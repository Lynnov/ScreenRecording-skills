import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { RunCommand } from '../audio.js';
import type { TimeInterval } from './fine-edit-plan.js';

const execFileAsync = promisify(execFile);
const defaultRunCommand: RunCommand = async (command, args) => execFileAsync(command, args);

export function parseWhiteScreenIntervals(output: string): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  const pattern = /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g;
  for (const match of output.matchAll(pattern)) {
    const startMs = Math.round(Number(match[1]) * 1000);
    const endMs = Math.round(Number(match[2]) * 1000);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      intervals.push({ startMs, endMs, confidence: 'high' });
    }
  }
  return intervals;
}

export async function detectWhiteScreenIntervals(input: {
  sourcePath: string;
  whiteFrameRatio: number;
  runCommand?: RunCommand;
}): Promise<TimeInterval[]> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const filter = `crop=iw:ih-80:0:80,negate,blackdetect=d=0.3:pix_th=0.10:pic_th=${input.whiteFrameRatio}`;
  const result = await runCommand('ffmpeg', [
    '-hide_banner', '-nostats', '-i', input.sourcePath,
    '-vf', filter,
    '-an', '-f', 'null', '-',
  ]);
  return parseWhiteScreenIntervals(`${result.stdout}\n${result.stderr}`);
}
