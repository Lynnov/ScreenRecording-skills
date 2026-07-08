import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { redactBrowserAction } from './action-redaction.js';
import { createRunArtifacts } from './artifacts.js';
import type { PreflightCheck, PreflightReport, RunReport } from './types.js';

export interface WriteRunReportResult {
  runReportPath: string;
  candidateReportPath?: string;
}

export async function writeRunReport(
  report: RunReport,
  reportPath = createRunArtifacts(report.outputDir).runReportPath,
): Promise<WriteRunReportResult> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const artifacts = createRunArtifacts(report.outputDir);
  const candidateReportPath = report.candidates !== undefined && report.candidates.length > 0
    ? artifacts.candidateReportPath
    : report.candidateReportPath;
  const redactedReport: RunReport = {
    ...report,
    failedAction: redactBrowserAction(report.failedAction),
    candidateReportPath,
  };

  if (report.candidates !== undefined && report.candidates.length > 0 && candidateReportPath !== undefined) {
    await mkdir(path.dirname(candidateReportPath), { recursive: true });
    await writeFile(candidateReportPath, `${JSON.stringify({
      failureReason: redactedReport.failureReason,
      failedSegmentId: redactedReport.failedSegmentId,
      failedAction: redactedReport.failedAction,
      candidates: redactedReport.candidates,
      screenshotPath: redactedReport.screenshotPath,
    }, null, 2)}\n`);
  }

  await writeFile(reportPath, `${JSON.stringify(redactedReport, null, 2)}\n`);
  return { runReportPath: reportPath, candidateReportPath };
}

export async function writePreflightReport(
  report: PreflightReport,
  reportPath = createRunArtifacts(report.outputDir).preflightReportPath,
): Promise<string> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const reportWithPath: PreflightReport = { ...report, failedAction: redactBrowserAction(report.failedAction), preflightReportPath: reportPath };
  await writeFile(reportPath, `${JSON.stringify(reportWithPath, null, 2)}\n`);
  return reportPath;
}

export interface CandidateReport {
  outputDir: string;
  candidateReportPath?: string;
  checks: PreflightCheck[];
}

export async function writeCandidateReport(
  report: CandidateReport,
  reportPath = createRunArtifacts(report.outputDir).candidateReportPath,
): Promise<string> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const reportWithPath: CandidateReport = { ...report, candidateReportPath: reportPath };
  await writeFile(reportPath, `${JSON.stringify(reportWithPath, null, 2)}\n`);
  return reportPath;
}
