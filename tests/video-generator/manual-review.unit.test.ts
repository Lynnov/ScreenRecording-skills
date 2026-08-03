import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import {
  createEditReviewDraft,
  saveReviewedEffectivePlan,
  saveEditReview,
  validateEditReview,
  type EditReview,
} from '../../src/lib/video-generator/manual/review.js';
import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';

async function withTempDir(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `manual-review-${process.pid}-${Date.now()}-${name}`);
  await mkdir(dir, { recursive: true });
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function agentPlan(): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [
      {
        segmentId: 'segment-001',
        title: '填写名称',
        clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }],
        confidence: 'high',
        reason: '事件明确。',
      },
      {
        segmentId: 'segment-002',
        title: '保存结果',
        clips: [{ sourceId: 'original', sourceStartMs: 1000, sourceEndMs: 2000, playbackRate: 1 }],
        confidence: 'low',
        reason: '等待较长，需要人工确认。',
      },
    ],
  };
}

test('createEditReviewDraft creates one pending review item per agent segment', () => {
  const draft = createEditReviewDraft({ agentPlan: agentPlan(), createdAt: '2026-07-28T00:00:00.000Z' });

  assert.equal(draft.version, 1);
  assert.equal(draft.reviewComplete, false);
  assert.deepEqual(draft.segments.map((segment) => segment.segmentId), ['segment-001', 'segment-002']);
  assert.deepEqual(draft.segments.map((segment) => segment.status), ['approved', 'pickup-required']);
  assert.deepEqual(draft.segments[1]!.reviewReasons, ['低置信度，需要人工处理。']);
});

test('validateEditReview accepts approved pickup-required rejected and rejects invalid boundaries or missing low-confidence handling', () => {
  const review = createEditReviewDraft({ agentPlan: agentPlan() });
  review.segments[0] = {
    ...review.segments[0]!,
    status: 'approved',
    adjustedStartMs: 100,
    adjustedEndMs: 900,
    waitStrategy: 'compress',
  };
  review.segments[1] = {
    ...review.segments[1]!,
    status: 'pickup-required',
    reviewReasons: ['低置信度，需要补录。'],
  };
  validateEditReview(review, agentPlan());

  assert.throws(() => validateEditReview({
    ...review,
    segments: [{ ...review.segments[0]!, status: 'done' as never }, review.segments[1]!],
  }, agentPlan()), /status/);
  assert.throws(() => validateEditReview({
    ...review,
    segments: [{ ...review.segments[0]!, adjustedStartMs: 950, adjustedEndMs: 900 }, review.segments[1]!],
  }, agentPlan()), /adjustedEndMs/);
  const unhandledLow = createEditReviewDraft({ agentPlan: agentPlan() });
  unhandledLow.segments[1] = { ...unhandledLow.segments[1]!, status: 'approved', reviewReasons: [] };
  assert.throws(() => validateEditReview(unhandledLow, agentPlan()), /low confidence|低置信度/i);
});

test('saveEditReview writes immutable version and current pointer', async () => {
  await withTempDir('save', async (runDir) => {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.editDir, { recursive: true });
    await writeFile(bundle.versionedEditPath('edit-plan.agent', 1), JSON.stringify(agentPlan(), null, 2), 'utf8');
    await writeFile(bundle.agentCurrentPlanPath, JSON.stringify({ version: 1, path: bundle.versionedEditPath('edit-plan.agent', 1) }), 'utf8');
    const review: EditReview = createEditReviewDraft({ agentPlan: agentPlan(), createdAt: '2026-07-28T00:00:00.000Z' });
    review.segments[1] = { ...review.segments[1]!, status: 'pickup-required', reviewReasons: ['低置信度，需要补录。'] };

    const saved = await saveEditReview({ runDir, review });

    assert.equal(saved.version, 1);
    assert.equal(saved.reviewPath, bundle.versionedEditPath('edit-review', 1));
    assert.deepEqual(JSON.parse(await readFile(bundle.reviewCurrentPath, 'utf8')), { version: 1, path: saved.reviewPath });
    assert.deepEqual(JSON.parse(await readFile(saved.reviewPath, 'utf8')), review);
  });
});

