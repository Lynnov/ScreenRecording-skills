import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface RunArtifacts {
  outputDir: string;
  scriptsDir: string;
  authDir: string;
  clipsDir: string;
  audioDir: string;
  screenshotsDir: string;
  reportsDir: string;
  debugDir: string;
  preflightReportPath: string;
  runReportPath: string;
  candidateReportPath: string;
  debugAttemptPath: (attemptNumber: number) => string;
}

export function createRunArtifacts(outputDir: string): RunArtifacts {
  const reportsDir = path.join(outputDir, 'reports');
  const debugDir = path.join(outputDir, 'debug');

  return {
    outputDir,
    scriptsDir: path.join(outputDir, 'scripts'),
    authDir: path.join(outputDir, 'auth'),
    clipsDir: path.join(outputDir, 'clips'),
    audioDir: path.join(outputDir, 'audio'),
    screenshotsDir: path.join(outputDir, 'screenshots'),
    reportsDir,
    debugDir,
    preflightReportPath: path.join(reportsDir, 'preflight-report.json'),
    runReportPath: path.join(reportsDir, 'run-report.json'),
    candidateReportPath: path.join(reportsDir, 'candidate-report.json'),
    debugAttemptPath: (attemptNumber: number) => path.join(debugDir, `attempt-${String(attemptNumber).padStart(3, '0')}`),
  };
}

export async function ensureRunArtifactDirs(artifacts: RunArtifacts): Promise<void> {
  await Promise.all([
    mkdir(artifacts.scriptsDir, { recursive: true }),
    mkdir(artifacts.authDir, { recursive: true }),
    mkdir(artifacts.clipsDir, { recursive: true }),
    mkdir(artifacts.audioDir, { recursive: true }),
    mkdir(artifacts.screenshotsDir, { recursive: true }),
    mkdir(artifacts.reportsDir, { recursive: true }),
    mkdir(artifacts.debugDir, { recursive: true }),
  ]);
}
