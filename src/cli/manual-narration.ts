import { fileURLToPath } from 'node:url';

import {
  applyNarrationAgentResponse,
  approveNarrationVersion,
  prepareNarrationAgentRequest,
} from '../lib/video-generator/manual/narration-response.js';

export async function runManualNarrationCli(
  argv: string[],
  io: { stdout?: (message: string) => void; stderr?: (message: string) => void } = {},
): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  let runDir: string | undefined;
  let responsePath: string | undefined;
  let approveVersion: number | undefined;
  let prepare = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--prepare-agent') { prepare = true; continue; }
    if (arg === '--run' || arg === '--apply-agent-response' || arg === '--approve-version') {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) { stderr(`${arg} requires a value.`); return 1; }
      if (arg === '--run') runDir = value;
      if (arg === '--apply-agent-response') responsePath = value;
      if (arg === '--approve-version') approveVersion = Number(value);
      continue;
    }
    stderr(`Unknown argument: ${arg}`);
    return 1;
  }
  if (runDir === undefined || [prepare, responsePath !== undefined, approveVersion !== undefined].filter(Boolean).length !== 1) {
    stderr('Usage: video:narration -- --run <run> (--prepare-agent | --apply-agent-response <path> | --approve-version <N>)');
    return 1;
  }
  try {
    if (prepare) {
      const result = await prepareNarrationAgentRequest({ runDir });
      stdout(`Narration request: ${result.requestPath}`);
    } else if (responsePath !== undefined) {
      const result = await applyNarrationAgentResponse({ runDir, responsePath });
      stdout(`Narration: ${result.narrationPath}`);
    } else {
      if (!Number.isInteger(approveVersion) || approveVersion! < 1) throw new Error('--approve-version must be a positive integer.');
      const result = await approveNarrationVersion({ runDir, version: approveVersion! });
      stdout(`Approved narration: ${result.narrationPath}`);
    }
    return 0;
  } catch (error) {
    stderr(`Manual narration failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runManualNarrationCli(process.argv.slice(2));
}
