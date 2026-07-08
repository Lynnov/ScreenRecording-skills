import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writeCandidateReport, writePreflightReport, writeRunReport } from '../../src/lib/video-generator/report.js';
import type { PreflightReport, RunReport } from '../../src/lib/video-generator/types.js';

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
    const result = await writeRunReport(report);
    const written = JSON.parse(await readFile(result.runReportPath, 'utf8')) as RunReport;

    assert.equal(result.runReportPath, path.join(outputDir, 'reports', 'run-report.json'));
    assert.equal(result.candidateReportPath, undefined);
    assert.equal(written.ok, true);
    assert.equal(written.finalVideoPath, report.finalVideoPath);
    assert.equal(written.timelinePath, report.timelinePath);
    assert.equal(written.subtitlesPath, report.subtitlesPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writeRunReport writes failure report with failure details', async () => {
  const outputDir = path.join(tmpdir(), `run-report-failure-${process.pid}-${Date.now()}`);
  const report: RunReport = {
    ok: false,
    outputDir,
    failedSegmentId: 'missing-click',
    errorMessage: 'Failed to click Missing',
    screenshotPath: path.join(outputDir, 'screenshots', 'missing-click.png'),
  };

  try {
    const result = await writeRunReport(report);
    const written = JSON.parse(await readFile(result.runReportPath, 'utf8')) as RunReport;

    assert.equal(result.runReportPath, path.join(outputDir, 'reports', 'run-report.json'));
    assert.equal(result.candidateReportPath, undefined);
    assert.equal(written.ok, false);
    assert.equal(written.failedSegmentId, report.failedSegmentId);
    assert.equal(written.errorMessage, report.errorMessage);
    assert.equal(written.screenshotPath, report.screenshotPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writeRunReport writes candidate report when candidates are present', async () => {
  const outputDir = path.join(tmpdir(), `run-report-candidates-${process.pid}-${Date.now()}`);
  const screenshotPath = path.join(outputDir, 'screenshots', 'seg-002.png');
  const report: RunReport = {
    ok: false,
    outputDir,
    failedSegmentId: 'seg-002',
    failedAction: { type: 'semanticClick', target: { kind: 'button', name: 'Submit' } },
    failureReason: 'AMBIGUOUS_TARGET',
    candidates: [
      {
        label: 'Submit button',
        role: 'button',
        name: 'Submit',
        text: 'Submit',
        layer: 'page',
        confidence: 'medium',
        selectorHint: 'button:nth-of-type(2)',
      },
    ],
    screenshotPath,
    errorMessage: 'Ambiguous semantic target',
  };

  try {
    const result = await writeRunReport(report);
    const writtenRunReport = JSON.parse(await readFile(result.runReportPath, 'utf8')) as RunReport;
    const writtenCandidateReport = JSON.parse(await readFile(result.candidateReportPath ?? '', 'utf8')) as Pick<RunReport,
      'failureReason' | 'failedSegmentId' | 'failedAction' | 'candidates' | 'screenshotPath'
    >;

    assert.equal(result.runReportPath, path.join(outputDir, 'reports', 'run-report.json'));
    assert.equal(result.candidateReportPath, path.join(outputDir, 'reports', 'candidate-report.json'));
    assert.equal(writtenRunReport.candidateReportPath, result.candidateReportPath);
    assert.deepEqual(writtenCandidateReport, {
      failureReason: report.failureReason,
      failedSegmentId: report.failedSegmentId,
      failedAction: report.failedAction,
      candidates: report.candidates,
      screenshotPath: report.screenshotPath,
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writeCandidateReport writes candidate details under reports directory', async () => {
  const outputDir = path.join(tmpdir(), `candidate-report-${process.pid}-${Date.now()}`);

  try {
    const reportPath = await writeCandidateReport({
      outputDir,
      checks: [{
        name: 'browser.action',
        status: 'failed',
        message: 'Missing target',
        segmentId: 'seg-001',
        actionIndex: 0,
        candidates: [{ tagName: 'button', role: 'button', text: '保存' }],
      }],
    });
    const written = JSON.parse(await readFile(reportPath, 'utf8')) as { outputDir: string; checks: Array<{ candidates?: unknown[] }> };

    assert.equal(reportPath, path.join(outputDir, 'reports', 'candidate-report.json'));
    assert.deepEqual(written.checks[0]?.candidates, [{ tagName: 'button', role: 'button', text: '保存' }]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writePreflightReport redacts sensitive failed action values before writing', async () => {
  const outputDir = path.join(tmpdir(), `preflight-report-redacted-${process.pid}-${Date.now()}`);
  const report: PreflightReport = {
    ok: false,
    outputDir,
    scriptPath: path.join(outputDir, 'script.md'),
    checks: [{ name: 'browser.action', status: 'failed', message: 'Missing target', segmentId: 'seg-001', actionIndex: 0 }],
    failedSegmentId: 'seg-001',
    failedAction: { type: 'uploadFile', text: '合同附件', path: path.join(outputDir, 'secret contract.pdf') },
  };

  try {
    const reportPath = await writePreflightReport(report);
    const reportText = await readFile(reportPath, 'utf8');
    const written = JSON.parse(reportText) as PreflightReport;

    assert.deepEqual(written.failedAction, { type: 'uploadFile', text: '合同附件', path: '[redacted]' });
    assert.equal(reportText.includes('secret contract.pdf'), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('writePreflightReport writes preflight details with report path', async () => {
  const outputDir = path.join(tmpdir(), `preflight-report-${process.pid}-${Date.now()}`);
  const report: PreflightReport = {
    ok: false,
    outputDir,
    scriptPath: path.join(outputDir, 'script.md'),
    checks: [{ name: 'browser.action', status: 'failed', message: 'Missing target', segmentId: 'seg-001', actionIndex: 0 }],
    failedSegmentId: 'seg-001',
    failedAction: { type: 'click', text: 'Missing' },
  };

  try {
    const reportPath = await writePreflightReport(report);
    const written = JSON.parse(await readFile(reportPath, 'utf8')) as PreflightReport;

    assert.equal(reportPath, path.join(outputDir, 'reports', 'preflight-report.json'));
    assert.equal(written.ok, false);
    assert.equal(written.preflightReportPath, reportPath);
    assert.equal(written.checks[0]?.name, 'browser.action');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
