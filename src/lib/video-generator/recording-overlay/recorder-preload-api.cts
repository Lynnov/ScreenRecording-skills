import type {
  RecorderChunkPayload,
  RecorderCompletedPayload,
  RecorderFailedPayload,
  RecorderFlushPayload,
} from '../capture/product-ipc.js';

const { MANUAL_RECORDER_CHANNELS } = require('../capture/product-ipc-channels.cjs') as typeof import('../capture/product-ipc-channels.cjs');

interface RecorderIpcBoundary {
  once(channel: string, listener: (...args: unknown[]) => void): void;
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  send(channel: string, payload?: unknown): void;
}

function createRecorderPreloadApi(ipc: RecorderIpcBoundary) {
  return {
    onStart(listener: () => void) {
      ipc.once(MANUAL_RECORDER_CHANNELS.start, (_event) => listener());
    },
    onStop(listener: () => void) {
      ipc.once(MANUAL_RECORDER_CHANNELS.stop, (_event) => listener());
    },
    started: () => ipc.send(MANUAL_RECORDER_CHANNELS.started),
    firstChunk: (payload: RecorderChunkPayload) => ipc.invoke(MANUAL_RECORDER_CHANNELS.firstChunk, payload),
    appendChunk: (payload: RecorderChunkPayload) => ipc.invoke(MANUAL_RECORDER_CHANNELS.appendChunk, payload),
    flush: (payload: RecorderFlushPayload) => ipc.invoke(MANUAL_RECORDER_CHANNELS.flush, payload),
    completed: (payload: RecorderCompletedPayload) => ipc.send(MANUAL_RECORDER_CHANNELS.completed, payload),
    failed: (payload: RecorderFailedPayload) => ipc.send(MANUAL_RECORDER_CHANNELS.failed, payload),
  };
}

export = { createRecorderPreloadApi };
