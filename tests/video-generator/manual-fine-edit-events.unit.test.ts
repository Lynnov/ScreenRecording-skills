import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  analyzeFineEditEvents,
  eventPathForSource,
  readSourceEvents,
  type FineEditEvent,
} from '../../src/lib/video-generator/manual/fine-edit-events.js';

function event(id: string, atMs: number, type: string, target: Record<string, unknown>): FineEditEvent {
  return { id, sourceId: 'pickup-001', atMs, type, target, payload: {} };
}

test('resolves original and pickup event artifact paths', () => {
  assert.equal(eventPathForSource('C:\\run', 'original'), path.join('C:\\run', 'capture', 'events.jsonl'));
  assert.equal(eventPathForSource('C:\\run', 'segment-004-attempt-003'), path.join('C:\\run', 'pickups', 'segment-004-attempt-003.events.jsonl'));
});

test('reads source events with stable line ids and video timestamps', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'fine-events-'));
  await mkdir(path.join(runDir, 'pickups'));
  await writeFile(path.join(runDir, 'pickups', 'pickup-001.events.jsonl'), [
    JSON.stringify({ type: 'input', videoTimeMs: 1234, target: { tagName: 'input', inputType: 'text', valueLength: 2 } }),
    JSON.stringify({ type: 'input', videoTimeMs: null, target: { tagName: 'input' } }),
  ].join('\n') + '\n');

  const events = await readSourceEvents(runDir, 'pickup-001');

  assert.deepEqual(events.map(({ id, atMs }) => ({ id, atMs })), [{ id: 'pickup-001:event-1', atMs: 1234 }]);
});

test('keeps only the final input attempt for a labelled target', () => {
  const events = [
    event('label', 500, 'pointer-click', { tagName: 'div', text: '订单量' }),
    event('first-input', 1000, 'input', { tagName: 'input', inputType: 'text' }),
    event('first-change', 1200, 'change', { tagName: 'input', inputType: 'text' }),
    event('second-input', 4000, 'input', { tagName: 'input', inputType: 'text' }),
    event('second-change', 4200, 'change', { tagName: 'input', inputType: 'text' }),
    event('save', 5000, 'pointer-click', { tagName: 'span', text: '保存' }),
  ];

  const analysis = analyzeFineEditEvents(events);

  assert.deepEqual([...analysis.discardedEventIds].sort(), ['first-change', 'first-input']);
  assert.equal(analysis.retainedEventIds.has('second-input'), true);
  assert.equal(analysis.retainedEventIds.has('second-change'), true);
  assert.equal(analysis.retainedEventIds.has('save'), true);
  assert.deepEqual(analysis.warnings.map((warning) => warning.code), ['SUPERSEDED_INPUT_REMOVED']);
});

test('preserves ambiguous generic inputs and emits a warning', () => {
  const events = [
    event('input-1', 1000, 'input', { tagName: 'input', inputType: 'text' }),
    event('input-2', 4000, 'input', { tagName: 'input', inputType: 'text' }),
  ];

  const analysis = analyzeFineEditEvents(events);

  assert.equal(analysis.discardedEventIds.size, 0);
  assert.equal(analysis.retainedEventIds.has('input-1'), true);
  assert.equal(analysis.retainedEventIds.has('input-2'), true);
  assert.deepEqual(analysis.warnings.map((warning) => warning.code), ['AMBIGUOUS_INPUT_TARGET']);
});

test('drops an interim save when the same labelled input is edited and saved again', () => {
  const events = [
    event('label', 500, 'pointer-click', { tagName: 'div', text: 'order-quantity' }),
    event('old-input', 1000, 'input', { tagName: 'input', inputType: 'text' }),
    event('old-change', 1200, 'change', { tagName: 'input', inputType: 'text' }),
    event('old-save', 2000, 'pointer-click', { tagName: 'span', text: '保存' }),
    event('final-click', 3500, 'pointer-click', { tagName: 'input', inputType: 'text' }),
    event('final-input', 3600, 'input', { tagName: 'input', inputType: 'text' }),
    event('final-change', 3800, 'change', { tagName: 'input', inputType: 'text' }),
    event('final-save', 4200, 'pointer-click', { tagName: 'span', text: '保存' }),
  ];

  const analysis = analyzeFineEditEvents(events);

  assert.deepEqual([...analysis.discardedEventIds].sort(), ['old-change', 'old-input', 'old-save']);
  assert.equal(analysis.retainedEventIds.has('final-click'), true);
  assert.equal(analysis.retainedEventIds.has('final-save'), true);
  assert.deepEqual(analysis.warnings.map((warning) => warning.code), ['SUPERSEDED_INPUT_REMOVED']);
});
