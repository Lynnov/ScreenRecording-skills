import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { mergeAudioSegments, type MergeAudioSegmentsInput } from './audio.js';
import { loadVideoGeneratorConfig, type VideoGeneratorConfigOverrides } from './config.js';
import { renderFinalVideo, type RenderFinalVideoInput } from './ffmpeg.js';
import { recordTimelineSegments, type RecordTimelineSegmentsInput } from './browser/recorder.js';
import { writeRunReport } from './report.js';
import { parseVideoScript } from './script-parser.js';
import { renderSrt } from './subtitles.js';
import { createAliyunTtsProvider } from './tts/aliyun.js';
import type { TtsProvider } from './tts/types.js';
import { VideoGeneratorError, type RunReport, type Timeline, type VideoGeneratorConfig } from './types.js';

export interface RunVideoGeneratorDeps {
  ttsProvider?: TtsProvider;
  mergeAudioSegments?: (input: MergeAudioSegmentsInput) => Promise<string>;
  recordTimelineSegments?: (input: RecordTimelineSegmentsInput) => Promise<Timeline>;
  renderFinalVideo?: (input: RenderFinalVideoInput) => Promise<string>;
}

export interface RunVideoGeneratorInput {
  scriptPath: string;
  configOverrides?: VideoGeneratorConfigOverrides;
  deps?: RunVideoGeneratorDeps;
}

export async function runVideoGenerator(input: RunVideoGeneratorInput): Promise<RunReport> {
  const config = loadVideoGeneratorConfig(input.configOverrides);
  const outputDir = config.outputDir;
  const audioDir = path.join(outputDir, 'audio');

  try {
    await mkdir(audioDir, { recursive: true });
    const script = await readFile(input.scriptPath, 'utf8');
    const parsedTimeline = parseVideoScript(script, config);
    const timelineWithAudio = await synthesizeTimelineAudio({
      timeline: parsedTimeline,
      outputDir,
      audioDir,
      ttsProvider: input.deps?.ttsProvider ?? createAliyunTtsProvider(process.env),
    });

    const recordedTimeline = await (input.deps?.recordTimelineSegments ?? recordTimelineSegments)({
      timeline: timelineWithAudio,
      config,
      outputDir,
    });

    const timelinePath = path.join(outputDir, 'timeline.json');
    await writeFile(timelinePath, `${JSON.stringify(recordedTimeline, null, 2)}\n`);

    const subtitlesPath = path.join(outputDir, 'subtitles.srt');
    await writeFile(subtitlesPath, renderSrt(recordedTimeline));

    const narrationAudioPath = await (input.deps?.mergeAudioSegments ?? mergeAudioSegments)({
      audioPaths: recordedTimeline.segments.map((segment) => segment.assets.audioPath).filter((audioPath): audioPath is string => audioPath !== undefined),
      outputPath: path.join(audioDir, 'narration.wav'),
      segments: recordedTimeline.segments.map((segment) => ({
        id: segment.id,
        startsAtMs: segment.startsAtMs,
        endsAtMs: segment.endsAtMs,
        actualAudioDurationMs: segment.actualAudioDurationMs,
      })),
    });

    const finalVideoPath = await (input.deps?.renderFinalVideo ?? renderFinalVideo)({
      timeline: recordedTimeline,
      outputDir,
      audioPath: narrationAudioPath,
      subtitlesPath,
    });

    const report: RunReport = {
      ok: true,
      outputDir,
      finalVideoPath,
      timelinePath,
      subtitlesPath,
    };
    await writeRunReport(report);
    return report;
  } catch (error) {
    const report = makeFailureReport(outputDir, error);
    await writeRunReport(report);
    return report;
  }
}

async function synthesizeTimelineAudio(input: {
  timeline: Timeline;
  outputDir: string;
  audioDir: string;
  ttsProvider: TtsProvider;
}): Promise<Timeline> {
  let cursorMs = 0;
  const segments = [];

  for (const segment of input.timeline.segments) {
    const outputPath = path.join(input.audioDir, `${segment.id}.wav`);
    const result = await synthesizeSegmentAudio(input.ttsProvider, {
      segmentId: segment.id,
      text: segment.narration,
      outputPath,
    });
    const startsAtMs = cursorMs;
    const endsAtMs = startsAtMs + Math.max(segment.estimatedDurationMs, result.durationMs) + segment.bufferMs;
    cursorMs = endsAtMs;

    segments.push({
      ...segment,
      actualAudioDurationMs: result.durationMs,
      startsAtMs,
      endsAtMs,
      assets: {
        ...segment.assets,
        audioPath: result.audioPath,
      },
    });
  }

  return {
    ...input.timeline,
    segments,
  };
}

async function synthesizeSegmentAudio(
  ttsProvider: TtsProvider,
  request: { segmentId: string; text: string; outputPath: string },
): ReturnType<TtsProvider['synthesize']> {
  try {
    return await ttsProvider.synthesize(request);
  } catch (error) {
    if (error instanceof VideoGeneratorError && error.segmentId !== undefined) {
      throw error;
    }

    throw new VideoGeneratorError(
      'TTS_SYNTHESIS_FAILED',
      error instanceof Error ? error.message : String(error),
      request.segmentId,
    );
  }
}

function makeFailureReport(outputDir: string, error: unknown): RunReport {
  return {
    ok: false,
    outputDir,
    failedSegmentId: extractSegmentId(error),
    errorMessage: error instanceof Error ? error.message : String(error),
    screenshotPath: extractScreenshotPath(error),
    failedAction: extractFailedAction(error),
  };
}

function extractSegmentId(error: unknown): string | undefined {
  if (error instanceof VideoGeneratorError) {
    return error.segmentId;
  }

  return readStringProperty(error, 'segmentId');
}

function extractFailedAction(error: unknown): RunReport['failedAction'] {
  if (error instanceof VideoGeneratorError) {
    return error.failedAction;
  }

  const failedAction = readObjectProperty(error, 'failedAction');
  return failedAction as RunReport['failedAction'];
}

function extractScreenshotPath(error: unknown): string | undefined {
  const directPath = readStringProperty(error, 'screenshotPath');
  if (directPath !== undefined) {
    return directPath;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.match(/screenshot saved to (.+?)(?::|$)/)?.[1];
}

function readObjectProperty(value: unknown, property: string): object | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'object' && propertyValue !== null ? propertyValue : undefined;
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    return undefined;
  }

  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : undefined;
}
