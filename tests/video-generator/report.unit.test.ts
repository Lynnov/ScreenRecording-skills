import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writeRunReport } from '../../src/lib/video-generator/report.js';
import type { RunReport } from '../../src/lib/video-generator/types.js';

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
    const reportPath = await writeRunReport(report);
    const written = JSON.parse(await readFile(reportPath, 'utf8')) as RunReport;

    assert.equal(reportPath, path.join(outputDir, 'run-report.json'));
    assert.equal(written.ok, false);
    assert.equal(written.failedSegmentId, report.failedSegmentId);
    assert.equal(written.errorMessage, report.errorMessage);
    assert.equal(written.screenshotPath, report.screenshotPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
