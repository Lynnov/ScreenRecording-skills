import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRecordingClock } from '../../src/lib/video-generator/recording/clock.js';
import {
  createProductCaptureSession,
  type ElectronCaptureAdapter,
} from '../../src/lib/video-generator/capture/electron-capture-session.js';
import { MANUAL_RECORDER_CHANNELS } from '../../src/lib/video-generator/capture/product-ipc.js';

type FakeFrame = {
  routingId: number;
  processId: number;
  mainFrame: boolean;
  destroyed: boolean;
  token?: string;
  isDestroyed(): boolean;
};
type Handler = (event: { senderId: number; senderFrame: FakeFrame | null }, payload: unknown) => unknown;
type Listener = (event: { senderId: number; senderFrame: FakeFrame | null }, payload: unknown) => void;

function createFakeElectron(sourceNames = ['VG-CAPTURE-session']): {
  adapter: ElectronCaptureAdapter;
  invoke(channel: string, payload: unknown, senderFrame?: FakeFrame, senderId?: number): Promise<unknown>;
  emit(channel: string, payload: unknown, senderFrame?: FakeFrame, senderId?: number): void;
  requestDisplay(frame?: FakeFrame): unknown;
  sent: Array<{ channel: string; payload: unknown }>;
  counts: { removeHandler: number; removeListener: number; clearDisplay: number; close: number; polls: number };
  mainFrame: FakeFrame;
  hasHandler(channel: string): boolean;
  installExistingDisplayHandler(): () => void;
} {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<Listener>>();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const counts = { removeHandler: 0, removeListener: 0, clearDisplay: 0, close: 0, polls: 0 };
  let displayHandler: ((request: { frame: FakeFrame | null }, callback: (value: unknown) => void) => void) | null = null;
  let destroyed = false;
  const webContents = {
    id: 71,
    mainFrame: {
      routingId: 91,
      processId: 11,
      mainFrame: true,
      destroyed: false,
      token: 'main-token',
      isDestroyed() { return this.destroyed; },
    },
    send(channel: string, payload?: unknown) {
      sent.push({ channel, payload });
    },
  };
  const adapter: ElectronCaptureAdapter = {
    createBrowserWindow() {
      return {
        webContents,
        async loadFile() {},
        isDestroyed: () => destroyed,
        close() {
          counts.close += 1;
          destroyed = true;
        },
      };
    },
    ipcMain: {
      handle(channel, handler) {
        if (handlers.has(channel)) throw new Error(`duplicate handler ${channel}`);
        handlers.set(channel, handler);
      },
      removeHandler(channel) {
        counts.removeHandler += 1;
        handlers.delete(channel);
      },
      on(channel, listener) {
        const channelListeners = listeners.get(channel) ?? new Set();
        channelListeners.add(listener);
        listeners.set(channel, channelListeners);
      },
      removeListener(channel, listener) {
        counts.removeListener += 1;
        listeners.get(channel)?.delete(listener);
      },
    },
    acquireDisplayMediaHandler(handler) {
      if (displayHandler !== null) throw new Error('display media handler already leased');
      displayHandler = handler;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        displayHandler = null;
        counts.clearDisplay += 1;
      };
    },
    fromFrame(frame) {
      const value = frame as FakeFrame;
      return frame.isDestroyed()
        ? null
        : {
            id: value.processId === webContents.mainFrame.processId
              && value.routingId === webContents.mainFrame.routingId
              && value.mainFrame
              ? 71
              : 72,
          };
    },
    frameToken(frame) {
      return (frame as FakeFrame).token ?? `frame-${frame.routingId}`;
    },
    frameIdentity(frame) {
      const value = frame as FakeFrame;
      return { processId: value.processId, routingId: value.routingId, isMainFrame: value.mainFrame };
    },
    async getWindowSources() {
      counts.polls += 1;
      return sourceNames.map((name, index) => ({ id: `window:${index + 1}:0`, name }));
    },
  };
  return {
    adapter,
    invoke: async (channel, payload, senderFrame = webContents.mainFrame, senderId = 71) => {
      const handler = handlers.get(channel);
      assert.ok(handler, `missing handler ${channel}`);
      return handler({ senderId, senderFrame }, payload);
    },
    emit(channel, payload, senderFrame = webContents.mainFrame, senderId = 71) {
      for (const listener of listeners.get(channel) ?? []) listener({ senderId, senderFrame }, payload);
    },
    requestDisplay(frame = webContents.mainFrame) {
      let result: unknown;
      assert.ok(displayHandler);
      displayHandler({ frame }, (value) => {
        result = value;
      });
      return result;
    },
    sent,
    counts,
    mainFrame: webContents.mainFrame,
    hasHandler: (channel) => handlers.has(channel),
    installExistingDisplayHandler() {
      assert.equal(displayHandler, null);
      displayHandler = (_request, callback) => callback({});
      return () => { displayHandler = null; };
    },
  };
}

