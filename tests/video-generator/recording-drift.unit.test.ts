import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeClockDrift } from '../../src/lib/video-generator/recording/drift.js';

test('detects residual or duration drift above the duration-scaled threshold', () => {
  const ok = analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 250, videoTimeMs: 250, mediaTimeMs: 250.02 },
    { sessionTimeMs: 500, videoTimeMs: 500, mediaTimeMs: 500.04 },
    { sessionTimeMs: 750, videoTimeMs: 750, mediaTimeMs: 750.06 },
  ], 1000);
  assert.equal(ok.status, 'ok');
  assert.ok(ok.maxResidualMs <= ok.maxAllowedResidualMs);

  const bad = analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 250, videoTimeMs: 250, mediaTimeMs: 250 },
    { sessionTimeMs: 500, videoTimeMs: 500, mediaTimeMs: 500 },
    { sessionTimeMs: 750, videoTimeMs: 750, mediaTimeMs: 750 },
  ], 1400);
  assert.equal(bad.status, 'drift-detected');
  assert.ok(bad.ffprobeDurationDeltaMs > bad.maxAllowedFfprobeDurationDeltaMs);
});

test('fails closed when drift samples are insufficient or invalid', () => {
  assert.equal(analyzeClockDrift([], 1000).status, 'drift-detected');
  assert.equal(analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 1, videoTimeMs: 0, mediaTimeMs: 1 },
    { sessionTimeMs: 2, videoTimeMs: 0, mediaTimeMs: 2 },
  ], 2).status, 'drift-detected');
  assert.equal(analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 1, videoTimeMs: 1, mediaTimeMs: Number.NaN },
    { sessionTimeMs: 2, videoTimeMs: 2, mediaTimeMs: 2 },
  ], 2).status, 'drift-detected');
});

test('separates stable clock regression from normal final chunk muxing delta', () => {
  const sampleCount = 76;
  const mediaDurationMs = 20_226.436;
  const intervalMs = mediaDurationMs / (sampleCount - 1);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const videoTimeMs = intervalMs * index;
    return {
      sessionTimeMs: 23_514 + videoTimeMs,
      videoTimeMs,
      mediaTimeMs: videoTimeMs * 1.000001131,
    };
  });

  const result = analyzeClockDrift(samples, 20_500);

  assert.equal(result.status, 'ok');
  assert.ok(result.maxResidualMs < 2);
  assert.ok(Math.abs(result.slopePpm) < 5);
  assert.ok(Math.abs(result.ffprobeDurationDeltaMs - 273.541) < 0.01);
  assert.ok(result.ffprobeDurationDeltaMs <= result.maxAllowedFfprobeDurationDeltaMs);
});
