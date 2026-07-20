import { execFile } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createCaptureChunkWriter, isValidOperatorChecklist, resolveDisplayMediaRequest } from '../../src/lib/video-generator/capture/windows-electron.js';
import { matchUniqueWindowSource } from '../../src/lib/video-generator/capture/source-matcher.js';
import { normalizeCapturedVideo, parseNormalizedVideoProbe } from '../../src/lib/video-generator/capture/normalize-video.js';
import { assertManualRunIsWritable, createManualRunArtifacts, ensureManualRunArtifactDirs, type ManualRunArtifacts } from '../../src/lib/video-generator/recording/artifacts.js';
import { launchManualChromiumSession, type ManualChromiumSession } from '../../src/lib/video-generator/recording/session.js';
import { writeCaptureOperatorChecklist, writeCapturePocReport, type CaptureOperatorChecklist, type CapturePocReport } from '../../src/lib/video-generator/recording/poc-report.js';
import type { CaptureSourceDescriptor } from '../../src/lib/video-generator/capture/types.js';

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
  startCapture?: (args: Required<Omit<ManualPocArgs, 'help'>>) => Promise<void>;
  cleanup?: () => Promise<void>;
}

export interface ManualCapturePocResult {
  exitCode: number;
  message: string;
}

const USAGE = `Usage: capture-main --output <dir> --display-mode f11|borderless-maximized --fixture capture|clock|events --duration-seconds <positive integer>`;
const execFileAsync = promisify(execFile);

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

export async function runManualCapturePoc(argv: string[], deps: ManualCapturePocDeps = {}): Promise<ManualCapturePocResult> {
  const cleanup = deps.cleanup ?? asyncNoop;
  try {
    const parsed = parseManualPocArgs(argv);
    if (parsed.help) {
      return { exitCode: 0, message: USAGE };
    }
    const normalized = normalizeArgs(parsed);
    if ((deps.platform ?? process.platform) !== 'win32') {
      return { exitCode: 3, message: 'Manual capture POC only supports Windows.' };
    }
    await deps.prepareOutput?.(normalized);
    try {
      await deps.bindSource?.(normalized);
    } catch (error) {
      return { exitCode: 4, message: formatError(error) };
    }
    try {
      await deps.startCapture?.(normalized);
    } catch (error) {
      return { exitCode: 5, message: formatError(error) };
    }
    return { exitCode: 0, message: 'Manual capture POC completed.' };
  } catch (error) {
    return { exitCode: 2, message: `${formatError(error)}\n${USAGE}` };
  } finally {
    await cleanup();
  }
}

async function createRealManualCaptureDeps(): Promise<ManualCapturePocDeps> {
  const electron = await import('electron');
  let artifacts: ManualRunArtifacts | null = null;
  let chromiumSession: ManualChromiumSession | null = null;
  let matchedSource: DesktopCapturerSourceLike | null = null;

  const cleanup = async () => {
    electron.globalShortcut.unregisterAll();
    electron.session.defaultSession.setDisplayMediaRequestHandler(null);
    await chromiumSession?.close().catch(() => undefined);
    if (electron.app.isReady()) {
      electron.app.quit();
    }
  };

  await electron.app.whenReady();

  return {
    platform: process.platform,
    async prepareOutput(args) {
      artifacts = createManualRunArtifacts(args.output);
      await ensureManualRunArtifactDirs(artifacts);
      await assertManualRunIsWritable(artifacts);
    },
    async bindSource(args) {
      if (artifacts === null) {
        throw new Error('Manual capture artifacts were not prepared.');
      }
      const sessionId = String(Date.now());
      chromiumSession = await launchManualChromiumSession({
        sessionId,
        fixtureDir: path.dirname(fileURLToPath(import.meta.url)),
      });
      matchedSource = await waitForUniqueWindowSource(electron, chromiumSession.bindingTitle, 10_000);
      await chromiumSession.navigateToFixture(args.fixture);
      console.log(`Bound Chromium window source: ${matchedSource.name} (${matchedSource.id})`);
      if (args.displayMode === 'f11') {
        console.log('请切到 Chromium 窗口并按 F11，然后回到控制窗点击“开始”。');
      } else {
        console.log('borderless-maximized 模式将在后续步骤接入 Windows window mode helper；当前先使用普通最大化窗口。');
      }
    },
    async startCapture(args) {
      if (artifacts === null || matchedSource === null) {
        throw new Error('Manual capture source was not bound.');
      }
      await runElectronCaptureSession(electron, args, artifacts, matchedSource);
    },
    cleanup,
  };
}

