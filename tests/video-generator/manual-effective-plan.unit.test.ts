import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';
import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { buildEffectivePlan, saveEffectivePlan } from '../../src/lib/video-generator/manual/effective-plan.js';
import { createEditReviewDraft } from '../../src/lib/video-generator/manual/review.js';
import type { ManualSourceCatalog } from '../../src/lib/video-generator/manual/types.js';

function plan(): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [
      { segmentId: 'segment-001', title: 'one', clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }], confidence: 'high', reason: 'ok' },
      { segmentId: 'segment-002', title: 'two', clips: [{ sourceId: 'original', sourceStartMs: 1000, sourceEndMs: 2000, playbackRate: 1 }], confidence: 'medium', reason: 'ok' },
    ],
  };
}

function catalog(): ManualSourceCatalog {
  return {
    version: 1,
    sources: [
      { id: 'original', path: 'capture/original.mp4', durationMs: 3000, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false, kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-28T00:00:00.000Z' },
      { id: 'pickup-002', path: 'pickups/segment-002-attempt-001.mp4', durationMs: 900, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false, kind: 'pickup', segmentId: 'segment-002', attempt: 1, status: 'available', createdAt: '2026-07-28T00:00:00.000Z' },
    ],
  };
}

test('buildEffectivePlan applies boundaries, attempt/source selection, and wait strategy', () => {
  const review = createEditReviewDraft({ agentPlan: plan() });
  review.segments[0] = { ...review.segments[0]!, status: 'approved', adjustedStartMs: 100, adjustedEndMs: 900, waitStrategy: 'keep' };
  review.segments[1] = { ...review.segments[1]!, status: 'approved', selectedSourceId: 'pickup-002', adjustedStartMs: 0, adjustedEndMs: 800, waitStrategy: 'compress', reviewReasons: ['使用补录素材。'] };

  const effective = buildEffectivePlan({ agentPlan: plan(), review, sourceCatalog: catalog() });

  assert.equal(effective.segments[0]!.clips[0]!.sourceStartMs, 100);
  assert.equal(effective.segments[0]!.clips[0]!.sourceEndMs, 900);
  assert.equal(effective.segments[1]!.clips[0]!.sourceId, 'pickup-002');
  assert.equal(effective.segments[1]!.clips[0]!.sourceEndMs, 800);
  assert.equal(effective.segments[1]!.clips[0]!.playbackRate, 1);
  assert.equal(Object.hasOwn(effective.segments[1]!, 'playbackRate'), false);
});

test('buildEffectivePlan removes hold when wait strategy compresses waiting', () => {
  const sourcePlan = plan();
  sourcePlan.segments[0] = { ...sourcePlan.segments[0]!, holdLastFrameMs: 1200 };
  const review = createEditReviewDraft({ agentPlan: sourcePlan });
  review.segments[0] = { ...review.segments[0]!, waitStrategy: 'compress' };

  const effective = buildEffectivePlan({ agentPlan: sourcePlan, review, sourceCatalog: catalog() });

  assert.equal(effective.segments[0]!.holdLastFrameMs, undefined);
});

test('buildEffectivePlan rejects pickup-required/rejected segments and unavailable sources', () => {
  const review = createEditReviewDraft({ agentPlan: plan() });
  review.segments[1] = { ...review.segments[1]!, status: 'pickup-required', reviewReasons: ['需要补录'] };
  assert.throws(() => buildEffectivePlan({ agentPlan: plan(), review, sourceCatalog: catalog() }), /not approved/i);

  const unavailable = catalog();
  unavailable.sources[1]!.status = 'failed';
  const approved = createEditReviewDraft({ agentPlan: plan() });
  approved.segments[1] = { ...approved.segments[1]!, status: 'approved', selectedSourceId: 'pickup-002', reviewReasons: ['已确认'] };
  assert.throws(() => buildEffectivePlan({ agentPlan: plan(), review: approved, sourceCatalog: unavailable }), /source/i);

  const missingSource = createEditReviewDraft({ agentPlan: plan() });
  missingSource.segments[1] = { ...missingSource.segments[1]!, status: 'approved', selectedSourceId: 'missing-source', reviewReasons: ['选择缺失素材。'] };
  assert.throws(() => buildEffectivePlan({ agentPlan: plan(), review: missingSource, sourceCatalog: catalog() }), /source/i);
});

test('buildEffectivePlan defaults selected pickup source boundaries to the pickup duration', () => {
  const sourcePlan = plan();
  sourcePlan.segments[1]!.clips[0] = { ...sourcePlan.segments[1]!.clips[0]!, sourceStartMs: 1200, sourceEndMs: 1800 };
  const review = createEditReviewDraft({ agentPlan: sourcePlan });
  review.segments[1] = { ...review.segments[1]!, status: 'approved', selectedSourceId: 'pickup-002', reviewReasons: ['使用补录素材。'] };

  const effective = buildEffectivePlan({ agentPlan: sourcePlan, review, sourceCatalog: catalog() });

  assert.equal(effective.segments[1]!.clips[0]!.sourceStartMs, 0);
  assert.equal(effective.segments[1]!.clips[0]!.sourceEndMs, 900);
});

test('buildEffectivePlan rejects adjusted boundaries outside the selected source duration', () => {
  const review = createEditReviewDraft({ agentPlan: plan() });
  review.segments[1] = { ...review.segments[1]!, status: 'approved', selectedSourceId: 'pickup-002', adjustedStartMs: 0, adjustedEndMs: 5000, reviewReasons: ['越界测试。'] };

  assert.throws(() => buildEffectivePlan({ agentPlan: plan(), review, sourceCatalog: catalog() }), /duration|bounds|越界/i);
});

test('saveEffectivePlan writes immutable effective plan and current pointer', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-effective-'));
  try {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.editDir, { recursive: true });
    const effective = plan();
    const saved = await saveEffectivePlan({ runDir, effectivePlan: effective });

    assert.equal(saved.version, 1);
    assert.deepEqual(JSON.parse(await readFile(saved.planPath, 'utf8')), effective);
    assert.deepEqual(JSON.parse(await readFile(bundle.effectiveCurrentPlanPath, 'utf8')), { version: 1, path: saved.planPath });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
