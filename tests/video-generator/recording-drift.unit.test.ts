import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeClockDrift } from '../../src/lib/video-generator/recording/drift.js';

test('detects residual or duration drift above the duration-scaled threshold', () => {
  const ok = analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 900_000, videoTimeMs: 900_000, mediaTimeMs: 900_090 },
    { sessionTimeMs: 1_800_000, videoTimeMs: 1_800_000, mediaTimeMs: 1_800_180 },
  ], 1_800_180);
  assert.equal(ok.status, 'ok');
  assert.ok(ok.maxObservedDriftMs <= ok.maxAllowedDriftMs);

  const bad = analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 900_000, videoTimeMs: 900_000, mediaTimeMs: 900_100 },
    { sessionTimeMs: 1_800_000, videoTimeMs: 1_800_000, mediaTimeMs: 1_800_500 },
  ], 1_801_000);
  assert.equal(bad.status, 'drift-detected');
  assert.ok(bad.maxObservedDriftMs > bad.maxAllowedDriftMs);
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
