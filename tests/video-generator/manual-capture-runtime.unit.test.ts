import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  MANUAL_RECORDER_CHANNELS,
  createRecorderCompletionGuard,
  validateRecorderAppendChunkPayload,
  validateRecorderCompletedPayload,
  validateRecorderFirstChunkPayload,
  validateRecorderChunkPayload,
  validateRecorderFailedPayload,
  validateRecorderFlushPayload,
} from '../../src/lib/video-generator/capture/product-ipc.js';
import {
  createRecorderLifecycle,
  type MediaRecorderLike,
  type RecorderEventLike,
} from '../../src/lib/video-generator/recording-overlay/recorder-lifecycle.js';
import recorderPreloadApi from '../../src/lib/video-generator/recording-overlay/recorder-preload-api.cjs';
import { waitForVideoFrame } from '../../src/lib/video-generator/recording-overlay/video-frame-wait.js';

const { createRecorderPreloadApi } = recorderPreloadApi;

test('recorder IPC exposes the complete typed channel contract', () => {
  assert.deepEqual(MANUAL_RECORDER_CHANNELS, {
    start: 'manual-recorder:start',
    started: 'manual-recorder:started',
    stop: 'manual-recorder:stop',
    firstChunk: 'manual-recorder:first-chunk',
    appendChunk: 'manual-recorder:append-chunk',
    flush: 'manual-recorder:flush',
    completed: 'manual-recorder:completed',
    failed: 'manual-recorder:failed',
  });
});

test('recorder chunk validator accepts valid bytes, sequence and timecode', () => {
  const payload = {
    bytes: new Uint8Array([1, 2, 3]),
    sequence: 0,
    timecodeMs: 0,
  };

  assert.equal(validateRecorderChunkPayload(payload), payload);
  assert.equal(validateRecorderFirstChunkPayload(payload), payload);
  assert.equal(validateRecorderAppendChunkPayload(payload), payload);
  assert.throws(
    () => validateRecorderFirstChunkPayload({ ...payload, sequence: 1 }),
    /first.*sequence|sequence.*zero/i,
  );
});

test('recorder chunk validator rejects malformed payload fields', () => {
  assert.throws(
    () => validateRecorderChunkPayload({ bytes: [1], sequence: 0, timecodeMs: 0 }),
    /Uint8Array/,
  );
  assert.throws(
    () => validateRecorderChunkPayload({ bytes: new Uint8Array(), sequence: -1, timecodeMs: 0 }),
    /sequence/,
  );
  assert.throws(
    () => validateRecorderChunkPayload({ bytes: new Uint8Array(), sequence: 0, timecodeMs: Number.NaN }),
    /timecode/,
  );
  for (const timecodeMs of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
      () => validateRecorderChunkPayload({ bytes: new Uint8Array(), sequence: 0, timecodeMs }),
      /timecode/,
    );
  }
  for (const sequence of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => validateRecorderChunkPayload({ bytes: new Uint8Array(), sequence, timecodeMs: 0 }),
      /sequence/,
    );
  }
  for (const payload of [null, undefined, 1, 'chunk']) {
    assert.throws(() => validateRecorderChunkPayload(payload), /payload|object/i);
  }
});

test('recorder completion guard rejects invalid and duplicate completion', () => {
  const guard = createRecorderCompletionGuard();

  assert.throws(() => guard.complete('unexpected'), /completion/i);
  guard.complete('completed');
  assert.throws(() => guard.complete('failed'), /already completed/i);
});

test('recorder terminal payload validators cover flush, completed and failed', () => {
  assert.deepEqual(validateRecorderFlushPayload({ lastSequence: -1 }), { lastSequence: -1 });
  assert.deepEqual(validateRecorderFlushPayload({ lastSequence: 2 }), { lastSequence: 2 });
  for (const lastSequence of [-2, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateRecorderFlushPayload({ lastSequence }), /lastSequence/);
  }
  assert.deepEqual(validateRecorderCompletedPayload({ lastSequence: -1 }), { lastSequence: -1 });
  assert.deepEqual(validateRecorderFailedPayload({ message: 'capture failed' }), { message: 'capture failed' });
  for (const payload of [null, 'failed', {}, { message: '' }, { message: 1 }]) {
    assert.throws(() => validateRecorderFailedPayload(payload), /message|payload/i);
  }
});

