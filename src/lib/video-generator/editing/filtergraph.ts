import {
  calculateEditClipDurationMs,
  calculateEditSegmentDurationMs,
} from './duration.js';
import type {
  EditPlan,
  EditSource,
  PreviewTimeline,
  PreviewTimelineSegment,
} from './types.js';
import { validateEditPlan } from './validator.js';

export interface BuiltEditFiltergraph {
  filterComplex: string;
  inputSourceIds: string[];
  outputLabel: '[v]';
  timeline: PreviewTimeline;
}

function formatSeconds(milliseconds: number): string {
  return Number((milliseconds / 1000).toFixed(3)).toString();
}

function buildTimeline(plan: EditPlan): PreviewTimeline {
  let cursorMs = 0;
  const segments: PreviewTimelineSegment[] = plan.segments.map((segment) => {
    const startsAtMs = cursorMs;
    let clipCursorMs = startsAtMs;
    const clips = segment.clips.map((clip) => {
      const outputStartMs = clipCursorMs;
      clipCursorMs += calculateEditClipDurationMs(clip);
      return { ...clip, outputStartMs, outputEndMs: clipCursorMs };
    });
    const contentEndsAtMs = clipCursorMs;
    cursorMs = startsAtMs + calculateEditSegmentDurationMs(segment);
    return {
      segmentId: segment.segmentId,
      startsAtMs,
      contentEndsAtMs,
      endsAtMs: cursorMs,
      clips,
    };
  });
  return { version: 1, durationMs: cursorMs, segments };
}

export function buildEditFiltergraph(
  plan: EditPlan,
  sources: readonly EditSource[],
): BuiltEditFiltergraph {
  validateEditPlan(plan, sources);

  const inputIndexBySourceId = new Map<string, number>();
  const inputSourceIds: string[] = [];
  for (const segment of plan.segments) {
    for (const clip of segment.clips) {
      if (inputIndexBySourceId.has(clip.sourceId)) continue;
      inputIndexBySourceId.set(clip.sourceId, inputSourceIds.length);
      inputSourceIds.push(clip.sourceId);
    }
  }

  const filters: string[] = [];
  const segmentLabels: string[] = [];
  let clipIndex = 0;
  plan.segments.forEach((segment, segmentIndex) => {
    const clipLabels = segment.clips.map((clip) => {
      const label = `clip${clipIndex++}`;
      filters.push(
        `[${inputIndexBySourceId.get(clip.sourceId)}:v]`
        + `trim=start=${formatSeconds(clip.sourceStartMs)}:end=${formatSeconds(clip.sourceEndMs)},`
        + `setpts=(PTS-STARTPTS)/${clip.playbackRate},`
        + 'settb=AVTB,fps=30,'
        + 'scale=1920:1080:force_original_aspect_ratio=decrease,'
        + 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p'
        + `[${label}]`,
      );
      return label;
    });

    let currentLabel: string;
    if (clipLabels.length === 1) {
      currentLabel = clipLabels[0]!;
    } else {
      currentLabel = `segment${segmentIndex}content`;
      filters.push(
        `${clipLabels.map((label) => `[${label}]`).join('')}concat=n=${clipLabels.length}:v=1:a=0[${currentLabel}]`,
      );
    }

    if ((segment.holdLastFrameMs ?? 0) > 0) {
      const heldLabel = `segment${segmentIndex}held`;
      filters.push(
        `[${currentLabel}]tpad=stop_mode=clone:stop_duration=${formatSeconds(segment.holdLastFrameMs!)}[${heldLabel}]`,
      );
      currentLabel = heldLabel;
    }

    const fadesIn = segmentIndex > 0 && plan.segments[segmentIndex - 1]!.transition === 'short-fade';
    const fadesOut = segment.transition === 'short-fade';
    if (fadesIn) {
      const fadeInLabel = fadesOut ? `segment${segmentIndex}fadein` : `segment${segmentIndex}`;
      filters.push(`[${currentLabel}]fade=t=in:st=0:d=0.12[${fadeInLabel}]`);
      currentLabel = fadeInLabel;
    }
    if (fadesOut) {
      const fadeStartMs = calculateEditSegmentDurationMs(segment) - 120;
      filters.push(
        `[${currentLabel}]fade=t=out:st=${formatSeconds(fadeStartMs)}:d=0.12[segment${segmentIndex}]`,
      );
      currentLabel = `segment${segmentIndex}`;
    }
    if (!fadesIn && !fadesOut && currentLabel !== `segment${segmentIndex}`) {
      filters.push(`[${currentLabel}]null[segment${segmentIndex}]`);
      currentLabel = `segment${segmentIndex}`;
    }
    segmentLabels.push(currentLabel);
  });

  filters.push(
    `${segmentLabels.map((label) => `[${label}]`).join('')}concat=n=${segmentLabels.length}:v=1:a=0[v]`,
  );

  return {
    filterComplex: filters.join(';'),
    inputSourceIds,
    outputLabel: '[v]',
    timeline: buildTimeline(plan),
  };
}
