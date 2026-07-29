import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createManualBundle, writeVersionedJson } from './bundle.js';
import { writeAtomicJson } from './atomic-writer.js';
import { buildEffectivePlan, saveEffectivePlan } from './effective-plan.js';
import { validateManualSourceCatalog } from './schema.js';
import type { EditPlan } from '../editing/types.js';
import type { ManualSourceCatalog } from './types.js';
import { resolvePathInsideRun } from './run-path.js';

export type EditReviewStatus = 'approved' | 'pickup-required' | 'rejected';
export type ReviewWaitStrategy = 'keep' | 'compress';

export interface EditReviewSegment {
  segmentId: string;
  status: EditReviewStatus;
  selectedSourceId?: string;
  adjustedStartMs?: number;
  adjustedEndMs?: number;
  waitStrategy?: ReviewWaitStrategy;
  reviewReasons: string[];
}

export interface EditReview {
  version: 1;
  createdAt: string;
  reviewComplete: boolean;
  segments: EditReviewSegment[];
}

export function createEditReviewDraft(input: { agentPlan: EditPlan; createdAt?: string }): EditReview {
  return {
    version: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    reviewComplete: input.agentPlan.segments.every((segment) => segment.confidence !== 'low'),
    segments: input.agentPlan.segments.map((segment) => ({
      segmentId: segment.segmentId,
      status: segment.confidence === 'low' ? 'pickup-required' : 'approved',
      waitStrategy: 'keep',
      reviewReasons: segment.confidence === 'low' ? ['low confidence / 低置信度，需要人工处理。'] : [],
    })),
  };
}

export function recalculateReviewComplete(review: EditReview): EditReview {
  return {
    ...review,
    reviewComplete: review.segments.every((segment) => segment.status === 'approved'),
  };
}

export function validateEditReview(review: EditReview, agentPlan: EditPlan): void {
  if (review.version !== 1) throw new Error('review.version must equal 1');
  if (!Array.isArray(review.segments)) throw new Error('review.segments must be an array');
  const planById = new Map(agentPlan.segments.map((segment) => [segment.segmentId, segment]));
  const reviewById = new Map<string, EditReviewSegment>();
  for (const [index, segment] of review.segments.entries()) {
    const path = `review.segments[${index}]`;
    if (reviewById.has(segment.segmentId)) throw new Error(`${path}.segmentId is duplicate: ${segment.segmentId}`);
    reviewById.set(segment.segmentId, segment);
    const planSegment = planById.get(segment.segmentId);
    if (planSegment === undefined) throw new Error(`${path}.segmentId is missing from agent plan`);
    if (segment.status !== 'approved' && segment.status !== 'pickup-required' && segment.status !== 'rejected') {
      throw new Error(`${path}.status must be approved, pickup-required, or rejected`);
    }
    if (segment.adjustedStartMs !== undefined && (!Number.isFinite(segment.adjustedStartMs) || segment.adjustedStartMs < 0)) {
      throw new Error(`${path}.adjustedStartMs is invalid`);
    }
    if (segment.adjustedEndMs !== undefined && (!Number.isFinite(segment.adjustedEndMs) || segment.adjustedEndMs <= (segment.adjustedStartMs ?? 0))) {
      throw new Error(`${path}.adjustedEndMs must be greater than adjustedStartMs`);
    }
    if (segment.adjustedStartMs !== undefined && planSegment.clips.some((clip) => segment.adjustedStartMs! > clip.sourceEndMs)) {
      throw new Error(`${path}.adjustedStartMs is outside clip bounds`);
    }
    if (segment.adjustedEndMs !== undefined && planSegment.clips.some((clip) => segment.adjustedEndMs! > clip.sourceEndMs)) {
      throw new Error(`${path}.adjustedEndMs is outside clip bounds`);
    }
    if (segment.waitStrategy !== undefined && segment.waitStrategy !== 'keep' && segment.waitStrategy !== 'compress') {
      throw new Error(`${path}.waitStrategy is invalid`);
    }
    if (planSegment.confidence === 'low' && segment.status === 'approved' && segment.reviewReasons.length === 0) {
      throw new Error(`${path}.reviewReasons must handle low confidence / 低置信度`);
    }
  }
  if (reviewById.size !== agentPlan.segments.length) {
    throw new Error('review.segments is missing review entries from agent plan');
  }
}

function assertPathInsideRun(targetPath: string, rootDir: string): string {
  return resolvePathInsideRun(rootDir, targetPath, 'Review input');
}

async function readCurrentAgentPlan(runDir: string): Promise<EditPlan> {
  const bundle = createManualBundle(runDir);
  const pointer = JSON.parse(await readFile(bundle.agentCurrentPlanPath, 'utf8')) as { path: string };
  const planPath = assertPathInsideRun(pointer.path, runDir);
  return JSON.parse(await readFile(planPath, 'utf8')) as EditPlan;
}

export async function saveEditReview(input: { runDir: string; review: EditReview }): Promise<{ version: number; reviewPath: string }> {
  const bundle = createManualBundle(input.runDir);
  const agentPlan = await readCurrentAgentPlan(input.runDir);
  const review = recalculateReviewComplete(input.review);
  validateEditReview(review, agentPlan);
  const written = await writeVersionedJson(bundle.editDir, 'edit-review', review);
  await writeAtomicJson(bundle.reviewCurrentPath, { version: written.version, path: written.path });
  return { version: written.version, reviewPath: written.path };
}

export async function saveReviewedEffectivePlan(input: { runDir: string; review: EditReview }): Promise<{
  reviewVersion: number;
  reviewPath: string;
  effectivePlanVersion?: number;
  effectivePlanPath?: string;
}> {
  const bundle = createManualBundle(input.runDir);
  const agentPlan = await readCurrentAgentPlan(input.runDir);
  const review = recalculateReviewComplete(input.review);
  validateEditReview(review, agentPlan);
  const reviewWritten = await writeVersionedJson(bundle.editDir, 'edit-review', review);
  if (!review.reviewComplete) {
    await writeAtomicJson(bundle.reviewCurrentPath, { version: reviewWritten.version, path: reviewWritten.path });
    return {
      reviewVersion: reviewWritten.version,
      reviewPath: reviewWritten.path,
    };
  }

  const sourceCatalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
  validateManualSourceCatalog(sourceCatalog);
  const effectivePlan = buildEffectivePlan({ agentPlan, review, sourceCatalog });
  const effectiveWritten = await saveEffectivePlan({ runDir: input.runDir, effectivePlan });
  await writeAtomicJson(bundle.reviewCurrentPath, { version: reviewWritten.version, path: reviewWritten.path });
  return {
    reviewVersion: reviewWritten.version,
    reviewPath: reviewWritten.path,
    effectivePlanVersion: effectiveWritten.version,
    effectivePlanPath: effectiveWritten.planPath,
  };
}
