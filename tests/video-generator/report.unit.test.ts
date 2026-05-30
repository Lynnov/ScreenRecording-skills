import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writePreflightReport, writeRunReport } from '../../src/lib/video-generator/report.js';
import { VideoGeneratorError, type PreflightReport, type RunReport } from '../../src/lib/video-generator/types.js';

test('writeRunReport writes success report with final artifacts', async () => {
  const outputDir = path.join(tmpdir(), `run-report-success-${process.pid}-${Date.now()}`);
  const report: RunReport = {
    ok: true,
    outputDir,
    finalVideoPath: path.join(outputDir, 'final.mp4'),
    timelinePath: path.join(outputDir, 'timeline.json'),
    subtitlesPath: path.join(outputDir, 'subtitles.srt'),
  };

  try {
    const reportPath = await writeRunReport(report);
    const written = JSON.parse(await readFile(reportPath, 'utf8')) as RunReport;

    assert.equal(reportPath, path.join(outputDir, 'run-report.json'));
    assert.equal(written.ok, true);
    assert.equal(written.finalVideoPath, report.finalVideoPath);
    assert.equal(written.timelinePath, report.timelinePath);
    assert.equal(written.subtitlesPath, report.subtitlesPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writeRunReport writes failure report with failure diagnostics and redacts sensitive input', async () => {
  const outputDir = path.join(tmpdir(), `run-report-failure-${process.pid}-${Date.now()}`);
  const report: RunReport = {
    ok: false,
    outputDir,
    failedSegmentId: 'missing-click',
    errorMessage: 'Failed to click Missing',
    screenshotPath: path.join(outputDir, 'screenshots', 'missing-click.png'),
    failedAction: { type: 'fill', selector: '#password', value: 'plain-secret' },
    diagnostics: {
      url: 'http://127.0.0.1/form',
      stageName: 'login.password',
      actionType: 'fill',
      selector: '#password',
      candidateCount: 1,
      candidates: [{ index: 0, visible: true, editable: true, boundingBox: { x: 1, y: 2, width: 100, height: 20 } }],
      screenshotPath: path.join(outputDir, 'screenshots', 'missing-click.png'),
      failureReason: 'fill failed',
    },
  };

  try {
    const reportPath = await writeRunReport(report);
    const written = JSON.parse(await readFile(reportPath, 'utf8')) as RunReport;

    assert.equal(reportPath, path.join(outputDir, 'run-report.json'));
    assert.equal(written.ok, false);
    assert.equal(written.failedSegmentId, report.failedSegmentId);
    assert.equal(written.errorMessage, report.errorMessage);
    assert.equal(written.screenshotPath, report.screenshotPath);
    assert.equal(written.diagnostics?.selector, '#password');
    assert.equal(written.diagnostics?.candidates[0]?.visible, true);
    assert.deepEqual(written.failedAction, { type: 'fill', selector: '#password', value: '[REDACTED]' });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writeRunReport rejects blank outputDir with a clear error', async () => {
  await assert.rejects(
    () => writeRunReport({ ok: false, outputDir: '   ', errorMessage: 'failed before output dir normalized' }),
    (error: unknown) => error instanceof VideoGeneratorError
      && error.code === 'INVALID_OUTPUT_DIR'
      && /must not be empty/.test(error.message),
  );
});

test('writePreflightReport rejects blank outputDir with a clear error', async () => {
  await assert.rejects(
    () => writePreflightReport({ ok: false, outputDir: '', checks: [], stageDiagnostics: [] }),
    (error: unknown) => error instanceof VideoGeneratorError
      && error.code === 'INVALID_OUTPUT_DIR'
      && /must not be empty/.test(error.message),
  );
});

test('writePreflightReport writes stage diagnostics with missing anchors', async () => {
  const outputDir = path.join(tmpdir(), `preflight-report-stage-${process.pid}-${Date.now()}`);
  const report: PreflightReport = {
    ok: false,
    outputDir,
    checks: [
      {
        name: 'stage anchors',
        ok: false,
        stageName: 'orderEntry.createDialog',
        message: 'Stage orderEntry.createDialog missing anchors: [data-testid="missing"]',
      },
    ],
    stageDiagnostics: [
      {
        stageName: 'orderEntry.createDialog',
        scope: '.el-dialog',
        scopeMatched: true,
        scopeCount: 1,
        matched: false,
        anchors: [
          { selector: 'text=新增订单', matched: true, count: 1 },
          { selector: '[data-testid="missing"]', matched: false, count: 0 },
        ],
        missingAnchors: ['[data-testid="missing"]'],
      },
    ],
  };

  try {
    const reportPath = await writePreflightReport(report);
    const written = JSON.parse(await readFile(reportPath, 'utf8')) as PreflightReport;

    assert.equal(reportPath, path.join(outputDir, 'preflight-report.json'));
    assert.equal(written.ok, false);
    assert.equal(written.stageDiagnostics[0]?.stageName, 'orderEntry.createDialog');
    assert.equal(written.stageDiagnostics[0]?.scope, '.el-dialog');
    assert.equal(written.stageDiagnostics[0]?.scopeMatched, true);
    assert.equal(written.stageDiagnostics[0]?.scopeCount, 1);
    assert.equal(written.stageDiagnostics[0]?.matched, false);
    assert.deepEqual(written.stageDiagnostics[0]?.missingAnchors, ['[data-testid="missing"]']);
    assert.deepEqual(written.stageDiagnostics[0]?.anchors[1], { selector: '[data-testid="missing"]', matched: false, count: 0 });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
