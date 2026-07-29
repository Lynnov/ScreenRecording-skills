import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planManualKeyframes } from '../../src/lib/video-generator/manual/keyframes.js';
import type { RecordingEvent } from '../../src/lib/video-generator/recording/types.js';

const events: RecordingEvent[] = [
  { type: 'recording-start', sessionTimeMs: 0, videoTimeMs: 0 },
  { type: 'pointer-click', sessionTimeMs: 1000, videoTimeMs: 1000, payload: { actionId: 'action-001' } },
  { type: 'input', sessionTimeMs: 1800, videoTimeMs: 1800, payload: { actionId: 'action-001' } },
  { type: 'action-confirmed', sessionTimeMs: 2300, videoTimeMs: 2300, payload: { actionId: 'action-001', segmentId: 'segment-001' } },
  { type: 'navigation', sessionTimeMs: 3200, videoTimeMs: 3200 },
  { type: 'tab-created', sessionTimeMs: 3600, videoTimeMs: 3600, tabId: 'tab-2' },
  { type: 'retry-start', sessionTimeMs: 4200, videoTimeMs: 4200 },
  { type: 'recording-stop', sessionTimeMs: 6100, videoTimeMs: 6100 },
];

test('planManualKeyframes includes event windows and low-frequency frames', () => {
  const result = planManualKeyframes({ events, durationMs: 6200, intervalMs: 2500 });
  const reasons = result.frames.map((frame) => frame.reason);

  assert.ok(result.frames.some((frame) => frame.atMs === 700 && frame.reason === 'click-before'));
  assert.ok(result.frames.some((frame) => frame.atMs === 1500 && frame.reason === 'click-after'));
  assert.ok(reasons.includes('input'));
  assert.ok(reasons.includes('result'));
  assert.ok(reasons.includes('navigation'));
  assert.ok(reasons.includes('tab'));
  assert.ok(reasons.includes('retry'));
  assert.ok(reasons.includes('segment-end'));
  assert.ok(result.frames.some((frame) => frame.reason === 'interval' && frame.atMs === 2500));
  assert.ok(result.frames.every((frame) => frame.atMs >= 0 && frame.atMs <= 6200));
});

test('planManualKeyframes deduplicates by timestamp while preserving reasons', () => {
  const result = planManualKeyframes({
    events: [
      { type: 'pointer-click', sessionTimeMs: 300, videoTimeMs: 300 },
      { type: 'recording-start', sessionTimeMs: 0, videoTimeMs: 0 },
    ],
    durationMs: 1000,
  });

  const zero = result.frames.find((frame) => frame.atMs === 0);
  assert.ok(zero);
  assert.match(zero.reason, /click-before|recording-start/);
}
);
