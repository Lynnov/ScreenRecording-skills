import type { CaptureSourceDescriptor } from './types.js';

export function matchUniqueWindowSource(
  sources: readonly CaptureSourceDescriptor[],
  expectedTitle: string,
): CaptureSourceDescriptor {
  const exactMatches = sources.filter((source) => source.name === expectedTitle);
  const matches = exactMatches.length > 0
    ? exactMatches
    : sources.filter((source) => source.name.startsWith(`${expectedTitle} - `));
  if (matches.length === 0) {
    throw new Error(`Chromium capture source "${expectedTitle}" was not found.`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple Chromium capture sources matched "${expectedTitle}".`);
  }
  return matches[0]!;
}

export function parseWindowsHandle(sourceId: string): bigint {
  const match = /^window:(\d+):\d+$/.exec(sourceId);
  if (match === null) {
    throw new Error(`Unsupported Windows capture source id: ${sourceId}`);
  }
  return BigInt(match[1]!);
}
