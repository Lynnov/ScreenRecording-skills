import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface ManualRunArtifacts {
  outputDir: string;
  captureDir: string;
  pickupsDir: string;
  editDir: string;
  reportsDir: string;
  rawVideoPath: string;
  originalVideoPath: string;
  eventsPath: string;
  tabsPath: string;
  manifestPath: string;
  previewTimelinePath: string;
  previewVideoPath: string;
  capturePocReportPath: string;
  captureOperatorChecklistPath: string;
  captureFfprobeJsonPath: string;
  captureEvidenceFramesDir: string;
  markerEvidenceDir: string;
  manualEventsPocReportPath: string;
  pickupPath(segmentId: string, attempt: number): string;
}

export function createManualRunArtifacts(outputDir: string): ManualRunArtifacts {
  const captureDir = path.join(outputDir, 'capture');
  const pickupsDir = path.join(outputDir, 'pickups');
  const editDir = path.join(outputDir, 'edit');
  const reportsDir = path.join(outputDir, 'reports');
  return {
    outputDir,
    captureDir,
    pickupsDir,
    editDir,
    reportsDir,
    rawVideoPath: path.join(captureDir, 'raw-window.webm'),
    originalVideoPath: path.join(captureDir, 'original-window.mp4'),
    eventsPath: path.join(captureDir, 'events.jsonl'),
    tabsPath: path.join(captureDir, 'tabs.json'),
    manifestPath: path.join(captureDir, 'recording-manifest.json'),
    previewTimelinePath: path.join(editDir, 'preview-timeline.json'),
    previewVideoPath: path.join(editDir, 'preview.mp4'),
    capturePocReportPath: path.join(reportsDir, 'capture-poc-report.json'),
    captureOperatorChecklistPath: path.join(reportsDir, 'capture-poc-operator-checklist.json'),
    captureFfprobeJsonPath: path.join(reportsDir, 'capture-poc-ffprobe.json'),
    captureEvidenceFramesDir: path.join(reportsDir, 'capture-poc-frames'),
    markerEvidenceDir: path.join(reportsDir, 'clock-marker-frames'),
    manualEventsPocReportPath: path.join(reportsDir, 'manual-events-poc-report.json'),
    pickupPath: (segmentId, attempt) => path.join(pickupsDir, `${segmentId}-attempt-${String(attempt).padStart(3, '0')}.mp4`),
  };
}

export async function ensureManualRunArtifactDirs(artifacts: ManualRunArtifacts): Promise<void> {
  await Promise.all([
    mkdir(artifacts.captureDir, { recursive: true }),
    mkdir(artifacts.pickupsDir, { recursive: true }),
    mkdir(artifacts.editDir, { recursive: true }),
    mkdir(artifacts.reportsDir, { recursive: true }),
    mkdir(artifacts.captureEvidenceFramesDir, { recursive: true }),
    mkdir(artifacts.markerEvidenceDir, { recursive: true }),
  ]);
}

export async function assertManualRunIsWritable(artifacts: ManualRunArtifacts): Promise<void> {
  for (const protectedPath of [artifacts.rawVideoPath, artifacts.originalVideoPath, artifacts.eventsPath, artifacts.manifestPath]) {
    if (await fileExists(protectedPath)) {
      throw new Error(`Protected manual recording artifact already exists: ${protectedPath}`);
    }
  }
}