async function createPaths(): Promise<{ rawVideoPath: string; outputVideoPath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'manual-product-capture-'));
  return {
    rawVideoPath: path.join(dir, 'raw.webm'),
    outputVideoPath: path.join(dir, 'normalized.mp4'),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('authorizes only the recorder main frame and writes strictly ordered chunks', async () => {
  const fake = createFakeElectron();
  const paths = await createPaths();
  let now = 1_000;
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => now,
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => {},
    probe: async () => ({
      videoStreams: 1, audioStreams: 0, codecName: 'h264', width: 1920, height: 1080,
      fps: 30, pixelFormat: 'yuv420p', durationMs: 500,
    }),
  });

  await session.start();
  assert.deepEqual(fake.requestDisplay(), { video: { id: 'window:1:0', name: 'VG-CAPTURE-session' } });
  assert.deepEqual(fake.requestDisplay({
    routingId: 92, processId: 12, mainFrame: true, destroyed: false, token: 'other',
    isDestroyed() { return this.destroyed; },
  }), {});
  now = 1_100;
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 });
  await fake.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, { bytes: new Uint8Array([2]), sequence: 1, timecodeMs: 250 });
  await assert.rejects(
    fake.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, { bytes: new Uint8Array([3]), sequence: 3, timecodeMs: 500 }),
    /Expected sequence 2/,
  );
  await assert.rejects(
    fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([4]), sequence: 1, timecodeMs: 750 }),
    /sequence must be zero/i,
  );
  await session.close();
  assert.deepEqual([...await readFile(paths.rawVideoPath)], [1, 2]);
});

test('polls a missing source at 250ms up to 10 seconds and rejects multiple matches immediately', async () => {
  const missing = createFakeElectron([]);
  const paths = await createPaths();
  let elapsed = 0;
  const session = createProductCaptureSession({
    electron: missing.adapter,
    bindingTitle: 'missing',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await assert.rejects(session.start(), /not found/i);
  assert.equal(elapsed, 10_000);
  assert.equal(missing.counts.polls, 41);
  await session.close();

  const multiple = createFakeElectron(['same', 'same']);
  const multiplePaths = await createPaths();
  const duplicateSession = createProductCaptureSession({
    electron: multiple.adapter,
    bindingTitle: 'same',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...multiplePaths,
    now: () => 0,
    sleep: async () => assert.fail('multiple matches must not poll again'),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await assert.rejects(duplicateSession.start(), /Multiple/);
  assert.equal(multiple.counts.polls, 1);
  await duplicateSession.close();
});

test('stop waits for flush and completion, then normalizes and probes the capture', async () => {
  const fake = createFakeElectron();
  const paths = await createPaths();
  let normalized = false;
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => 2_000,
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => { normalized = true; },
    probe: async () => ({
      videoStreams: 1, audioStreams: 0, codecName: 'h264', width: 1920, height: 1080,
      fps: 30, pixelFormat: 'yuv420p', durationMs: 750,
    }),
  });
  await session.start();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 });
  const stopping = session.stop();
  assert.equal(fake.sent.at(-1)?.channel, MANUAL_RECORDER_CHANNELS.stop);
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: 0 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 0 }, {
    routingId: 92, processId: 12, mainFrame: true, destroyed: false, token: 'other',
    isDestroyed() { return this.destroyed; },
  });
  const unauthorizedWon = await Promise.race([
    stopping.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
  ]);
  assert.equal(unauthorizedWon, false);
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 0 });
  const result = await stopping;
  assert.equal(normalized, true);
  assert.deepEqual(result.video, {
    status: 'available', path: paths.outputVideoPath, width: 1920, height: 1080,
    fps: 30, durationMs: 750, hasAudio: false,
  });
  assert.equal(typeof result.firstVideoFrameSessionTimeMs, 'number');
  assert.equal(result.clockSamples.length, 1);
  await session.close();
});

