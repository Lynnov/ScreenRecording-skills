import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { prepareScriptDrafts } from '../../src/lib/video-generator/script-drafts.js';

async function withTempDir(testName: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `script-drafts-${process.pid}-${Date.now()}-${testName}`);
  await mkdir(dir, { recursive: true });
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('prepareScriptDrafts creates original, polished, executable drafts from source', async () => {
  await withTempDir('copies', async (dir) => {
    const sourcePath = path.join(dir, 'source.md');
    const outputDir = path.join(dir, 'run');
    const sourceContent = '# 原纸贸易订单录入\n\n填写客户：测试客户\n';
    await writeFile(sourcePath, sourceContent, 'utf8');

    const manifest = await prepareScriptDrafts({ sourceScriptPath: sourcePath, outputDir, createdAt: '2026-05-28T00:00:00.000Z' });

    assert.equal(await readFile(path.join(outputDir, 'scripts', 'original.md'), 'utf8'), sourceContent);
    assert.equal(await readFile(path.join(outputDir, 'scripts', 'polished.md'), 'utf8'), sourceContent);
    assert.equal(await readFile(path.join(outputDir, 'scripts', 'executable.md'), 'utf8'), sourceContent);
    assert.equal(manifest.drafts.original.path, path.join(outputDir, 'scripts', 'original.md'));
    assert.equal(manifest.drafts.polished.sourcePath, manifest.drafts.original.path);
    assert.equal(manifest.drafts.executable.sourcePath, manifest.drafts.polished.path);
  });
});

test('prepareScriptDrafts writes manifest with paths and business data protection notice', async () => {
  await withTempDir('manifest', async (dir) => {
    const sourcePath = path.join(dir, 'source.md');
    const outputDir = path.join(dir, 'run');
    await writeFile(sourcePath, '客户名称：测试\n上传文件：合同.pdf\n', 'utf8');

    const manifest = await prepareScriptDrafts({ sourceScriptPath: sourcePath, outputDir, createdAt: '2026-05-28T00:00:00.000Z' });
    const manifestContent = JSON.parse(await readFile(path.join(outputDir, 'scripts', 'script-manifest.json'), 'utf8')) as typeof manifest;

    assert.equal(manifestContent.version, 1);
    assert.equal(manifestContent.sourceScriptPath, sourcePath);
    assert.equal(manifestContent.manifestPath, path.join(outputDir, 'scripts', 'script-manifest.json'));
    assert.equal(manifestContent.overwriteAllowed, false);
    assert.equal(manifestContent.drafts.polished.overwriteAllowed, true);
    assert.equal(manifestContent.drafts.executable.overwriteAllowed, true);
    assert.match(manifestContent.businessDataProtectionNotice, /不要覆盖原始脚本/);
    assert.ok(manifestContent.protectedBusinessTerms.includes('客户名'));
    assert.ok(manifestContent.protectedBusinessTerms.includes('上传文件路径'));
    assert.doesNotMatch(JSON.stringify(manifestContent), /客户名称：测试/);
  });
});

test('prepareScriptDrafts continues when original draft already exists with same content', async () => {
  await withTempDir('same-existing', async (dir) => {
    const sourcePath = path.join(dir, 'source.md');
    const outputDir = path.join(dir, 'run');
    const scriptsDir = path.join(outputDir, 'scripts');
    const sourceContent = '源脚本内容\n';
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(sourcePath, sourceContent, 'utf8');
    await writeFile(path.join(scriptsDir, 'original.md'), sourceContent, 'utf8');

    const manifest = await prepareScriptDrafts({ sourceScriptPath: sourcePath, outputDir });

    assert.equal(manifest.drafts.original.path, path.join(scriptsDir, 'original.md'));
    assert.equal(await readFile(path.join(scriptsDir, 'original.md'), 'utf8'), sourceContent);
    assert.equal(await readFile(path.join(scriptsDir, 'polished.md'), 'utf8'), sourceContent);
    assert.equal(await readFile(path.join(scriptsDir, 'executable.md'), 'utf8'), sourceContent);
  });
});

test('prepareScriptDrafts overwrites polished and executable drafts on rerun', async () => {
  await withTempDir('rerun-overwrites-derived', async (dir) => {
    const sourcePath = path.join(dir, 'source.md');
    const outputDir = path.join(dir, 'run');
    const scriptsDir = path.join(outputDir, 'scripts');
    const sourceContent = '源脚本内容\n';
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(sourcePath, sourceContent, 'utf8');
    await writeFile(path.join(scriptsDir, 'original.md'), sourceContent, 'utf8');
    await writeFile(path.join(scriptsDir, 'polished.md'), '人工润色草稿\n', 'utf8');
    await writeFile(path.join(scriptsDir, 'executable.md'), '可执行草稿\n', 'utf8');

    const manifest = await prepareScriptDrafts({ sourceScriptPath: sourcePath, outputDir });

    assert.equal(manifest.drafts.polished.overwriteAllowed, true);
    assert.equal(manifest.drafts.executable.overwriteAllowed, true);
    assert.equal(await readFile(path.join(scriptsDir, 'polished.md'), 'utf8'), sourceContent);
    assert.equal(await readFile(path.join(scriptsDir, 'executable.md'), 'utf8'), sourceContent);
  });
});

test('prepareScriptDrafts refuses to overwrite a different original draft', async () => {
  await withTempDir('conflict', async (dir) => {
    const sourcePath = path.join(dir, 'source.md');
    const outputDir = path.join(dir, 'run');
    const scriptsDir = path.join(outputDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(sourcePath, '源脚本内容\n', 'utf8');
    await writeFile(path.join(scriptsDir, 'original.md'), '已有不同原始稿\n', 'utf8');

    await assert.rejects(
      prepareScriptDrafts({ sourceScriptPath: sourcePath, outputDir }),
      /Do not overwrite the user's original script/,
    );
    assert.equal(await readFile(path.join(scriptsDir, 'original.md'), 'utf8'), '已有不同原始稿\n');
  });
});
