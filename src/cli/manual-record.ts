import { fileURLToPath } from 'node:url';

import {
  loadApprovedGuide,
  runManualRecordController,
  type ManualRecordControllerInput,
  type ManualRecordControllerResult,
  type ManualRecordDisplayMode,
} from '../lib/video-generator/manual/record-controller.js';
import { recoverManualRecording, type RecoverManualRecordingResult } from '../lib/video-generator/manual/recovery.js';
import {
  launchManualElectronChild,
  type ManualElectronChildLauncher,
} from '../lib/video-generator/manual/electron-child.js';
import { createManualBundle } from '../lib/video-generator/manual/bundle.js';
import path from 'node:path';

export interface ManualRecordCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  record?: (input: ManualRecordCliRecordInput) => Promise<ManualRecordControllerResult>;
  recover?: (input: { runDir: string }) => Promise<RecoverManualRecordingResult>;
  launchChild?: ManualElectronChildLauncher;
}

export interface ManualRecordCliRecordInput {
  runDir: string;
  displayMode: ManualRecordDisplayMode;
  recover: false;
}

interface ParsedArgs {
  runDir?: string;
  displayMode?: ManualRecordDisplayMode;
  recover?: boolean;
  error?: string;
}

export async function runManualRecordCli(argv: string[], io: ManualRecordCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    stderr(`${parsed.error}\n${usage()}`);
    return 1;
  }
  if (parsed.runDir === undefined) {
    stderr(`--run is required.\n${usage()}`);
    return 1;
  }

  if (parsed.recover === true) {
    try {
      const result = await (io.recover ?? recoverManualRecording)({ runDir: parsed.runDir });
      stdout(`Manual recording recovery report: ${result.reportPath}`);
      return 0;
    } catch (error) {
      stderr(`Manual recording recovery failed.\n${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  if (parsed.displayMode === undefined) {
    stderr(`--display-mode is required unless --recover is used.\n${usage()}`);
    return 1;
  }

  try {
    await loadApprovedGuide(parsed.runDir);
  } catch (error) {
    stderr(`Manual recording requires an approved guide.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  try {
    if (io.record === undefined) {
      const runDir = path.resolve(parsed.runDir);
      const child = await (io.launchChild ?? launchManualElectronChild)({
        mode: 'recording',
        runDir,
        displayMode: parsed.displayMode,
      });
      if (child.exitCode !== 0) {
        stderr(`Manual recording failed.\nReport: ${createManualBundle(runDir).reportPath('manual-run-report')}`);
      }
      return child.exitCode;
    }
    const input: ManualRecordCliRecordInput = { runDir: parsed.runDir, displayMode: parsed.displayMode, recover: false };
    const record = io.record;
    const result = await record(input);
    if (!result.ok) {
      stderr(`Manual recording failed.\n${result.errorMessage}\nManifest: ${result.manifestPath}`);
      return 1;
    }
    stdout(`Manual recording completed.\nManifest: ${result.manifestPath}\nSource catalog: ${result.sourceCatalogPath}`);
    return 0;
  } catch (error) {
    stderr(`Manual recording failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') {
      const value = readFlagValue(argv, index, '--run');
      if (value.error !== undefined) return { error: value.error };
      parsed.runDir = value.value;
      index += 1;
      continue;
    }
    if (arg === '--display-mode') {
      const value = readFlagValue(argv, index, '--display-mode');
      if (value.error !== undefined) return { error: value.error };
      if (value.value !== 'f11' && value.value !== 'borderless-maximized') {
        return { error: `Invalid --display-mode: ${value.value}` };
      }
      parsed.displayMode = value.value;
      index += 1;
      continue;
    }
    if (arg === '--recover') {
      parsed.recover = true;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): { value: string; error?: undefined } | { value?: undefined; error: string } {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return { error: `${flag} requires a value` };
  return { value };
}

function usage(): string {
  return [
    'Usage:',
    '  npm run video:record -- --run <run-dir> --display-mode f11|borderless-maximized',
    '  npm run video:record -- --run <run-dir> --recover',
  ].join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const exitCode = await runManualRecordCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