test('normalization failure returns unavailable and preserves protected raw capture', async () => {
  const fake = createFakeElectron();
  const paths = await createPaths();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => 3_000,
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => { throw new Error('normalize boom'); },
  });
  await session.start();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([9]), sequence: 0, timecodeMs: 0 });
  const stopping = session.stop();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: 0 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 0 });
  const result = await stopping;
  assert.deepEqual(result.video, { status: 'unavailable', path: null, reason: 'normalize boom' });
  assert.deepEqual([...await readFile(paths.rawVideoPath)], [9]);
  await session.close();

  const protectedFake = createFakeElectron();
  await writeFile(paths.rawVideoPath, 'existing');
  const protectedSession = createProductCaptureSession({
    electron: protectedFake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => 0,
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await assert.rejects(protectedSession.start(), /already exists|protected/i);
  assert.equal(await readFile(paths.rawVideoPath, 'utf8'), 'existing');
});

test('close is idempotent, unregisters every boundary, and preserves the first cleanup error', async () => {
  const fake = createFakeElectron();
  const paths = await createPaths();
  const first = new Error('remove handler failed first');
  let thrown = false;
  const removeHandler = fake.adapter.ipcMain.removeHandler;
  fake.adapter.ipcMain.removeHandler = (channel) => {
    removeHandler(channel);
    if (!thrown) {
      thrown = true;
      throw first;
    }
  };
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => 0,
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await session.start();
  await assert.rejects(session.close(), (error) => error === first);
  await assert.rejects(session.close(), (error) => error === first);
  assert.equal(fake.counts.removeHandler, 3);
  assert.equal(fake.counts.removeListener, 3);
  assert.equal(fake.counts.clearDisplay, 1);
  assert.equal(fake.counts.close, 1);
});

test('completed is ignored until a successful flush for the same last sequence', async () => {
  const fake = createFakeElectron();
  const paths = await createPaths();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => 0,
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => {},
    probe: async () => ({
      videoStreams: 1, audioStreams: 0, codecName: 'h264', width: 1920, height: 1080,
      fps: 30, pixelFormat: 'yuv420p', durationMs: 1,
    }),
  });
  await session.start();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 });
  const stopping = session.stop();
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 0 });
  assert.equal(await Promise.race([stopping.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 10))]), false);
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: 0 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 0 });
  await stopping;
  await session.close();
});

test('concurrent start shares one promise and close cancels an in-flight start before cleanup', async () => {
  const gate = deferred<void>();
  const loadEntered = deferred<void>();
  const fake = createFakeElectron();
  const originalCreate = fake.adapter.createBrowserWindow;
  let windows = 0;
  fake.adapter.createBrowserWindow = (options) => {
    windows += 1;
    const window = originalCreate(options);
    window.loadFile = async () => {
      loadEntered.resolve();
      return gate.promise;
    };
    return window;
  };
  const paths = await createPaths();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...paths,
    now: () => 0,
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  const first = session.start();
  const second = session.start();
  assert.equal(first, second);
  await loadEntered.promise;
  const closing = session.close();
  assert.equal(await Promise.race([closing.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 50))]), true);
  gate.resolve();
  await assert.rejects(first, /closed/i);
  assert.equal(windows, 1);
  await assert.rejects(session.start(), /closed/i);
});

