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

test('pickup verifier accepts pickup-owned capture updates and ignores failed upstream reports', async () => {
  const runDir = await createGuideRun();
  const bundle = createManualBundle(runDir);
  await Promise.all([
    mkdir(bundle.captureDir, { recursive: true }),
    mkdir(bundle.pickupsDir, { recursive: true }),
    mkdir(bundle.editDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(bundle.originalVideoPath, 'original-video'),
    writeFile(bundle.eventsPath, ''),
    writeFile(bundle.tabsPath, '[]'),
    writeFile(bundle.recordingManifestPath, JSON.stringify({
      version: 1,
      captureComplete: true,
      clockStatus: 'ok',
      video: { status: 'available', path: bundle.originalVideoPath },
    })),
    writeFile(bundle.sourceCatalogPath, JSON.stringify({
      version: 1,
      sources: [{
        id: 'original', path: bundle.originalVideoPath, kind: 'original', segmentId: null, attempt: null,
        status: 'available', createdAt: '2026-07-29T00:00:00.000Z', durationMs: 1000,
        width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false,
      }],
    })),
    writeFile(bundle.previewVideoPath, 'preview-before-pickup'),
    writeFile(bundle.previewTimelinePath, JSON.stringify({ version: 1, durationMs: 1000, segments: [] })),
  ]);
  await verifyManualStage({ runDir, stage: 'guide' });
  const capture = await verifyManualStage({
    runDir,
    stage: 'capture',
    probeMedia: async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
  });
  assert.equal(capture.ok, true);
  const preview = await verifyManualStage({
    runDir,
    stage: 'preview',
    probeMedia: async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
  });
  assert.equal(preview.ok, true);

  const pickupPath = bundle.pickupPath('segment-001', 1);
  await Promise.all([
    writeFile(pickupPath, 'pickup-video'),
    writeFile(bundle.previewVideoPath, 'preview-after-pickup'),
    writeFile(bundle.previewTimelinePath, JSON.stringify({ version: 1, durationMs: 1800, segments: [] })),
    writeFile(bundle.recordingManifestPath, JSON.stringify({
      version: 1,
      captureComplete: true,
      clockStatus: 'ok',
      video: { status: 'available', path: bundle.originalVideoPath },
      pickupAttempts: [{ segmentId: 'segment-001', status: 'confirmed' }],
    })),
    writeFile(bundle.sourceCatalogPath, JSON.stringify({
      version: 1,
      sources: [
        {
          id: 'original', path: bundle.originalVideoPath, kind: 'original', segmentId: null, attempt: null,
          status: 'available', createdAt: '2026-07-29T00:00:00.000Z', durationMs: 1000,
          width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false,
        },
        {
          id: 'segment-001-attempt-001', path: pickupPath, kind: 'pickup', segmentId: 'segment-001', attempt: 1,
          status: 'available', createdAt: '2026-07-29T00:01:00.000Z', durationMs: 800,
          width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false,
        },
      ],
    })),
    writeFile(bundle.reportPath('review-verification'), JSON.stringify({
      version: 1,
      stage: 'review',
      ok: false,
      checkedAt: '2026-07-29T00:02:00.000Z',
      hashes: { [bundle.originalScriptPath]: 'failed-report-must-not-be-a-baseline' },
      media: {},
      errors: ['review incomplete'],
    })),
  ]);

  const pickup = await verifyManualStage({ runDir, stage: 'pickup' });
  assert.equal(pickup.ok, true, pickup.errors.join('\n'));
  assert.ok(bundle.recordingManifestPath in pickup.hashes);
  assert.ok(bundle.sourceCatalogPath in pickup.hashes);
  assert.ok(bundle.previewVideoPath in pickup.hashes);
  assert.ok(bundle.previewTimelinePath in pickup.hashes);
});

test('final stage verifier preserves the finalize report and writes a separate stage report', async () => {
  const runDir = await createGuideRun();
  const bundle = createManualBundle(runDir);
  await Promise.all([
    mkdir(bundle.editDir, { recursive: true }),
    writeFile(bundle.finalTimelinePath, JSON.stringify({ version: 1, durationMs: 1000, segments: [] })),
    writeFile(bundle.subtitlesPath, '1\n00:00:00,000 --> 00:00:01,000\n完成\n'),
    writeFile(bundle.finalVideoPath, 'final-video'),
    writeFile(bundle.reportPath('final-verification'), JSON.stringify({
      version: 1,
      ok: true,
      renderOk: true,
      runDir,
      finalVideoPath: bundle.finalVideoPath,
      fineEditRulesSnapshotPath: bundle.fineEditRulesSnapshotPath,
      fineEditPlanPath: bundle.versionedEditPath('edit-plan.fine', 1),
      fineEditQualityPath: bundle.fineEditQualityPath,
      quality: { status: 'warning', warnings: [{ code: 'LONG_ACTION_AFTER_NARRATION', message: 'long action' }] },
      probe: { durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264' },
    })),
    writeFile(bundle.fineEditRulesSnapshotPath, JSON.stringify({ version: 1 })),
    writeFile(bundle.versionedEditPath('edit-plan.fine', 1), JSON.stringify({ version: 1, segments: [] })),
    writeFile(bundle.fineEditQualityPath, JSON.stringify({ version: 1, status: 'warning' })),
  ]);

  const report = await verifyManualStage({
    runDir,
    stage: 'final',
    probeMedia: async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
  });
  assert.equal(report.ok, true, report.errors.join('\n'));
  const finalizeReport = JSON.parse(await readFile(bundle.reportPath('final-verification'), 'utf8')) as { ok: boolean; stage?: string };
  assert.equal(finalizeReport.ok, true);
  assert.equal(finalizeReport.stage, undefined);
  const stageReport = JSON.parse(await readFile(bundle.reportPath('final-stage-verification'), 'utf8')) as { stage: string; ok: boolean };
  assert.deepEqual({ stage: stageReport.stage, ok: stageReport.ok }, { stage: 'final', ok: true });
});

test('final stage verifier rejects a successful render report without fine-edit quality evidence', async () => {
  const runDir = await createGuideRun();
  const bundle = createManualBundle(runDir);
  await Promise.all([
    writeFile(bundle.finalTimelinePath, JSON.stringify({ version: 1, durationMs: 1000, segments: [] })),
    writeFile(bundle.subtitlesPath, 'subtitle'),
    writeFile(bundle.finalVideoPath, 'final-video'),
    writeFile(bundle.reportPath('final-verification'), JSON.stringify({ version: 1, ok: true, renderOk: true, runDir })),
  ]);

  const report = await verifyManualStage({
    runDir,
    stage: 'final',
    probeMedia: async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
  });

  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /quality|fine.edit/i);
});
