import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VideoGeneratorError, type BrowserAction, type PreflightReport, type RunReport } from './types.js';

export async function writeRunReport(report: RunReport): Promise<string> {
  assertOutputDir(report.outputDir);
  await mkdir(report.outputDir, { recursive: true });
  const reportPath = path.join(report.outputDir, 'run-report.json');
  await writeFile(reportPath, `${JSON.stringify(redactRunReport(report), null, 2)}\n`);
  return reportPath;
}

export async function writePreflightReport(report: PreflightReport): Promise<string> {
  assertOutputDir(report.outputDir);
  await mkdir(report.outputDir, { recursive: true });
  const reportPath = path.join(report.outputDir, 'preflight-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

function redactRunReport(report: RunReport): RunReport {
  return {
    ...report,
    failedAction: report.failedAction === undefined ? undefined : redactAction(report.failedAction),
  };
}

function redactAction(action: BrowserAction): BrowserAction {
  if (action.type === 'fill') {
    return { ...action, value: '[REDACTED]' };
  }

  if (action.type === 'remoteSelect') {
    return { ...action, keyword: '[REDACTED]' };
  }

  return action;
}

function assertOutputDir(outputDir: string): void {
  if (outputDir.trim().length === 0) {
    throw new VideoGeneratorError('INVALID_OUTPUT_DIR', 'Output directory must not be empty.');
  }
}
