import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { verifyManualStage } from '../../src/lib/video-generator/manual/verifiers.js';

async function createGuideRun(): Promise<string> {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-verify-'));
  const bundle = createManualBundle(runDir);
  await Promise.all([mkdir(bundle.scriptsDir, { recursive: true }), mkdir(bundle.reportsDir, { recursive: true })]);
  await writeFile(bundle.originalScriptPath, '# Demo\n');
  const guidePath = bundle.versionedScriptPath('recording-guide', 1);
  await writeFile(guidePath, JSON.stringify({
    version: 1,
    startUrl: 'https://example.test',
    actions: [{ id: 'action-001', segmentId: 'segment-001', title: 'Save', instruction: 'Save', expectedEvents: [], expectedResults: [] }],
  }));
  await writeFile(bundle.approvedGuidePath, JSON.stringify({ version: 1, guideVersion: 1, guidePath, approvedAt: '2026-07-29T00:00:00.000Z' }));
  return runDir;
}

test('guide verifier writes a successful report with immutable hashes', async () => {
  const runDir = await createGuideRun();
  const report = await verifyManualStage({ runDir, stage: 'guide', now: () => '2026-07-29T00:00:00.000Z' });
  assert.equal(report.ok, true);
  assert.ok(Object.keys(report.hashes).some((file) => file.endsWith('original.md')));
  const written = JSON.parse(await readFile(createManualBundle(runDir).reportPath('guide-verification'), 'utf8')) as { ok: boolean };
  assert.equal(written.ok, true);
});

test('downstream verifier fails closed when an upstream protected artifact hash changes', async () => {
  const runDir = await createGuideRun();
  const bundle = createManualBundle(runDir);
  await verifyManualStage({ runDir, stage: 'guide' });
  await writeFile(bundle.originalScriptPath, '# Mutated\n');
  await mkdir(bundle.captureDir, { recursive: true });
  await writeFile(bundle.originalVideoPath, 'video');
  await writeFile(bundle.eventsPath, '');
  await writeFile(bundle.tabsPath, '[]');
  await writeFile(bundle.recordingManifestPath, JSON.stringify({
    version: 1, captureComplete: true, clockStatus: 'ok',
    video: { status: 'available', path: bundle.originalVideoPath, width: 1920, height: 1080, fps: 30, durationMs: 1000, hasAudio: false },
  }));
  await writeFile(bundle.sourceCatalogPath, JSON.stringify({
    version: 1,
    sources: [{ id: 'original', path: bundle.originalVideoPath, kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-29T00:00:00.000Z', durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false }],
  }));
  const report = await verifyManualStage({
    runDir,
    stage: 'capture',
    probeMedia: async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
  });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /immutable|hash|original\.md/i);
});

test('review verifier requires reviewComplete and valid current pointers', async () => {
  const runDir = await createGuideRun();
  const bundle = createManualBundle(runDir);
  await mkdir(bundle.editDir, { recursive: true });
  const reviewPath = bundle.versionedEditPath('edit-review', 1);
  await writeFile(reviewPath, JSON.stringify({ version: 1, createdAt: '2026-07-29T00:00:00.000Z', reviewComplete: false, segments: [] }));
  await writeFile(bundle.reviewCurrentPath, JSON.stringify({ version: 1, path: reviewPath }));
  const report = await verifyManualStage({ runDir, stage: 'review' });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /reviewComplete/);
});
