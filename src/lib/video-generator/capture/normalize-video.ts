import { rename, rm } from 'node:fs/promises';

import type { RunCommand } from '../audio.js';
import { assertFfmpegAvailable } from '../ffmpeg.js';

const VIDEO_FILTER = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';

export interface NormalizedVideoProbe {
  videoStreams: number;
  audioStreams: number;
  codecName: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  pixelFormat: string | null;
  durationMs: number;
}

export async function normalizeCapturedVideo(input: {
  inputPath: string;
  outputPath: string;
  runCommand: RunCommand;
}): Promise<void> {
  await assertFfmpegAvailable(input.runCommand);
  const tempPath = `${input.outputPath}.tmp.mp4`;
  try {
    await input.runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input.inputPath,
      '-vf',
      VIDEO_FILTER,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-movflags',
      '+faststart',
      '-an',
      '-y',
      tempPath,
    ]);
    const probe = await input.runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration',
      '-of',
      'json',
      tempPath,
    ]);
    parseNormalizedVideoProbe(probe.stdout);
    await rename(tempPath, input.outputPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new Error(formatCommandFailure('Failed to normalize captured video.', error));
  }
}

export function parseNormalizedVideoProbe(stdout: string): NormalizedVideoProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid ffprobe JSON for normalized capture: ${String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid ffprobe JSON for normalized capture: root must be an object.');
  }
  const root = parsed as { streams?: unknown; format?: { duration?: unknown } };
  if (!Array.isArray(root.streams)) {
    throw new Error('Invalid ffprobe JSON for normalized capture: streams must be an array.');
  }

  const streams = root.streams.filter((stream): stream is Record<string, unknown> => typeof stream === 'object' && stream !== null);
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const video = videoStreams[0];
  const durationSeconds = typeof root.format?.duration === 'string' ? Number(root.format.duration) : Number.NaN;
  if (!Number.isFinite(durationSeconds)) {
    throw new Error('Invalid ffprobe JSON for normalized capture: duration must be finite.');
  }

  const metadata: NormalizedVideoProbe = {
    videoStreams: videoStreams.length,
    audioStreams: audioStreams.length,
    codecName: stringField(video, 'codec_name'),
    width: numberField(video, 'width'),
    height: numberField(video, 'height'),
    fps: parseFps(stringField(video, 'r_frame_rate')),
    pixelFormat: stringField(video, 'pix_fmt'),
    durationMs: Math.round(durationSeconds * 1000),
  };

  if (
    metadata.videoStreams !== 1
    || metadata.audioStreams !== 0
    || metadata.codecName !== 'h264'
    || metadata.width !== 1920
    || metadata.height !== 1080
    || metadata.fps !== 30
    || metadata.pixelFormat !== 'yuv420p'
  ) {
    throw new Error(`Normalized capture has unexpected media structure: ${JSON.stringify(metadata)}`);
  }

  return metadata;
}

function stringField(value: Record<string, unknown> | undefined, field: string): string | null {
  const fieldValue = value?.[field];
  return typeof fieldValue === 'string' ? fieldValue : null;
}

function numberField(value: Record<string, unknown> | undefined, field: string): number | null {
  const fieldValue = value?.[field];
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : null;
}

function parseFps(rate: string | null): number | null {
  if (rate === null) {
    return null;
  }
  const [numeratorText, denominatorText] = rate.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function formatCommandFailure(prefix: string, error: unknown): string {
  const details = [readStringProperty(error, 'message'), readStringProperty(error, 'stderr'), readStringProperty(error, 'stdout')]
    .filter((detail): detail is string => detail !== undefined)
    .map((detail) => detail.replace(/\s+/g, ' ').slice(0, 500));

  return [prefix, details.length > 0 ? details.join(' | ') : undefined]
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
