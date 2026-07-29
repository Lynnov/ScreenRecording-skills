import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import {
  applyGuideAgentResponse,
  approveRecordingGuideVersion,
  prepareGuideAgentRequest,
} from '../../src/lib/video-generator/manual/guide-writer.js';
import type { GuideAgentResponse } from '../../src/lib/video-generator/manual/types.js';

async function withTempDir(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `manual-guide-${process.pid}-${Date.now()}-${name}`);
  await mkdir(dir, { recursive: true });
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function response(version = 1): GuideAgentResponse {
  return {
    version: 1,
    kind: 'manual-guide-response',
    requestVersion: version,
    producer: { agentId: 'agent.fixture', generatedAt: '2026-07-28T00:00:00.000Z' },
    polishedMarkdown: '# 润色稿\n',
    executableMarkdown: '# 可执行稿\n',
    guide: {
      version: 1,
      startUrl: 'https://example.com/form',
      actions: [
        {
          id: 'action-001',
          segmentId: 'segment-001',
          title: '填写名称',
          instruction: '输入测试名称。',
          expectedEvents: [{ type: 'input', target: '名称' }],
          expectedResults: [{ type: 'text-visible', text: '保存成功' }],
        },
      ],
    },
    warnings: ['请用户确认登录状态。'],
  };
}

test('prepareGuideAgentRequest writes original script and immutable guide request version', async () => {
  await withTempDir('prepare', async (dir) => {
    const scriptPath = path.join(dir, 'source.md');
    const runDir = path.join(dir, 'run');
    const sourceText = '# 原始业务脚本\n客户：Pacdora\n';
    await writeFile(scriptPath, sourceText, 'utf8');

    const result = await prepareGuideAgentRequest({
      sourceScriptPath: scriptPath,
      outputDir: runDir,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    const bundle = createManualBundle(runDir);
    assert.equal(await readFile(bundle.originalScriptPath, 'utf8'), sourceText);
    assert.equal(result.requestVersion, 1);
    assert.equal(result.requestPath, path.join(bundle.agentDir, 'guide-request.v01.json'));
    assert.equal(result.businessDataNotice.includes('第一版不做脱敏'), true);
    const request = JSON.parse(await readFile(result.requestPath, 'utf8')) as { sourceText: string; kind: string };
    assert.equal(request.kind, 'manual-guide-request');
    assert.equal(request.sourceText, sourceText);
  });
});

test('prepareGuideAgentRequest refuses to overwrite a different original script', async () => {
  await withTempDir('original-conflict', async (dir) => {
    const scriptPath = path.join(dir, 'source.md');
    const runDir = path.join(dir, 'run');
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.scriptsDir, { recursive: true });
    await writeFile(scriptPath, '新的原始脚本\n', 'utf8');
    await writeFile(bundle.originalScriptPath, '已有不同原始脚本\n', 'utf8');

    await assert.rejects(() => prepareGuideAgentRequest({ sourceScriptPath: scriptPath, outputDir: runDir }), /original\.md/);
    assert.equal(await readFile(bundle.originalScriptPath, 'utf8'), '已有不同原始脚本\n');
  });
});

test('applyGuideAgentResponse validates response and writes immutable polished executable and guide files', async () => {
  await withTempDir('apply', async (dir) => {
    const scriptPath = path.join(dir, 'source.md');
    const runDir = path.join(dir, 'run');
    await writeFile(scriptPath, '# 原始脚本\n', 'utf8');
    const prepared = await prepareGuideAgentRequest({ sourceScriptPath: scriptPath, outputDir: runDir });
    const bundle = createManualBundle(runDir);
    const responsePath = bundle.versionedAgentPath('guide-response', prepared.requestVersion);
    await writeFile(responsePath, `${JSON.stringify(response(prepared.requestVersion), null, 2)}\n`, 'utf8');

    const applied = await applyGuideAgentResponse({ runDir, responsePath });

    assert.equal(applied.version, 1);
    assert.equal(await readFile(bundle.versionedScriptPath('polished', 1), 'utf8'), '# 润色稿\n');
    assert.equal(await readFile(bundle.versionedScriptPath('executable', 1), 'utf8'), '# 可执行稿\n');
    assert.deepEqual(JSON.parse(await readFile(bundle.versionedScriptPath('recording-guide', 1), 'utf8')), response().guide);
  });
});

test('applyGuideAgentResponse rejects invalid response without writing derived files', async () => {
  await withTempDir('apply-invalid', async (dir) => {
    const scriptPath = path.join(dir, 'source.md');
    const runDir = path.join(dir, 'run');
    await writeFile(scriptPath, '# 原始脚本\n', 'utf8');
    await prepareGuideAgentRequest({ sourceScriptPath: scriptPath, outputDir: runDir });
    const bundle = createManualBundle(runDir);
    const responsePath = bundle.versionedAgentPath('guide-response', 1);
    await writeFile(responsePath, JSON.stringify({ ...response(), kind: 'wrong' }), 'utf8');

    await assert.rejects(() => applyGuideAgentResponse({ runDir, responsePath }), /kind/);
    await assert.rejects(() => readFile(bundle.versionedScriptPath('recording-guide', 1), 'utf8'));
  });
});

test('approveRecordingGuideVersion writes a current pointer without modifying immutable guide version', async () => {
  await withTempDir('approve', async (dir) => {
    const scriptPath = path.join(dir, 'source.md');
    const runDir = path.join(dir, 'run');
    await writeFile(scriptPath, '# 原始脚本\n', 'utf8');
    await prepareGuideAgentRequest({ sourceScriptPath: scriptPath, outputDir: runDir });
    const bundle = createManualBundle(runDir);
    const responsePath = bundle.versionedAgentPath('guide-response', 1);
    await writeFile(responsePath, `${JSON.stringify(response(), null, 2)}\n`, 'utf8');
    await applyGuideAgentResponse({ runDir, responsePath });

    const approved = await approveRecordingGuideVersion({
      runDir,
      version: 1,
      approvedAt: '2026-07-28T01:00:00.000Z',
    });

    assert.deepEqual(approved, {
      version: 1,
      guideVersion: 1,
      guidePath: bundle.versionedScriptPath('recording-guide', 1),
      approvedAt: '2026-07-28T01:00:00.000Z',
    });
    assert.deepEqual(JSON.parse(await readFile(bundle.approvedGuidePath, 'utf8')), approved);
  });
});