test('load failure occurs before Electron boundaries are registered and still closes the recorder window', async () => {
  const fake = createFakeElectron();
  const originalCreate = fake.adapter.createBrowserWindow;
  fake.adapter.createBrowserWindow = (options) => {
    const window = originalCreate(options);
    window.loadFile = async () => { throw new Error('load failed'); };
    return window;
  };
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    now: () => 0,
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await assert.rejects(session.start(), /load failed/);
  assert.equal(fake.counts.removeHandler, 0);
  assert.equal(fake.counts.removeListener, 0);
  assert.equal(fake.counts.clearDisplay, 0);
  assert.equal(fake.counts.close, 1);
});

test('uses an injected monotonic recording clock with session-from-zero timestamps', async () => {
  let nowNs = 50_000_000_000n;
  const clock = createRecordingClock(() => nowNs);
  const fake = createFakeElectron();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    clock,
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => {},
    probe: async () => ({
      videoStreams: 1, audioStreams: 0, codecName: 'h264', width: 1920, height: 1080,
      fps: 30, pixelFormat: 'yuv420p', durationMs: 100,
    }),
  } as Parameters<typeof createProductCaptureSession>[0] & { clock: typeof clock });
  await session.start();
  nowNs += 25_000_000n;
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 });
  nowNs += 25_000_000n;
  await fake.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, { bytes: new Uint8Array([2]), sequence: 1, timecodeMs: 25 });
  const stopping = session.stop();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: 1 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 1 });
  const result = await stopping;
  assert.equal(result.recordingStartMs, 0);
  assert.equal(result.firstVideoFrameSessionTimeMs, 25);
  assert.deepEqual(result.clockSamples.map(({ sessionTimeMs, videoTimeMs }) => ({ sessionTimeMs, videoTimeMs })), [
    { sessionTimeMs: 25, videoTimeMs: 0 },
    { sessionTimeMs: 50, videoTimeMs: 25 },
  ]);
  await session.close();
});

test('uses injected poll timing independently of the default 250ms and 10 second policy', async () => {
  const fake = createFakeElectron([]);
  let elapsed = 0;
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'missing',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
    pollIntervalMs: 20,
    sourceTimeoutMs: 60,
    runCommand: async () => ({ stdout: '', stderr: '' }),
  } as Parameters<typeof createProductCaptureSession>[0] & { pollIntervalMs: number; sourceTimeoutMs: number });
  await assert.rejects(session.start(), /not found/i);
  assert.equal(elapsed, 60);
  assert.equal(fake.counts.polls, 4);
});

test('uses sender webContents, frame identity, destruction state and frame token for one authorization decision', async () => {
  const fake = createFakeElectron();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await session.start();
  const payload = { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 };
  await assert.rejects(fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, payload, fake.mainFrame, 72), /authorized/i);
  const equivalentWrapper = {
    routingId: fake.mainFrame.routingId,
    processId: fake.mainFrame.processId,
    mainFrame: true,
    destroyed: false,
    token: fake.mainFrame.token,
    isDestroyed() { return this.destroyed; },
  };
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, payload, equivalentWrapper, 71);
  assert.deepEqual(fake.requestDisplay(equivalentWrapper), { video: { id: 'window:1:0', name: 'VG-CAPTURE-session' } });
  const lookalike = {
    routingId: fake.mainFrame.routingId,
    processId: 99,
    mainFrame: true,
    destroyed: false,
    token: 'forged-token',
    isDestroyed() { return this.destroyed; },
  };
  await assert.rejects(fake.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, {
    bytes: new Uint8Array([2]), sequence: 1, timecodeMs: 1,
  }, lookalike, 71), /authorized/i);
  assert.deepEqual(fake.requestDisplay(lookalike), {});
  fake.mainFrame.destroyed = true;
  await assert.rejects(fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, payload, fake.mainFrame, 71), /authorized/i);
  assert.deepEqual(fake.requestDisplay(fake.mainFrame), {});
  fake.mainFrame.destroyed = false;
  await fake.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, {
    bytes: new Uint8Array([2]), sequence: 1, timecodeMs: 1,
  }, fake.mainFrame, 71);
  assert.deepEqual(fake.requestDisplay(fake.mainFrame), { video: { id: 'window:1:0', name: 'VG-CAPTURE-session' } });
  await session.close();
});

