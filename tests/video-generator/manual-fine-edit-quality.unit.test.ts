import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';
import { evaluateFineEditQuality } from '../../src/lib/video-generator/manual/fine-edit-quality.js';
import type { FineEditResult } from '../../src/lib/video-generator/manual/fine-edit-plan.js';
import type { FineEditRules } from '../../src/lib/video-generator/manual/fine-edit-rules.js';

const rules: FineEditRules = {
  version: 1,
  hard: { keepRequiredEvents: true, shortWaitMaxMs: 1000, mistakeWaitMaxMs: 3000, mistakeWaitPlaybackRate: 5, normalIdleMaxPlaybackRate: 2 },
  soft: { actionPreRollMs: 500, actionPostRollMs: 500, narrationTailMs: 1000, resultReactionMs: 1000, maxSilentTailMs: 2000, fadeMs: 120, whiteFrameRatio: 0.92 },
  evolution: { enabled: true, maxAdjustmentRatio: 0.1, promoteOnlyPassed: true },
};

function plan(evidenceEventIds: string[], endMs: number): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [{
      segmentId: 'segment-001',
      title: 'Save',
      clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: endMs, playbackRate: 1, clipKind: 'action', evidenceEventIds, reason: 'required action' }],
      confidence: 'high',
      reason: 'approved',
    }],
  };
}

test('hard-fails when a required event is missing from the fine plan', () => {
  const fineResult: FineEditResult = {
    plan: plan(['input'], 5000),
    warnings: [],
    discardedEventIds: [],
    requiredEventIdsBySegment: { 'segment-001': ['input', 'save'] },
  };

  const report = evaluateFineEditQuality({
    beforePlan: plan([], 12000),
    fineResult,
    audioDurationBySegment: new Map([['segment-001', 4000]]),
    rules,
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.requiredEventCoverage, 0.5);
  assert.deepEqual(report.hardFailures.map((failure) => failure.code), ['MISSING_REQUIRED_EVENT']);
});

test('allows a warning final when required actions exceed the TTS soft target', () => {
  const fineResult: FineEditResult = {
    plan: plan(['input', 'save'], 8500),
    warnings: [{ code: 'LONG_ACTION_AFTER_NARRATION', segmentId: 'segment-001', message: 'action is longer' }],
    discardedEventIds: ['old-input'],
    requiredEventIdsBySegment: { 'segment-001': ['input', 'save'] },
  };

  const report = evaluateFineEditQuality({
    beforePlan: plan([], 12000),
    fineResult,
    audioDurationBySegment: new Map([['segment-001', 4000]]),
    rules,
  });

  assert.equal(report.status, 'warning');
  assert.equal(report.requiredEventCoverage, 1);
  assert.equal(report.beforeDurationMs, 12000);
  assert.equal(report.afterDurationMs, 8500);
  assert.equal(report.narrationDurationMs, 4000);
  assert.equal(report.segments[0]?.silentTailMs, 4500);
});
