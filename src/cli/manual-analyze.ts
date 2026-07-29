import { fileURLToPath } from 'node:url';
import { applyEditAgentResponse, prepareEditAgentRequest, type ApplyEditAgentResponseResult, type PrepareEditAgentRequestResult } from '../lib/video-generator/manual/edit-request.js';

export interface ManualAnalyzeCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  prepare?: (input: { runDir: string; segmentId?: string }) => Promise<PrepareEditAgentRequestResult>;
  apply?: (input: { runDir: string; responsePath: string }) => Promise<ApplyEditAgentResponseResult>;
}

interface ParsedArgs {
  runDir?: string;
  segmentId?: string;
  prepareAgent?: boolean;
  applyResponsePath?: string;
  error?: string;
}

export async function runManualAnalyzeCli(argv: string[], io: ManualAnalyzeCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) { stderr(`${parsed.error}\n${usage()}`); return 1; }
  if (parsed.runDir === undefined) { stderr(`--run is required.\n${usage()}`); return 1; }
  const modeCount = [parsed.prepareAgent, parsed.applyResponsePath !== undefined].filter(Boolean).length;
  if (modeCount !== 1) { stderr(`Choose exactly one analyze mode.\n${usage()}`); return 1; }
  try {
    if (parsed.prepareAgent === true) {
      const result = await (io.prepare ?? prepareEditAgentRequest)({ runDir: parsed.runDir, segmentId: parsed.segmentId });
      stdout(`Manual edit agent request prepared.\nRequest: ${result.requestPath}`);
      return 0;
    }
    const result = await (io.apply ?? applyEditAgentResponse)({ runDir: parsed.runDir, responsePath: parsed.applyResponsePath! });
    stdout(`Manual edit agent response applied.\nPlan: ${result.planPath}\nReport: ${result.reportPath}`);
    return 0;
  } catch (error) {
    stderr(`Manual analyze failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run' || arg === '--segment' || arg === '--apply-agent-response') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} requires a value` };
      if (arg === '--run') parsed.runDir = value;
      if (arg === '--segment') parsed.segmentId = value;
      if (arg === '--apply-agent-response') parsed.applyResponsePath = value;
      index += 1;
      continue;
    }
    if (arg === '--prepare-agent') { parsed.prepareAgent = true; continue; }
    return { error: `Unknown argument: ${arg}` };
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run video:analyze -- --run <run-dir> --prepare-agent [--segment <segment-id>]',
    '  npm run video:analyze -- --run <run-dir> --apply-agent-response <run-dir>/agent/edit-response.vNN.json',
  ].join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runManualAnalyzeCli(process.argv.slice(2));
}
