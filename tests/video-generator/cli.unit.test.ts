import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runVideoGeneratorCli } from '../../src/cli/video-generator.js';
import type { RunReport } from '../../src/lib/video-generator/types.js';

function makeIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
      env: {},
    },
  };
}

test('runVideoGeneratorCli requires --script for normal generation', async () => {
  const { stderr, io } = makeIo();

  const exitCode = await runVideoGeneratorCli([], io);

  assert.equal(exitCode, 1);
  assert.match(stderr.join('\n'), /Usage:/);
  assert.match(stderr.join('\n'), /--script/);
});

test('runVideoGeneratorCli passes script and output args to pipeline', async () => {
  const { stdout, io } = makeIo();
  const calls: Array<{ scriptPath: string; outputDir?: string }> = [];

  const exitCode = await runVideoGeneratorCli([
    '--script',
    './demo-script.md',
    '--output',
    './video-runs/demo',
  ], {
    ...io,
    runVideoGenerator: async (input) => {
      calls.push({ scriptPath: input.scriptPath, outputDir: input.configOverrides?.outputDir });
      return { ok: true, outputDir: './video-runs/demo', finalVideoPath: './video-runs/demo/final.mp4' } satisfies RunReport;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ scriptPath: './demo-script.md', outputDir: './video-runs/demo' }]);
  assert.match(stdout.join('\n'), /final\.mp4/);
});

test('runVideoGeneratorCli rejects missing flag values without treating flags as values', async () => {
  const missingScript = makeIo();

  const missingScriptExit = await runVideoGeneratorCli(['--script', '--output', './out'], missingScript.io);

  assert.equal(missingScriptExit, 1);
  assert.match(missingScript.stderr.join('\n'), /--script requires a value/);

  const missingOutput = makeIo();

  const missingOutputExit = await runVideoGeneratorCli(['--output', '--tts-smoke'], missingOutput.io);

  assert.equal(missingOutputExit, 1);
  assert.match(missingOutput.stderr.join('\n'), /--output requires a value/);
});

test('runVideoGeneratorCli rejects unknown arguments', async () => {
  const { stderr, io } = makeIo();

  const exitCode = await runVideoGeneratorCli(['--script', './demo-script.md', '--bogus'], io);

  assert.equal(exitCode, 1);
  assert.match(stderr.join('\n'), /Unknown argument: --bogus/);
});

test('runVideoGeneratorCli reports thrown generation errors clearly', async () => {
  const { stderr, io } = makeIo();

  const exitCode = await runVideoGeneratorCli(['--script', './demo-script.md'], {
    ...io,
    runVideoGenerator: async () => {
      throw new Error('pipeline exploded');
    },
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join('\n'), /Video generation failed/);
  assert.match(stderr.join('\n'), /pipeline exploded/);
});

test('runVideoGeneratorCli returns non-zero when pipeline reports failure', async () => {
  const { stderr, io } = makeIo();

  const exitCode = await runVideoGeneratorCli(['--script', './demo-script.md'], {
    ...io,
    runVideoGenerator: async () => ({ ok: false, outputDir: './video-runs', failedSegmentId: 'seg-001', errorMessage: 'Missing TTS credentials' }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join('\n'), /seg-001/);
  assert.match(stderr.join('\n'), /Missing TTS credentials/);
});

test('runVideoGeneratorCli tts smoke synthesizes text to output directory', async () => {
  const outputDir = path.join(tmpdir(), `cli-tts-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const { stdout, io } = makeIo();
  const synthesized: Array<{ text: string; outputPath: string }> = [];

  try {
    const exitCode = await runVideoGeneratorCli(['--tts-smoke', '你好', '--output', outputDir], {
      ...io,
      createTtsProvider: () => ({
        async synthesize(request) {
          synthesized.push({ text: request.text, outputPath: request.outputPath });
          return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 500 };
        },
      }),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(synthesized, [{ text: '你好', outputPath: path.join(outputDir, 'tts-smoke.wav') }]);
    assert.match(stdout.join('\n'), /tts-smoke\.wav/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGeneratorCli tts smoke reports provider stub errors clearly', async () => {
  const { stderr, io } = makeIo();

  const exitCode = await runVideoGeneratorCli(['--tts-smoke', '你好'], {
    ...io,
    createTtsProvider: () => ({
      async synthesize() {
        throw new Error('TTS_PROVIDER_NOT_IMPLEMENTED: provider stub');
      },
    }),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join('\n'), /TTS smoke failed/);
  assert.match(stderr.join('\n'), /provider stub/);
});