test('recorder lifecycle waits for an in-flight start before stopping without leaking tracks', async () => {
  const frame = deferred<void>();
  const events: string[] = [];
  const track = { stop: () => events.push('track.stop') };
  const recorder = new FakeMediaRecorder(events);
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => ({ getTracks: () => [track] }),
    waitForFirstVideoFrame: async () => frame.promise,
    createMediaRecorder: () => recorder,
    bridge: createFakeBridge(events),
  });

  const starting = lifecycle.start();
  const stopping = lifecycle.stop();
  frame.resolve();
  await Promise.all([starting, stopping]);

  assert.equal(recorder.startCalls, 0);
  assert.deepEqual(events, ['flush:-1', 'track.stop', 'completed:-1']);
  await lifecycle.start();
  assert.equal(recorder.startCalls, 0);
});

test('recorder lifecycle serializes chunks and flushes after final dataavailable', async () => {
  const events: string[] = [];
  const firstWrite = deferred<void>();
  const track = { stop: () => events.push('track.stop') };
  const recorder = new FakeMediaRecorder(events);
  const bridge = createFakeBridge(events, firstWrite);
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => ({ getTracks: () => [track] }),
    waitForFirstVideoFrame: async () => undefined,
    createMediaRecorder: () => recorder,
    bridge,
  });

  await lifecycle.start();
  recorder.emitData(new Uint8Array([1]), 10);
  recorder.emitData(new Uint8Array([2]), 20);
  const stopping = lifecycle.stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['recorder.start:250', 'recorder.stop', 'first:0']);
  firstWrite.resolve();
  await stopping;

  assert.deepEqual(events, [
    'recorder.start:250',
    'recorder.stop',
    'first:0',
    'append:1',
    'append:2',
    'flush:2',
    'track.stop',
    'completed:2',
  ]);
});

test('recorder lifecycle ignores zero-size dataavailable chunks', async () => {
  const events: string[] = [];
  const recorder = new FakeMediaRecorder(events, { finalChunk: 'zero-size' });
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => ({ getTracks: () => [{ stop: () => events.push('track.stop') }] }),
    waitForFirstVideoFrame: async () => undefined,
    createMediaRecorder: () => recorder,
    bridge: createFakeBridge(events),
  });

  await lifecycle.start();
  recorder.emitZeroData(0);
  await lifecycle.stop();

  assert.deepEqual(events, [
    'recorder.start:250',
    'recorder.stop',
    'flush:-1',
    'track.stop',
    'completed:-1',
  ]);
});

test('recorder lifecycle reports an append rejection immediately and stop cleans up once', async () => {
  const events: string[] = [];
  const track = { stop: () => events.push('track.stop') };
  const recorder = new FakeMediaRecorder(events, { finalChunk: 'zero-size' });
  const bridge = createFakeBridge(events);
  bridge.appendChunk = async () => {
    throw new Error('append failed');
  };
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => ({ getTracks: () => [track] }),
    waitForFirstVideoFrame: async () => undefined,
    createMediaRecorder: () => recorder,
    bridge,
  });

  await lifecycle.start();
  recorder.emitData(new Uint8Array([1]), 0);
  recorder.emitData(new Uint8Array([2]), 1);
  await waitForEvent(events, 'failed:append failed');

  assert.equal(events.filter((event) => event.startsWith('failed:')).length, 1);
  await lifecycle.stop();
  assert.equal(events.filter((event) => event.startsWith('failed:')).length, 1);
  assert.equal(events.filter((event) => event === 'track.stop').length, 1);
  assert.ok(events.includes('recorder.stop'));
  assert.equal(events.some((event) => event.startsWith('completed:')), false);
});

