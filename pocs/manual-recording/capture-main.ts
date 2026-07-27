import { execFile } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createCaptureChunkWriter, isValidOperatorChecklist, resolveDisplayMediaRequest } from '../../src/lib/video-generator/capture/windows-electron.js';
import { matchUniqueWindowSource } from '../../src/lib/video-generator/capture/source-matcher.js';
import { normalizeCapturedVideo, parseNormalizedVideoProbe } from '../../src/lib/video-generator/capture/normalize-video.js';
import {
  enableBorderlessWindowMode,
  restoreBorderlessWindowMode,
  type AppliedBorderlessWindowMode,
  type WindowsCommand,
} from '../../src/lib/video-generator/capture/windows-window-mode.js';
import { assertManualRunIsWritable, createManualRunArtifacts, ensureManualRunArtifactDirs, type ManualRunArtifacts } from '../../src/lib/video-generator/recording/artifacts.js';
import {
  createTimestampedObserverEventSink,
  installManualCaptureObservers,
  launchManualChromiumSession,
  type ManualCaptureObservers,
  type ManualChromiumSession,
  type TimestampedObserverEventSink,
} from '../../src/lib/video-generator/recording/session.js';
import {
  capturePocEvidenceErrors,
  writeCaptureOperatorChecklist,
  writeCapturePocReport,
  type CaptureOperatorChecklist,
  type CapturePocReport,
  type CaptureWindowModeEvidence,
} from '../../src/lib/video-generator/recording/poc-report.js';
import { createRecordingClock, type RecordingClock } from '../../src/lib/video-generator/recording/clock.js';
import { createEventLog } from '../../src/lib/video-generator/recording/event-log.js';
import { analyzeClockDrift } from '../../src/lib/video-generator/recording/drift.js';
import { writeRecordingManifest } from '../../src/lib/video-generator/recording/manifest.js';
import { writeManualEventsPocReport } from '../../src/lib/video-generator/recording/events-poc-report.js';
import type { CaptureSourceDescriptor } from '../../src/lib/video-generator/capture/types.js';
import type { CaptureClockSample, RecordingEvent, RecordingManifest } from '../../src/lib/video-generator/recording/types.js';

export type ManualDisplayMode = 'f11' | 'borderless-maximized';
export type ManualPocFixture = 'capture' | 'clock' | 'events';

export interface ManualPocArgs {
  help: boolean;
  output?: string;
  displayMode?: ManualDisplayMode;
  fixture?: ManualPocFixture;
  durationSeconds?: number;
}

export interface ManualCapturePocDeps {
  platform?: NodeJS.Platform;
  prepareOutput?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  bindSource?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  applyWindowMode?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  startCapture?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  restoreWindowMode?: () => Promise<void>;
  cleanup?: () => Promise<void>;
}

export interface ManualCapturePocResult {
  exitCode: number;
  message: string;
}

const USAGE = `Usage: capture-main --output <dir> --display-mode f11|borderless-maximized --fixture capture|clock|events --duration-seconds <positive integer>`;
const execFileAsync = promisify(execFile);

export function formatManualPocLogStep(message: string): string {
  return `[manual-poc] ${message}`;
}

function logStep(message: string): void {
  console.log(formatManualPocLogStep(message));
}

type ElectronModule = typeof import('electron');
type DesktopCapturerSourceLike = CaptureSourceDescriptor & { thumbnail?: unknown };

export function parseManualPocArgs(argv: string[]): ManualPocArgs {
  const result: ManualPocArgs = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      return { help: true };
    }
    if (!['--output', '--display-mode', '--fixture', '--duration-seconds'].includes(arg)) {
      throw new Error(`Unknown option: ${arg}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}.`);
    }
    switch (arg) {
      case '--output':
        result.output = value;
        break;
      case '--display-mode':
        if (value !== 'f11' && value !== 'borderless-maximized') {
          throw new Error(`Invalid --display-mode: ${value}.`);
        }
        result.displayMode = value;
        break;
      case '--fixture':
        if (value !== 'capture' && value !== 'clock' && value !== 'events') {
          throw new Error(`Invalid --fixture: ${value}.`);
        }
        result.fixture = value;
        break;
      case '--duration-seconds': {
        const durationSeconds = Number(value);
        if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
          throw new Error('--duration-seconds must be a positive integer.');
        }
        result.durationSeconds = durationSeconds;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}.`);
    }
    index += 1;
  }

  for (const required of ['output', 'displayMode', 'fixture', 'durationSeconds'] as const) {
    if (result[required] === undefined) {
      throw new Error(`Missing required option: --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
    }
  }

  return result;
}

