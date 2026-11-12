import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { mergeAudioSegments, type MergeAudioSegmentsInput } from '../audio.js';
import { validateEditPlan } from '../editing/validator.js';
import type { EditPlan } from '../editing/types.js';
import {
  probeFinalVideo,
  renderManualFinalVideo,
  type ProbedFinalVideo,
  type RenderManualFinalVideoInput,
} from '../ffmpeg.js';
import { renderFinalTimelineSrt } from '../subtitles.js';
import { createAliyunTtsProvider } from '../tts/aliyun.js';
import type { TtsProvider, TtsResult } from '../tts/types.js';
import { writeAtomicJson } from './atomic-writer.js';
import { createManualBundle, ensureManualBundleDirs, writeVersionedJson } from './bundle.js';
import { detectWhiteScreenIntervals } from './fine-edit-blank.js';
import { readSourceEvents, type FineEditEvent, type FineEditWarning } from './fine-edit-events.js';
import { buildFineEditLearningCandidate, persistFineEditLearningCandidate } from './fine-edit-learning.js';
import { buildFineEditPlan, type TimeInterval } from './fine-edit-plan.js';
import { evaluateFineEditQuality, type FineEditQualityReport } from './fine-edit-quality.js';
import { loadFineEditRules } from './fine-edit-rules.js';
import { buildFinalTimeline, type FinalTimeline } from './final-timeline.js';
import { parseNarrationMarkdown, type ApprovedNarrationPointer } from './narration-response.js';
import { resolvePathInsideRun } from './run-path.js';
import { validateManualSourceCatalog } from './schema.js';
import { availableManualSources, type ManualSourceCatalog } from './types.js';

export interface ManualFinalReport {
  version: 1;
  ok: boolean;
  renderOk?: boolean;
  runDir: string;
  finalTimelinePath?: string;
  subtitlesPath?: string;
  finalVideoPath?: string;
  fineEditRulesSnapshotPath?: string;
  fineEditPlanPath?: string;
  fineEditQualityPath?: string;
  fineEditLearningCandidatePath?: string;
  quality?: Pick<FineEditQualityReport, 'status' | 'warnings' | 'requiredEventCoverage'>;
  cleanupErrors: string[];
  errorMessage?: string;
  failedSegmentId?: string;
  probe?: ProbedFinalVideo;
}

