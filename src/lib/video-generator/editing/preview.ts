import { execFile } from 'node:child_process';
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RunCommand } from '../audio.js';
import { buildEditFiltergraph } from './filtergraph.js';
import type { EditPlan, EditSource } from './types.js';

const execFileAsync = promisify(execFile);
const defaultRunCommand: RunCommand = async (command, args) => execFileAsync(command, args);
const MAX_STDERR_LENGTH = 4_000;

type UnknownRecord = Record<string, unknown>;

export interface PreviewFileOperations {
  access: typeof access;
  rename: typeof rename;
  unlink: typeof unlink;
  writeFile: typeof writeFile;
}

const defaultFileOperations: PreviewFileOperations = { access, rename, unlink, writeFile };

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;
}

function diagnosticStderr(error: unknown): string {
  const record = asRecord(error);
  const raw = typeof record?.stderr === 'string'
    ? record.stderr
    : typeof record?.message === 'string' ? record.message : String(error);
  const compact = raw.trim();
  return compact.length <= MAX_STDERR_LENGTH
    ? compact
    : `${compact.slice(0, MAX_STDERR_LENGTH)}… [truncated]`;
}

async function removeIfPresent(filePath: string, operations: PreviewFileOperations): Promise<void> {
  try {
    await operations.unlink(filePath);
  } catch (error) {
    if (asRecord(error)?.code !== 'ENOENT') throw error;
  }
}

async function exists(filePath: string, operations: PreviewFileOperations): Promise<boolean> {
  try {
    await operations.access(filePath);
    return true;
  } catch (error) {
    if (asRecord(error)?.code === 'ENOENT') return false;
    throw error;
  }
}

function validatePreviewProbe(stdout: string, expectedDurationMs: number): void {
  const parsed = asRecord(JSON.parse(stdout));
  const streams = Array.isArray(parsed?.streams) ? parsed.streams.map(asRecord) : [];
  const videos = streams.filter((stream) => stream?.codec_type === 'video');
  const audios = streams.filter((stream) => stream?.codec_type === 'audio');
  const video = videos[0];
  const durationSeconds = Number(asRecord(parsed?.format)?.duration);
  const oneFrameMs = 1000 / 30;
  if (
    videos.length !== 1
    || audios.length !== 0
    || video?.codec_name !== 'h264'
    || video.width !== 1920
    || video.height !== 1080
    || video.r_frame_rate !== '30/1'
    || video.pix_fmt !== 'yuv420p'
    || !Number.isFinite(durationSeconds)
    || Math.abs(durationSeconds * 1000 - expectedDurationMs) > oneFrameMs + 0.001
  ) {
    throw new Error(`ffprobe rejected rendered preview metadata: ${stdout.slice(0, 2_000)}`);
  }
}

export async function renderEditPreview(input: {
  plan: EditPlan;
  sources: readonly EditSource[];
  outputPath: string;
  timelinePath: string;
  runCommand?: RunCommand;
  fileOperations?: PreviewFileOperations;
}): Promise<{ previewPath: string; timelinePath: string; durationMs: number }> {
  const built = buildEditFiltergraph(input.plan, input.sources);
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const temporaryPreviewPath = `${input.outputPath}.tmp.mp4`;
  const temporaryTimelinePath = `${input.timelinePath}.tmp`;
  const runCommand = input.runCommand ?? defaultRunCommand;
  const fileOperations = input.fileOperations ?? defaultFileOperations;

  const ffmpegArgs = ['-hide_banner', '-loglevel', 'error'];
  for (const sourceId of built.inputSourceIds) {
    ffmpegArgs.push('-i', sourceById.get(sourceId)!.path);
  }
  ffmpegArgs.push(
    '-filter_complex', built.filterComplex,
    '-map', built.outputLabel,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-movflags', '+faststart',
    '-an',
    '-y',
    temporaryPreviewPath,
  );

  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await mkdir(path.dirname(input.timelinePath), { recursive: true });
  if (
    await exists(input.outputPath, fileOperations)
    || await exists(input.timelinePath, fileOperations)
  ) {
    throw new Error(
      `Cannot render edit preview because a formal output already exists: `
      + `${input.outputPath} or ${input.timelinePath}`,
    );
  }
  await removeIfPresent(temporaryPreviewPath, fileOperations);
  await removeIfPresent(temporaryTimelinePath, fileOperations);
  let previewPublished = false;
  let timelinePublished = false;
  try {
    const rendered = await runCommand('ffmpeg', ffmpegArgs);
    if (rendered.stderr.trim().length > 0) throw Object.assign(new Error('ffmpeg failed'), rendered);
    const probed = await runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration',
      '-of', 'json',
      temporaryPreviewPath,
    ]);
    if (probed.stderr.trim().length > 0) throw Object.assign(new Error('ffprobe failed'), probed);
    validatePreviewProbe(probed.stdout, built.timeline.durationMs);

    await fileOperations.writeFile(
      temporaryTimelinePath,
      `${JSON.stringify(built.timeline, null, 2)}\n`,
      'utf8',
    );
    await fileOperations.rename(temporaryPreviewPath, input.outputPath);
    previewPublished = true;
    await fileOperations.rename(temporaryTimelinePath, input.timelinePath);
    timelinePublished = true;
  } catch (error) {
    await Promise.allSettled([
      removeIfPresent(temporaryPreviewPath, fileOperations),
      removeIfPresent(temporaryTimelinePath, fileOperations),
      ...(previewPublished ? [removeIfPresent(input.outputPath, fileOperations)] : []),
      ...(timelinePublished ? [removeIfPresent(input.timelinePath, fileOperations)] : []),
    ]);
    throw new Error(
      `Failed to render edit preview; source ids: ${built.inputSourceIds.join(', ')}; `
      + `segment ids: ${input.plan.segments.map((segment) => segment.segmentId).join(', ')}; `
      + `outputPath: ${input.outputPath}; stderr: ${diagnosticStderr(error)}`,
      { cause: error },
    );
  }

  return {
    previewPath: input.outputPath,
    timelinePath: input.timelinePath,
    durationMs: built.timeline.durationMs,
  };
}
