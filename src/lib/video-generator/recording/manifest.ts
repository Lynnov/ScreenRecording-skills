import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingManifest } from './types.js';

export async function writeRecordingManifest(
  manifestPath: string,
  manifest: RecordingManifest,
): Promise<void> {
  validateRecordingManifest(manifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(tempPath, manifestPath);
}

function validateRecordingManifest(manifest: RecordingManifest): void {
  if (manifest.captureComplete && manifest.video.status !== 'available') {
    throw new Error('A complete recording manifest must reference an available video.');
  }
  if (manifest.captureComplete && manifest.firstVideoFrameSessionTimeMs === null) {
    throw new Error('A complete recording manifest must include first video frame session time.');
  }
  if (manifest.firstVideoFrameSessionTimeMs === null && manifest.clockStatus === 'ok') {
    throw new Error('A recording manifest without a first video frame cannot have clockStatus ok.');
  }
}
