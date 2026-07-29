import { open, rm } from 'node:fs/promises';
import path from 'node:path';

import type { RunCommand } from '../audio.js';
import { createRecordingClock, type RecordingClock } from '../recording/clock.js';
import type { CaptureClockSample, RecordingManifest } from '../recording/types.js';
import { normalizeCapturedVideo, parseNormalizedVideoProbe, type NormalizedVideoProbe } from './normalize-video.js';
import {
  MANUAL_RECORDER_CHANNELS,
  validateRecorderAppendChunkPayload,
  validateRecorderCompletedPayload,
  validateRecorderFailedPayload,
  validateRecorderFirstChunkPayload,
  validateRecorderFlushPayload,
} from './product-ipc.js';
import { matchUniqueWindowSource } from './source-matcher.js';
import type { CaptureSourceDescriptor } from './types.js';
import { createCaptureChunkWriter, resolveDisplayMediaRequest } from './windows-electron.js';

export interface RecorderFrameAdapter {
  readonly routingId: number;
  isDestroyed(): boolean;
}

interface RecorderWindowLike {
  webContents: {
    id: number;
    mainFrame: RecorderFrameAdapter;
    send(channel: string, payload?: unknown): void;
  };
  loadFile(filePath: string): Promise<void>;
  isDestroyed(): boolean;
  close(): void;
}

interface RecorderIpcEvent {
  senderId: number;
  senderFrame: RecorderFrameAdapter | null;
}

type IpcHandler = (event: RecorderIpcEvent, payload: unknown) => unknown;
type IpcListener = (event: RecorderIpcEvent, payload: unknown) => void;
type DisplayRequestHandler = (
  request: { frame: RecorderFrameAdapter | null },
  callback: (resolution: { video: CaptureSourceDescriptor } | Record<string, never>) => void,
) => void;

export interface ElectronCaptureAdapter {
  createBrowserWindow(options: {
    show: false;
    webPreferences: {
      preload: string;
      contextIsolation: true;
      nodeIntegration: false;
      backgroundThrottling: false;
      sandbox: false;
    };
  }): RecorderWindowLike;
  ipcMain: {
    handle(channel: string, handler: IpcHandler): void;
    removeHandler(channel: string): void;
    on(channel: string, listener: IpcListener): void;
    removeListener(channel: string, listener: IpcListener): void;
  };
  acquireDisplayMediaHandler(handler: DisplayRequestHandler): () => void;
  fromFrame(frame: RecorderFrameAdapter): { id: number } | null;
  frameToken(frame: RecorderFrameAdapter): string;
  frameIdentity(frame: RecorderFrameAdapter): {
    processId: number;
    routingId: number;
    isMainFrame: boolean;
  };
  getWindowSources(): Promise<readonly CaptureSourceDescriptor[]>;
}

export interface CaptureRawFile {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ bytesWritten: number }>;
  close(): Promise<void>;
}

export interface ProductCaptureSession {
  start(): Promise<void>;
  waitUntilReady(): Promise<void>;
  stop(): Promise<ProductCaptureResult>;
  close(): Promise<void>;
}

export interface ProductCaptureResult {
  video: RecordingManifest['video'];
  recordingStartMs: number;
  recordingEndMs: number;
  firstVideoFrameSessionTimeMs: number | null;
  clockSamples: CaptureClockSample[];
}

export interface ProductCaptureSessionInput {
  electron: ElectronCaptureAdapter;
  bindingTitle: string;
  boundSource?: CaptureSourceDescriptor;
  rawVideoPath: string;
  outputVideoPath: string;
  recorderHtmlPath: string;
  recorderPreloadPath: string;
  runCommand: RunCommand;
  clock?: RecordingClock;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  sourceTimeoutMs?: number;
  recorderReadyTimeoutMs?: number;
  openRawFile?: (filePath: string) => Promise<CaptureRawFile>;
  normalize?: typeof normalizeCapturedVideo;
  probe?: (outputPath: string, runCommand: RunCommand) => Promise<NormalizedVideoProbe>;
  removeOutput?: (filePath: string) => Promise<void>;
}

