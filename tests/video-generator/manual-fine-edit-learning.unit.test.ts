import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFineEditLearningCandidate } from '../../src/lib/video-generator/manual/fine-edit-learning.js';
import type { FineEditQualityReport } from '../../src/lib/video-generator/manual/fine-edit-quality.js';
import type { FineEditRules } from '../../src/lib/video-generator/manual/fine-edit-rules.js';

const rules: FineEditRules = {
  version: 1,
  hard: { keepRequiredEvents: true, shortWaitMaxMs: 1000, mistakeWaitMaxMs: 3000, mistakeWaitPlaybackRate: 5, normalIdleMaxPlaybackRate: 2 },
  soft: { actionPreRollMs: 500, actionPostRollMs: 500, narrationTailMs: 1000, resultReactionMs: 1000, maxSilentTailMs: 2000, fadeMs: 120, whiteFrameRatio: 0.92 },
  evolution: { enabled: true, maxAdjustmentRatio: 0.1, promoteOnlyPassed: true },
};

function quality(status: 'passed' | 'warning'): FineEditQualityReport {
  return {
    version: 1,
    status,
    rulesVersion: 1,
    requiredEventCoverage: 1,
    beforeDurationMs: 10000,
    afterDurationMs: 6000,
    narrationDurationMs: 4000,
    segments: [{ segmentId: 'segment-001', beforeDurationMs: 10000, afterDurationMs: 6000, audioDurationMs: 4000, silentTailMs: 2000, requiredEventCoverage: 1 }],
    warnings: status === 'warning' ? [{ code: 'LONG_ACTION_AFTER_NARRATION', message: 'long' }] : [],
    hardFailures: [],
  };
}

test('does not promote learning candidates from warning finals', () => {
  const candidate = buildFineEditLearningCandidate({ rules, quality: quality('warning'), runDir: 'run' });
  assert.equal(candidate.eligible, false);
  assert.match(candidate.reason, /passed/i);
});
test('limits passed-run soft adjustments to ten percent and preserves hard rules', () => {
  const candidate = buildFineEditLearningCandidate({ rules, quality: quality('passed'), runDir: 'run' });
  assert.equal(candidate.eligible, true);
  assert.deepEqual(candidate.proposedRules.hard, rules.hard);
  assert.ok(Math.abs(candidate.proposedRules.soft.resultReactionMs - rules.soft.resultReactionMs) <= 100);
});
