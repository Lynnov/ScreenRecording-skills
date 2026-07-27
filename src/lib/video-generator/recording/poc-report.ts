import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WindowBounds } from '../capture/windows-window-mode.js';

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
  windowMode: CaptureWindowModeEvidence;
  evidence: {
    operatorChecklistPath: string;
    ffprobeJsonPath: string;
    sampledFrames: string[];
  };
  errors: string[];
}

export interface CaptureWindowModeEvidence {
  requested: 'f11' | 'borderless-maximized';
  applied: boolean;
  restored: boolean | null;
  handle: string | null;
  snapshot: {
    style: string;
    exStyle: string;
    bounds: WindowBounds;
  } | null;
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
    if (capturePocEvidenceErrors(report).length > 0) {
      throw new Error('Cannot write a passed capture POC report with incomplete evidence.');
    }
  }
  await writeJsonAtomically(filePath, report);
}

export function capturePocEvidenceErrors(report: CapturePocReport): string[] {
  const errors = [...report.errors, ...report.windowMode.errors];
  if (report.video.status !== 'available') {
    errors.push('Normalized capture video is unavailable.');
  } else {
    if (report.video.width !== 1920 || report.video.height !== 1080) {
      errors.push('Capture video must be 1920x1080.');
    }
    if (report.video.fps !== 30 || report.video.hasAudio !== false) {
      errors.push('Capture video must be 30fps without audio.');
    }
  }
  if (report.normalizedVideoStatus !== 'passed') errors.push('Video normalization failed.');
  if (!report.overlayAlwaysOnTop) errors.push('Control overlay was not always on top.');
  if (report.overlayEnteredCapture !== false) errors.push('Control overlay entered capture or was not verified.');
  if (report.multiTabContinuous !== true) errors.push('Multi-tab continuity was not verified.');
  if (report.windowModeRestoreRequired) errors.push('Window mode still requires restoration.');
  if (report.windowMode.requested !== report.displayMode) errors.push('Window mode evidence does not match requested mode.');
  if (report.displayMode === 'borderless-maximized') {
    if (!report.windowMode.applied) errors.push('Borderless mode was not applied.');
    if (report.windowMode.restored !== true) errors.push('Borderless mode was not restored.');
    if (report.windowMode.handle === null || report.windowMode.snapshot === null) {
      errors.push('Borderless mode snapshot is missing.');
    }
  }
  if (report.evidence.operatorChecklistPath.length === 0) errors.push('Operator checklist path is missing.');
  if (report.evidence.ffprobeJsonPath.length === 0) errors.push('ffprobe evidence path is missing.');
  if (report.evidence.sampledFrames.length < 3) errors.push('Three sampled capture frames are required.');
  return errors;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}
