import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runVideoDoctorChecks, runVideoDoctorCli, type DoctorCheck } from '../../src/cli/video-doctor.js';

function makeIo(checks: DoctorCheck[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
      runChecks: async () => checks,
    },
  };
}

test('runVideoDoctorCli returns zero and prints OK checks when environment is ready', async () => {
  const { stdout, io } = makeIo([
    { name: 'Node.js', status: 'ok', detail: 'v22.0.0' },
    { name: 'npm dependencies', status: 'ok', detail: 'node_modules exists' },
    { name: 'DASHSCOPE_API_KEY', status: 'ok', detail: 'configured' },
  ]);

  const exitCode = await runVideoDoctorCli([], io);

  assert.equal(exitCode, 0);
  assert.match(stdout.join('\n'), /Node\.js: OK/);
  assert.match(stdout.join('\n'), /npm dependencies: OK/);
  assert.match(stdout.join('\n'), /DASHSCOPE_API_KEY: OK/);
  assert.match(stdout.join('\n'), /环境检查通过/);
});

test('runVideoDoctorChecks reads DASHSCOPE_API_KEY from project .env', async () => {
  const projectDir = path.join(tmpdir(), `video-doctor-env-${process.pid}-${Date.now()}`);
  await mkdir(path.join(projectDir, 'examples', 'video-generator'), { recursive: true });

  try {
    await writeFile(path.join(projectDir, '.env'), 'DASHSCOPE_API_KEY=file-key\n');
    await writeFile(path.join(projectDir, 'examples', 'video-generator', 'basic-demo.md'), '打开 demo:basic\n旁白：测试。\n');

    const checks = await runVideoDoctorChecks({
      cwd: projectDir,
      env: {},
    });

    assert.equal(checks.find((check) => check.name === 'DASHSCOPE_API_KEY')?.status, 'ok');
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('runVideoDoctorChecks checks npm through the command runner', async () => {
  const projectDir = path.join(tmpdir(), `video-doctor-npm-${process.pid}-${Date.now()}`);
  await mkdir(path.join(projectDir, 'node_modules'), { recursive: true });
  await mkdir(path.join(projectDir, 'examples', 'video-generator'), { recursive: true });

  try {
    await writeFile(path.join(projectDir, 'examples', 'video-generator', 'basic-demo.md'), '打开 demo:basic\n旁白：测试。\n');
    const commands: string[] = [];

    const checks = await runVideoDoctorChecks({
      cwd: projectDir,
      env: { DASHSCOPE_API_KEY: 'test-key' },
      getPlaywrightExecutablePath: () => 'chromium.exe',
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(' '));
        return { stdout: `${command} ok` };
      },
    });

    assert.equal(checks.find((check) => check.name === 'npm')?.status, 'ok');
    assert.ok(commands.includes('npm --version'));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('runVideoDoctorCli returns non-zero and prints agent guidance for missing checks', async () => {
  const { stdout, io } = makeIo([
    { name: 'Node.js', status: 'ok', detail: 'v22.0.0' },
    {
      name: 'Playwright Chromium',
      status: 'missing',
      detail: 'browser executable not found',
      agentAdvice: '请向用户说明需要下载 Chromium，获得授权后运行：npx playwright install chromium',
    },
    {
      name: 'DASHSCOPE_API_KEY',
      status: 'missing',
      detail: 'environment variable is empty',
      agentAdvice: '请向用户索取 DashScope API Key，获得授权后写入本机 .env 或当前终端环境。',
    },
  ]);

  const exitCode = await runVideoDoctorCli([], io);

  assert.equal(exitCode, 1);
  assert.match(stdout.join('\n'), /Playwright Chromium: missing/);
  assert.match(stdout.join('\n'), /建议给 agent：请向用户说明需要下载 Chromium/);
  assert.match(stdout.join('\n'), /DASHSCOPE_API_KEY: missing/);
  assert.match(stdout.join('\n'), /发现 2 项需要处理/);
});
