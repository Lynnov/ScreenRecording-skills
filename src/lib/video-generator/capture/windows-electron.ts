import type { CaptureSourceDescriptor } from './types.js';

export interface OperatorChecklist {
  overlayEnteredCapture: boolean;
  multiTabContinuous: boolean;
  notes: string;
}

export interface DisplayMediaFrameDescriptor {
  routingId: number;
  destroyed: boolean;
}

export interface DisplayMediaRequestInput {
  requestFrame: DisplayMediaFrameDescriptor | null;
  requestWebContentsId: number | null;
  controlWebContentsId: number;
  controlMainFrameRoutingId: number;
  source: CaptureSourceDescriptor;
}

export type DisplayMediaResolution = { video: CaptureSourceDescriptor } | Record<string, never>;

export function isValidOperatorChecklist(value: unknown): value is OperatorChecklist {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.overlayEnteredCapture === 'boolean'
    && typeof candidate.multiTabContinuous === 'boolean'
    && typeof candidate.notes === 'string';
}

export function resolveDisplayMediaRequest(input: DisplayMediaRequestInput): DisplayMediaResolution {
  if (input.requestFrame === null || input.requestFrame.destroyed) {
    return {};
  }
  if (input.requestFrame.routingId !== input.controlMainFrameRoutingId) {
    return {};
  }
  if (input.requestWebContentsId !== input.controlWebContentsId) {
    return {};
  }
  return { video: input.source };
}

export interface CaptureChunkWriter {
  appendChunk(bytes: Uint8Array, sequence: number): Promise<void>;
  flush(lastSequence: number): Promise<void>;
  writtenSequence(): number;
}

export function createCaptureChunkWriter(
  append: (bytes: Uint8Array, sequence: number) => Promise<void>,
): CaptureChunkWriter {
  let expectedSequence = 0;
  let writtenSequence = -1;
  let writeQueue = Promise.resolve();
  let failedSequence: number | null = null;

  return {
    async appendChunk(bytes, sequence) {
      if (sequence !== expectedSequence) {
        failedSequence = expectedSequence;
        throw new Error(`Expected sequence ${expectedSequence}, received ${sequence}.`);
      }
      expectedSequence += 1;
      writeQueue = writeQueue.then(async () => {
        await append(bytes, sequence);
        writtenSequence = sequence;
      });
      await writeQueue;
    },
    async flush(lastSequence) {
      await writeQueue;
      if (failedSequence !== null) {
        throw new Error(`Missing sequence ${failedSequence}.`);
      }
      if (writtenSequence !== lastSequence) {
        throw new Error(`Missing sequence ${writtenSequence + 1}.`);
      }
    },
    writtenSequence() {
      return writtenSequence;
    },
  };
}
