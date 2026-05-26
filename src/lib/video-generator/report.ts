import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RunReport } from './types.js';

export interface WriteRunReportResult {
  runReportPath: string;
  candidateReportPath?: string;
}

export async function writeRunReport(report: RunReport): Promise<WriteRunReportResult> {
  await mkdir(report.outputDir, { recursive: true });
  const runReportPath = path.join(report.outputDir, 'run-report.json');
  const candidateReportPath = report.candidates !== undefined && report.candidates.length > 0
    ? path.join(report.outputDir, 'candidate-report.json')
    : undefined;
  const reportToWrite: RunReport = {
    ...report,
    candidateReportPath: candidateReportPath ?? report.candidateReportPath,
  };

  if (candidateReportPath !== undefined) {
    await writeFile(candidateReportPath, `${JSON.stringify({
      failureReason: reportToWrite.failureReason,
      failedSegmentId: reportToWrite.failedSegmentId,
      failedAction: reportToWrite.failedAction,
      candidates: reportToWrite.candidates,
      screenshotPath: reportToWrite.screenshotPath,
    }, null, 2)}\n`);
  }

  await writeFile(runReportPath, `${JSON.stringify(reportToWrite, null, 2)}\n`);
  return { runReportPath, candidateReportPath };
}
