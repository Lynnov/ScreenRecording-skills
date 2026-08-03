import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';
import { calculateEditSegmentDurationMs } from '../../src/lib/video-generator/editing/duration.js';
import type { FineEditEvent } from '../../src/lib/video-generator/manual/fine-edit-events.js';
import { buildFineEditPlan } from '../../src/lib/video-generator/manual/fine-edit-plan.js';
import type { FineEditRules } from '../../src/lib/video-generator/manual/fine-edit-rules.js';

const rules: FineEditRules = {
  version: 1,
  hard: { keepRequiredEvents: true, shortWaitMaxMs: 1000, mistakeWaitMaxMs: 3000, mistakeWaitPlaybackRate: 5, normalIdleMaxPlaybackRate: 2 },
  soft: { actionPreRollMs: 500, actionPostRollMs: 500, narrationTailMs: 1000, resultReactionMs: 1000, maxSilentTailMs: 2000, fadeMs: 120, whiteFrameRatio: 0.92 },
  evolution: { enabled: true, maxAdjustmentRatio: 0.1, promoteOnlyPassed: true },
};

function basePlan(endMs = 12000): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [{
      segmentId: 'segment-001',
      title: '录入并保存',
      clips: [{ sourceId: 'pickup-001', sourceStartMs: 0, sourceEndMs: endMs, playbackRate: 1 }],
      confidence: 'high',
      reason: 'approved content',
    }],
  };
}

function event(id: string, atMs: number, type: string, target: Record<string, unknown>): FineEditEvent {
  return { id, sourceId: 'pickup-001', atMs, type, target, payload: {} };
}

test('drops superseded input attempts, preserves final input and save, and removes long gaps', () => {
  const events = [
    event('label', 500, 'pointer-click', { tagName: 'div', text: '订单量' }),
    event('old-input', 1500, 'input', { tagName: 'input', inputType: 'text' }),
    event('old-change', 1700, 'change', { tagName: 'input', inputType: 'text' }),
    event('final-input', 7000, 'input', { tagName: 'input', inputType: 'text' }),
    event('final-change', 7200, 'change', { tagName: 'input', inputType: 'text' }),
    event('save', 8000, 'pointer-click', { tagName: 'span', text: '保存' }),
  ];

  const result = buildFineEditPlan({
    effectivePlan: basePlan(),
    eventsBySource: new Map([['pickup-001', events]]),
    audioDurationBySegment: new Map([['segment-001', 4000]]),
    blankIntervalsBySource: new Map(),
    rules,
  });

  const segment = result.plan.segments[0]!;
  assert.equal(segment.clips.some((clip) => clip.sourceStartMs <= 1500 && clip.sourceEndMs >= 1500), false);
  assert.equal(segment.clips.some((clip) => clip.sourceStartMs <= 7000 && clip.sourceEndMs >= 7200), true);
  assert.equal(segment.clips.some((clip) => clip.sourceStartMs <= 8000 && clip.sourceEndMs >= 8000), true);
  assert.ok(calculateEditSegmentDurationMs(segment) >= 5000);
  assert.ok(calculateEditSegmentDurationMs(segment) < 9000);
});

test('uses a TTS-sized stable window when a segment has no events', () => {
  const result = buildFineEditPlan({
    effectivePlan: basePlan(19000),
    eventsBySource: new Map([['pickup-001', []]]),
    audioDurationBySegment: new Map([['segment-001', 7930]]),
    blankIntervalsBySource: new Map(),
    rules,
  });

  const segment = result.plan.segments[0]!;
  assert.equal(calculateEditSegmentDurationMs(segment), 8930);
  assert.equal(segment.clips[0]!.sourceEndMs, 19000);
});

test('prioritizes high-confidence white-screen deletion over lifecycle navigation events', () => {
  const events = [
    event('navigation', 5301, 'navigation', {}),
  ];
  const result = buildFineEditPlan({
    effectivePlan: basePlan(12000),
    eventsBySource: new Map([['pickup-001', events]]),
    audioDurationBySegment: new Map([['segment-001', 4000]]),
    blankIntervalsBySource: new Map([['pickup-001', [{ startMs: 2800, endMs: 6033, confidence: 'high' }]]]),
    rules,
  });

  const clips = result.plan.segments[0]!.clips;
  assert.equal(clips.some((clip) => clip.sourceStartMs < 6033 && clip.sourceEndMs > 2800), false);
});

test('does not delete a white candidate that contains a real user action', () => {
  const result = buildFineEditPlan({
    effectivePlan: basePlan(12000),
    eventsBySource: new Map([['pickup-001', [event('click', 5301, 'pointer-click', { tagName: 'button', text: 'Save' })]]]),
    audioDurationBySegment: new Map([['segment-001', 4000]]),
    blankIntervalsBySource: new Map([['pickup-001', [{ startMs: 2800, endMs: 6033, confidence: 'high' }]]]),
    rules,
  });

  assert.ok(result.plan.segments[0]!.clips.some((clip) => clip.sourceStartMs < 6033 && clip.sourceEndMs > 2800));
  assert.equal(result.warnings.some((warning) => warning.code === 'AMBIGUOUS_BLANK_REGION'), true);
});
