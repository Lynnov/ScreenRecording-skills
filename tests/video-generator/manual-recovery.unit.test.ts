import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { recoverManualRecording } from '../../src/lib/video-generator/manual/recovery.js';
import type { RecordingManifest } from '../../src/lib/video-generator/recording/types.js';

function incompleteManifest(runDir: string): RecordingManifest {
  const bundle = createManualBundle(runDir);
  return {
    version: 1,
    platform: 'win32',
    video: { status: 'unavailable', path: null, reason: 'capture interrupted' },
    rawVideoPath: bundle.rawVideoPath,
    eventsPath: bundle.eventsPath,
    tabsPath: bundle.tabsPath,
    recordingStartMs: 0,
    recordingEndMs: 500,
    firstVideoFrameSessionTimeMs: null,
    attempts: [
      { actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original', attempt: 1, startMs: 0, endMs: 100, confirmedAtMs: 100, status: 'confirmed' },
      { actionId: 'action-002', segmentId: 'segment-002', sourceId: 'original', attempt: 1, startMs: 100, endMs: null, confirmedAtMs: null, status: 'recording' },
    ],
    clockStatus: 'drift-detected',
    slopePpm: Number.NaN,
    maxResidualMs: Number.NaN,
    maxAllowedResidualMs: 250,
    ffprobeDurationDeltaMs: Number.NaN,
    maxAllowedFfprobeDurationDeltaMs: 250,
    markerEvidence: [],
    captureComplete: false,
  };
}

test('recoverManualRecording marks the first unfinished segment as pickup-required without overwriting capture', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-recovery-'));
  try {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.captureDir, { recursive: true });
    await writeFile(bundle.recordingManifestPath, JSON.stringify(incompleteManifest(runDir), null, 2), { encoding: 'utf8', flag: 'wx' });
    await writeFile(bundle.rawVideoPath, 'partial raw', 'utf8');

    const result = await recoverManualRecording({ runDir, recoveredAt: '2026-07-28T02:00:00.000Z' });

    assert.deepEqual(result, {
      ok: true,
      reportPath: bundle.reportPath('capture-recovery'),
      pickupRequiredSegmentId: 'segment-002',
    });
    assert.equal(await readFile(bundle.rawVideoPath, 'utf8'), 'partial raw');
    const report = JSON.parse(await readFile(bundle.reportPath('capture-recovery'), 'utf8')) as { pickupRequiredSegmentId: string; lastConfirmedSegmentId: string };
    assert.equal(report.pickupRequiredSegmentId, 'segment-002');
    assert.equal(report.lastConfirmedSegmentId, 'segment-001');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('recoverManualRecording rejects complete manifests and missing manifests', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-recovery-complete-'));
  try {
    const bundle = createManualBundle(runDir);
    await assert.rejects(() => recoverManualRecording({ runDir }), /manifest/i);
    await mkdir(bundle.captureDir, { recursive: true });
    const manifest = { ...incompleteManifest(runDir), captureComplete: true, video: { status: 'available', path: bundle.originalVideoPath, width: 1920, height: 1080, fps: 30, durationMs: 1000, hasAudio: false }, firstVideoFrameSessionTimeMs: 10, clockStatus: 'ok' };
    await writeFile(bundle.recordingManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await assert.rejects(() => recoverManualRecording({ runDir }), /complete/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
