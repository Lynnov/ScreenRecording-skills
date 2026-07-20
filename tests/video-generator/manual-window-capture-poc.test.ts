import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const runDir = process.env.MANUAL_POC_RUN;

test('captures the selected Chromium window on Windows', async () => {
  assert.equal(process.platform, 'win32');
  assert.ok(runDir, 'MANUAL_POC_RUN must point to a completed capture POC run');
  const report = JSON.parse(await readFile(path.join(runDir, 'reports', 'capture-poc-report.json'), 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.video.status, 'available');
  if (report.video.status !== 'available') assert.fail(report.video.reason);
  assert.equal(report.video.width, 1920);
  assert.equal(report.video.height, 1080);
  assert.equal(report.video.fps, 30);
  assert.equal(report.video.hasAudio, false);
  assert.equal(report.overlayEnteredCapture, false);
  assert.equal(report.multiTabContinuous, true);
});
