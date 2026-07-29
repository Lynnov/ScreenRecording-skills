import { execFile } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RunCommand } from './audio.js';
import { buildEditFiltergraph } from './editing/filtergraph.js';
import type { EditPlan, EditSource } from './editing/types.js';
import { VideoGeneratorError, type Timeline } from './types.js';

const execFileAsync = promisify(execFile);
const defaultRunCommand: RunCommand = async (command, args) => execFileAsync(command, args);

export interface RenderFinalVideoInput {
  timeline: Timeline;
  outputDir: string;
  audioPath?: string;
  subtitlesPath?: string;
  runCommand?: RunCommand;
}

export interface RenderManualFinalVideoInput {
  plan: EditPlan;
  sources: readonly EditSource[];
  audioPath: string;
  subtitlesPath: string;
  outputPath: string;
  runCommand?: RunCommand;
}

export interface ProbedFinalVideo {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codecName: string;
}

export async function assertFfmpegAvailable(runCommand: RunCommand = defaultRunCommand): Promise<void> {
  try {
    await runCommand('ffmpeg', ['-version']);
  } catch (error) {
    throw new VideoGeneratorError('FFMPEG_FAILED', formatFfmpegFailureMessage('Failed to run ffmpeg.', error));
  }
}

export async function renderFinalVideo(input: RenderFinalVideoInput): Promise<string> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const finalVideoPath = path.join(input.outputDir, 'final.mp4');
  const concatListPath = path.join(input.outputDir, 'concat-list.txt');
  const continuousClipPath = input.timeline.assets?.continuousClipPath;
  const clipPaths = continuousClipPath !== undefined
    ? [continuousClipPath]
    : input.timeline.segments.map((segment) => {
        if (segment.assets.clipPath === undefined) {
          throw new VideoGeneratorError('FFMPEG_FAILED', `Cannot render final video because segment ${segment.id} is missing a clip path.`);
        }

        return segment.assets.clipPath;
      });

  await assertFfmpegAvailable(runCommand);
  await mkdir(input.outputDir, { recursive: true });
  await writeFile(concatListPath, clipPaths.map((clipPath) => `file '${escapeConcatPath(clipPath)}'`).join('\n') + '\n');

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
  ];

  if (continuousClipPath === undefined) {
    args.push(
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
    );
  } else {
    args.push('-i', continuousClipPath);
  }

  if (input.audioPath !== undefined) {
    args.push('-i', input.audioPath);
  }

  const filterComplex = buildFilterComplex(input.timeline, input.subtitlesPath);
  if (filterComplex !== undefined) {
    args.push('-filter_complex', filterComplex, '-map', '[v]');
    if (input.audioPath !== undefined) {
      args.push('-map', '1:a');
    }
  } else {
    const videoFilters = buildVideoFilters(input.subtitlesPath);
    if (videoFilters.length > 0) {
      args.push('-vf', videoFilters.join(','));
    }
  }

  args.push('-c:v', 'libx264');

  if (input.audioPath !== undefined) {
    args.push('-c:a', 'aac', '-shortest');
  } else {
    args.push('-an');
  }

  args.push('-y', finalVideoPath);

  try {
    await runCommand('ffmpeg', args);
  } catch (error) {
    throw new VideoGeneratorError('FFMPEG_FAILED', formatFfmpegFailureMessage(`Failed to render final video at ${finalVideoPath}.`, error));
  }

  return finalVideoPath;
}

