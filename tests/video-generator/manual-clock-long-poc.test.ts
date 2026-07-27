import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const runDir = process.env.MANUAL_POC_RUN;

test('covers a 30 minute recording with bounded clock sample gaps and stable drift', async () => {
  assert.equal(process.platform, 'win32');
  assert.ok(runDir, 'MANUAL_POC_RUN must point to a completed long clock POC run');

  const manifest = JSON.parse(await readFile(path.join(runDir, 'capture', 'recording-manifest.json'), 'utf8'));
  assert.equal(manifest.video.status, 'available');
  assert.ok(manifest.video.durationMs >= 1_800_000);
  assert.equal(manifest.clockStatus, 'ok');
  assert.ok(manifest.maxResidualMs <= manifest.maxAllowedResidualMs);
  assert.ok(manifest.ffprobeDurationDeltaMs <= manifest.maxAllowedFfprobeDurationDeltaMs);

  const samples = (await readFile(path.join(runDir, 'capture', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === 'capture-clock-sample');
  assert.ok(samples.length >= 900, `expected at least 900 clock samples, received ${samples.length}`);
  assert.ok(samples[0].videoTimeMs <= 1_500, 'clock sampling should begin near video start');
  assert.ok(
    samples.at(-1).videoTimeMs >= manifest.video.durationMs - 2_000,
    'clock sampling should cover the video tail',
  );

  const maximumGapMs = samples.slice(1).reduce(
    (maximum, sample, index) => Math.max(maximum, sample.videoTimeMs - samples[index].videoTimeMs),
    0,
  );
  assert.ok(maximumGapMs <= 2_000, `maximum clock sample gap was ${maximumGapMs}ms`);
});
