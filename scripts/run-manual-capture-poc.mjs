import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function formatManualCapturePocRunnerLogStep(message) {
  return `[manual-poc-runner] ${message}`;
}

function logStep(message) {
  console.log(formatManualCapturePocRunnerLogStep(message));
}

export function buildManualCapturePocSpawn({ electronPath, entryPath, argv }) {
  return {
    command: electronPath,
    args: [entryPath, ...argv],
    options: { stdio: 'inherit', windowsHide: false },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const electronPath = require('electron');
  const entryPath = 'dist/manual-recording-poc/pocs/manual-recording/capture-main.js';
  logStep(`resolved Electron executable: ${electronPath}`);
  logStep(`using entry: ${entryPath}`);
  const childConfig = buildManualCapturePocSpawn({ electronPath, entryPath, argv: process.argv.slice(2) });
  logStep(`spawning Electron with ${childConfig.args.length} argument(s)`);
  const child = spawn(childConfig.command, childConfig.args, childConfig.options);
  logStep(`Electron child pid: ${child.pid ?? 'unavailable'}`);

  child.on('exit', (code, signal) => {
    logStep(`Electron child exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
