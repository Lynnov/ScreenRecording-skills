import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);

export function buildManualRecordingSpawn({
  electronPath,
  entryPath,
  mode,
  runDir,
  displayMode,
  segmentId,
}) {
  const args = [
    entryPath,
    '--mode', mode,
    '--run', path.resolve(runDir),
    '--display-mode', displayMode,
  ];
  if (segmentId !== undefined) args.push('--segment', segmentId);
  return {
    command: electronPath,
    args,
    options: { stdio: 'inherit', windowsHide: false },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = (flag) => {
    const index = process.argv.indexOf(flag);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const electronPath = require('electron');
  const entryPath = path.resolve('dist/manual-recording');
  const childConfig = buildManualRecordingSpawn({
    electronPath,
    entryPath,
    mode: value('--mode'),
    runDir: value('--run'),
    displayMode: value('--display-mode'),
    segmentId: value('--segment'),
  });
  const child = spawn(childConfig.command, childConfig.args, childConfig.options);
  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