test('retries partial raw file writes until every chunk byte is persisted', async () => {
  const fake = createFakeElectron();
  const written: number[] = [];
  let closed = false;
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    openRawFile: async () => ({
      async write(bytes, offset, length) {
        const bytesWritten = Math.min(2, length);
        written.push(...bytes.subarray(offset, offset + bytesWritten));
        return { bytesWritten };
      },
      async close() { closed = true; },
    }),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await session.start();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, {
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    sequence: 0,
    timecodeMs: 0,
  });
  assert.deepEqual(written, [1, 2, 3, 4, 5]);
  await session.close();
  assert.equal(closed, true);
});

test('stop waits for an in-flight start and invalid failed payload cannot consume terminal state', async () => {
  const gate = deferred<void>();
  const loadEntered = deferred<void>();
  const fake = createFakeElectron();
  const originalCreate = fake.adapter.createBrowserWindow;
  fake.adapter.createBrowserWindow = (options) => {
    const window = originalCreate(options);
    window.loadFile = async () => {
      loadEntered.resolve();
      await gate.promise;
    };
    return window;
  };
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => {},
    probe: async () => ({
      videoStreams: 1, audioStreams: 0, codecName: 'h264', width: 1920, height: 1080,
      fps: 30, pixelFormat: 'yuv420p', durationMs: 1,
    }),
  });
  const starting = session.start();
  await loadEntered.promise;
  const stopping = session.stop();
  gate.resolve();
  await starting;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.sent.at(-1)?.channel, MANUAL_RECORDER_CHANNELS.stop);
  fake.emit(MANUAL_RECORDER_CHANNELS.failed, { message: '' });
  assert.equal(await Promise.race([stopping.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 10))]), false);
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: -1 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: -1 });
  await stopping;
  await session.close();
});

test('partial IPC registration failure never removes a handler owned by another session', async () => {
  const fake = createFakeElectron();
  fake.adapter.ipcMain.handle(MANUAL_RECORDER_CHANNELS.firstChunk, async () => undefined);
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await assert.rejects(session.start(), /duplicate handler/);
  assert.equal(fake.hasHandler(MANUAL_RECORDER_CHANNELS.firstChunk), true);
  assert.equal(fake.counts.removeHandler, 0);
});

test('close during an in-flight stop settles both promises before removing terminal listeners', async () => {
  const fake = createFakeElectron();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await session.start();
  const stopping = session.stop();
  const closing = session.close();
  const stopOutcome = await Promise.race([
    stopping.then(() => 'resolved' as const, () => 'rejected' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
  ]);
  const closeOutcome = await Promise.race([
    closing.then(() => 'resolved' as const, () => 'rejected' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
  ]);
  assert.equal(stopOutcome, 'rejected');
  assert.equal(closeOutcome, 'resolved');
  assert.equal(fake.counts.removeListener, 3);
  assert.equal(fake.counts.clearDisplay, 1);
  assert.equal(fake.counts.close, 1);
});

test('completed lastSequence mismatch after a successful flush rejects stop as a protocol error', async () => {
  const fake = createFakeElectron();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await session.start();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 });
  await fake.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, { bytes: new Uint8Array([2]), sequence: 1, timecodeMs: 1 });
  const stopping = session.stop();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: 1 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: 0 });
  await assert.rejects(stopping, /completed.*0.*flush.*1|protocol/i);
  await session.close();
});

