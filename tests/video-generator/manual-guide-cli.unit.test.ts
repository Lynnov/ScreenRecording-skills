import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runManualGuideCli } from '../../src/cli/manual-guide.js';

async function withTempDir(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `manual-guide-cli-${process.pid}-${Date.now()}-${name}`);
  await mkdir(dir, { recursive: true });
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

test('manual guide CLI prepares, applies, and approves guide versions', async () => {
  await withTempDir('guide-flow', async (dir) => {
    const sourcePath = path.join(dir, 'basic-form.md');
    const runDir = path.join(dir, 'run');
    await writeFile(sourcePath, '# 基础表单\n客户：Pacdora\n', 'utf8');

    const prepareIo = makeIo();
    const prepareExit = await runManualGuideCli([
      '--script',
      sourcePath,
      '--output',
      runDir,
      '--prepare-agent',
    ], prepareIo.io);

    assert.equal(prepareExit, 0);
    assert.match(prepareIo.stdout.join('\n'), /guide-request\.v01\.json/);
    assert.match(prepareIo.stdout.join('\n'), /business data/i);

    const responsePath = path.join(runDir, 'agent', 'guide-response.v01.json');
    const response = {
      version: 1,
      kind: 'manual-guide-response',
      requestVersion: 1,
      producer: { agentId: 'agent.fixture', generatedAt: '2026-07-28T00:00:00.000Z' },
      polishedMarkdown: '# 润色稿\n',
      executableMarkdown: '# 可执行稿\n',
      guide: {
        version: 1,
        startUrl: 'https://example.com/form',
        actions: [{
          id: 'action-001',
          segmentId: 'segment-001',
          title: '填写名称',
          instruction: '输入测试名称。',
          expectedEvents: [{ type: 'input', target: '名称' }],
          expectedResults: [{ type: 'text-visible', text: '保存成功' }],
        }],
      },
      warnings: [],
    };
    await writeFile(responsePath, `${JSON.stringify(response, null, 2)}\n`, 'utf8');

    const applyIo = makeIo();
    const applyExit = await runManualGuideCli([
      '--run',
      runDir,
      '--apply-agent-response',
      responsePath,
    ], applyIo.io);

    assert.equal(applyExit, 0);
    assert.match(applyIo.stdout.join('\n'), /recording-guide\.v01\.json/);
    assert.match(applyIo.stdout.join('\n'), /polished\.v01\.md/);

    const approveIo = makeIo();
    const approveExit = await runManualGuideCli([
      '--run',
      runDir,
      '--approve-version',
      '1',
    ], approveIo.io);

    assert.equal(approveExit, 0);
    assert.match(approveIo.stdout.join('\n'), /recording-guide\.approved\.json/);
    const approved = JSON.parse(await readFile(path.join(runDir, 'scripts', 'recording-guide.approved.json'), 'utf8')) as {
      version: number;
      guideVersion: number;
      guidePath: string;
      approvedAt: string;
    };
    assert.equal(approved.version, 1);
    assert.equal(approved.guideVersion, 1);
    assert.equal(approved.guidePath, path.join(runDir, 'scripts', 'recording-guide.v01.json'));
    assert.equal(Number.isFinite(Date.parse(approved.approvedAt)), true);
  });
});

test('manual guide CLI rejects missing mode and invalid flag combinations', async () => {
  const { stderr, io } = makeIo();

  const exitCode = await runManualGuideCli(['--script', 'demo.md'], io);

  assert.equal(exitCode, 1);
  assert.match(stderr.join('\n'), /Usage:/);
  assert.match(stderr.join('\n'), /--prepare-agent/);
  assert.match(stderr.join('\n'), /--apply-agent-response/);
  assert.match(stderr.join('\n'), /--approve-version/);
});
