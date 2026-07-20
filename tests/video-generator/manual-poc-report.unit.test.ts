import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeCaptureOperatorChecklist, writeCapturePocReport } from '../../src/lib/video-generator/recording/poc-report.js';

const availableVideo = {
  status: 'available' as const,
  path: 'capture/original-window.mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 1000,
  hasAudio: false as const,
};

test('writes capture checklist and POC reports atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-poc-report-'));
  try {
    const checklistPath = path.join(dir, 'checklist.json');
    await writeCaptureOperatorChecklist(checklistPath, {
      overlayEnteredCapture: false,
      multiTabContinuous: true,
      notes: 'verified',
    });
    assert.deepEqual(JSON.parse(await readFile(checklistPath, 'utf8')), {
      overlayEnteredCapture: false,
      multiTabContinuous: true,
      notes: 'verified',
    });

    const reportPath = path.join(dir, 'capture-poc-report.json');
    await writeCapturePocReport(reportPath, {
      version: 1,
      status: 'passed',
      displayMode: 'f11',
      displayScaleFactor: 1,
      video: availableVideo,
      overlayAlwaysOnTop: true,
      overlayEnteredCapture: false,
      multiTabContinuous: true,
      normalizedVideoStatus: 'passed',
      windowModeRestoreRequired: false,
      evidence: { operatorChecklistPath: checklistPath, ffprobeJsonPath: 'ffprobe.json', sampledFrames: [] },
      errors: [],
    });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.status, 'passed');
    assert.equal(report.video.width, 1920);
    await assert.rejects(() => readFile(`${reportPath}.tmp`, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects passed capture reports with missing operator evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-poc-report-invalid-'));
  try {
    await assert.rejects(() => writeCapturePocReport(path.join(dir, 'report.json'), {
      version: 1,
      status: 'passed',
      displayMode: 'borderless-maximized',
      displayScaleFactor: 1,
      video: availableVideo,
      overlayAlwaysOnTop: true,
      overlayEnteredCapture: null,
      multiTabContinuous: true,
      normalizedVideoStatus: 'passed',
      windowModeRestoreRequired: false,
      evidence: { operatorChecklistPath: 'missing.json', ffprobeJsonPath: 'ffprobe.json', sampledFrames: [] },
      errors: [],
    }), /incomplete/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
