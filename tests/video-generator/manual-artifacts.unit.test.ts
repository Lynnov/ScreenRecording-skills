import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertManualRunIsWritable,
  createManualRunArtifacts,
  ensureManualRunArtifactDirs,
} from '../../src/lib/video-generator/recording/artifacts.js';

test('creates deterministic manual recording artifact paths', () => {
  const artifacts = createManualRunArtifacts(String.raw`E:\video runs\manual-poc`);
  assert.equal(artifacts.rawVideoPath, path.join(artifacts.captureDir, 'raw-window.webm'));
  assert.equal(artifacts.originalVideoPath, path.join(artifacts.captureDir, 'original-window.mp4'));
  assert.equal(artifacts.eventsPath, path.join(artifacts.captureDir, 'events.jsonl'));
  assert.equal(artifacts.manifestPath, path.join(artifacts.captureDir, 'recording-manifest.json'));
  assert.equal(artifacts.markerEvidenceDir, path.join(artifacts.reportsDir, 'clock-marker-frames'));
  assert.equal(artifacts.previewVideoPath, path.join(artifacts.editDir, 'preview.mp4'));
  assert.equal(artifacts.pickupPath('segment-003', 1), path.join(artifacts.pickupsDir, 'segment-003-attempt-001.mp4'));
});

test('refuses to prepare a run when protected original artifacts already exist', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-artifacts-'));
  try {
    const artifacts = createManualRunArtifacts(tempDir);
    await ensureManualRunArtifactDirs(artifacts);
    await writeFile(artifacts.rawVideoPath, 'existing');
    await assert.rejects(() => assertManualRunIsWritable(artifacts), /already exists/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