test('validateEditReview rejects missing and duplicate segment reviews', () => {
  const review = createEditReviewDraft({ agentPlan: agentPlan() });

  assert.throws(() => validateEditReview({ ...review, segments: [review.segments[0]!] }, agentPlan()), /missing review/i);
  assert.throws(() => validateEditReview({ ...review, segments: [review.segments[0]!, review.segments[0]!] }, agentPlan()), /duplicate/i);
});

test('saveReviewedEffectivePlan can save an incomplete review without writing an effective plan', async () => {
  await withTempDir('incomplete-combined', async (runDir) => {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.editDir, { recursive: true });
    await mkdir(bundle.captureDir, { recursive: true });
    const plan = agentPlan();
    await writeFile(bundle.versionedEditPath('edit-plan.agent', 1), JSON.stringify(plan, null, 2), 'utf8');
    await writeFile(bundle.agentCurrentPlanPath, JSON.stringify({ version: 1, path: bundle.versionedEditPath('edit-plan.agent', 1) }), 'utf8');
    await writeFile(bundle.sourceCatalogPath, JSON.stringify({
      version: 1,
      sources: [{ id: 'original', path: 'capture/original.mp4', durationMs: 3000, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false, kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-28T00:00:00.000Z' }],
    }, null, 2), 'utf8');
    const review = createEditReviewDraft({ agentPlan: plan, createdAt: '2026-07-28T00:00:00.000Z' });

    const saved = await saveReviewedEffectivePlan({ runDir, review });

    assert.equal(saved.effectivePlanPath, undefined);
    const savedReview = JSON.parse(await readFile(saved.reviewPath, 'utf8')) as EditReview;
    assert.equal(savedReview.reviewComplete, false);
    assert.deepEqual(JSON.parse(await readFile(bundle.reviewCurrentPath, 'utf8')), { version: 1, path: saved.reviewPath });
    await assert.rejects(readFile(bundle.effectiveCurrentPlanPath, 'utf8'));
  });
});

test('saveReviewedEffectivePlan writes review and effective plan and recalculates reviewComplete', async () => {
  await withTempDir('combined', async (runDir) => {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.editDir, { recursive: true });
    await mkdir(bundle.captureDir, { recursive: true });
    const plan = agentPlan();
    await writeFile(bundle.versionedEditPath('edit-plan.agent', 1), JSON.stringify(plan, null, 2), 'utf8');
    await writeFile(bundle.agentCurrentPlanPath, JSON.stringify({ version: 1, path: bundle.versionedEditPath('edit-plan.agent', 1) }), 'utf8');
    await writeFile(bundle.sourceCatalogPath, JSON.stringify({
      version: 1,
      sources: [{ id: 'original', path: 'capture/original.mp4', durationMs: 3000, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false, kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-28T00:00:00.000Z' }],
    }, null, 2), 'utf8');
    const review = createEditReviewDraft({ agentPlan: plan, createdAt: '2026-07-28T00:00:00.000Z' });
    review.segments[1] = { ...review.segments[1]!, status: 'approved', reviewReasons: ['人工确认低置信度片段可用。'] };

    const saved = await saveReviewedEffectivePlan({ runDir, review });

    assert.equal(saved.reviewVersion, 1);
    assert.equal(saved.effectivePlanVersion, 1);
    const savedReview = JSON.parse(await readFile(saved.reviewPath, 'utf8')) as EditReview;
    assert.equal(savedReview.reviewComplete, true);
    assert.deepEqual(JSON.parse(await readFile(bundle.reviewCurrentPath, 'utf8')), { version: 1, path: saved.reviewPath });
    assert.deepEqual(JSON.parse(await readFile(bundle.effectiveCurrentPlanPath, 'utf8')), { version: 1, path: saved.effectivePlanPath });
  });
});
