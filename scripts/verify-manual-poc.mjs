import { spawn } from 'node:child_process';
import path from 'node:path';

const kind = process.argv[2];
const defaults = {
  capture: { runDir: 'video-runs/manual-poc-borderless-100', test: 'tests/video-generator/manual-window-capture-poc.test.ts' },
  clock: { runDir: 'video-runs/manual-clock-markers', test: 'tests/video-generator/manual-clock-poc.test.ts' },
  'clock-long': { runDir: 'video-runs/manual-clock-30m', test: 'tests/video-generator/manual-clock-long-poc.test.ts' },
  events: { runDir: 'video-runs/manual-events-poc', test: 'tests/video-generator/manual-events-poc.test.ts' },
};

if (!(kind in defaults)) {
  console.error('Usage: node scripts/verify-manual-poc.mjs capture|clock|clock-long|events');
  process.exit(2);
}

const config = defaults[kind];
const runDir = path.resolve(process.env.MANUAL_POC_RUN ?? config.runDir);
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', config.test], {
  stdio: 'inherit',
  env: { ...process.env, MANUAL_POC_RUN: runDir },
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
