import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseManualPocArgs, runManualCapturePoc, shouldRunManualCaptureEntrypoint } from '../../pocs/manual-recording/capture-main.js';

test('parses manual capture POC arguments', () => {
  assert.deepEqual(parseManualPocArgs(['--help']), { help: true });
  assert.deepEqual(parseManualPocArgs([
    '--output', 'video-runs/manual',
    '--display-mode', 'f11',
    '--fixture', 'capture',
    '--duration-seconds', '60',
  ]), {
    help: false,
    output: 'video-runs/manual',
    displayMode: 'f11',
    fixture: 'capture',
    durationSeconds: 60,
  });
  assert.throws(() => parseManualPocArgs(['--unknown']), /unknown option/i);
  assert.throws(() => parseManualPocArgs(['--output']), /missing value/i);
  assert.throws(() => parseManualPocArgs(['--duration-seconds', '0']), /positive integer/i);
  assert.throws(() => parseManualPocArgs(['--display-mode', 'screen']), /display-mode/i);
  assert.throws(() => parseManualPocArgs(['--fixture', 'popup']), /fixture/i);
});

test('detects Electron main execution even when argv[1] is not the module path', () => {
  assert.equal(shouldRunManualCaptureEntrypoint({
    argv1: 'E:/Code/ScreenRecording/node_modules/electron/dist/electron.exe',
    modulePath: 'E:/Code/ScreenRecording/dist/manual-recording-poc/pocs/manual-recording/capture-main.js',
    isElectronMain: true,
  }), true);
  assert.equal(shouldRunManualCaptureEntrypoint({
    argv1: 'E:/Code/ScreenRecording/dist/manual-recording-poc/pocs/manual-recording/capture-main.js',
    modulePath: 'E:/Code/ScreenRecording/dist/manual-recording-poc/pocs/manual-recording/capture-main.js',
    isElectronMain: false,
  }), true);
  assert.equal(shouldRunManualCaptureEntrypoint({
    argv1: 'E:/Code/ScreenRecording/tests/video-generator/manual-capture-cli.unit.test.ts',
    modulePath: 'E:/Code/ScreenRecording/dist/manual-recording-poc/pocs/manual-recording/capture-main.js',
    isElectronMain: false,
  }), false);
});

test('runs cleanup hooks for help, platform failure, source failure, and capture failure', async () => {
  const scenarios = [
    {
      args: ['--help'],
      platform: 'win32' as const,
      expectedExitCode: 0,
    },
    {
      args: ['--output', 'out', '--display-mode', 'f11', '--fixture', 'capture', '--duration-seconds', '1'],
      platform: 'linux' as NodeJS.Platform,
      expectedExitCode: 3,
    },
    {
      args: ['--output', 'out', '--display-mode', 'f11', '--fixture', 'capture', '--duration-seconds', '1'],
      platform: 'win32' as const,
      sourceError: new Error('source missing'),
      expectedExitCode: 4,
    },
    {
      args: ['--output', 'out', '--display-mode', 'f11', '--fixture', 'capture', '--duration-seconds', '1'],
      platform: 'win32' as const,
      captureError: new Error('capture failed'),
      expectedExitCode: 5,
    },
  ];

  for (const scenario of scenarios) {
    const calls: string[] = [];
    const result = await runManualCapturePoc(scenario.args, {
      platform: scenario.platform,
      prepareOutput: async () => {
        calls.push('prepare-output');
      },
      bindSource: async () => {
        calls.push('bind-source');
        if (scenario.sourceError !== undefined) throw scenario.sourceError;
      },
      startCapture: async () => {
        calls.push('start-capture');
        if (scenario.captureError !== undefined) throw scenario.captureError;
      },
      cleanup: async () => {
        calls.push('cleanup');
      },
    });
    assert.equal(result.exitCode, scenario.expectedExitCode);
    assert.equal(calls.at(-1), 'cleanup');
  }
});