export function shouldRunManualCaptureEntrypoint(input: {
  argv1: string | undefined;
  modulePath: string;
  isElectronMain: boolean;
}): boolean {
  return input.isElectronMain || input.argv1 === input.modulePath;
}

export function createManualMarkerController(
  clock: RecordingClock,
  requestStop: () => void,
  log: (message: string) => void = logStep,
  onEvent: (event: RecordingEvent) => void | Promise<void> = asyncNoop,
) {
  const markerEvents: RecordingEvent[] = [];
  let stopRequested = false;

  const recordUserMarker = (type: string): RecordingEvent => {
    const event: RecordingEvent = { type, ...clock.stamp() };
    markerEvents.push(event);
    log(`recorded marker ${type} at session=${event.sessionTimeMs}ms video=${event.videoTimeMs ?? 'null'}ms`);
    void Promise.resolve(onEvent(event)).catch((error) => log(`failed to append marker event: ${formatError(error)}`));
    return event;
  };

  return {
    stamp() {
      return clock.stamp();
    },
    markFirstVideoFrame() {
      return clock.markFirstVideoFrame();
    },
    firstVideoFrameSessionTimeMs() {
      return clock.firstVideoFrameSessionTimeMs();
    },
    recordUserMarker,
    requestStopConfirmation() {
      if (!stopRequested) {
        stopRequested = true;
        recordUserMarker('recording-stop-requested');
        return;
      }
      recordUserMarker('recording-stop');
      requestStop();
    },
    events() {
      return [...markerEvents];
    },
  };
}

export async function runManualCapturePoc(argv: string[], deps: ManualCapturePocDeps = {}): Promise<ManualCapturePocResult> {
  const cleanup = deps.cleanup ?? asyncNoop;
  let result: ManualCapturePocResult;
  let restoreWindowMode = false;
  try {
    const parsed = parseManualPocArgs(argv);
    if (parsed.help) {
      result = { exitCode: 0, message: USAGE };
    } else {
      const normalized = normalizeArgs(parsed);
      if ((deps.platform ?? process.platform) !== 'win32') {
        result = { exitCode: 3, message: 'Manual capture POC only supports Windows.' };
      } else {
        await deps.prepareOutput?.(normalized);
        try {
          await deps.bindSource?.(normalized);
        } catch (error) {
          result = { exitCode: 4, message: formatError(error) };
          return result;
        }
        try {
          if (normalized.displayMode === 'borderless-maximized') {
            restoreWindowMode = true;
            await deps.applyWindowMode?.(normalized);
          }
          await deps.startCapture?.(normalized);
          result = { exitCode: 0, message: 'Manual capture POC completed.' };
        } catch (error) {
          result = { exitCode: 5, message: formatError(error) };
        }
      }
    }
  } catch (error) {
    result = { exitCode: 2, message: `${formatError(error)}\n${USAGE}` };
  } finally {
    if (restoreWindowMode) {
      try {
        await deps.restoreWindowMode?.();
      } catch (error) {
        result = { exitCode: 5, message: `Window mode restore failed: ${formatError(error)}` };
      }
    }
    await cleanup();
  }
  return result!;
}

