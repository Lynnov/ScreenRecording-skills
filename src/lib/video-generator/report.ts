import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RunReport } from './types.js';

export async function writeRunReport(report: RunReport): Promise<string> {
  await mkdir(report.outputDir, { recursive: true });
  const reportPath = path.join(report.outputDir, 'run-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}
