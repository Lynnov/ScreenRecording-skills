import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { VideoGeneratorError } from './types.js';

const execFileAsync = promisify(execFile);

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

export interface MergeAudioSegmentsInput {
  audioPaths: string[];
  outputPath: string;
  segments?: Array<{
    id: string;
    startsAtMs?: number;
    endsAtMs?: number;
    actualAudioDurationMs?: number;
  }>;
  runCommand?: RunCommand;
}

const defaultRunCommand: RunCommand = async (command, args) => execFileAsync(command, args);

function readStringProperty(value: unknown, property: 'message' | 'stdout' | 'stderr'): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const propertyValue = (value as Record<typeof property, unknown>)[property];
  return typeof propertyValue === 'string' && propertyValue.trim() ? propertyValue.trim() : undefined;
}

function formatFfprobeFailureMessage(audioPath: string, error: unknown): string {
  return [
    `Failed to read audio duration with ffprobe for ${audioPath}.`,
    'Please install ffmpeg/ffprobe and ensure the audio file is readable.',
    formatCommandDetails('ffprobe', error),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

function formatAudioMergeFailureMessage(audioPath: string, error: unknown): string {
  return [
    `Failed to merge narration audio at ${audioPath}.`,
    'Please install ffmpeg and ensure synthesized audio files are readable.',
    formatCommandDetails('ffmpeg', error),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

function formatCommandDetails(command: string, error: unknown): string | undefined {
  const details = [
    readStringProperty(error, 'message'),
    readStringProperty(error, 'stderr'),
    readStringProperty(error, 'stdout'),
  ]
    .filter((detail): detail is string => detail !== undefined)
    .map((detail) => detail.replace(/\s+/g, ' ').slice(0, 500));

  return details.length > 0 ? `${command} details: ${details.join(' | ')}` : undefined;
}

function escapeConcatPath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replaceAll("'", "'\\''");
}

function concatListPathFor(filePath: string, concatListDir: string): string {
  return path.relative(concatListDir, filePath) || path.basename(filePath);
}

function timelineDurationMs(segment: NonNullable<MergeAudioSegmentsInput['segments']>[number]): number | undefined {
  if (segment.startsAtMs === undefined || segment.endsAtMs === undefined) {
    return undefined;
  }

  return Math.max(0, segment.endsAtMs - segment.startsAtMs);
}

function silenceDurationSeconds(segment: NonNullable<MergeAudioSegmentsInput['segments']>[number]): number {
  return Math.max(0, ((timelineDurationMs(segment) ?? 0) - (segment.actualAudioDurationMs ?? 0)) / 1000);
}

async function padAudioSegment(input: {
  audioPath: string;
  segment: NonNullable<MergeAudioSegmentsInput['segments']>[number];
  outputDir: string;
  runCommand: RunCommand;
}): Promise<string> {
  const silenceSeconds = silenceDurationSeconds(input.segment);
  if (silenceSeconds <= 0) {
    return input.audioPath;
  }

  const paddedPath = path.join(input.outputDir, `${input.segment.id}-padded.wav`);
  await input.runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input.audioPath,
    '-f',
    'lavfi',
    '-t',
    Number(silenceSeconds.toFixed(3)).toString(),
    '-i',
    'anullsrc=r=48000:cl=mono',
    '-filter_complex',
    '[0:a][1:a]concat=n=2:v=0:a=1[a]',
    '-map',
    '[a]',
    '-y',
    paddedPath,
  ]);
  return paddedPath;
}

export async function mergeAudioSegments(input: MergeAudioSegmentsInput): Promise<string> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const concatListPath = path.join(path.dirname(input.outputPath), 'narration-concat-list.txt');

  await mkdir(path.dirname(input.outputPath), { recursive: true });

  try {
    const paddedAudioPaths = input.segments === undefined
      ? input.audioPaths
      : await Promise.all(input.audioPaths.map((audioPath, index) => {
        const segment = input.segments?.[index];
        return segment === undefined
          ? audioPath
          : padAudioSegment({ audioPath, segment, outputDir: path.dirname(input.outputPath), runCommand });
      }));

    await writeFile(concatListPath, paddedAudioPaths.map((audioPath) => `file '${escapeConcatPath(concatListPathFor(audioPath, path.dirname(concatListPath)))}'`).join('\n') + '\n');
    await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      '-y',
      input.outputPath,
    ]);
  } catch (error) {
    throw new VideoGeneratorError('FFMPEG_FAILED', formatAudioMergeFailureMessage(input.outputPath, error));
  }

  return input.outputPath;
}

export async function getAudioDurationMs(
  audioPath: string,
  runCommand: RunCommand = defaultRunCommand,
): Promise<number> {
  try {
    const result = await runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    const seconds = Number.parseFloat(result.stdout.trim());

    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`Invalid ffprobe duration output: ${result.stdout}`);
    }

    return Math.round(seconds * 1000);
  } catch (error) {
    throw new VideoGeneratorError('FFPROBE_FAILED', formatFfprobeFailureMessage(audioPath, error));
  }
}