async function createRealManualCaptureDeps(): Promise<ManualCapturePocDeps> {
  logStep('importing Electron module');
  const electron = await import('electron');
  logStep('Electron module imported');
  logStep(`process argv: ${JSON.stringify(process.argv)}`);
  logStep(`Electron versions: ${JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node })}`);
  logStep(`Electron app initial ready state: ${electron.app.isReady()}`);
  electron.app.once('will-finish-launching', () => logStep('Electron app event: will-finish-launching'));
  electron.app.once('ready', () => logStep('Electron app event: ready'));
  electron.app.once('window-all-closed', () => logStep('Electron app event: window-all-closed'));
  let artifacts: ManualRunArtifacts | null = null;
  let chromiumSession: ManualChromiumSession | null = null;
  let matchedSource: DesktopCapturerSourceLike | null = null;
  let borderlessMode: AppliedBorderlessWindowMode | null = null;
  let windowModeEvidence: CaptureWindowModeEvidence | null = null;
  let lastCaptureReport: CapturePocReport | null = null;
  let eventLog: Awaited<ReturnType<typeof createEventLog>> | null = null;
  let recordingClock: RecordingClock | null = null;
  let observerSink: TimestampedObserverEventSink | null = null;
  let observers: ManualCaptureObservers | null = null;
  let fixture: ManualPocFixture | null = null;
  let eventCaptureFinalized = false;
  let eventWriteQueue = Promise.resolve();
  const appendRecordingEvent = async (event: RecordingEvent) => {
    const operation = eventWriteQueue.catch(() => undefined).then(async () => {
      if (eventLog === null) throw new Error('Manual capture event log is not open.');
      await eventLog.append(event);
    });
    eventWriteQueue = operation;
    await operation;
  };

  const finalizeEventCapture = async () => {
    if (eventCaptureFinalized) return;
    eventCaptureFinalized = true;
    await chromiumSession?.close().catch(() => undefined);
    chromiumSession = null;
    await observers?.flush();
    await observerSink?.flush();
    await eventWriteQueue.catch(() => undefined);
    await eventLog?.close().catch(() => undefined);
    if (fixture === 'events' && artifacts !== null) {
      await writeManualEventsPocReport({
        eventsPath: artifacts.eventsPath,
        tabsPath: artifacts.tabsPath,
        reportPath: artifacts.manualEventsPocReportPath,
        eventCaptureComplete: (observers?.eventCaptureComplete ?? false)
          && (observerSink?.eventCaptureComplete ?? false),
      });
    }
  };

  const cleanup = async () => {
    electron.globalShortcut.unregisterAll();
    electron.session.defaultSession.setDisplayMediaRequestHandler(null);
    await finalizeEventCapture().catch((error) => logStep(`event capture finalization failed: ${formatError(error)}`));
    if (electron.app.isReady()) {
      electron.app.quit();
    }
  };

  logStep('waiting for Electron app ready');
  await electron.app.whenReady();
  logStep('Electron app ready');

  return {
    platform: process.platform,
    async prepareOutput(args) {
      logStep(`preparing output at ${args.output}`);
      artifacts = createManualRunArtifacts(args.output);
      await ensureManualRunArtifactDirs(artifacts);
      await assertManualRunIsWritable(artifacts);
      fixture = args.fixture;
      recordingClock = createRecordingClock();
      eventLog = await createEventLog(artifacts.eventsPath);
      logStep('output prepared');
    },
    async bindSource(args) {
      if (artifacts === null) {
        throw new Error('Manual capture artifacts were not prepared.');
      }
      const sessionId = String(Date.now());
      logStep(`launching Chromium session ${sessionId}`);
      chromiumSession = await launchManualChromiumSession({
        sessionId,
        fixtureDir: path.dirname(fileURLToPath(import.meta.url)),
      });
      if (args.fixture === 'events') {
        if (recordingClock === null || eventLog === null) {
          throw new Error('Events fixture recording clock and event log were not prepared.');
        }
        observerSink = createTimestampedObserverEventSink({
          clock: recordingClock,
          append: appendRecordingEvent,
        });
        observers = await installManualCaptureObservers({
          context: chromiumSession.context,
          tabsPath: artifacts.tabsPath,
          onEvent: observerSink.onEvent,
        });
      }
      logStep(`Chromium launched with binding title ${chromiumSession.bindingTitle}`);
      logStep('polling desktop sources for Chromium binding window');
      matchedSource = await waitForUniqueWindowSource(electron, chromiumSession.bindingTitle, 10_000);
      windowModeEvidence = {
        requested: args.displayMode,
        applied: false,
        restored: args.displayMode === 'f11' ? null : false,
        handle: null,
        snapshot: null,
        errors: [],
      };
      logStep(`source bound: ${matchedSource.name} (${matchedSource.id})`);
      logStep(`navigating Chromium to ${args.fixture} fixture`);
      await chromiumSession.navigateToFixture(args.fixture);
      logStep(`Chromium fixture loaded: ${args.fixture}`);
      console.log(`Bound Chromium window source: ${matchedSource.name} (${matchedSource.id})`);
      if (args.displayMode === 'f11') {
        console.log('请切到 Chromium 窗口并按 F11，然后回到控制窗点击“开始”。');
      } else {
        console.log('borderless-maximized 模式将在后续步骤接入 Windows window mode helper；当前先使用普通最大化窗口。');
      }
    },
    async applyWindowMode(args) {
      if (args.displayMode !== 'borderless-maximized') return;
      if (matchedSource === null) {
        throw new Error('Manual capture source was not bound before applying window mode.');
      }
      logStep(`applying borderless window mode to ${matchedSource.id}`);
      borderlessMode = await enableBorderlessWindowMode(matchedSource.id, runWindowsCommand);
      windowModeEvidence = {
        requested: 'borderless-maximized',
        applied: true,
        restored: false,
        handle: borderlessMode.handle.toString(),
        snapshot: {
          style: borderlessMode.snapshot.style.toString(),
          exStyle: borderlessMode.snapshot.exStyle.toString(),
          bounds: borderlessMode.snapshot.bounds,
        },
        errors: [],
      };
      logStep(`borderless window mode applied to handle ${borderlessMode.handle.toString()}`);
    },
    async startCapture(args) {
      if (artifacts === null || matchedSource === null) {
        throw new Error('Manual capture source was not bound.');
      }
      if (eventLog === null || recordingClock === null) {
        throw new Error('Manual capture event log and clock were not prepared.');
      }
      try {
        if (windowModeEvidence === null) {
          throw new Error('Window mode evidence was not initialized.');
        }
        lastCaptureReport = await runElectronCaptureSession(
          electron,
          args,
          artifacts,
          matchedSource,
          recordingClock,
          appendRecordingEvent,
          windowModeEvidence,
        );
      } finally {
        await finalizeEventCapture();
      }
    },
    async restoreWindowMode() {
      if (borderlessMode === null) return;
      logStep(`restoring borderless window mode for handle ${borderlessMode.handle.toString()}`);
      try {
        await restoreBorderlessWindowMode(borderlessMode, runWindowsCommand);
        if (windowModeEvidence !== null) windowModeEvidence.restored = true;
        logStep('borderless window mode restored');
      } catch (error) {
        if (windowModeEvidence !== null) {
          windowModeEvidence.restored = false;
          windowModeEvidence.errors.push(formatError(error));
        }
        throw error;
      } finally {
        borderlessMode = null;
        if (lastCaptureReport !== null && artifacts !== null && windowModeEvidence !== null) {
          const updated: CapturePocReport = {
            ...lastCaptureReport,
            windowModeRestoreRequired: windowModeEvidence.restored !== true,
            windowMode: windowModeEvidence,
          };
          updated.status = capturePocEvidenceErrors(updated).length === 0 ? 'passed' : 'failed';
          await writeCapturePocReport(artifacts.capturePocReportPath, updated);
          lastCaptureReport = updated;
        }
      }
    },
    cleanup,
  };
}

