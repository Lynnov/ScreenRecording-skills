import type { CaptureClockSample } from './types.js';

export interface DriftAnalysis {
  status: 'ok' | 'drift-detected';
  maxObservedDriftMs: number;
  maxAllowedDriftMs: number;
  slopePpm: number;
  ffprobeDurationDeltaMs: number;
}

export function analyzeClockDrift(
  samples: readonly CaptureClockSample[],
  ffprobeDurationMs: number,
): DriftAnalysis {
  const fail = (observed = Number.POSITIVE_INFINITY): DriftAnalysis => ({
    status: 'drift-detected',
    maxObservedDriftMs: observed,
    maxAllowedDriftMs: Number.isFinite(ffprobeDurationMs) ? Math.max(250, ffprobeDurationMs * 0.00015) : 250,
    slopePpm: Number.NaN,
    ffprobeDurationDeltaMs: Number.NaN,
  });

  if (samples.length < 3 || !Number.isFinite(ffprobeDurationMs)) {
    return fail();
  }
  if (samples.some((sample) => !isFiniteSample(sample))) {
    return fail();
  }

  const first = samples[0]!;
  const originVideoMs = first.videoTimeMs ?? 0;
  const originMediaMs = first.mediaTimeMs;
  const points = samples.map((sample) => ({
    x: (sample.videoTimeMs ?? 0) - originVideoMs,
    y: sample.mediaTimeMs - originMediaMs,
  }));
  const meanX = mean(points.map((point) => point.x));
  const meanY = mean(points.map((point) => point.y));
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  if (variance === 0) {
    return fail();
  }

  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  const residuals = points.map((point) => point.y - (intercept + slope * point.x));
  const maxResidualMs = Math.max(...residuals.map((residual) => Math.abs(residual)));
  const last = samples.at(-1)!;
  const mediaDurationMs = last.mediaTimeMs - originMediaMs;
  const ffprobeDurationDeltaMs = Math.abs(ffprobeDurationMs - mediaDurationMs);
  const maxObservedDriftMs = Math.max(maxResidualMs, ffprobeDurationDeltaMs);
  const maxAllowedDriftMs = Math.max(250, ffprobeDurationMs * 0.00015);

  return {
    status: maxObservedDriftMs <= maxAllowedDriftMs ? 'ok' : 'drift-detected',
    maxObservedDriftMs,
    maxAllowedDriftMs,
    slopePpm: (slope - 1) * 1_000_000,
    ffprobeDurationDeltaMs,
  };
}

function isFiniteSample(sample: CaptureClockSample): boolean {
  return Number.isFinite(sample.sessionTimeMs)
    && (sample.videoTimeMs === null || Number.isFinite(sample.videoTimeMs))
    && Number.isFinite(sample.mediaTimeMs);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
