import { fileURLToPath } from 'node:url';

import {
  applyGuideAgentResponse,
  approveRecordingGuideVersion,
  prepareGuideAgentRequest,
} from '../lib/video-generator/manual/guide-writer.js';

export interface ManualGuideCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
}

interface ParsedArgs {
  scriptPath?: string;
  outputDir?: string;
  runDir?: string;
  prepareAgent?: boolean;
  applyAgentResponsePath?: string;
  approveVersion?: number;
  error?: string;
}

export async function runManualGuideCli(argv: string[], io: ManualGuideCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const parsed = parseArgs(argv);

  if (parsed.error !== undefined) {
    stderr(`${parsed.error}\n${usage()}`);
    return 1;
  }

  const modeCount = [parsed.prepareAgent, parsed.applyAgentResponsePath !== undefined, parsed.approveVersion !== undefined]
    .filter(Boolean).length;
  if (modeCount !== 1) {
    stderr(`Choose exactly one guide mode.\n${usage()}`);
    return 1;
  }

  if (parsed.prepareAgent === true) {
    if (parsed.scriptPath === undefined || parsed.outputDir === undefined) {
      stderr(`--prepare-agent requires --script and --output.\n${usage()}`);
      return 1;
    }
    try {
      const result = await prepareGuideAgentRequest({
        sourceScriptPath: parsed.scriptPath,
        outputDir: parsed.outputDir,
      });
      stdout([
        'Manual guide agent request prepared.',
        `Request: ${result.requestPath}`,
        `Original: ${result.originalScriptPath}`,
        `Notice: ${result.businessDataNotice}`,
        'Business data notice: request includes local script text; keep the Agent session local/trusted.',
      ].join('\n'));
      return 0;
    } catch (error) {
      stderr(`Manual guide prepare failed.\n${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  if (parsed.applyAgentResponsePath !== undefined) {
    if (parsed.runDir === undefined) {
      stderr(`--apply-agent-response requires --run.\n${usage()}`);
      return 1;
    }
    try {
      const result = await applyGuideAgentResponse({
        runDir: parsed.runDir,
        responsePath: parsed.applyAgentResponsePath,
      });
      stdout([
        'Manual guide agent response applied.',
        `Polished: ${result.polishedPath}`,
        `Executable: ${result.executablePath}`,
        `Guide: ${result.guidePath}`,
        result.warnings.length === 0 ? undefined : `Warnings: ${result.warnings.join('; ')}`,
      ].filter((line): line is string => line !== undefined).join('\n'));
      return 0;
    } catch (error) {
      stderr(`Manual guide apply failed.\n${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  if (parsed.approveVersion !== undefined) {
    if (parsed.runDir === undefined) {
      stderr(`--approve-version requires --run.\n${usage()}`);
      return 1;
    }
    try {
      const result = await approveRecordingGuideVersion({
        runDir: parsed.runDir,
        version: parsed.approveVersion,
      });
      stdout([
        'Manual recording guide approved.',
        `Approved: ${parsed.runDir}/scripts/recording-guide.approved.json`,
        `Guide: ${result.guidePath}`,
      ].join('\n'));
      return 0;
    } catch (error) {
      stderr(`Manual guide approve failed.\n${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  stderr(usage());
  return 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--script') {
      const value = readFlagValue(argv, index, '--script');
      if (value.error !== undefined) return { error: value.error };
      parsed.scriptPath = value.value;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const value = readFlagValue(argv, index, '--output');
      if (value.error !== undefined) return { error: value.error };
      parsed.outputDir = value.value;
      index += 1;
      continue;
    }
    if (arg === '--run') {
      const value = readFlagValue(argv, index, '--run');
      if (value.error !== undefined) return { error: value.error };
      parsed.runDir = value.value;
      index += 1;
      continue;
    }
    if (arg === '--prepare-agent') {
      parsed.prepareAgent = true;
      continue;
    }
    if (arg === '--apply-agent-response') {
      const value = readFlagValue(argv, index, '--apply-agent-response');
      if (value.error !== undefined) return { error: value.error };
      parsed.applyAgentResponsePath = value.value;
      index += 1;
      continue;
    }
    if (arg === '--approve-version') {
      const value = readFlagValue(argv, index, '--approve-version');
      if (value.error !== undefined) return { error: value.error };
      const version = Number(value.value);
      if (!Number.isInteger(version) || version < 1) return { error: '--approve-version requires a positive integer' };
      parsed.approveVersion = version;
      index += 1;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): { value: string; error?: undefined } | { value?: undefined; error: string } {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return { error: `${flag} requires a value` };
  }
  return { value };
}

function usage(): string {
  return [
    'Usage:',
    '  npm run video:guide -- --script <script.md> --output <run-dir> --prepare-agent',
    '  npm run video:guide -- --run <run-dir> --apply-agent-response <run-dir>/agent/guide-response.vNN.json',
    '  npm run video:guide -- --run <run-dir> --approve-version <N>',
  ].join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const exitCode = await runManualGuideCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
