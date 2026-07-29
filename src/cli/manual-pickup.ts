import { fileURLToPath } from 'node:url';

import {
  runManualPickupController,
  type ManualPickupControllerInput,
  type ManualPickupControllerResult,
} from '../lib/video-generator/manual/pickup-controller.js';
import type { ManualRecordDisplayMode } from '../lib/video-generator/manual/record-controller.js';
import {
  launchManualElectronChild,
  type ManualElectronChildLauncher,
} from '../lib/video-generator/manual/electron-child.js';
import { createManualBundle } from '../lib/video-generator/manual/bundle.js';
import path from 'node:path';

export interface ManualPickupCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  pickup?: (input: Omit<ManualPickupControllerInput, 'deps'>) => Promise<ManualPickupControllerResult>;
  launchChild?: ManualElectronChildLauncher;
}

interface ParsedArgs {
  runDir?: string;
  segmentId?: string;
  displayMode?: ManualRecordDisplayMode;
  error?: string;
}

export async function runManualPickupCli(argv: string[], io: ManualPickupCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    stderr(`${parsed.error}\n${usage()}`);
    return 1;
  }
  const missing = [
    parsed.runDir === undefined ? '--run' : null,
    parsed.segmentId === undefined ? '--segment' : null,
    parsed.displayMode === undefined ? '--display-mode' : null,
  ].filter((flag): flag is string => flag !== null);
  if (missing.length > 0) {
    stderr(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.\n${usage()}`);
    return 1;
  }

  try {
    if (io.pickup === undefined) {
      const runDir = path.resolve(parsed.runDir!);
      const child = await (io.launchChild ?? launchManualElectronChild)({
        mode: 'pickup',
        runDir,
        segmentId: parsed.segmentId!,
        displayMode: parsed.displayMode!,
      });
      if (child.exitCode !== 0) {
        stderr([
          `Manual pickup failed for ${parsed.segmentId}.`,
          `Report: ${createManualBundle(runDir).reportPath('manual-run-report')}`,
        ].join('\n'));
      }
      return child.exitCode;
    }
    const controllerInput = {
      runDir: parsed.runDir!,
      segmentId: parsed.segmentId!,
      displayMode: parsed.displayMode!,
    };
    const result = await io.pickup(controllerInput);
    if (!result.ok) {
      stderr([
        `Manual pickup failed for ${parsed.segmentId}.`,
        result.errorMessage,
        `Failed source: ${result.sourceId}`,
        nextSteps(parsed.runDir!, parsed.segmentId!),
      ].join('\n'));
      return 1;
    }
    stdout([
      `Manual pickup completed for ${parsed.segmentId}.`,
      `Source: ${result.sourceId}`,
      `Source catalog: ${result.sourceCatalogPath}`,
      'The Segment remains pickup-required; pickup never auto-approves review.',
      nextSteps(parsed.runDir!, parsed.segmentId!),
    ].join('\n'));
    return 0;
  } catch (error) {
    stderr(`Manual pickup failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function nextSteps(runDir: string, segmentId: string): string {
  return [
    'Re-run the required Segment checks:',
    `  npm run video:analyze -- --run ${runDir} --prepare-agent --segment ${segmentId}`,
    `  npm run video:preview -- --run ${runDir} --plan agent`,
    `  npm run video:review -- --run ${runDir}`,
  ].join('\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run' || arg === '--segment' || arg === '--display-mode') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} requires a value` };
      if (arg === '--run') parsed.runDir = value;
      if (arg === '--segment') parsed.segmentId = value;
      if (arg === '--display-mode') {
        if (value !== 'f11' && value !== 'borderless-maximized') {
          return { error: `Invalid --display-mode: ${value}` };
        }
        parsed.displayMode = value;
      }
      index += 1;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  return parsed;
}

function usage(): string {
  return 'Usage: npm run video:pickup -- --run <run-dir> --segment <segment-id> --display-mode f11|borderless-maximized';
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runManualPickupCli(process.argv.slice(2));
}
