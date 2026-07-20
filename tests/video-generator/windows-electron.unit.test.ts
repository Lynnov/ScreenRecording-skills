import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCaptureChunkWriter,
  isValidOperatorChecklist,
  resolveDisplayMediaRequest,
} from '../../src/lib/video-generator/capture/windows-electron.js';

test('validates operator checklist payloads', () => {
  assert.equal(isValidOperatorChecklist({ overlayEnteredCapture: false, multiTabContinuous: true, notes: 'ok' }), true);
  assert.equal(isValidOperatorChecklist({ overlayEnteredCapture: 'false', multiTabContinuous: true, notes: 'ok' }), false);
  assert.equal(isValidOperatorChecklist({ overlayEnteredCapture: false, multiTabContinuous: true, notes: 1 }), false);
});

test('authorizes display media only for the control main frame', () => {
  const source = { id: 'window:101:0', name: 'VG-CAPTURE-abc' };
  assert.deepEqual(resolveDisplayMediaRequest({
    requestFrame: { routingId: 7, destroyed: false },
    requestWebContentsId: 42,
    controlWebContentsId: 42,
    controlMainFrameRoutingId: 7,
    source,
  }), { video: source });

  assert.deepEqual(resolveDisplayMediaRequest({
    requestFrame: null,
    requestWebContentsId: 42,
    controlWebContentsId: 42,
    controlMainFrameRoutingId: 7,
    source,
  }), {});
  assert.deepEqual(resolveDisplayMediaRequest({
    requestFrame: { routingId: 7, destroyed: true },
    requestWebContentsId: 42,
    controlWebContentsId: 42,
    controlMainFrameRoutingId: 7,
    source,
  }), {});
  assert.deepEqual(resolveDisplayMediaRequest({
    requestFrame: { routingId: 8, destroyed: false },
    requestWebContentsId: 42,
    controlWebContentsId: 42,
    controlMainFrameRoutingId: 7,
    source,
  }), {});
  assert.deepEqual(resolveDisplayMediaRequest({
    requestFrame: { routingId: 7, destroyed: false },
    requestWebContentsId: 43,
    controlWebContentsId: 42,
    controlMainFrameRoutingId: 7,
    source,
  }), {});
});

test('serializes chunk writes and reports missing sequences on flush', async () => {
  const writes: Array<{ sequence: number; bytes: Uint8Array }> = [];
  const writer = createCaptureChunkWriter(async (bytes, sequence) => {
    writes.push({ sequence, bytes });
  });

  await writer.appendChunk(new Uint8Array([1]), 0);
  await writer.appendChunk(new Uint8Array([2]), 1);
  await writer.appendChunk(new Uint8Array([3]), 2);
  await writer.flush(2);
  assert.deepEqual(writes.map((write) => write.sequence), [0, 1, 2]);

  const broken = createCaptureChunkWriter(async () => {});
  await broken.appendChunk(new Uint8Array([1]), 0);
  await assert.rejects(() => broken.appendChunk(new Uint8Array([3]), 2), /expected sequence 1/i);
  await assert.rejects(() => broken.flush(2), /missing sequence 1/i);
});
