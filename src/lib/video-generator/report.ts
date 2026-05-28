import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { redactBrowserAction } from './action-redaction.js';
import { createRunArtifacts } from './artifacts.js';
import type { PreflightCheck, PreflightReport, RunReport } from './types.js';

export async function writeRunReport(report: RunReport, reportPath = createRunArtifacts(report.outputDir).runReportPath): Promise<string> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const redactedReport: RunReport = { ...report, failedAction: redactBrowserAction(report.failedAction) };
  await writeFile(reportPath, `${JSON.stringify(redactedReport, null, 2)}\n`);
  return reportPath;
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
