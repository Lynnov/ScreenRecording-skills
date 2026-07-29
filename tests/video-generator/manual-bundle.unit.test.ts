import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  acquireManualRunLock,
  createManualBundle,
  writeProtectedJson,
  writeVersionedJson,
} from '../../src/lib/video-generator/manual/bundle.js';
import { writeAtomicJson } from '../../src/lib/video-generator/manual/atomic-writer.js';

test('creates deterministic manual bundle paths for all product artifacts', () => {
  const bundle = createManualBundle(String.raw`E:\video runs\manual`);

  assert.equal(bundle.rootDir, String.raw`E:\video runs\manual`);
  assert.equal(bundle.scriptsDir, path.join(bundle.rootDir, 'scripts'));
  assert.equal(bundle.agentDir, path.join(bundle.rootDir, 'agent'));
  assert.equal(bundle.captureDir, path.join(bundle.rootDir, 'capture'));
  assert.equal(bundle.pickupsDir, path.join(bundle.rootDir, 'pickups'));
  assert.equal(bundle.editDir, path.join(bundle.rootDir, 'edit'));
  assert.equal(bundle.audioDir, path.join(bundle.rootDir, 'audio'));
  assert.equal(bundle.reportsDir, path.join(bundle.rootDir, 'reports'));
  assert.equal(bundle.originalScriptPath, path.join(bundle.scriptsDir, 'original.md'));
  assert.equal(bundle.approvedGuidePath, path.join(bundle.scriptsDir, 'recording-guide.approved.json'));
  assert.equal(bundle.sourceCatalogPath, path.join(bundle.captureDir, 'source-catalog.json'));
  assert.equal(bundle.recordingManifestPath, path.join(bundle.captureDir, 'recording-manifest.json'));
  assert.equal(bundle.versionedScriptPath('polished', 2), path.join(bundle.scriptsDir, 'polished.v02.md'));
  assert.equal(bundle.versionedAgentPath('guide-request', 1), path.join(bundle.agentDir, 'guide-request.v01.json'));
  assert.equal(bundle.versionedEditPath('edit-plan.agent', 12), path.join(bundle.editDir, 'edit-plan.agent.v12.json'));
  assert.equal(bundle.pickupPath('segment-003', 1), path.join(bundle.pickupsDir, 'segment-003-attempt-001.mp4'));
  assert.equal(bundle.audioSegmentPath('segment-003'), path.join(bundle.audioDir, 'segment-003.wav'));
});

test('writeProtectedJson writes atomically and refuses to overwrite protected artifacts', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-protected-'));
  const file = path.join(tempDir, 'scripts', 'original.json');
  try {
    await writeProtectedJson(file, { version: 1, ok: true });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, ok: true });
    await assert.rejects(() => readFile(`${file}.tmp`, 'utf8'));
    await assert.rejects(() => writeProtectedJson(file, { version: 1, ok: false }), /already exists/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('writeAtomicJson replaces existing file without leaving temp files', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-atomic-'));
  const file = path.join(tempDir, 'reports', 'report.json');
  try {
    await writeAtomicJson(file, { version: 1 });
    await writeAtomicJson(file, { version: 2 });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 2 });
    await assert.rejects(() => readFile(`${file}.tmp`, 'utf8'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('writeVersionedJson allocates monotonically increasing immutable vNN files', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-versioned-'));
  try {
    const first = await writeVersionedJson(tempDir, 'guide-request', { version: 1 });
    const second = await writeVersionedJson(tempDir, 'guide-request', { version: 1 });

    assert.equal(first.version, 1);
    assert.equal(first.path, path.join(tempDir, 'guide-request.v01.json'));
    assert.equal(second.version, 2);
    assert.equal(second.path, path.join(tempDir, 'guide-request.v02.json'));
    assert.deepEqual(JSON.parse(await readFile(first.path, 'utf8')), { version: 1 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('acquireManualRunLock rejects concurrent writers for the same run and releases cleanly', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-lock-'));
  try {
    const lock = await acquireManualRunLock(tempDir);
    await assert.rejects(() => acquireManualRunLock(tempDir), /locked/i);
    await lock.release();
    const reacquired = await acquireManualRunLock(tempDir);
    await reacquired.release();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
