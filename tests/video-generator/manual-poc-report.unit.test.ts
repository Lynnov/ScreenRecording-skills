import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  capturePocEvidenceErrors,
  writeCaptureOperatorChecklist,
  writeCapturePocReport,
  type CapturePocReport,
} from '../../src/lib/video-generator/recording/poc-report.js';

const availableVideo = {
  status: 'available' as const,
  path: 'capture/original-window.mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 1000,
  hasAudio: false as const,
};

const validF11Report: CapturePocReport = {
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
  windowMode: {
    requested: 'f11',
    applied: false,
    restored: null,
    handle: null,
    snapshot: null,
    errors: [],
  },
  evidence: {
    operatorChecklistPath: 'checklist.json',
    ffprobeJsonPath: 'ffprobe.json',
    sampledFrames: ['start.png', 'middle.png', 'end.png'],
  },
  errors: [],
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
      ...validF11Report,
      evidence: { ...validF11Report.evidence, operatorChecklistPath: checklistPath },
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
      ...validF11Report,
      overlayEnteredCapture: null,
    }), /incomplete/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects passed reports whose objective or operator evidence says capture failed', async () => {
  const invalidReports: CapturePocReport[] = [
    { ...validF11Report, overlayAlwaysOnTop: false },
    { ...validF11Report, overlayEnteredCapture: true },
    { ...validF11Report, multiTabContinuous: false },
    { ...validF11Report, evidence: { ...validF11Report.evidence, sampledFrames: [] } },
    {
      ...validF11Report,
      displayMode: 'borderless-maximized',
      windowMode: {
        requested: 'borderless-maximized',
        applied: false,
        restored: false,
        handle: '123',
        snapshot: null,
        errors: [],
      },
    },
    {
      ...validF11Report,
      displayMode: 'borderless-maximized',
      windowMode: {
        requested: 'borderless-maximized',
        applied: true,
        restored: false,
        handle: '123',
        snapshot: {
          style: '1',
          exStyle: '2',
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        },
        errors: [],
      },
    },
  ];

  for (const report of invalidReports) {
    assert.ok(capturePocEvidenceErrors(report).length > 0);
    await assert.rejects(
      () => writeCapturePocReport(path.join(tmpdir(), `invalid-${Math.random()}.json`), report),
      /incomplete evidence/i,
    );
  }
});
