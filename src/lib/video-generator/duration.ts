export interface SegmentDurationInput {
  estimatedMs: number;
  actualAudioMs?: number;
  bufferMs: number;
}

export function countChineseVisibleChars(text: string): number {
  return Array.from(text).filter((char) => /[\p{Script=Han}A-Za-z0-9]/u.test(char)).length;
}

export function estimateNarrationDurationMs(text: string, charsPerMinute: number): number {
  const chars = countChineseVisibleChars(text);
  return Math.ceil((chars / charsPerMinute) * 60000);
}

export function calculateSegmentDurationMs({
  estimatedMs,
  actualAudioMs,
  bufferMs,
}: SegmentDurationInput): number {
  return Math.ceil(Math.max(estimatedMs, actualAudioMs ?? 0) + bufferMs);
}
