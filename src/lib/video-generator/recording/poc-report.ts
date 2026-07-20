import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CapturePocReport {
  version: 1;
  status: 'passed' | 'failed' | 'incomplete';
  displayMode: 'f11' | 'borderless-maximized';
  displayScaleFactor: number;
  video:
    | {
        status: 'available';
        path: string;
        width: number;
        height: number;
        fps: number;
        durationMs: number;
        hasAudio: false;
      }
    | {
        status: 'unavailable';
        path: null;
        reason: string;
      };
  overlayAlwaysOnTop: boolean;
  overlayEnteredCapture: boolean | null;
  multiTabContinuous: boolean | null;
  normalizedVideoStatus: 'passed' | 'failed';
  windowModeRestoreRequired: boolean;
  evidence: {
    operatorChecklistPath: string;
    ffprobeJsonPath: string;
    sampledFrames: string[];
  };
  errors: string[];
}

export interface CaptureOperatorChecklist {
  overlayEnteredCapture: boolean;
  multiTabContinuous: boolean;
  notes: string;
}

export async function writeCaptureOperatorChecklist(
  filePath: string,
  checklist: CaptureOperatorChecklist,
): Promise<void> {
  await writeJsonAtomically(filePath, checklist);
}

export async function writeCapturePocReport(
  filePath: string,
  report: CapturePocReport,
): Promise<void> {
  if (report.status === 'passed') {
    const missingOperatorDecision = report.overlayEnteredCapture === null || report.multiTabContinuous === null;
    const unavailableVideo = report.video.status !== 'available';
    const failedNormalization = report.normalizedVideoStatus !== 'passed';
    if (missingOperatorDecision || unavailableVideo || failedNormalization || report.errors.length > 0) {
      throw new Error('Cannot write a passed capture POC report with incomplete evidence.');
    }
  }
  await writeJsonAtomically(filePath, report);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}