const IPC_HANDLER_CHANNELS = [
  MANUAL_RECORDER_CHANNELS.firstChunk,
  MANUAL_RECORDER_CHANNELS.appendChunk,
  MANUAL_RECORDER_CHANNELS.flush,
] as const;

export function createProductCaptureSession(input: ProductCaptureSessionInput): ProductCaptureSession {
  assertAbsolutePath(input.rawVideoPath, 'rawVideoPath');
  assertAbsolutePath(input.outputVideoPath, 'outputVideoPath');
  assertAbsolutePath(input.recorderHtmlPath, 'recorderHtmlPath');
  assertAbsolutePath(input.recorderPreloadPath, 'recorderPreloadPath');
  const pollIntervalMs = positiveNumber(input.pollIntervalMs ?? 250, 'pollIntervalMs');
  const sourceTimeoutMs = nonNegativeNumber(input.sourceTimeoutMs ?? 10_000, 'sourceTimeoutMs');
  const recorderReadyTimeoutMs = positiveNumber(input.recorderReadyTimeoutMs ?? 15_000, 'recorderReadyTimeoutMs');

  const pollNow = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = input.clock ?? createRecordingClock();
  const normalize = input.normalize ?? normalizeCapturedVideo;
  const probe = input.probe ?? probeNormalizedVideo;
  const openRawFile = input.openRawFile ?? defaultOpenRawFile;
  const removeOutput = input.removeOutput ?? ((filePath: string) => rm(filePath, { force: true }));

  let recorderWindow: RecorderWindowLike | null = null;
  let recorderFrameToken: string | null = null;
  let recorderFrameIdentity: ReturnType<ElectronCaptureAdapter['frameIdentity']> | null = null;
  let rawFile: CaptureRawFile | null = null;
  let source: CaptureSourceDescriptor | null = null;
  let phase: 'idle' | 'starting' | 'started' | 'stopping' | 'stopped' | 'failed' | 'closed' = 'idle';
  let startPromise: Promise<void> | null = null;
  let readyWaitPromise: Promise<void> | null = null;
  let stopPromise: Promise<ProductCaptureResult> | null = null;
  let closePromise: Promise<void> | null = null;
  let cleanupPromise: Promise<void> | null = null;
  let closeRequested = false;
  let recordingStartMs = 0;
  let recordingEndMs = 0;
  const clockSamples: CaptureClockSample[] = [];
  let successfulFlushLastSequence: number | null = null;
  const registeredHandlers = new Set<string>();
  let completedListenerRegistered = false;
  let startedListenerRegistered = false;
  let failedListenerRegistered = false;
  let displayHandlerRegistered = false;
  let releaseDisplayHandler: (() => void) | null = null;
  let resolveCloseGate!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    resolveCloseGate = resolve;
  });

  let terminalSettled = false;
  let resolveTerminal!: () => void;
  let rejectTerminal!: (error: Error) => void;
  const terminal = new Promise<void>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  void terminal.catch(() => undefined);

  let recorderReadySettled = false;
  let resolveRecorderReady!: () => void;
  let rejectRecorderReady!: (error: Error) => void;
  const recorderReady = new Promise<void>((resolve, reject) => {
    resolveRecorderReady = resolve;
    rejectRecorderReady = reject;
  });
  void recorderReady.catch(() => undefined);

  const chunkWriter = createCaptureChunkWriter(writeAll);

  const isAuthorizedFrame = (senderId: number | null, frame: RecorderFrameAdapter | null): boolean => {
    if (recorderWindow === null || frame === null || frame.isDestroyed()) return false;
    const mainFrame = recorderWindow.webContents.mainFrame;
    const identity = input.electron.frameIdentity(frame);
    return !mainFrame.isDestroyed()
      && senderId === recorderWindow.webContents.id
      && identity.isMainFrame
      && recorderFrameIdentity !== null
      && identity.processId === recorderFrameIdentity.processId
      && identity.routingId === recorderFrameIdentity.routingId
      && recorderFrameToken !== null
      && input.electron.frameToken(frame) === recorderFrameToken;
  };
  const requireAuthorizedIpc = (event: RecorderIpcEvent) => {
    if (!isAuthorizedFrame(event.senderId, event.senderFrame)) {
      throw new Error('Recorder IPC is only authorized for the recorder main frame.');
    }
  };

  const handleFirstChunk: IpcHandler = async (event, payload) => {
    requireAuthorizedIpc(event);
    const chunk = validateRecorderFirstChunkPayload(payload);
    if (clock.firstVideoFrameSessionTimeMs() !== null) {
      throw new Error('First capture chunk must be reported exactly once.');
    }
    const timestamp = clock.markFirstVideoFrame();
    clockSamples.push({ ...timestamp, mediaTimeMs: chunk.timecodeMs });
    await chunkWriter.appendChunk(chunk.bytes, chunk.sequence);
  };
  const handleAppendChunk: IpcHandler = async (event, payload) => {
    requireAuthorizedIpc(event);
    const chunk = validateRecorderAppendChunkPayload(payload);
    clockSamples.push({ ...clock.stamp(), mediaTimeMs: chunk.timecodeMs });
    await chunkWriter.appendChunk(chunk.bytes, chunk.sequence);
  };
  const handleFlush: IpcHandler = async (event, payload) => {
    requireAuthorizedIpc(event);
    const flush = validateRecorderFlushPayload(payload);
    await chunkWriter.flush(flush.lastSequence);
    successfulFlushLastSequence = flush.lastSequence;
  };
  const handleCompleted: IpcListener = (event, payload) => {
    if (!isAuthorizedFrame(event.senderId, event.senderFrame) || terminalSettled) return;
    try {
      const completion = validateRecorderCompletedPayload(payload);
      if (successfulFlushLastSequence === null) return;
      if (completion.lastSequence !== successfulFlushLastSequence) {
        terminalSettled = true;
        rejectTerminal(new Error(
          `Recorder protocol error: completed lastSequence ${completion.lastSequence} does not match successful flush ${successfulFlushLastSequence}.`,
        ));
        return;
      }
      terminalSettled = true;
      resolveTerminal();
    } catch {
      // An invalid event does not consume the sole terminal transition.
    }
  };
  const handleStarted: IpcListener = (event) => {
    if (!isAuthorizedFrame(event.senderId, event.senderFrame) || recorderReadySettled) return;
    recorderReadySettled = true;
    resolveRecorderReady();
  };
  const handleFailed: IpcListener = (event, payload) => {
    if (!isAuthorizedFrame(event.senderId, event.senderFrame) || terminalSettled) return;
    try {
      const failure = validateRecorderFailedPayload(payload);
      if (!recorderReadySettled) {
        recorderReadySettled = true;
        rejectRecorderReady(new Error(failure.message));
      }
      terminalSettled = true;
      rejectTerminal(new Error(failure.message));
    } catch {
      // An invalid event does not consume the sole terminal transition.
    }
  };

  const start = (): Promise<void> => {
    if (phase === 'closed' || closeRequested) return Promise.reject(new Error('Capture session is closed.'));
    if (startPromise !== null) return startPromise;
    phase = 'starting';
    startPromise = (async () => {
      try {
        const pendingRawFile = openRawFile(input.rawVideoPath);
        let acceptedRawFile = false;
        void pendingRawFile.then(async (file) => {
          if (!acceptedRawFile && closeRequested) await file.close().catch(() => undefined);
        }, () => undefined);
        rawFile = await raceClose(pendingRawFile);
        acceptedRawFile = true;
        if (closeRequested) return;
        recorderWindow = input.electron.createBrowserWindow({
          show: false,
          webPreferences: {
            preload: input.recorderPreloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            sandbox: false,
          },
        });
        await raceClose(recorderWindow.loadFile(input.recorderHtmlPath));
        if (closeRequested) return;
        recorderFrameToken = input.electron.frameToken(recorderWindow.webContents.mainFrame);
        recorderFrameIdentity = input.electron.frameIdentity(recorderWindow.webContents.mainFrame);
        registerBoundaries();
        source = input.boundSource ?? await waitForUniqueWindowSource({
            electron: input.electron,
            expectedTitle: input.bindingTitle,
            now: pollNow,
            sleep,
            pollIntervalMs,
            timeoutMs: sourceTimeoutMs,
            closeGate,
          });
        if (closeRequested) return;
        recordingStartMs = clock.stamp().sessionTimeMs;
        phase = 'started';
        recorderWindow.webContents.send(MANUAL_RECORDER_CHANNELS.start);
      } catch (error) {
        phase = 'failed';
        await cleanup().catch(() => undefined);
        throw error;
      }
    })();
    return startPromise;
  };

  const waitUntilReady = (): Promise<void> => {
    readyWaitPromise ??= raceClose(Promise.race([
      recorderReady,
      new Promise<void>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error(`Recorder did not become ready within ${recorderReadyTimeoutMs}ms.`)),
          recorderReadyTimeoutMs,
        );
      }),
    ]));
    return readyWaitPromise;
  };

  const stop = (): Promise<ProductCaptureResult> => {
    if (stopPromise !== null) return stopPromise;
    if (phase === 'closed' || closeRequested) return Promise.reject(new Error('Capture session is closed.'));
    if (startPromise === null) return Promise.reject(new Error('Capture session has not started.'));
    requestRecorderStop();
    stopPromise = (async () => {
      await startPromise;
      requestRecorderStop();
      if (phase !== 'stopping') throw new Error('Capture session did not start.');
      await terminal;
      recordingEndMs = clock.stamp().sessionTimeMs;
      await closeRawFile();
      phase = 'stopped';
      try {
        await normalize({ inputPath: input.rawVideoPath, outputPath: input.outputVideoPath, runCommand: input.runCommand });
        const metadata = await probe(input.outputVideoPath, input.runCommand);
        return makeResult({
          status: 'available',
          path: input.outputVideoPath,
          width: 1920,
          height: 1080,
          fps: 30,
          durationMs: metadata.durationMs,
          hasAudio: false,
        });
      } catch (error) {
        await removeOutput(input.outputVideoPath).catch(() => undefined);
        return makeResult({ status: 'unavailable', path: null, reason: toError(error).message });
      }
    })();
    return stopPromise;
  };

  function requestRecorderStop() {
    if (phase !== 'started') return;
    phase = 'stopping';
    recorderWindow!.webContents.send(MANUAL_RECORDER_CHANNELS.stop);
  }

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    closeRequested = true;
    resolveCloseGate();
    closePromise = (async () => {
      await startPromise?.catch(() => undefined);
      if (stopPromise !== null && !terminalSettled) {
        terminalSettled = true;
        rejectTerminal(new Error('Capture session closed while recorder stop was in flight.'));
      }
      await stopPromise?.catch(() => undefined);
      await cleanup();
      phase = 'closed';
    })();
    return closePromise;
  };

  function registerBoundaries() {
    input.electron.ipcMain.handle(MANUAL_RECORDER_CHANNELS.firstChunk, handleFirstChunk);
    registeredHandlers.add(MANUAL_RECORDER_CHANNELS.firstChunk);
    input.electron.ipcMain.handle(MANUAL_RECORDER_CHANNELS.appendChunk, handleAppendChunk);
    registeredHandlers.add(MANUAL_RECORDER_CHANNELS.appendChunk);
    input.electron.ipcMain.handle(MANUAL_RECORDER_CHANNELS.flush, handleFlush);
    registeredHandlers.add(MANUAL_RECORDER_CHANNELS.flush);
    input.electron.ipcMain.on(MANUAL_RECORDER_CHANNELS.completed, handleCompleted);
    completedListenerRegistered = true;
    input.electron.ipcMain.on(MANUAL_RECORDER_CHANNELS.started, handleStarted);
    startedListenerRegistered = true;
    input.electron.ipcMain.on(MANUAL_RECORDER_CHANNELS.failed, handleFailed);
    failedListenerRegistered = true;
    releaseDisplayHandler = input.electron.acquireDisplayMediaHandler((request, callback) => {
      const frame = request.frame;
      const senderId = frame === null || frame.isDestroyed() ? null : input.electron.fromFrame(frame)?.id ?? null;
      callback(source !== null && isAuthorizedFrame(senderId, frame)
        ? resolveDisplayMediaRequest({
            requestFrame: { routingId: frame!.routingId, destroyed: false },
            requestWebContentsId: senderId,
            controlWebContentsId: recorderWindow!.webContents.id,
            controlMainFrameRoutingId: recorderWindow!.webContents.mainFrame.routingId,
            source,
          })
        : {});
    });
    displayHandlerRegistered = true;
  }

  function cleanup(): Promise<void> {
    if (cleanupPromise !== null) return cleanupPromise;
    cleanupPromise = (async () => {
      let firstError: unknown;
      const run = async (operation: () => void | Promise<void>) => {
        try {
          await operation();
        } catch (error) {
          firstError ??= error;
        }
      };
      for (const channel of IPC_HANDLER_CHANNELS) {
        if (registeredHandlers.has(channel)) await run(() => input.electron.ipcMain.removeHandler(channel));
      }
      if (completedListenerRegistered) {
        await run(() => input.electron.ipcMain.removeListener(MANUAL_RECORDER_CHANNELS.completed, handleCompleted));
      }
      if (startedListenerRegistered) {
        await run(() => input.electron.ipcMain.removeListener(MANUAL_RECORDER_CHANNELS.started, handleStarted));
        startedListenerRegistered = false;
      }
      if (failedListenerRegistered) {
        await run(() => input.electron.ipcMain.removeListener(MANUAL_RECORDER_CHANNELS.failed, handleFailed));
      }
      if (displayHandlerRegistered && releaseDisplayHandler !== null) await run(releaseDisplayHandler);
      await run(closeRawFile);
      await run(() => {
        if (recorderWindow !== null && !recorderWindow.isDestroyed()) recorderWindow.close();
      });
      if (firstError !== undefined) throw firstError;
    })();
    return cleanupPromise;
  }

  async function closeRawFile() {
    const file = rawFile;
    rawFile = null;
    await file?.close();
  }

  async function writeAll(bytes: Uint8Array): Promise<void> {
    if (rawFile === null) throw new Error('Raw capture file is not open.');
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await rawFile.write(bytes, offset, bytes.byteLength - offset, null);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.byteLength - offset) {
        throw new Error(`Invalid raw capture write result: ${bytesWritten}.`);
      }
      offset += bytesWritten;
    }
  }

  function makeResult(video: RecordingManifest['video']): ProductCaptureResult {
    return {
      video,
      recordingStartMs,
      recordingEndMs,
      firstVideoFrameSessionTimeMs: clock.firstVideoFrameSessionTimeMs(),
      clockSamples: [...clockSamples],
    };
  }

  async function raceClose<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      closeGate.then(() => {
        throw new Error('Capture session closed during startup.');
      }),
    ]);
  }

  return { start, waitUntilReady, stop, close };
}

