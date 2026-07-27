import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { RunCommand } from '../audio.js';
import type { EditSource } from './types.js';

const execFileAsync = promisify(execFile);
const defaultRunCommand: RunCommand = async (command, args) => execFileAsync(command, args);

type ProbeRecord = Record<string, unknown>;

function record(value: unknown): ProbeRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as ProbeRecord
    : undefined;
}

function detail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  return ['message', 'stderr', 'stdout']
    .map((key) => (error as ProbeRecord)[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .join(' | ');
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim().length === 0)) {
    return undefined;
  }
  const number = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(number) ? number : undefined;
}

function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const [numeratorText, denominatorText] = value.split('/');
  const numerator = finiteNumber(numeratorText);
  const denominator = denominatorText === undefined ? 1 : finiteNumber(denominatorText);
  if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined;
  const fps = numerator / denominator;
  return fps > 0 ? fps : undefined;
}

export async function probeEditSource(
  id: string,
  sourcePath: string,
  runCommand: RunCommand = defaultRunCommand,
): Promise<EditSource> {
  try {
    const result = await runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration',
      '-of',
      'json',
      sourcePath,
    ]);
    if (result.stderr.trim().length > 0) {
      throw new Error(result.stderr.trim());
    }

    const output = record(JSON.parse(result.stdout));
    const streams = Array.isArray(output?.streams) ? output.streams : [];
    const video = streams.map(record).find((stream) => stream?.codec_type === 'video');
    if (video === undefined) {
      throw new Error(`No video stream found for ${sourcePath}`);
    }

    const durationSeconds = finiteNumber(record(output?.format)?.duration);
    if (durationSeconds === undefined || durationSeconds < 0) {
      throw new Error(`Invalid duration for ${sourcePath}`);
    }

    const width = finiteNumber(video.width);
    const height = finiteNumber(video.height);
    const fps = parseFrameRate(video.r_frame_rate);
    if (width === undefined || height === undefined || fps === undefined) {
      throw new Error(`Invalid video metadata for ${sourcePath}`);
    }

    return {
      id,
      path: sourcePath,
      durationMs: Math.round(durationSeconds * 1000),
      width,
      height,
      fps,
      codecName: typeof video.codec_name === 'string' ? video.codec_name : '',
      pixelFormat: typeof video.pix_fmt === 'string' ? video.pix_fmt : '',
      hasAudio: streams.map(record).some((stream) => stream?.codec_type === 'audio'),
    };
  } catch (error) {
    const diagnostics = detail(error);
    throw new Error(
      `Failed to probe edit source ${sourcePath}${diagnostics.length > 0 ? `: ${diagnostics}` : ''}`,
      { cause: error },
    );
  }
}
