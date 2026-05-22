import type { Timeline, TimelineSegment } from './types.js';

export function renderSrt(timeline: Timeline): string {
  let cursorMs = 0;

  return timeline.segments
    .map((segment, index) => {
      const startMs = segment.startsAtMs ?? cursorMs;
      const endMs = segment.endsAtMs ?? startMs + segmentDurationMs(segment);
      cursorMs = endMs;

      return [
        String(index + 1),
        `${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}`,
        segment.subtitle,
        '',
      ].join('\n');
    })
    .join('\n');
}

function segmentDurationMs(segment: TimelineSegment): number {
  return (segment.actualAudioDurationMs ?? segment.estimatedDurationMs) + segment.bufferMs;
}

function formatSrtTimestamp(totalMs: number): string {
  const safeMs = Math.max(0, Math.floor(totalMs));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const milliseconds = safeMs % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(milliseconds).padStart(3, '0')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