export interface FinalizeManualDeps {
  ttsProvider?: TtsProvider;
  mergeAudioSegments?: (input: MergeAudioSegmentsInput) => Promise<string>;
  renderManualFinalVideo?: (input: RenderManualFinalVideoInput) => Promise<string>;
  probeFinalVideo?: (filePath: string) => Promise<ProbedFinalVideo>;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function readPointerTarget<T>(runDir: string, pointerPath: string, label: string): Promise<T> {
  const pointer = await readJson<{ path?: string }>(pointerPath);
  if (typeof pointer.path !== 'string') throw new Error(`${label} pointer is invalid.`);
  return readJson<T>(resolvePathInsideRun(runDir, pointer.path, label));
}

async function loadFinalInputs(runDir: string): Promise<{
  plan: EditPlan;
  catalog: ManualSourceCatalog;
  narration: Array<{ segmentId: string; text: string }>;
}> {
  const bundle = createManualBundle(runDir);
  const review = await readPointerTarget<{ reviewComplete?: boolean }>(runDir, bundle.reviewCurrentPath, 'Current review');
  if (review.reviewComplete !== true) throw new Error('Finalize requires reviewComplete=true.');
  const catalog = await readJson<ManualSourceCatalog>(bundle.sourceCatalogPath);
  validateManualSourceCatalog(catalog);
  const sources = availableManualSources(catalog);
  if (sources.length !== catalog.sources.length) throw new Error('Finalize requires every catalog source to be available.');
  const plan = await readPointerTarget<EditPlan>(runDir, bundle.effectiveCurrentPlanPath, 'Current effective plan');
  validateEditPlan(plan, sources);
  const manifest = await readJson<{ captureComplete?: boolean; clockStatus?: string }>(bundle.recordingManifestPath);
  if (manifest.captureComplete !== true) throw new Error('Finalize requires a complete capture.');
  if (manifest.clockStatus !== 'ok') throw new Error('Finalize requires clock status ok.');
  const approved = await readJson<ApprovedNarrationPointer>(bundle.approvedNarrationPath);
  if (approved.version !== 1 || !Number.isInteger(approved.narrationVersion) || typeof approved.narrationPath !== 'string') {
    throw new Error('Approved narration pointer is invalid.');
  }
  const narrationPath = resolvePathInsideRun(runDir, approved.narrationPath, 'Approved narration');
  const expectedNarrationPath = path.resolve(bundle.versionedScriptPath('narration-final', approved.narrationVersion));
  if (path.resolve(narrationPath) !== expectedNarrationPath) {
    throw new Error('Approved narration pointer version and path do not match.');
  }
  const narration = parseNarrationMarkdown(await readFile(narrationPath, 'utf8'));
  if (narration.length !== plan.segments.length || narration.some((segment, index) => segment.segmentId !== plan.segments[index]?.segmentId)) {
    throw new Error('Approved narration Segment ids must exactly match the effective plan.');
  }
  return { plan, catalog, narration };
}

function redactSecret(message: string, secret: string | undefined): string {
  return secret === undefined || secret.length === 0 ? message : message.replaceAll(secret, '[REDACTED]');
}

function planWithFinalHolds(plan: EditPlan, timeline: FinalTimeline): EditPlan {
  return {
    ...plan,
    segments: plan.segments.map((segment, index) => ({
      ...segment,
      holdLastFrameMs: timeline.segments[index]!.holdLastFrameMs,
    })),
  };
}

export async function finalizeManualRecording(input: {
  runDir: string;
  env?: NodeJS.ProcessEnv;
  deps?: FinalizeManualDeps;
}): Promise<ManualFinalReport> {
  const bundle = createManualBundle(input.runDir);
  const env = input.env ?? process.env;
  const pendingVideoPath = path.join(input.runDir, `.final-${randomUUID()}.mp4`);
  await ensureManualBundleDirs(bundle);
  let failedSegmentId: string | undefined;
  try {
    const loaded = await loadFinalInputs(input.runDir);
    if (!env.DASHSCOPE_API_KEY) throw new Error('Missing required DASHSCOPE_API_KEY; final video was not generated.');
    const ttsProvider = input.deps?.ttsProvider ?? createAliyunTtsProvider(env);
    const audioResults: TtsResult[] = [];
    await mkdir(bundle.audioDir, { recursive: true });
    for (const narration of loaded.narration) {
      failedSegmentId = narration.segmentId;
      audioResults.push(await ttsProvider.synthesize({
        segmentId: narration.segmentId,
        text: narration.text,
        outputPath: bundle.audioSegmentPath(narration.segmentId),
      }));
    }
    failedSegmentId = undefined;
    const loadedRules = await loadFineEditRules({ runDir: input.runDir });
    await writeAtomicJson(bundle.fineEditRulesSnapshotPath, {
      ...loadedRules.rules,
      source: loadedRules.source,
      diagnostics: loadedRules.diagnostics,
    });
    const sources = availableManualSources(loaded.catalog);
    const eventsBySource = new Map<string, FineEditEvent[]>();
    const blankIntervalsBySource = new Map<string, TimeInterval[]>();
    const discoveryWarnings: FineEditWarning[] = loadedRules.diagnostics.map((message) => ({
      code: 'AMBIGUOUS_BLANK_REGION',
      message,
    }));
    for (const source of sources) {
      try {
        eventsBySource.set(source.id, await readSourceEvents(input.runDir, source.id, source.kind));
      } catch (error) {
        eventsBySource.set(source.id, []);
        discoveryWarnings.push({
          code: 'AMBIGUOUS_INPUT_TARGET',
          message: `Event evidence unavailable for ${source.id}; source content was preserved conservatively: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      try {
        blankIntervalsBySource.set(source.id, await detectWhiteScreenIntervals({
          sourcePath: resolvePathInsideRun(input.runDir, source.path, `Source ${source.id}`),
          whiteFrameRatio: loadedRules.rules.soft.whiteFrameRatio,
        }));
      } catch (error) {
        blankIntervalsBySource.set(source.id, []);
        discoveryWarnings.push({
          code: 'AMBIGUOUS_BLANK_REGION',
          message: `Blank-screen evidence unavailable for ${source.id}; no frames were deleted on that basis: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    const audioDurationBySegment = new Map(audioResults.map((result) => [result.segmentId, result.durationMs]));
    const fineResult = buildFineEditPlan({
      effectivePlan: loaded.plan,
      eventsBySource,
      audioDurationBySegment,
      blankIntervalsBySource,
      rules: loadedRules.rules,
    });
    fineResult.warnings.push(...discoveryWarnings);
    validateEditPlan(fineResult.plan, sources);
    const quality = evaluateFineEditQuality({
      beforePlan: loaded.plan,
      fineResult,
      audioDurationBySegment,
      rules: loadedRules.rules,
    });
    await writeAtomicJson(bundle.fineEditQualityPath, quality);
    if (quality.status === 'failed') {
      throw new Error(`Fine edit quality failed: ${quality.hardFailures.map((failure) => failure.message).join('; ')}`);
    }
    const finePlanArtifact = await writeVersionedJson(bundle.editDir, 'edit-plan.fine', fineResult.plan);
    await writeAtomicJson(bundle.fineEditCurrentPlanPath, { version: 1, path: finePlanArtifact.path });
    const learningCandidate = buildFineEditLearningCandidate({ rules: loadedRules.rules, quality, runDir: input.runDir });
    await persistFineEditLearningCandidate({
      candidate: learningCandidate,
      candidatePath: bundle.fineEditLearningCandidatePath,
      learningDir: loadedRules.learningDir,
    });
    const timeline = buildFinalTimeline({
      effectivePlan: fineResult.plan,
      narration: loaded.narration.map((segment, index) => ({
        ...segment,
        estimatedDurationMs: audioResults[index]!.durationMs,
        audioDurationMs: audioResults[index]!.durationMs,
      })),
    });
    await writeAtomicJson(bundle.finalTimelinePath, timeline);
    await writeFile(bundle.subtitlesPath, renderFinalTimelineSrt(timeline), 'utf8');
    const narrationAudioPath = path.join(bundle.audioDir, 'narration.wav');
    await (input.deps?.mergeAudioSegments ?? mergeAudioSegments)({
      audioPaths: audioResults.map((result) => result.audioPath),
      outputPath: narrationAudioPath,
      segments: timeline.segments.map((segment) => ({
        id: segment.segmentId,
        startsAtMs: segment.videoStartMs,
        endsAtMs: segment.videoEndMs,
        actualAudioDurationMs: segment.audioDurationMs,
      })),
    });
    await (input.deps?.renderManualFinalVideo ?? renderManualFinalVideo)({
      plan: planWithFinalHolds(fineResult.plan, timeline),
      sources,
      audioPath: narrationAudioPath,
      subtitlesPath: bundle.subtitlesPath,
      outputPath: pendingVideoPath,
    });
    const probe = await (input.deps?.probeFinalVideo ?? probeFinalVideo)(pendingVideoPath);
    if (probe.width !== 1920 || probe.height !== 1080 || Math.abs(probe.fps - 30) > 0.001 || probe.codecName !== 'h264') {
      throw new Error(`ffprobe rejected final video metadata: ${JSON.stringify(probe)}`);
    }
    if (Math.abs(probe.durationMs - timeline.durationMs) > (1000 / 30) + 1) {
      throw new Error(`ffprobe final duration ${probe.durationMs}ms does not match timeline ${timeline.durationMs}ms.`);
    }
    const report: ManualFinalReport = {
      version: 1,
      ok: true,
      renderOk: true,
      runDir: input.runDir,
      finalTimelinePath: bundle.finalTimelinePath,
      subtitlesPath: bundle.subtitlesPath,
      finalVideoPath: bundle.finalVideoPath,
      fineEditRulesSnapshotPath: bundle.fineEditRulesSnapshotPath,
      fineEditPlanPath: finePlanArtifact.path,
      fineEditQualityPath: bundle.fineEditQualityPath,
      fineEditLearningCandidatePath: bundle.fineEditLearningCandidatePath,
      quality: {
        status: quality.status,
        warnings: quality.warnings,
        requiredEventCoverage: quality.requiredEventCoverage,
      },
      probe,
      cleanupErrors: [],
    };
    await writeAtomicJson(bundle.reportPath('final-verification'), report);
    // Publish last: rendering, probing or report failures must leave the old video intact.
    await rename(pendingVideoPath, bundle.finalVideoPath);
    return report;
  } catch (error) {
    const cleanupErrors: string[] = [];
    try {
      await rm(pendingVideoPath, { force: true });
    } catch (cleanupError) {
      cleanupErrors.push(redactSecret(cleanupError instanceof Error ? cleanupError.message : String(cleanupError), env.DASHSCOPE_API_KEY));
    }
    const report: ManualFinalReport = {
      version: 1,
      ok: false,
      runDir: input.runDir,
      failedSegmentId,
      errorMessage: redactSecret(error instanceof Error ? error.message : String(error), env.DASHSCOPE_API_KEY),
      cleanupErrors,
    };
    await writeAtomicJson(bundle.reportPath('final-verification'), report);
    return report;
  }
}