async function runElectronCaptureSession(
  electron: ElectronModule,
  args: Required<Omit<ManualPocArgs, 'help'>>,
  artifacts: ManualRunArtifacts,
  source: DesktopCapturerSourceLike,
  recordingClock: RecordingClock,
  appendRecordingEvent: (event: RecordingEvent) => Promise<void>,
  windowModeEvidence: CaptureWindowModeEvidence,
): Promise<CapturePocReport> {
  const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture-preload.cjs');
  logStep(`creating control window with preload ${preloadPath}`);
  const controlWindow = new electron.BrowserWindow({
    width: 320,
    height: 220,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const display = electron.screen.getPrimaryDisplay();
  const markerController = createManualMarkerController(recordingClock, () => {
    controlWindow.webContents.executeJavaScript('window.dispatchEvent(new Event("manual-capture-stop-request"));').catch(() => undefined);
  }, logStep, async (event) => {
    await appendRecordingEvent(event);
  });
  const chunkWriter = createCaptureChunkWriter(async (bytes) => {
    await appendFile(artifacts.rawVideoPath, bytes);
  });
  let firstChunkMarked = false;
  let stopped = false;
  let captureError: string | null = null;
  let video: CapturePocReport['video'] = { status: 'unavailable', path: null, reason: 'capture not stopped' };
  let normalizedVideoStatus: CapturePocReport['normalizedVideoStatus'] = 'failed';
  let checklist: CaptureOperatorChecklist | null = null;
  let sampledFrames: string[] = [];
  let clockSamples: CaptureClockSample[] = [];

  const reportBase = (): Omit<CapturePocReport, 'status' | 'overlayEnteredCapture' | 'multiTabContinuous' | 'errors'> => ({
    version: 1,
    displayMode: args.displayMode,
    displayScaleFactor: display.scaleFactor,
    video,
    overlayAlwaysOnTop: controlWindow.isAlwaysOnTop(),
    normalizedVideoStatus,
    windowModeRestoreRequired: args.displayMode === 'borderless-maximized' && windowModeEvidence.restored !== true,
    windowMode: windowModeEvidence,
    evidence: {
      operatorChecklistPath: artifacts.captureOperatorChecklistPath,
      ffprobeJsonPath: artifacts.captureFfprobeJsonPath,
      sampledFrames,
    },
  });

  const finishWithReport = async (): Promise<CapturePocReport> => {
    const errors = captureError === null ? [] : [captureError];
    const report: CapturePocReport = {
      ...reportBase(),
      status: 'incomplete',
      overlayEnteredCapture: checklist?.overlayEnteredCapture ?? null,
      multiTabContinuous: checklist?.multiTabContinuous ?? null,
      errors,
    };
    report.status = checklist === null
      ? 'incomplete'
      : capturePocEvidenceErrors(report).length === 0
        ? 'passed'
        : 'failed';
    await writeCapturePocReport(artifacts.capturePocReportPath, report);
    return report;
  };

  const completion = new Promise<CapturePocReport>((resolve, reject) => {
    electron.ipcMain.handle('capture:first-chunk', async (_event, sequence: unknown) => {
      if (sequence !== 0 || firstChunkMarked) {
        throw new Error('First capture chunk must be reported exactly once with sequence 0.');
      }
      firstChunkMarked = true;
      markerController.markFirstVideoFrame();
    });
    electron.ipcMain.handle('capture:append-chunk', async (_event, bytes: unknown, sequence: unknown, timecode: unknown) => {
      if (!(bytes instanceof Uint8Array) || typeof sequence !== 'number' || typeof timecode !== 'number') {
        throw new Error('Invalid capture chunk payload.');
      }
      const timestamp = markerController.stamp();
      const sample: CaptureClockSample = { ...timestamp, mediaTimeMs: timecode };
      clockSamples.push(sample);
      await appendRecordingEvent({ ...timestamp, type: 'capture-clock-sample', payload: { mediaTimeMs: timecode } });
      await chunkWriter.appendChunk(bytes, sequence);
    });
    electron.ipcMain.handle('capture:flush', async (_event, lastSequence: unknown) => {
      if (typeof lastSequence !== 'number') {
        throw new Error('Invalid capture flush sequence.');
      }
      await chunkWriter.flush(lastSequence);
    });
    electron.ipcMain.handle('capture:stop', async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        await normalizeCapturedVideo({ inputPath: artifacts.rawVideoPath, outputPath: artifacts.originalVideoPath, runCommand: defaultRunCommand });
        const probe = await defaultRunCommand('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration', '-of', 'json', artifacts.originalVideoPath]);
        await writeFile(artifacts.captureFfprobeJsonPath, `${probe.stdout}\n`, 'utf8');
        const metadata = parseNormalizedVideoProbe(probe.stdout);
        sampledFrames = await extractSampledFrames({
          videoPath: artifacts.originalVideoPath,
          framesDir: artifacts.captureEvidenceFramesDir,
          durationMs: metadata.durationMs,
          runCommand: defaultRunCommand,
        });
        video = {
          status: 'available',
          path: artifacts.originalVideoPath,
          width: metadata.width ?? 0,
          height: metadata.height ?? 0,
          fps: metadata.fps ?? 0,
          durationMs: metadata.durationMs,
          hasAudio: false,
        };
        normalizedVideoStatus = 'passed';
      } catch (error) {
        captureError = formatError(error);
        video = { status: 'unavailable', path: null, reason: captureError };
      }
      await writeRecordingManifest(artifacts.manifestPath, buildRecordingManifest({
        artifacts,
        video,
        samples: clockSamples,
        firstVideoFrameSessionTimeMs: markerController.firstVideoFrameSessionTimeMs(),
        captureComplete: captureError === null,
      }));
    });
    electron.ipcMain.handle('capture:submit-checklist', async (_event, value: unknown) => {
      if (!isValidOperatorChecklist(value)) {
        throw new Error('Invalid operator checklist payload.');
      }
      checklist = value;
      await writeCaptureOperatorChecklist(artifacts.captureOperatorChecklistPath, value);
      finishWithReport().then(resolve, reject);
    });
  });

  logStep('registering display media request handler');
  electron.session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    try {
      const frame = request.frame;
      const requestWebContents = frame === null || frame.isDestroyed() ? null : electron.webContents.fromFrame(frame);
      const resolved = resolveDisplayMediaRequest({
        requestFrame: frame === null ? null : { routingId: frame.routingId, destroyed: frame.isDestroyed() },
        requestWebContentsId: requestWebContents?.id ?? null,
        controlWebContentsId: controlWindow.webContents.id,
        controlMainFrameRoutingId: controlWindow.webContents.mainFrame.routingId,
        source,
      });
      callback(resolved);
    } catch {
      callback({});
    }
  });

  logStep('registering F7/F9/F10 global shortcuts');
  const f7Registered = electron.globalShortcut.register('F7', () => markerController.recordUserMarker('recording-start'));
  const f9Registered = electron.globalShortcut.register('F9', () => markerController.recordUserMarker('retry-start'));
  const f10Registered = electron.globalShortcut.register('F10', () => markerController.requestStopConfirmation());
  logStep(`F7 global shortcut registered: ${f7Registered}`);
  logStep(`F9 global shortcut registered: ${f9Registered}`);
  logStep(`F10 global shortcut registered: ${f10Registered}`);

  controlWindow.once('ready-to-show', () => {
    logStep('control window ready-to-show');
    controlWindow.show();
    logStep('control window shown');
  });
  const captureHtmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture.html');
  logStep(`loading control window file ${captureHtmlPath}`);
  await controlWindow.loadFile(captureHtmlPath, {
    query: { durationSeconds: String(args.durationSeconds) },
  });
  logStep('control window loadFile resolved');
  console.log('控制窗已打开：点击“开始”开始窗口捕获；结束时可按 F10 或点击“结束”，随后提交验收勾选。');

  return completion.finally(async () => {
    electron.ipcMain.removeHandler('capture:first-chunk');
    electron.ipcMain.removeHandler('capture:append-chunk');
    electron.ipcMain.removeHandler('capture:flush');
    electron.ipcMain.removeHandler('capture:stop');
    electron.ipcMain.removeHandler('capture:submit-checklist');
    electron.session.defaultSession.setDisplayMediaRequestHandler(null);
    electron.globalShortcut.unregister('F7');
    electron.globalShortcut.unregister('F9');
    electron.globalShortcut.unregister('F10');
    if (!controlWindow.isDestroyed()) {
      controlWindow.close();
    }
  });
}