test('stop before start is not cached and a later start then stop succeeds', async () => {
  const fake = createFakeElectron();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => {},
    probe: async () => ({
      videoStreams: 1, audioStreams: 0, codecName: 'h264', width: 1920, height: 1080,
      fps: 30, pixelFormat: 'yuv420p', durationMs: 1,
    }),
  });
  await assert.rejects(session.stop(), /not started/i);
  await session.start();
  const stopping = session.stop();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: -1 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: -1 });
  await stopping;
  await session.close();
});

test('close cancels a permanently pending source poll sleep without waiting for the adapter promise', async () => {
  const fake = createFakeElectron([]);
  const sleepEntered = deferred<void>();
  const never = deferred<void>();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'missing',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    now: () => 0,
    sleep: async () => {
      sleepEntered.resolve();
      await never.promise;
    },
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  const starting = session.start();
  await sleepEntered.promise;
  const closing = session.close();
  assert.equal(await Promise.race([closing.then(() => 'closed'), new Promise((r) => setTimeout(() => r('timeout'), 50))]), 'closed');
  await assert.rejects(starting, /closed|cancel/i);
  assert.equal(fake.counts.close, 1);
});

test('late load and source results cannot restart capture after close', async () => {
  const fake = createFakeElectron();
  const loadGate = deferred<void>();
  const loadEntered = deferred<void>();
  const originalCreate = fake.adapter.createBrowserWindow;
  fake.adapter.createBrowserWindow = (options) => {
    const window = originalCreate(options);
    window.loadFile = async () => {
      loadEntered.resolve();
      await loadGate.promise;
    };
    return window;
  };
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  const starting = session.start();
  await loadEntered.promise;
  await session.close();
  loadGate.resolve();
  await assert.rejects(starting, /closed|cancel/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.sent.some(({ channel }) => channel === MANUAL_RECORDER_CHANNELS.start), false);
  assert.equal(fake.counts.close, 1);

  const sourceFake = createFakeElectron();
  const sourceGate = deferred<readonly { id: string; name: string }[]>();
  const sourceEntered = deferred<void>();
  sourceFake.adapter.getWindowSources = async () => {
    sourceEntered.resolve();
    return sourceGate.promise;
  };
  const sourceSession = createProductCaptureSession({
    electron: sourceFake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  const sourceStarting = sourceSession.start();
  await sourceEntered.promise;
  await sourceSession.close();
  sourceGate.resolve([{ id: 'window:1:0', name: 'VG-CAPTURE-session' }]);
  await assert.rejects(sourceStarting, /closed|cancel/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sourceFake.sent.some(({ channel }) => channel === MANUAL_RECORDER_CHANNELS.start), false);
  assert.equal(sourceFake.counts.close, 1);
});

test('display handler collision preserves the existing app handler and never releases it', async () => {
  const fake = createFakeElectron();
  const removeExisting = fake.installExistingDisplayHandler();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
  });
  await assert.rejects(session.start(), /already leased/);
  assert.deepEqual(fake.requestDisplay(fake.mainFrame), {});
  assert.equal(fake.counts.clearDisplay, 0);
  removeExisting();
});

test('output cleanup failure does not replace the normalize failure reason', async () => {
  const fake = createFakeElectron();
  const session = createProductCaptureSession({
    electron: fake.adapter,
    bindingTitle: 'VG-CAPTURE-session',
    recorderHtmlPath: path.resolve('recorder.html'),
    recorderPreloadPath: path.resolve('recorder-preload.cjs'),
    ...await createPaths(),
    runCommand: async () => ({ stdout: '', stderr: '' }),
    normalize: async () => { throw new Error('primary normalize failure'); },
    removeOutput: async () => { throw new Error('secondary rm failure'); },
  } as Parameters<typeof createProductCaptureSession>[0] & { removeOutput: () => Promise<void> });
  await session.start();
  const stopping = session.stop();
  await fake.invoke(MANUAL_RECORDER_CHANNELS.flush, { lastSequence: -1 });
  fake.emit(MANUAL_RECORDER_CHANNELS.completed, { lastSequence: -1 });
  const result = await stopping;
  assert.deepEqual(result.video, { status: 'unavailable', path: null, reason: 'primary normalize failure' });
  await session.close();
});
