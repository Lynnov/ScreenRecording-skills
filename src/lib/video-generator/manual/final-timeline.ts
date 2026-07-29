import { calculateEditClipDurationMs } from '../editing/duration.js';
import type { EditPlan } from '../editing/types.js';

export interface FinalTimelineSegment {
  segmentId: string;
  videoStartMs: number;
  contentEndMs: number;
  videoEndMs: number;
  holdLastFrameMs: number;
  transition: 'cut' | 'short-fade';
  narrationText: string;
  audioDurationMs: number;
  subtitleStartMs: number;
  subtitleEndMs: number;
}

export interface FinalTimeline {
  version: 1;
  durationMs: number;
  segments: FinalTimelineSegment[];
}

export function buildFinalTimeline(input: {
  effectivePlan: EditPlan;
  narration: Array<{ segmentId: string; text: string; estimatedDurationMs: number; audioDurationMs: number }>;
}): FinalTimeline {
  if (input.narration.length !== input.effectivePlan.segments.length) throw new Error('Narration must contain exactly every effective plan Segment.');
  let cursorMs = 0;
  const segments = input.effectivePlan.segments.map((planSegment, index) => {
    const narration = input.narration[index]!;
    if (narration.segmentId !== planSegment.segmentId) throw new Error(`Narration Segment order mismatch at ${planSegment.segmentId}.`);
    const contentDurationMs = planSegment.clips.reduce((sum, clip) => sum + calculateEditClipDurationMs(clip), 0);
    const holdLastFrameMs = Math.max(planSegment.holdLastFrameMs ?? 0, narration.audioDurationMs - contentDurationMs, 0);
    if (holdLastFrameMs > 5000) {
      throw new Error(`Narration for ${planSegment.segmentId} requires more than 5 seconds hold; 精简旁白 or pickup is required.`);
    }
    const videoStartMs = cursorMs;
    const contentEndMs = videoStartMs + contentDurationMs;
    const videoEndMs = contentEndMs + holdLastFrameMs;
    cursorMs = videoEndMs;
    return {
      segmentId: planSegment.segmentId,
      videoStartMs,
      contentEndMs,
      videoEndMs,
      holdLastFrameMs,
      transition: planSegment.transition ?? 'cut',
      narrationText: narration.text,
      audioDurationMs: narration.audioDurationMs,
      subtitleStartMs: videoStartMs,
      subtitleEndMs: Math.min(videoEndMs, videoStartMs + narration.audioDurationMs),
    };
  });
  return { version: 1, durationMs: cursorMs, segments };
}
