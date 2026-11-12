import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runManualFinalizeCli } from '../../src/cli/manual-finalize.js';
import type { finalizeManualRecording } from '../../src/lib/video-generator/manual/final-report.js';

for (const override of [false, true]) {
  test(`manual finalize loads project .env${override ? ' with process environment taking precedence' : ''}`, async (t) => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'manual cli 环境 '));
    t.after(() => rm(projectDir, { recursive: true, force: true }));
    await writeFile(path.join(projectDir, '.env'), 'DASHSCOPE_API_KEY=file-placeholder\nALIYUN_TTS_VOICE=file-voice\nALIYUN_TTS_RATE=1.2\n');
    const env: NodeJS.ProcessEnv = override ? { DASHSCOPE_API_KEY: 'process-placeholder', ALIYUN_TTS_VOICE: 'process-voice' } : {};
    const before = { ...env };
    const processKey = process.env.DASHSCOPE_API_KEY;
    let captured: Parameters<typeof finalizeManualRecording>[0] | undefined;
    const output: string[] = [];
    const io = {
      cwd: projectDir, env,
      stdout: (message: string) => output.push(message),
      stderr: (message: string) => output.push(message),
      finalize: async (input: Parameters<typeof finalizeManualRecording>[0]) => {
        captured = input;
        return { version: 1 as const, ok: true, runDir: input.runDir, finalVideoPath: path.join(input.runDir, 'final.mp4'), cleanupErrors: [] };
      },
    };
    const exitCode = await runManualFinalizeCli(['--run', projectDir], io);
    assert.equal(exitCode, 0);
    assert.deepEqual(captured, { runDir: projectDir, env: {
      DASHSCOPE_API_KEY: override ? 'process-placeholder' : 'file-placeholder',
      ALIYUN_TTS_VOICE: override ? 'process-voice' : 'file-voice',
      ALIYUN_TTS_RATE: '1.2',
    } });
    assert.deepEqual(env, before);
    assert.equal(process.env.DASHSCOPE_API_KEY, processKey);
    assert.match(output.join('\n'), /Final video:/);
    assert.doesNotMatch(output.join('\n'), /file-placeholder|process-placeholder/);
  });
}

test('manual finalize without .env forwards process configuration and reports failures', async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'manual-cli-no-env-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const output: string[] = [];
  let captured: NodeJS.ProcessEnv | undefined;
  const io = {
    cwd, env: { ALIYUN_TTS_VOICE: 'process-voice' },
    stdout: (message: string) => output.push(message),
    stderr: (message: string) => output.push(message),
    finalize: async (input: Parameters<typeof finalizeManualRecording>[0]) => {
      captured = input.env;
      return { version: 1 as const, ok: false, runDir: input.runDir, errorMessage: 'Missing required DASHSCOPE_API_KEY', cleanupErrors: [] };
    },
  };
  assert.equal(await runManualFinalizeCli(['--run', cwd], io), 1);
  assert.deepEqual(captured, { ALIYUN_TTS_VOICE: 'process-voice' });
  assert.match(output.join('\n'), /Missing required DASHSCOPE_API_KEY/);
});

test('manual finalize rejects invalid arguments before invoking the finalizer', async () => {
  const output: string[] = [];
  const io = {
    stdout: (message: string) => output.push(message), stderr: (message: string) => output.push(message),
    finalize: async (): ReturnType<typeof finalizeManualRecording> => { throw new Error('should not finalize'); },
  };
  assert.equal(await runManualFinalizeCli([], io), 1);
  assert.match(output.join('\n'), /Usage:/);
});