async function waitForUniqueWindowSource(input: {
  electron: ElectronCaptureAdapter;
  expectedTitle: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs: number;
  timeoutMs: number;
  closeGate: Promise<void>;
}): Promise<CaptureSourceDescriptor> {
  const startedAt = input.now();
  let lastMissingError: Error | null = null;
  while (input.now() - startedAt <= input.timeoutMs) {
    try {
      const sources = await Promise.race([
        input.electron.getWindowSources(),
        cancelled(input.closeGate),
      ]);
      return matchUniqueWindowSource(sources, input.expectedTitle);
    } catch (error) {
      const failure = toError(error);
      if (/Multiple/i.test(failure.message)) throw failure;
      lastMissingError = failure;
      const remaining = input.timeoutMs - (input.now() - startedAt);
      if (remaining <= 0) break;
      await Promise.race([
        input.sleep(Math.min(input.pollIntervalMs, remaining)),
        cancelled(input.closeGate),
      ]);
    }
  }
  throw lastMissingError ?? new Error(`Chromium capture source "${input.expectedTitle}" was not found.`);
}

function cancelled(closeGate: Promise<void>): Promise<never> {
  return closeGate.then(() => {
    throw new Error('Capture session closed during source polling.');
  });
}

async function defaultOpenRawFile(filePath: string): Promise<CaptureRawFile> {
  return open(filePath, 'wx');
}

async function probeNormalizedVideo(outputPath: string, runCommand: RunCommand): Promise<NormalizedVideoProbe> {
  const probe = await runCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration',
    '-of', 'json',
    outputPath,
  ]);
  return parseNormalizedVideoProbe(probe.stdout);
}

function assertAbsolutePath(value: string, label: string): void {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}

function nonNegativeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`);
  return value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
