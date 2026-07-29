import { readFile } from 'node:fs/promises';

import { writeAtomicJson } from './atomic-writer.js';
import { createManualBundle } from './bundle.js';
import type { RecordingManifest } from '../recording/types.js';

export interface RecoverManualRecordingInput {
  runDir: string;
  recoveredAt?: string;
}

export interface RecoverManualRecordingResult {
  ok: true;
  reportPath: string;
  pickupRequiredSegmentId: string;
}

export async function recoverManualRecording(input: RecoverManualRecordingInput): Promise<RecoverManualRecordingResult> {
  const bundle = createManualBundle(input.runDir);
  let manifest: RecordingManifest;
  try {
    manifest = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as RecordingManifest;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') throw new Error(`Recording manifest is required for recovery: ${bundle.recordingManifestPath}`);
    throw error;
  }
  if (manifest.captureComplete) {
    throw new Error('Recording manifest is already complete; recovery is not needed.');
  }

  const lastConfirmed = [...manifest.attempts].reverse().find((attempt) => attempt.status === 'confirmed');
  const firstUnfinished = manifest.attempts.find((attempt) => attempt.status !== 'confirmed');
  const pickupRequiredSegmentId = firstUnfinished?.segmentId ?? lastConfirmed?.segmentId ?? 'segment-001';
  const reportPath = bundle.reportPath('capture-recovery');
  await writeAtomicJson(reportPath, {
    version: 1,
    status: 'pickup-required',
    recoveredAt: input.recoveredAt ?? new Date().toISOString(),
    lastConfirmedSegmentId: lastConfirmed?.segmentId ?? null,
    pickupRequiredSegmentId,
    capturePath: manifest.rawVideoPath,
    manifestPath: bundle.recordingManifestPath,
  });

  return { ok: true, reportPath, pickupRequiredSegmentId };
}