test('recorder lifecycle skips queued writes after first or append chunk failure', async () => {
  for (const rejectSequence of [0, 1]) {
    const events: string[] = [];
    const recorder = new FakeMediaRecorder(events, { finalChunk: 'zero-size' });
    const bridge = createFakeBridge(events);
    bridge.firstChunk = async (payload) => {
      events.push(`write:${payload.sequence}`);
      if (rejectSequence === 0) throw new Error('write failed');
    };
    bridge.appendChunk = async (payload) => {
      events.push(`write:${payload.sequence}`);
      if (payload.sequence === rejectSequence) throw new Error('write failed');
    };
    const lifecycle = createRecorderLifecycle({
      getDisplayMedia: async () => ({ getTracks: () => [{ stop: () => events.push('track.stop') }] }),
      waitForFirstVideoFrame: async () => undefined,
      createMediaRecorder: () => recorder,
      bridge,
    });

    await lifecycle.start();
    recorder.emitData(new Uint8Array([1]), 0);
    recorder.emitData(new Uint8Array([2]), 1);
    recorder.emitData(new Uint8Array([3]), 2);
    await waitForEvent(events, 'failed:write failed');
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(
      events.filter((event) => event.startsWith('write:')),
      rejectSequence === 0 ? ['write:0'] : ['write:0', 'write:1'],
    );
    await lifecycle.stop();
  }
});

test('stop aborts a never-resolving first-frame wait and completes cleanup', async () => {
  const events: string[] = [];
  const frameStarted = deferred<void>();
  const recorder = new FakeMediaRecorder(events);
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => ({ getTracks: () => [{ stop: () => events.push('track.stop') }] }),
    waitForFirstVideoFrame: async (_stream, signal) => {
      frameStarted.resolve();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
      });
    },
    createMediaRecorder: () => recorder,
    bridge: createFakeBridge(events),
  });

  const starting = lifecycle.start();
  await frameStarted.promise;
  await lifecycle.stop();
  await starting;

  assert.equal(recorder.startCalls, 0);
  assert.equal(events.filter((event) => event === 'track.stop').length, 1);
  assert.deepEqual(events.filter((event) => /^(completed|failed):/.test(event)), ['completed:-1']);
});

test('stop before display media resolves observes the pre-aborted frame signal immediately', async () => {
  const events: string[] = [];
  const streamResult = deferred<{ getTracks(): Array<{ stop(): void }> }>();
  let playCalls = 0;
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => streamResult.promise,
    waitForFirstVideoFrame: (stream, signal) => waitForVideoFrame({
      video: {
        srcObject: null,
        play: async () => { playCalls += 1; },
        pause: () => events.push('pause'),
        requestVideoFrameCallback: () => 1,
        addEventListener() {},
        removeEventListener() {},
      },
      stream,
      signal,
      timeoutMs: 5,
    }),
    createMediaRecorder: () => new FakeMediaRecorder(events),
    bridge: createFakeBridge(events),
  });

  const starting = lifecycle.start();
  const stopping = lifecycle.stop();
  streamResult.resolve({ getTracks: () => [{ stop: () => events.push('track.stop') }] });
  await Promise.all([starting, stopping]);

  assert.equal(playCalls, 0);
  assert.equal(events.filter((event) => event === 'track.stop').length, 1);
  assert.deepEqual(events.filter((event) => /^(completed|failed):/.test(event)), ['completed:-1']);
});

test('stop aborts a permanently pending video play and cleans every boundary', async () => {
  const events: string[] = [];
  const playStarted = deferred<void>();
  const listeners = new Map<string, () => void>();
  const video = {
    srcObject: null as unknown,
    play: async () => {
      playStarted.resolve();
      await new Promise<void>(() => undefined);
    },
    pause: () => events.push('pause'),
    requestVideoFrameCallback: () => 1,
    addEventListener: (name: string, listener: () => void) => listeners.set(`video:${name}`, listener),
    removeEventListener: (name: string) => {
      listeners.delete(`video:${name}`);
      events.push(`remove:video:${name}`);
    },
  };
  const track = {
    stop: () => events.push('track.stop'),
    addEventListener: (name: string, listener: () => void) => listeners.set(`track:${name}`, listener),
    removeEventListener: (name: string) => {
      listeners.delete(`track:${name}`);
      events.push(`remove:track:${name}`);
    },
  };
  const lifecycle = createRecorderLifecycle({
    getDisplayMedia: async () => ({ getTracks: () => [track] }),
    waitForFirstVideoFrame: (stream, signal) => waitForVideoFrame({
      video,
      stream,
      signal,
      timeoutMs: 10_000,
    }),
    createMediaRecorder: () => new FakeMediaRecorder(events),
    bridge: createFakeBridge(events),
  });

  const starting = lifecycle.start();
  await playStarted.promise;
  const stopping = lifecycle.stop();
  await Promise.race([
    Promise.all([starting, stopping]),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('stop remained pending')), 25)),
  ]);

  assert.equal(video.srcObject, null);
  assert.equal(listeners.size, 0);
  assert.equal(events.filter((event) => event === 'pause').length, 1);
  assert.equal(events.filter((event) => event === 'track.stop').length, 1);
  assert.deepEqual(events.filter((event) => /^(completed|failed):/.test(event)), ['completed:-1']);
});

