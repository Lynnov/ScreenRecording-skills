import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const runDir = process.env.MANUAL_POC_RUN;

test('records manual marker events against the unified recording clock', async () => {
  assert.equal(process.platform, 'win32');
  assert.ok(runDir, 'MANUAL_POC_RUN must point to a completed clock POC run');

  const manifest = JSON.parse(await readFile(path.join(runDir, 'capture', 'recording-manifest.json'), 'utf8'));
  assert.equal(manifest.video.status, 'available');
  assert.equal(manifest.clockStatus, 'ok');
  assert.ok(manifest.maxResidualMs <= manifest.maxAllowedResidualMs);
  assert.ok(manifest.ffprobeDurationDeltaMs <= manifest.maxAllowedFfprobeDurationDeltaMs);
  assert.equal(typeof manifest.slopePpm, 'number');
  assert.deepEqual(
    manifest.markerEvidence.map((item: { type: string; passed: boolean }) => [item.type, item.passed]),
    [
      ['recording-start', true],
      ['retry-start', true],
      ['recording-stop', true],
    ],
  );

  const events = (await readFile(path.join(runDir, 'capture', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  for (const type of ['recording-start', 'retry-start', 'recording-stop']) {
    const event = events.find((item) => item.type === type);
    assert.equal(typeof event?.videoTimeMs, 'number', `${type} should have videoTimeMs`);
  }
  assert.ok(events.some((item) => item.type === 'capture-clock-sample'));
});
