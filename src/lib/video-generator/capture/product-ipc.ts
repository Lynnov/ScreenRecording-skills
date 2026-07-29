import channelContract from './product-ipc-channels.cjs';

export const { MANUAL_RECORDER_CHANNELS } = channelContract;

export interface RecorderChunkPayload {
  bytes: Uint8Array;
  sequence: number;
  timecodeMs: number;
}

export interface RecorderFlushPayload {
  lastSequence: number;
}

export type RecorderCompletedPayload = RecorderFlushPayload;

export interface RecorderFailedPayload {
  message: string;
}

export type RecorderCompletion = 'completed' | 'failed';

export function validateRecorderChunkPayload(payload: unknown): RecorderChunkPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new TypeError('Recorder chunk payload must be an object');
  }

  const candidate = payload as Partial<RecorderChunkPayload>;
  if (!(candidate.bytes instanceof Uint8Array)) {
    throw new TypeError('Recorder chunk bytes must be a Uint8Array');
  }
  if (!Number.isSafeInteger(candidate.sequence) || candidate.sequence! < 0) {
    throw new TypeError('Recorder chunk sequence must be a non-negative safe integer');
  }
  if (
    typeof candidate.timecodeMs !== 'number'
    || !Number.isFinite(candidate.timecodeMs)
    || candidate.timecodeMs < 0
  ) {
    throw new TypeError('Recorder chunk timecode must be finite and non-negative');
  }

  return candidate as RecorderChunkPayload;
}

export function validateRecorderFirstChunkPayload(payload: unknown): RecorderChunkPayload {
  const chunk = validateRecorderChunkPayload(payload);
  if (chunk.sequence !== 0) {
    throw new TypeError('Recorder first chunk sequence must be zero');
  }
  return chunk;
}

export const validateRecorderAppendChunkPayload = validateRecorderChunkPayload;

export function validateRecorderFlushPayload(payload: unknown): RecorderFlushPayload {
  assertObject(payload, 'Recorder flush payload');
  const { lastSequence } = payload as Partial<RecorderFlushPayload>;
  if (!Number.isSafeInteger(lastSequence) || lastSequence! < -1) {
    throw new TypeError('Recorder flush lastSequence must be -1 or a non-negative safe integer');
  }
  return { lastSequence: lastSequence! };
}

export const validateRecorderCompletedPayload = validateRecorderFlushPayload;

export function validateRecorderFailedPayload(payload: unknown): RecorderFailedPayload {
  assertObject(payload, 'Recorder failed payload');
  const { message } = payload as Partial<RecorderFailedPayload>;
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('Recorder failed message must be a non-empty string');
  }
  return { message };
}

export function validateRecorderCompletion(value: unknown): RecorderCompletion {
  if (value !== 'completed' && value !== 'failed') {
    throw new TypeError('Invalid recorder completion');
  }
  return value;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} must be an object`);
  }
}

export function createRecorderCompletionGuard(): {
  complete(value: unknown): RecorderCompletion;
} {
  let completion: RecorderCompletion | null = null;
  return {
    complete(value) {
      const validated = validateRecorderCompletion(value);
      if (completion !== null) {
        throw new Error(`Recorder already completed as ${completion}`);
      }
      completion = validated;
      return validated;
    },
  };
}
