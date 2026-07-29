import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createManualBundle } from '../lib/video-generator/manual/bundle.js';

export interface ManualReviewCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  launch?: (runDir: string) => Promise<void>;
}

export async function runManualReviewCli(argv: string[], io: ManualReviewCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const runIndex = argv.indexOf('--run');
  const runDir = runIndex === -1 ? undefined : argv[runIndex + 1];
  if (runDir === undefined || runDir.startsWith('--')) {
    stderr('Usage: npm run video:review -- --run <run-dir>');
    return 1;
  }
  try {
    await verifyReviewInputs(runDir);
    await (io.launch ?? launchReviewUi)(runDir);
    stdout(`Manual review UI opened: ${runDir}`);
    return 0;
  } catch (error) {
    stderr(`Manual review failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function verifyReviewInputs(runDir: string): Promise<void> {
  const bundle = createManualBundle(runDir);
  try {
    await access(bundle.agentCurrentPlanPath);
  } catch {
    throw new Error(`Manual review requires an agent plan current pointer: ${bundle.agentCurrentPlanPath}`);
  }
  try {
    await access(bundle.previewVideoPath);
  } catch {
    throw new Error(`Manual review requires preview video: ${bundle.previewVideoPath}`);
  }
}

async function launchReviewUi(runDir: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const electronPath = require('electron') as string;
  const child = spawn(electronPath, ['dist/manual-recording/src/lib/video-generator/review-ui/main.js', '--run', runDir], { stdio: 'inherit', windowsHide: false });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => resolve());
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runManualReviewCli(process.argv.slice(2));
}
