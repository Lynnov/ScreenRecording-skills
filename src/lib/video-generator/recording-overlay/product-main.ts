import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  webContents,
  type WebFrameMain,
} from 'electron';

import { createProductCaptureSession, type ElectronCaptureAdapter, type ProductCaptureResult, type ProductCaptureSession } from '../capture/electron-capture-session.js';
import { matchUniqueWindowSource } from '../capture/source-matcher.js';
import type { CaptureSourceDescriptor } from '../capture/types.js';
import {
  enableBorderlessWindowMode,
  restoreBorderlessWindowMode,
  type AppliedBorderlessWindowMode,
  type WindowsCommand,
} from '../capture/windows-window-mode.js';
import { createEventLog } from '../recording/event-log.js';
import { createRecordingClock } from '../recording/clock.js';
import {
  createTimestampedObserverEventSink,
  installManualCaptureObservers,
  launchProductManualChromiumSession,
  type ProductManualChromiumSession,
} from '../recording/session.js';
import { createManualBundle, ensureManualBundleDirs } from '../manual/bundle.js';
import { writeAtomicJson } from '../manual/atomic-writer.js';
import { loadApprovedGuide, runManualRecordController, type ManualRecordDisplayMode } from '../manual/record-controller.js';
import { runManualPickupController } from '../manual/pickup-controller.js';
import {
  getNextPickupAttemptFromArtifacts,
  readManualSourceCatalog,
} from '../manual/source-catalog.js';
import { createManualProductRuntime, type ManualProductRuntime } from '../manual/product-runtime.js';
import {
  runManualProductComposition,
  type ManualProductCompositionDeps,
  type ManualProductCompositionInput,
  type ManualProductLoadedInput,
} from '../manual/product-runtime-entry.js';
import { startManualRecordingOverlay, stopManualRecordingOverlay } from './main.js';

const execFileAsync = promisify(execFile);

interface ProductLoaded extends ManualProductLoadedInput {
  fullGuide: Awaited<ReturnType<typeof loadApprovedGuide>>;
}

export function createElectronCaptureAdapter(): ElectronCaptureAdapter {
  const listenerWrappers = new Map<string, (...args: unknown[]) => void>();
  return {
    createBrowserWindow(options) {
      const win = new BrowserWindow(options);
      win.webContents.on('preload-error', (_event, preloadPath, error) => {
        console.error(`[manual-recorder] preload failed: ${preloadPath}: ${error.message}`);
      });
      win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2) {
          console.error(`[manual-recorder] renderer level ${level}: ${message}`);
        }
      });
      win.webContents.on('render-process-gone', (_event, details) => {
        console.error(`[manual-recorder] renderer exited: ${details.reason} (${details.exitCode})`);
      });
      return win;
    },
    ipcMain: {
      handle: (channel, handler) => ipcMain.handle(channel, (event, payload) => handler({
        senderId: event.sender.id,
        senderFrame: event.senderFrame,
      }, payload)),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
      on: (channel, listener) => {
        const wrapper = (event: Electron.IpcMainEvent, payload: unknown) => listener({
          senderId: event.sender.id,
          senderFrame: event.senderFrame,
        }, payload);
        listenerWrappers.set(channel, wrapper as (...args: unknown[]) => void);
        ipcMain.on(channel, wrapper);
      },
      removeListener: (channel, listener) => {
        void listener;
        const wrapper = listenerWrappers.get(channel);
        if (wrapper !== undefined) {
          ipcMain.removeListener(channel, wrapper);
          listenerWrappers.delete(channel);
        }
      },
    },
    acquireDisplayMediaHandler(handler) {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        console.error('[manual-recorder] display-media request received');
        handler({ frame: request.frame }, (resolution) => {
          if (!('video' in resolution)) {
            console.error('[manual-recorder] display-media request was not authorized');
            callback({});
            return;
          }
          void desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false })
            .then((sources) => {
              const nativeSource = sources.find((candidate) => candidate.id === resolution.video.id);
              console.error(nativeSource === undefined
                ? `[manual-recorder] native source not found: ${resolution.video.id}`
                : `[manual-recorder] native source resolved: ${nativeSource.id}`);
              callback(nativeSource === undefined ? {} : { video: nativeSource });
            })
            .catch((error: unknown) => {
              console.error(`[manual-recorder] native source lookup failed: ${error instanceof Error ? error.message : String(error)}`);
              callback({});
            });
        });
      });
      return () => session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    },
    fromFrame: (frame) => webContents.fromFrame(frame as WebFrameMain) ?? null,
    frameToken: (frame) => {
      const value = frame as WebFrameMain;
      return `${value.processId}:${value.routingId}`;
    },
    frameIdentity: (frame) => {
      const value = frame as WebFrameMain;
      return {
        processId: value.processId,
        routingId: value.routingId,
        isMainFrame: value.parent === null,
      };
    },
    async getWindowSources() {
      const sources = await desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false });
      return sources.map(({ id, name }) => ({ id, name }));
    },
  };
}

