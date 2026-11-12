import { fileURLToPath } from 'node:url';

import { loadProjectEnv } from '../lib/video-generator/env.js';
import { finalizeManualRecording } from '../lib/video-generator/manual/final-report.js';

export interface ManualFinalizeCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  finalize?: typeof finalizeManualRecording;
}

export async function runManualFinalizeCli(
  argv: string[],
  io: ManualFinalizeCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  if (argv.length !== 2 || argv[0] !== '--run') {
    stderr('Usage: video:finalize -- --run <run-dir>');
    return 1;
  }
  const env = await loadProjectEnv(io.cwd, io.env);
  const report = await (io.finalize ?? finalizeManualRecording)({ runDir: argv[1]!, env });
  if (!report.ok) {
    stderr(`Manual finalize failed.\n${report.errorMessage ?? 'Unknown error'}`);
    return 1;
  }
  stdout(`Final video: ${report.finalVideoPath}`);
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runManualFinalizeCli(process.argv.slice(2));
}
