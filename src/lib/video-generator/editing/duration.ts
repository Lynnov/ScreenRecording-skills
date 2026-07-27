import type { EditClip, EditPlanSegment } from './types.js';

export function calculateEditClipDurationMs(clip: EditClip): number {
  return Math.round((clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate);
}

export function calculateEditSegmentDurationMs(segment: EditPlanSegment): number {
  return segment.clips.reduce(
    (sum, clip) => sum + calculateEditClipDurationMs(clip),
    0,
  ) + (segment.holdLastFrameMs ?? 0);
}