export async function runProductMain(
  input: ManualProductCompositionInput,
): Promise<{ exitCode: number; reportPath: string }> {
  await app.whenReady();
  if (!app.requestSingleInstanceLock()) {
    throw new Error('Another manual recording runtime is already running.');
  }
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  const clock = createRecordingClock();
  let chromium: ProductManualChromiumSession | undefined;
  let captureSession: ProductCaptureSession | undefined;
  let captureResult: ProductCaptureResult | undefined;
  let runtime: ManualProductRuntime | undefined;
  let loaded: ProductLoaded | undefined;
  let borderless: AppliedBorderlessWindowMode | undefined;
  let pickupAttempt = 1;

  const deps: ManualProductCompositionDeps = {
    async loadInput(compositionInput) {
      const fullGuide = await loadApprovedGuide(compositionInput.runDir);
      const actions = compositionInput.mode === 'pickup'
        ? fullGuide.actions.filter((action) => action.segmentId === compositionInput.segmentId)
        : fullGuide.actions;
      if (actions.length === 0) throw new Error(`No approved guide actions for ${compositionInput.segmentId ?? 'recording'}.`);
      if (compositionInput.mode === 'pickup') {
        const catalog = await readManualSourceCatalog(bundle.sourceCatalogPath);
        pickupAttempt = await getNextPickupAttemptFromArtifacts(
          catalog,
          bundle.pickupsDir,
          compositionInput.segmentId!,
        );
      }
      loaded = {
        guide: { startUrl: fullGuide.startUrl, actionIds: actions.map((action) => action.id) },
        fullGuide,
        segmentId: compositionInput.segmentId ?? actions[0]!.segmentId,
        sourceId: compositionInput.mode === 'pickup'
          ? `${compositionInput.segmentId}-attempt-${String(pickupAttempt).padStart(3, '0')}`
          : 'original',
      };
      return loaded;
    },
    async launchChromium(value) {
      chromium = await launchProductManualChromiumSession({
        sessionId: `${Date.now()}-${process.pid}`,
        startUrl: value.guide.startUrl,
      });
      return chromium;
    },
    async bindSource(bindingTitle) {
      const startedAt = Date.now();
      let lastError: Error | undefined;
      while (Date.now() - startedAt <= 10_000) {
        try {
          const sources = await desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false });
          return matchUniqueWindowSource(sources.map(({ id, name }) => ({ id, name })), bindingTitle);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (/Multiple/i.test(lastError.message)) throw lastError;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      throw lastError ?? new Error(`Chromium capture source "${bindingTitle}" was not found.`);
    },
    async applyDisplayMode(source, mode) {
      if (mode === 'f11') return () => undefined;
      borderless = await enableBorderlessWindowMode(source.id, runWindowsCommand);
      return async () => {
        if (borderless !== undefined) await restoreBorderlessWindowMode(borderless, runWindowsCommand);
      };
    },
    async installObservers() {
      const eventLogPath = input.mode === 'recording'
        ? bundle.eventsPath
        : path.join(bundle.pickupsDir, `${loaded!.sourceId}.events.jsonl`);
      const tabsPath = input.mode === 'recording'
        ? bundle.tabsPath
        : path.join(bundle.pickupsDir, `${loaded!.sourceId}.tabs.json`);
      const eventLog = await createEventLog(eventLogPath);
      const sink = createTimestampedObserverEventSink({
        clock,
        append: (event) => eventLog.append(event),
      });
      const observers = await installManualCaptureObservers({
        context: chromium!.context,
        tabsPath,
        onEvent: (event) => sink.onEvent(event),
      });
      return {
        async close() {
          await observers.flush();
          await sink.flush();
          await eventLog.close();
        },
      };
    },
    createCapture({ source }) {
      const pickupOutput = input.segmentId === undefined
        ? bundle.originalVideoPath
        : bundle.pickupPath(input.segmentId, pickupAttempt);
      const rawVideoPath = input.segmentId === undefined
        ? bundle.rawVideoPath
        : path.join(bundle.captureDir, `${path.basename(pickupOutput, '.mp4')}.webm`);
      captureSession = createProductCaptureSession({
        electron: createElectronCaptureAdapter(),
        bindingTitle: chromium!.bindingTitle,
        boundSource: source,
        rawVideoPath,
        outputVideoPath: pickupOutput,
        recorderHtmlPath: path.join(moduleDir(), 'recorder.html'),
        recorderPreloadPath: path.join(moduleDir(), 'recorder-preload.cjs'),
        runCommand: (command, args) => execFileAsync(command, args),
        clock,
      });
      return captureSession;
    },
    createRuntime() {
      runtime = createManualProductRuntime({
        mode: input.mode,
        segmentId: loaded!.segmentId,
        actionIds: loaded!.guide.actionIds,
        segmentIdForAction: (actionId) => loaded!.fullGuide.actions.find((action) => action.id === actionId)?.segmentId ?? loaded!.segmentId,
        sourceId: loaded!.sourceId,
        ...(input.displayMode === 'f11'
          ? { preparationHint: '请先在 Chromium 窗口中手动按 F11，再按 F7 开始录制。' }
          : {}),
        sourceReady: () => true,
        capture: {
          async start() {
            await captureSession!.start();
            await captureSession!.waitUntilReady();
          },
          async stop() {
            captureResult = await captureSession!.stop();
            return captureResult;
          },
        },
      });
      return { close: async () => undefined };
    },
    async startOverlay() {
      await startManualRecordingOverlay(undefined, runtime);
      return { close: stopManualRecordingOverlay };
    },
    async runController() {
      if (input.mode === 'recording') {
        return runManualRecordController({
          runDir: input.runDir,
          displayMode: input.displayMode,
          deps: {
            launchChromium: async () => ({ sourceId: 'original', bindingTitle: chromium!.bindingTitle }),
            waitForStart: () => runtime!.waitForStart(),
            capture: async () => {
              await runtime!.waitForStop();
              if (captureResult === undefined) throw new Error('Capture stopped without a result.');
              return { ...captureResult, attempts: runtime!.attempts() };
            },
          },
        });
      }
      return runManualPickupController({
        runDir: input.runDir,
        segmentId: input.segmentId!,
        displayMode: input.displayMode,
        deps: {
          reservedPickupAttempt: pickupAttempt,
          waitForStart: () => runtime!.waitForStart(),
          capture: async () => {
            await runtime!.waitForStop();
            if (captureResult === undefined) throw new Error('Capture stopped without a result.');
            return {
              ok: captureResult.video.status === 'available',
              ...(captureResult.video.status === 'available' ? {} : { errorMessage: captureResult.video.reason }),
              startMs: captureResult.recordingStartMs,
              endMs: captureResult.recordingEndMs,
              firstFramePath: null,
              lastFramePath: null,
              attempts: runtime!.attempts(),
            };
          },
        },
      });
    },
    async writeReport(report) {
      const reportPath = bundle.reportPath('manual-run-report');
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeAtomicJson(reportPath, { version: 1, ...report });
      return reportPath;
    },
  };
  const keepAliveUntilReport = () => undefined;
  app.on('window-all-closed', keepAliveUntilReport);
  try {
    return await runManualProductComposition(input, deps);
  } finally {
    app.off('window-all-closed', keepAliveUntilReport);
  }
}

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function runWindowsCommand(command: WindowsCommand) {
  const result = await execFileAsync(command.command, command.args);
  return { stdout: result.stdout, stderr: result.stderr };
}

function parseArgs(argv: string[]): ManualProductCompositionInput {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const mode = value('--mode');
  const runDir = value('--run');
  const displayMode = value('--display-mode');
  const segmentId = value('--segment');
  if (mode !== 'recording' && mode !== 'pickup') throw new Error('--mode must be recording or pickup.');
  if (runDir === undefined || !path.isAbsolute(runDir)) throw new Error('--run must be an absolute path.');
  if (displayMode !== 'f11' && displayMode !== 'borderless-maximized') throw new Error('Invalid --display-mode.');
  if (mode === 'pickup' && segmentId === undefined) throw new Error('--segment is required for pickup.');
  return { mode, runDir, displayMode: displayMode as ManualRecordDisplayMode, ...(segmentId === undefined ? {} : { segmentId }) };
}

if (process.argv.includes('--mode') && process.argv.includes('--run')) {
  let exitCode = 1;
  try {
    const result = await runProductMain(parseArgs(process.argv.slice(2)));
    exitCode = result.exitCode;
    if (exitCode !== 0) console.error(`Manual runtime report: ${result.reportPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    app.exit(exitCode);
  }
}