async function waitForUniqueWindowSource(electron: ElectronModule, expectedTitle: string, timeoutMs: number): Promise<DesktopCapturerSourceLike> {
  const startedAt = Date.now();
  let lastMissingError: Error | null = null;
  let attempt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;
    logStep(`desktop source poll #${attempt}`);
    const sources = (await electron.desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false })) as DesktopCapturerSourceLike[];
    logStep(`desktop source poll #${attempt} returned ${sources.length} window source(s)`);
    if (attempt === 1 || attempt % 10 === 0) {
      const sourceSummary = sources.slice(0, 20).map((source) => `${source.id}:${source.name}`).join(' | ');
      logStep(`desktop source names: ${sourceSummary}`);
    }
    try {
      const matched = matchUniqueWindowSource(sources, expectedTitle);
      return sources.find((source) => source.id === matched.id) ?? matched;
    } catch (error) {
      if (error instanceof Error && /Multiple/i.test(error.message)) {
        throw error;
      }
      lastMissingError = error instanceof Error ? error : new Error(String(error));
      await delay(250);
    }
  }
  throw lastMissingError ?? new Error(`Chromium capture source "${expectedTitle}" was not found.`);
}

function normalizeArgs(parsed: ManualPocArgs): Required<Omit<ManualPocArgs, 'help'>> {
  if (parsed.output === undefined || parsed.displayMode === undefined || parsed.fixture === undefined || parsed.durationSeconds === undefined) {
    throw new Error('Missing required manual capture POC options.');
  }
  return {
    output: path.resolve(parsed.output),
    displayMode: parsed.displayMode,
    fixture: parsed.fixture,
    durationSeconds: parsed.durationSeconds,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultRunCommand = async (command: string, args: string[]) => execFileAsync(command, args);

const runWindowsCommand = async (command: WindowsCommand) => {
  const result = await execFileAsync(command.command, command.args);
  return { stdout: result.stdout, stderr: result.stderr };
};

function buildRecordingManifest(input: {
  artifacts: ManualRunArtifacts;
  video: CapturePocReport['video'];
  samples: CaptureClockSample[];
  firstVideoFrameSessionTimeMs: number | null;
  captureComplete: boolean;
}): RecordingManifest {
  const availableDurationMs = input.video.status === 'available' ? input.video.durationMs : 0;
  const drift = analyzeClockDrift(input.samples, availableDurationMs);
  const recordingEndMs = input.samples.at(-1)?.sessionTimeMs ?? 0;
  return {
    version: 1,
    platform: 'win32',
    video: input.video,
    rawVideoPath: input.artifacts.rawVideoPath,
    eventsPath: input.artifacts.eventsPath,
    tabsPath: input.artifacts.tabsPath,
    recordingStartMs: 0,
    recordingEndMs,
    firstVideoFrameSessionTimeMs: input.firstVideoFrameSessionTimeMs,
    attempts: [],
    clockStatus: drift.status,
    maxObservedDriftMs: drift.maxObservedDriftMs,
    maxAllowedDriftMs: drift.maxAllowedDriftMs,
    captureComplete: input.captureComplete && drift.status === 'ok',
  };
}

async function extractSampledFrames(input: {
  videoPath: string;
  framesDir: string;
  durationMs: number;
  runCommand: typeof defaultRunCommand;
}): Promise<string[]> {
  await mkdir(input.framesDir, { recursive: true });
  const durationSeconds = Math.max(0, input.durationMs / 1000);
  const samples = [
    { name: 'frame-001-start.png', atSeconds: 0.1 },
    { name: 'frame-002-middle.png', atSeconds: durationSeconds / 2 },
    { name: 'frame-003-end.png', atSeconds: Math.max(0, durationSeconds - 0.1) },
  ];
  const paths: string[] = [];
  for (const sample of samples) {
    const framePath = path.join(input.framesDir, sample.name);
    await input.runCommand('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', sample.atSeconds.toFixed(3),
      '-i', input.videoPath,
      '-frames:v', '1',
      framePath,
    ]);
    paths.push(framePath);
  }
  return paths;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function asyncNoop(): Promise<void> {}

export async function runManualCaptureEntrypoint(input: {
  argv: string[];
  createDeps?: () => Promise<ManualCapturePocDeps>;
  log?: (message: string) => void;
  error?: (message: string) => void;
}): Promise<ManualCapturePocResult> {
  const log = input.log ?? console.log;
  const errorLog = input.error ?? console.error;
  let result: ManualCapturePocResult;
  try {
    const parsed = parseManualPocArgs(input.argv);
    if (parsed.help) {
      result = await runManualCapturePoc(['--help']);
    } else {
      const deps = await (input.createDeps ?? createRealManualCaptureDeps)();
      result = await runManualCapturePoc(input.argv, deps);
    }
  } catch (error) {
    result = { exitCode: 2, message: `${formatError(error)}\n${USAGE}` };
  }
  if (result.message) {
    const output = result.exitCode === 0 ? log : errorLog;
    output(result.message);
  }
  return result;
}

if (shouldRunManualCaptureEntrypoint({ argv1: process.argv[1], modulePath: fileURLToPath(import.meta.url), isElectronMain: process.versions.electron !== undefined })) {
  void runManualCaptureEntrypoint({ argv: process.argv.slice(2) })
    .then((result) => {
      process.exit(result.exitCode);
    })
    .catch((error) => {
      console.error(`${formatError(error)}\n${USAGE}`);
      process.exit(2);
    });
}
