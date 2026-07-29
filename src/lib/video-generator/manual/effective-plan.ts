import { createManualBundle, writeVersionedJson } from './bundle.js';
import { writeAtomicJson } from './atomic-writer.js';
import type { EditPlan, EditPlanSegment } from '../editing/types.js';
import type { ManualSourceCatalog } from './types.js';
import type { EditReview } from './review.js';

export function buildEffectivePlan(input: {
  agentPlan: EditPlan;
  review: EditReview;
  sourceCatalog: ManualSourceCatalog;
}): EditPlan {
  const sourceById = new Map(input.sourceCatalog.sources.map((source) => [source.id, source]));
  const reviewBySegment = new Map(input.review.segments.map((segment) => [segment.segmentId, segment]));
  const segments: EditPlanSegment[] = input.agentPlan.segments.map((segment) => {
    const review = reviewBySegment.get(segment.segmentId);
    if (review === undefined) throw new Error(`Segment ${segment.segmentId} is missing review.`);
    if (review.status !== 'approved') throw new Error(`Segment ${segment.segmentId} is not approved.`);
    const clips = segment.clips.map((clip) => {
      const sourceId = review.selectedSourceId ?? clip.sourceId;
      const source = sourceById.get(sourceId);
      if (source === undefined || source.status !== 'available') throw new Error(`Selected source is unavailable: ${sourceId}`);
      const usesDifferentSource = sourceId !== clip.sourceId;
      const sourceStartMs = review.adjustedStartMs ?? (usesDifferentSource ? 0 : clip.sourceStartMs);
      const sourceEndMs = review.adjustedEndMs ?? (usesDifferentSource ? source.durationMs : Math.min(clip.sourceEndMs, source.durationMs));
      if (sourceStartMs < 0 || sourceEndMs <= sourceStartMs || sourceEndMs > source.durationMs) {
        throw new Error(`Selected source bounds are outside duration for ${sourceId}`);
      }
      return {
        ...clip,
        sourceId,
        sourceStartMs,
        sourceEndMs,
      };
    });
    const effectiveSegment: EditPlanSegment = {
      ...segment,
      clips,
      reason: `${segment.reason}${review.reviewReasons.length === 0 ? '' : ` Review: ${review.reviewReasons.join('; ')}`}`,
    };
    if (review.waitStrategy === 'compress') {
      delete effectiveSegment.holdLastFrameMs;
    }
    return effectiveSegment;
  });
  return { ...input.agentPlan, segments };
}

export async function saveEffectivePlan(input: { runDir: string; effectivePlan: EditPlan }): Promise<{ version: number; planPath: string }> {
  const bundle = createManualBundle(input.runDir);
  const written = await writeVersionedJson(bundle.editDir, 'edit-plan.effective', input.effectivePlan);
  await writeAtomicJson(bundle.effectiveCurrentPlanPath, { version: written.version, path: written.path });
  return { version: written.version, planPath: written.path };
}