export async function renderManualFinalVideo(input: RenderManualFinalVideoInput): Promise<string> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const built = buildEditFiltergraph(input.plan, input.sources);
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const temporaryPath = `${input.outputPath}.tmp.mp4`;
  const args = ['-hide_banner', '-loglevel', 'error'];
  for (const sourceId of built.inputSourceIds) args.push('-i', sourceById.get(sourceId)!.path);
  args.push('-i', input.audioPath);
  const outputLabel = '[manual-final-video]';
  args.push(
    '-filter_complex',
    `${built.filterComplex};${built.outputLabel}subtitles='${escapeFilterPath(input.subtitlesPath)}'${outputLabel}`,
    '-map',
    outputLabel,
    '-map',
    `${built.inputSourceIds.length}:a`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-shortest',
    '-y',
    temporaryPath,
  );
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });
  try {
    const result = await runCommand('ffmpeg', args);
    if (result.stderr.trim().length > 0) throw Object.assign(new Error('ffmpeg failed'), result);
    await rename(temporaryPath, input.outputPath);
    return input.outputPath;
  } catch (error) {
    await Promise.allSettled([rm(temporaryPath, { force: true }), rm(input.outputPath, { force: true })]);
    throw new VideoGeneratorError('FFMPEG_FAILED', formatFfmpegFailureMessage(`Failed to render manual final video at ${input.outputPath}.`, error));
  }
}

export async function probeFinalVideo(
  filePath: string,
  runCommand: RunCommand = defaultRunCommand,
): Promise<ProbedFinalVideo> {
  try {
    const result = await runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration',
      '-of', 'json',
      filePath,
    ]);
    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
      format?: { duration?: string };
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
    const fpsParts = video?.r_frame_rate?.split('/').map(Number);
    const fps = fpsParts?.length === 2 && fpsParts[1] !== 0 ? fpsParts[0]! / fpsParts[1]! : Number.NaN;
    if (!video || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(fps)) throw new Error('invalid final media metadata');
    return {
      durationMs,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps,
      codecName: video.codec_name ?? '',
    };
  } catch (error) {
    throw new VideoGeneratorError('FFPROBE_FAILED', formatFfmpegFailureMessage(`Failed to verify final video at ${filePath}.`, error));
  }
}

function buildFilterComplex(timeline: Timeline, subtitlesPath: string | undefined): string | undefined {
  if (timeline.assets?.continuousClipPath === undefined || !timeline.segments.every((segment) => segment.assets.videoStartMs !== undefined && segment.assets.videoEndMs !== undefined)) {
    return undefined;
  }

  const trimFilters = timeline.segments.map((segment, index) => `[0:v]trim=start=${formatSeconds(segment.assets.videoStartMs as number)}:end=${formatSeconds(segment.assets.videoEndMs as number)},setpts=PTS-STARTPTS[v${index}]`);
  const concatFilter = `${timeline.segments.map((_segment, index) => `[v${index}]`).join('')}concat=n=${timeline.segments.length}:v=1:a=0[trimmed]`;
  const outputFilter = subtitlesPath === undefined
    ? '[trimmed]null[v]'
    : `[trimmed]subtitles=${escapeFilterPath(subtitlesPath)}[v]`;

  return [...trimFilters, concatFilter, outputFilter].join(';');
}

function buildVideoFilters(subtitlesPath: string | undefined): string[] {
  return subtitlesPath === undefined ? [] : [`subtitles=${escapeFilterPath(subtitlesPath)}`];
}

function formatSeconds(milliseconds: number): string {
  return String(milliseconds / 1000);
}

function escapeConcatPath(filePath: string): string {
  return normalizeFfmpegPath(filePath).replaceAll("'", "'\\''");
}

function escapeFilterPath(filePath: string): string {
  return normalizeFfmpegPath(filePath).replace(/[\\ :;,\[\]']/g, (character) => `\\${character}`);
}

function normalizeFfmpegPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function formatFfmpegFailureMessage(prefix: string, error: unknown): string {
  const details = [readStringProperty(error, 'message'), readStringProperty(error, 'stderr'), readStringProperty(error, 'stdout')]
    .filter((detail): detail is string => detail !== undefined)
    .map((detail) => detail.replace(/\s+/g, ' ').slice(0, 500));

  return [prefix, 'Please install ffmpeg and ensure input video, audio, and subtitle files are readable.', details.length > 0 ? `ffmpeg details: ${details.join(' | ')}` : undefined]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

function readStringProperty(value: unknown, property: 'message' | 'stdout' | 'stderr'): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const propertyValue = (value as Record<typeof property, unknown>)[property];
  return typeof propertyValue === 'string' && propertyValue.trim() ? propertyValue.trim() : undefined;
}
