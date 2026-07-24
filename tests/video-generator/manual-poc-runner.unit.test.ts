import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error The manual POC runner is an executable .mjs wrapper tested through its real module exports.
import { buildManualCapturePocSpawn, formatManualCapturePocRunnerLogStep } from '../../scripts/run-manual-capture-poc.mjs';
import { formatManualPocLogStep } from '../../pocs/manual-recording/capture-main.js';

test('formats manual POC diagnostic steps with a stable prefix', () => {
  assert.equal(formatManualPocLogStep('launching Chromium'), '[manual-poc] launching Chromium');
  assert.equal(formatManualCapturePocRunnerLogStep('spawning Electron'), '[manual-poc-runner] spawning Electron');
});

test('builds an Electron exe spawn without relying on npm or cmd shims', () => {
  const spawn = buildManualCapturePocSpawn({
    electronPath: String.raw`E:\repo\node_modules\electron\dist\electron.exe`,
    entryPath: 'dist/manual-recording-poc/pocs/manual-recording/capture-main.js',
    argv: ['--output', 'video-runs/manual', '--display-mode', 'f11'],
  });

  assert.equal(spawn.command, String.raw`E:\repo\node_modules\electron\dist\electron.exe`);
  assert.deepEqual(spawn.args, [
    'dist/manual-recording-poc/pocs/manual-recording/capture-main.js',
    '--output',
    'video-runs/manual',
    '--display-mode',
    'f11',
  ]);
  assert.equal(spawn.options.stdio, 'inherit');
  assert.equal(spawn.options.windowsHide, false);
});
