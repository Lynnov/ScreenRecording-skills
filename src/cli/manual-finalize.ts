import { fileURLToPath } from 'node:url';

import { finalizeManualRecording } from '../lib/video-generator/manual/final-report.js';

export async function runManualFinalizeCli(
  argv: string[],
  io: { stdout?: (message: string) => void; stderr?: (message: string) => void } = {},
): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  if (argv.length !== 2 || argv[0] !== '--run') {
    stderr('Usage: video:finalize -- --run <run-dir>');
    return 1;
  }
  const report = await finalizeManualRecording({ runDir: argv[1]! });
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
