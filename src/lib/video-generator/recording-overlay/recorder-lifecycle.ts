import {
  createRecorderCompletionGuard,
  type RecorderChunkPayload,
  type RecorderCompletedPayload,
  type RecorderFailedPayload,
  type RecorderFlushPayload,
} from '../capture/product-ipc.js';

export interface RecorderTrackLike {
  stop(): void;
  addEventListener?(name: string, listener: () => void): void;
  removeEventListener?(name: string, listener: () => void): void;
}

export interface RecorderStreamLike {
  getTracks(): RecorderTrackLike[];
}

export interface RecorderDataLike {
  readonly size?: number;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export interface RecorderEventLike {
  data: RecorderDataLike | Uint8Array;
  timecode: number;
}

export interface MediaRecorderLike {
  readonly state: string;
  addEventListener(name: 'dataavailable', listener: (event: RecorderEventLike) => void): void;
  addEventListener(name: 'stop', listener: () => void, options?: { once: boolean }): void;
  start(timeslice: number): void;
  stop(): void;
}

export interface RecorderBridge {
  started(): void;
  firstChunk(payload: RecorderChunkPayload): Promise<void>;
  appendChunk(payload: RecorderChunkPayload): Promise<void>;
  flush(payload: RecorderFlushPayload): Promise<void>;
  completed(payload: RecorderCompletedPayload): void;
  failed(payload: RecorderFailedPayload): void;
}

export interface RecorderLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createRecorderLifecycle(input: {
  getDisplayMedia(): Promise<RecorderStreamLike>;
  waitForFirstVideoFrame(stream: RecorderStreamLike, signal: AbortSignal): Promise<void>;
  createMediaRecorder(stream: RecorderStreamLike): MediaRecorderLike;
  bridge: RecorderBridge;
}): RecorderLifecycle {
  const completion = createRecorderCompletionGuard();
  let stream: RecorderStreamLike | null = null;
  let recorder: MediaRecorderLike | null = null;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let writeQueue = Promise.resolve();
  let sequence = 0;
  let stopRequested = false;
  let terminal: 'completed' | 'failed' | null = null;
  let tracksStopped = false;
  const frameWaitAbort = new AbortController();
  const getTerminal = () => terminal;

  const stopTracks = () => {
    if (tracksStopped) return;
    tracksStopped = true;
    for (const track of stream?.getTracks() ?? []) track.stop();
  };

  const fail = (error: unknown) => {
    if (terminal === null) {
      terminal = 'failed';
      completion.complete('failed');
      input.bridge.failed({ message: error instanceof Error ? error.message : String(error) });
    }
    stopTracks();
  };

  const complete = (lastSequence: number) => {
    if (terminal !== null) return;
    terminal = 'completed';
    completion.complete('completed');
    input.bridge.completed({ lastSequence });
  };

  const flushAndComplete = async () => {
    const lastSequence = sequence - 1;
    await writeQueue;
    if (terminal !== null) {
      stopTracks();
      return;
    }
    await input.bridge.flush({ lastSequence });
    stopTracks();
    complete(lastSequence);
  };

  const start = (): Promise<void> => {
    if (terminal !== null) return Promise.resolve();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        stream = await input.getDisplayMedia();
        await input.waitForFirstVideoFrame(stream, frameWaitAbort.signal);
        if (stopRequested || terminal !== null) {
          await flushAndComplete();
          return;
        }
        recorder = input.createMediaRecorder(stream);
        recorder.addEventListener('dataavailable', (event) => {
          if (getTerminal() !== null || isZeroSizeData(event.data)) {
            return;
          }
          const currentSequence = sequence++;
          const pendingWrite = writeQueue.then(async () => {
            if (getTerminal() !== null) return;
            const bytes = await toBytes(event.data);
            const payload = { bytes, sequence: currentSequence, timecodeMs: event.timecode };
            if (currentSequence === 0) await input.bridge.firstChunk(payload);
            else await input.bridge.appendChunk(payload);
          });
          writeQueue = pendingWrite.catch((error: unknown) => {
            fail(error);
          });
        });
        recorder.start(250);
        input.bridge.started();
      } catch (error) {
        if (stopRequested && isAbortError(error)) {
          await flushAndComplete();
          return;
        }
        fail(error);
        throw error;
      }
    })();
    return startPromise;
  };

  const stop = (): Promise<void> => {
    if (terminal === 'completed') return Promise.resolve();
    if (terminal === 'failed' && (!recorder || recorder.state === 'inactive')) {
      stopTracks();
      return Promise.resolve();
    }
    if (stopPromise) return stopPromise;
    stopRequested = true;
    frameWaitAbort.abort();
    stopPromise = (async () => {
      try {
        await startPromise;
        if (getTerminal() === 'completed') return;
        if (recorder && recorder.state !== 'inactive') {
          const stopped = new Promise<void>((resolve) => {
            recorder!.addEventListener('stop', resolve, { once: true });
          });
          recorder.stop();
          await stopped;
        }
        if (terminal === 'failed') {
          stopTracks();
          return;
        }
        await flushAndComplete();
      } catch (error) {
        if (stopRequested && isAbortError(error)) {
          await flushAndComplete();
          return;
        }
        fail(error);
        throw error;
      }
    })();
    return stopPromise;
  };

  return { start, stop };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function toBytes(data: RecorderDataLike | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (typeof data.arrayBuffer !== 'function') {
    throw new TypeError('Recorder data must provide arrayBuffer()');
  }
  return new Uint8Array(await data.arrayBuffer());
}

function isZeroSizeData(data: RecorderDataLike | Uint8Array): boolean {
  return !(data instanceof Uint8Array) && data.size === 0;
}