test('video-frame waiter rejects ended, error and timeout and always cleans video', async () => {
  for (const failure of ['ended', 'error', 'timeout', 'play'] as const) {
    const events: string[] = [];
    const listeners = new Map<string, () => void>();
    const video = {
      srcObject: null as unknown,
      play: async () => {
        events.push('play');
        if (failure === 'play') throw new Error('play rejected');
        if (failure !== 'timeout') setTimeout(() => listeners.get(failure)?.(), 0);
      },
      pause: () => events.push('pause'),
      requestVideoFrameCallback: (_listener: () => void) => 1,
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    const track = {
      stop() {},
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    };

    await assert.rejects(
      () => waitForVideoFrame({
        video,
        stream: { getTracks: () => [track] },
        signal: new AbortController().signal,
        timeoutMs: failure === 'timeout' ? 1 : 100,
      }),
      new RegExp(failure, 'i'),
    );
    assert.deepEqual(events, ['play', 'pause']);
    assert.equal(video.srcObject, null);
  }
});

test('recorder lifecycle sends only one mutually exclusive terminal signal', async () => {
  for (const failurePoint of ['start', 'chunk', 'stop'] as const) {
    const events: string[] = [];
    const recorder = new FakeMediaRecorder(events);
    const bridge = createFakeBridge(events);
    if (failurePoint === 'chunk') bridge.firstChunk = async () => { throw new Error('chunk failed'); };
    if (failurePoint === 'stop') bridge.flush = async () => { throw new Error('stop failed'); };
    const lifecycle = createRecorderLifecycle({
      getDisplayMedia: async () => {
        if (failurePoint === 'start') throw new Error('start failed');
        return { getTracks: () => [{ stop: () => events.push('track.stop') }] };
      },
      waitForFirstVideoFrame: async () => undefined,
      createMediaRecorder: () => recorder,
      bridge,
    });

    if (failurePoint === 'start') {
      await assert.rejects(() => lifecycle.start(), /start failed/);
    } else {
      await lifecycle.start();
      recorder.emitData(new Uint8Array([1]), 0);
      if (failurePoint === 'chunk') {
        await waitForEvent(events, 'failed:chunk failed');
        await lifecycle.stop();
      } else {
        await assert.rejects(() => lifecycle.stop());
      }
    }
    await lifecycle.stop();
    await lifecycle.start();
    assert.equal(events.filter((event) => event.startsWith('failed:')).length, 1);
    assert.equal(events.some((event) => event.startsWith('completed:')), false);
  }
});

test('hidden recorder preload exposes wrapped listeners and shared channels', async () => {
  const preload = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/recorder-preload.cts'),
    'utf8',
  );

  assert.match(preload, /contextBridge\.exposeInMainWorld\('manualRecorder'/);
  assert.match(preload, /createRecorderPreloadApi\(ipcRenderer\)/);
  assert.doesNotMatch(preload, /'manual-recorder:/);
  assert.doesNotMatch(preload, /node:path|guide/);
});

test('preload API registration wraps Electron events and uses typed channels', async () => {
  const calls: Array<{ kind: string; channel: string; payload?: unknown }> = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const api = createRecorderPreloadApi({
    once: (channel, listener) => listeners.set(channel, listener),
    invoke: async (channel, payload) => {
      calls.push({ kind: 'invoke', channel, payload });
    },
    send: (channel, payload) => calls.push({ kind: 'send', channel, payload }),
  });
  let starts = 0;
  api.onStart(() => { starts += 1; });
  listeners.get(MANUAL_RECORDER_CHANNELS.start)?.({ sender: 'must not cross bridge' });
  assert.equal(starts, 1);
  api.started();

  const chunk = { bytes: new Uint8Array([1]), sequence: 0, timecodeMs: 0 };
  await api.firstChunk(chunk);
  await api.flush({ lastSequence: 0 });
  api.completed({ lastSequence: 0 });
  api.failed({ message: 'failed' });
  assert.deepEqual(calls.map((call) => call.channel), [
    MANUAL_RECORDER_CHANNELS.started,
    MANUAL_RECORDER_CHANNELS.firstChunk,
    MANUAL_RECORDER_CHANNELS.flush,
    MANUAL_RECORDER_CHANNELS.completed,
    MANUAL_RECORDER_CHANNELS.failed,
  ]);
});

test('product asset copier includes recorder HTML without POC references', async () => {
  const html = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/recorder.html'),
    'utf8',
  );
  const copyScript = await readFile(path.resolve('scripts/copy-manual-recording-assets.mjs'), 'utf8');

  assert.match(html, /recorder-renderer\.bundle\.js/);
  assert.doesNotMatch(html, /pocs\/manual-recording/);
  assert.match(copyScript, /recording-overlay/);
  assert.doesNotMatch(copyScript, /pocs\/manual-recording/);

  const { selectManualRecordingAssets } = await import('../../scripts/copy-manual-recording-assets.mjs');
  assert.deepEqual(
    selectManualRecordingAssets(
      'src/lib/video-generator/recording-overlay',
      ['overlay.html', 'recorder.html', 'renderer.ts', 'capture-poc.html'],
    ),
    ['overlay.html', 'recorder.html'],
  );
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve: (value) => resolve(value as T) };
}

class FakeMediaRecorder implements MediaRecorderLike {
  state: 'inactive' | 'recording' = 'inactive';
  startCalls = 0;
  private readonly listeners = new Map<string, Array<(event?: RecorderEventLike) => void>>();

  constructor(
    private readonly events: string[],
    private readonly options: { finalChunk?: 'data' | 'zero-size' } = {},
  ) {}

  addEventListener(name: 'dataavailable', listener: (event: RecorderEventLike) => void): void;
  addEventListener(name: 'stop', listener: () => void, options?: { once: boolean }): void;
  addEventListener(
    name: 'dataavailable' | 'stop',
    listener: ((event: RecorderEventLike) => void) | (() => void),
    _options?: { once: boolean },
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener as (event?: RecorderEventLike) => void);
    this.listeners.set(name, listeners);
  }

  start(timeslice: number): void {
    this.state = 'recording';
    this.startCalls += 1;
    this.events.push(`recorder.start:${timeslice}`);
  }

  stop(): void {
    this.events.push('recorder.stop');
    if (this.options.finalChunk === 'zero-size') this.emitZeroData(30);
    else this.emitData(new Uint8Array([3]), 30);
    this.state = 'inactive';
    this.emit('stop');
  }

  emitData(data: Uint8Array, timecode: number): void {
    this.emit('dataavailable', { data, timecode });
  }

  emitZeroData(timecode: number): void {
    this.emit('dataavailable', {
      data: { size: 0, arrayBuffer: async () => new ArrayBuffer(0) },
      timecode,
    });
  }

  private emit(name: string, event?: RecorderEventLike): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

async function waitForEvent(events: string[], expected: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (events.includes(expected)) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${expected}; observed ${events.join(', ')}`);
}

function createFakeBridge(events: string[], firstWrite?: ReturnType<typeof deferred<void>>) {
  return {
    started: () => undefined,
    firstChunk: async (payload: { sequence: number }) => {
      events.push(`first:${payload.sequence}`);
      await firstWrite?.promise;
    },
    appendChunk: async (payload: { sequence: number }) => {
      events.push(`append:${payload.sequence}`);
    },
    flush: async (payload: { lastSequence: number }) => {
      events.push(`flush:${payload.lastSequence}`);
    },
    completed: (payload: { lastSequence: number }) => {
      events.push(`completed:${payload.lastSequence}`);
    },
    failed: (payload: { message: string }) => {
      events.push(`failed:${payload.message}`);
    },
  };
}
