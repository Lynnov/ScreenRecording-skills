import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';

export async function createReadyRun(): Promise<string> {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-finalize-'));
  const bundle = createManualBundle(runDir);
  await Promise.all([mkdir(bundle.scriptsDir, { recursive: true }), mkdir(bundle.editDir, { recursive: true }), mkdir(bundle.captureDir, { recursive: true })]);
  const guidePath = bundle.versionedScriptPath('recording-guide', 1);
  await writeFile(guidePath, JSON.stringify({ version: 1, startUrl: 'https://example.test', actions: [{ id: 'a1', segmentId: 'segment-001', title: 'Save', instruction: 'Save settings', expectedEvents: [], expectedResults: [] }] }));
  await writeFile(bundle.approvedGuidePath, JSON.stringify({ version: 1, guideVersion: 1, guidePath, approvedAt: '2026-07-29T00:00:00.000Z' }));
  const narrationPath = bundle.versionedScriptPath('narration-final', 1);
  await writeFile(narrationPath, '# Final Narration\n\n## segment-001\n\nSave settings.\n');
  await writeFile(bundle.approvedNarrationPath, JSON.stringify({ version: 1, narrationVersion: 1, narrationPath, approvedAt: '2026-07-29T00:00:00.000Z' }));
  const source = { id: 'source-001', path: path.join(bundle.captureDir, 'original-window.mp4'), kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-29T00:00:00.000Z', durationMs: 2000, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false };
  await writeFile(bundle.sourceCatalogPath, JSON.stringify({ version: 1, sources: [source] }));
  const planPath = bundle.versionedEditPath('edit-plan.effective', 1);
  await writeFile(planPath, JSON.stringify({ version: 1, canvas: { width: 1920, height: 1080, fps: 30 }, segments: [{ segmentId: 'segment-001', title: 'Save', clips: [{ sourceId: 'source-001', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 1 }], confidence: 'high', reason: 'approved' }] }));
  await writeFile(bundle.effectiveCurrentPlanPath, JSON.stringify({ version: 1, path: planPath }));
  const reviewPath = bundle.versionedEditPath('edit-review', 1);
  await writeFile(reviewPath, JSON.stringify({ version: 1, createdAt: '2026-07-29T00:00:00.000Z', reviewComplete: true, segments: [{ segmentId: 'segment-001', status: 'approved', reviewReasons: [] }] }));
  await writeFile(bundle.reviewCurrentPath, JSON.stringify({ version: 1, path: reviewPath }));
  await writeFile(bundle.recordingManifestPath, JSON.stringify({ version: 1, captureComplete: true, clockStatus: 'ok' }));
  return runDir;
}