async function runElectronCaptureSession(
  electron: ElectronModule,
  args: Required<Omit<ManualPocArgs, 'help'>>,
  artifacts: ManualRunArtifacts,
  source: DesktopCapturerSourceLike,
): Promise<CapturePocReport> {
  const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture-preload.cjs');
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
  const chunkWriter = createCaptureChunkWriter(async (bytes) => {
    await appendFile(artifacts.rawVideoPath, bytes);
  });
  let firstChunkMarked = false;
  let stopped = false;
  let captureError: string | null = null;
  let video: CapturePocReport['video'] = { status: 'unavailable', path: null, reason: 'capture not stopped' };
  let normalizedVideoStatus: CapturePocReport['normalizedVideoStatus'] = 'failed';
  let checklist: CaptureOperatorChecklist | null = null;

  const reportBase = (): Omit<CapturePocReport, 'status' | 'overlayEnteredCapture' | 'multiTabContinuous' | 'errors'> => ({
    version: 1,
    displayMode: args.displayMode,
    displayScaleFactor: display.scaleFactor,
    video,
    overlayAlwaysOnTop: controlWindow.isAlwaysOnTop(),
    normalizedVideoStatus,
    windowModeRestoreRequired: false,
    evidence: {
      operatorChecklistPath: artifacts.captureOperatorChecklistPath,
      ffprobeJsonPath: artifacts.captureFfprobeJsonPath,
      sampledFrames: [],
    },
  });

  const finishWithReport = async (): Promise<CapturePocReport> => {
    const errors = captureError === null ? [] : [captureError];
    const status: CapturePocReport['status'] = video.status === 'available'
      && normalizedVideoStatus === 'passed'
      && checklist !== null
      && checklist.overlayEnteredCapture === false
      && checklist.multiTabContinuous
      && errors.length === 0
      ? 'passed'
      : checklist === null
        ? 'incomplete'
        : 'failed';
    const report: CapturePocReport = {
      ...reportBase(),
      status,
      overlayEnteredCapture: checklist?.overlayEnteredCapture ?? null,
      multiTabContinuous: checklist?.multiTabContinuous ?? null,
      errors,
    };
    await writeCapturePocReport(artifacts.capturePocReportPath, report);
    return report;
  };

  const completion = new Promise<CapturePocReport>((resolve, reject) => {
    electron.ipcMain.handle('capture:first-chunk', async (_event, sequence: unknown) => {
      if (sequence !== 0 || firstChunkMarked) {
        throw new Error('First capture chunk must be reported exactly once with sequence 0.');
      }
      firstChunkMarked = true;
    });
    electron.ipcMain.handle('capture:append-chunk', async (_event, bytes: unknown, sequence: unknown) => {
      if (!(bytes instanceof Uint8Array) || typeof sequence !== 'number') {
        throw new Error('Invalid capture chunk payload.');
      }
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

  electron.globalShortcut.register('F10', () => {
    controlWindow.webContents.executeJavaScript('window.dispatchEvent(new Event("manual-capture-stop-request"));').catch(() => undefined);
  });

  controlWindow.once('ready-to-show', () => controlWindow.show());
  await controlWindow.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture.html'), {
    query: { durationSeconds: String(args.durationSeconds) },
  });
  console.log('控制窗已打开：点击“开始”开始窗口捕获；结束时可按 F10 或点击“结束”，随后提交验收勾选。');

  return completion.finally(() => {
    electron.ipcMain.removeHandler('capture:first-chunk');
    electron.ipcMain.removeHandler('capture:append-chunk');
    electron.ipcMain.removeHandler('capture:flush');
    electron.ipcMain.removeHandler('capture:stop');
    electron.ipcMain.removeHandler('capture:submit-checklist');
    electron.session.defaultSession.setDisplayMediaRequestHandler(null);
    electron.globalShortcut.unregister('F10');
    if (!controlWindow.isDestroyed()) {
      controlWindow.close();
    }
  });
}

async function waitForUniqueWindowSource(electron: ElectronModule, expectedTitle: string, timeoutMs: number): Promise<DesktopCapturerSourceLike> {
  const startedAt = Date.now();
  let lastMissingError: Error | null = null;
  while (Date.now() - startedAt <= timeoutMs) {
    const sources = (await electron.desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false })) as DesktopCapturerSourceLike[];
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function asyncNoop(): Promise<void> {}

if (shouldRunManualCaptureEntrypoint({ argv1: process.argv[1], modulePath: fileURLToPath(import.meta.url), isElectronMain: process.versions.electron !== undefined })) {
  let result: ManualCapturePocResult;
  try {
    const parsed = parseManualPocArgs(process.argv.slice(2));
    if (parsed.help) {
      result = await runManualCapturePoc(['--help']);
    } else {
      const deps = await createRealManualCaptureDeps();
      result = await runManualCapturePoc(process.argv.slice(2), deps);
    }
  } catch (error) {
    result = { exitCode: 2, message: `${formatError(error)}\n${USAGE}` };
  }
  if (result.message) {
    const output = result.exitCode === 0 ? console.log : console.error;
    output(result.message);
  }
  process.exit(result.exitCode);
}
