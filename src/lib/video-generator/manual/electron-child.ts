import { spawn } from 'node:child_process';
import path from 'node:path';

import type { ManualRecordDisplayMode } from './record-controller.js';

export interface ManualElectronChildInput {
  mode: 'recording' | 'pickup';
  runDir: string;
  displayMode: ManualRecordDisplayMode;
  segmentId?: string;
}

export interface ManualElectronChildResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export type ManualElectronChildLauncher = (
  input: ManualElectronChildInput,
) => Promise<ManualElectronChildResult>;

export function launchManualElectronChild(
  input: ManualElectronChildInput,
): Promise<ManualElectronChildResult> {
  const runnerPath = path.resolve('scripts/run-manual-recording.mjs');
  const args = [
    runnerPath,
    '--mode', input.mode,
    '--run', path.resolve(input.runDir),
    '--display-mode', input.displayMode,
  ];
  if (input.segmentId !== undefined) args.push('--segment', input.segmentId);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => {
      resolve({ exitCode: exitCode ?? 1, signal });
    });
  });
}
