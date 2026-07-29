import { execFile } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { EditPlan, EditPlanSegment } from '../editing/types.js';
import { probeEditSource } from '../editing/media-probe.js';
import { writeRecordingManifest } from '../recording/manifest.js';
import type { RecordingAttempt, RecordingManifest } from '../recording/types.js';
import { createManualBundle, ensureManualBundleDirs, type ManualBundle } from './bundle.js';
import { loadApprovedGuide, type ManualRecordDisplayMode } from './record-controller.js';
import type { EditReview } from './review.js';
import { validateEditReview } from './review.js';
import {
  appendPickupSource,
  getNextPickupAttemptFromArtifacts,
  readManualSourceCatalog,
  type ManualSourceProbe,
} from './source-catalog.js';
import {
  createManualOverlayState,
  manualOverlayReducer,
  type CreateManualOverlayStateInput,
  type ManualOverlayState,
  type ManualOverlayStatus,
} from './state-machine.js';
import type { ManualSourceCatalog, RecordingGuideAction } from './types.js';
import { writeAtomicJson } from './atomic-writer.js';
import { resolvePathInsideRun } from './run-path.js';

const execFileAsync = promisify(execFile);
const SAFE_SEGMENT_ID = /^segment-[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type PickupContinuityResult = 'continuous' | 'discontinuous' | 'unknown';

export interface PickupBoundaryComparison {
  neighborSegmentId: string;
  result: PickupContinuityResult;
  reason: string;
}

export interface PickupContinuityGateInput {
  segmentId: string;
  previous: PickupBoundaryComparison | null;
  next: PickupBoundaryComparison | null;
}

export interface PickupContinuityGate {
  status: 'pickup-required';
  reviewRequired: true;
  reviewReasons: string[];
  previous: PickupBoundaryComparison | null;
  next: PickupBoundaryComparison | null;
}

export interface PickupNeighborKeyframe {
  segmentId: string;
  sourceId: string;
  atMs: number;
  framePath: string;
}

export interface PickupContinuityComparisonRequest {
  pickup: {
    segmentId: string;
    sourceId: string;
    firstFramePath: string;
    lastFramePath: string;
  };
  previous: PickupNeighborKeyframe | null;
  next: PickupNeighborKeyframe | null;
}

export interface PickupContinuityComparisons {
  previous: PickupBoundaryComparison | null;
  next: PickupBoundaryComparison | null;
}

export interface ManualPickupCaptureInput {
  runDir: string;
  segmentId: string;
  actions: RecordingGuideAction[];
  displayMode: ManualRecordDisplayMode;
  outputPath: string;
  sourceId: string;
  attempt: number;
  overlay: CreateManualOverlayStateInput;
}

export interface ManualPickupCaptureResult {
  ok: boolean;
  errorMessage?: string;
  startMs: number;
  endMs: number | null;
  firstFramePath: string | null;
  lastFramePath: string | null;
  attempts: RecordingAttempt[];
}

export interface PickupKeyframeExtractionInput {
  videoPath: string;
  atMs: number;
  outputPath: string;
}

export interface ManualPickupControllerDeps {
  reservedPickupAttempt?: number;
  capture?: (input: ManualPickupCaptureInput) => Promise<ManualPickupCaptureResult>;
  probe?: (videoPath: string) => Promise<ManualSourceProbe>;
  waitForStart?: (state: ManualOverlayState) => Promise<void>;
  extractKeyframe?: (input: PickupKeyframeExtractionInput) => Promise<void>;
  compareContinuity?: (input: PickupContinuityComparisonRequest) => Promise<PickupContinuityComparisons>;
  onStateChange?: (state: ManualOverlayState) => Promise<void> | void;
  now?: () => Date;
}

export interface ManualPickupControllerInput {
  runDir: string;
  segmentId: string;
  displayMode: ManualRecordDisplayMode;
  deps?: ManualPickupControllerDeps;
}

interface ManualPickupControllerResultBase {
  sourceId: string;
  sourceCatalogPath: string;
  attempts: RecordingAttempt[];
  lifecycle: ManualOverlayStatus[];
  continuityGate: PickupContinuityGate;
}

export type ManualPickupControllerResult =
  | (ManualPickupControllerResultBase & { ok: true })
  | (ManualPickupControllerResultBase & { ok: false; errorMessage: string });

export function evaluatePickupContinuityGate(input: PickupContinuityGateInput): PickupContinuityGate {
  const comparisons = [input.previous, input.next].filter((comparison): comparison is PickupBoundaryComparison => comparison !== null);
  const reviewReasons: string[] = [];
  for (const comparison of comparisons) {
    if (comparison.result === 'discontinuous') {
      reviewReasons.push(`与相邻 Segment ${comparison.neighborSegmentId} 明显不连续：${comparison.reason}`);
    } else if (comparison.result === 'unknown') {
      reviewReasons.push(`无法确认与相邻 Segment ${comparison.neighborSegmentId} 的连续性：${comparison.reason}`);
    }
  }
  if (comparisons.length === 0) {
    reviewReasons.push(`Segment ${input.segmentId} 没有可自动比较的相邻关键帧。`);
  }
  reviewReasons.push(`补录后必须重新 analyze/preview/review Segment ${input.segmentId}，连续性通过也不得自动 approved。`);
  return {
    status: 'pickup-required',
    reviewRequired: true,
    reviewReasons,
    previous: input.previous,
    next: input.next,
  };
}

export async function runManualPickupController(
  input: ManualPickupControllerInput,
): Promise<ManualPickupControllerResult> {
  assertSafeSegmentId(input.segmentId);
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  const guide = await loadApprovedGuide(input.runDir);
  const agentPlan = await readCurrentJson<EditPlan>(bundle.agentCurrentPlanPath, input.runDir, 'agent plan');
  const review = await readCurrentJson<EditReview>(bundle.reviewCurrentPath, input.runDir, 'review');
  validateEditReview(review, agentPlan);

  const targetPlanIndex = agentPlan.segments.findIndex((segment) => segment.segmentId === input.segmentId);
  const actions = guide.actions.filter((action) => action.segmentId === input.segmentId);
  if (targetPlanIndex === -1 || actions.length === 0) {
    throw new Error(`Pickup Segment ${input.segmentId} does not exist in both the approved guide and current agent plan.`);
  }
  const targetReview = review.segments.find((segment) => segment.segmentId === input.segmentId);
  if (targetReview?.status !== 'pickup-required') {
    throw new Error(`Pickup Segment ${input.segmentId} current review status must be pickup-required.`);
  }

  const catalog = await readManualSourceCatalog(bundle.sourceCatalogPath);
  const deps = input.deps ?? {};
  if (
    deps.reservedPickupAttempt !== undefined
    && (!Number.isSafeInteger(deps.reservedPickupAttempt) || deps.reservedPickupAttempt < 1)
  ) {
    throw new Error(`Reserved pickup attempt must be a positive integer: ${deps.reservedPickupAttempt}`);
  }
  const pickupAttempt = deps.reservedPickupAttempt ?? await getNextPickupAttemptFromArtifacts(
      catalog,
      bundle.pickupsDir,
      input.segmentId,
    );
  const sourceId = `${input.segmentId}-attempt-${String(pickupAttempt).padStart(3, '0')}`;
  const outputPath = bundle.pickupPath(input.segmentId, pickupAttempt);
  const capture = deps.capture ?? defaultCapture;
  const probe = deps.probe ?? defaultProbe;
  const waitForStart = deps.waitForStart ?? defaultWaitForStart;
  const extractKeyframe = deps.extractKeyframe ?? defaultExtractKeyframe;
  const lifecycle: ManualOverlayStatus[] = [];
  let state = createManualOverlayState({
    mode: 'pickup',
    segmentId: input.segmentId,
    actionId: actions[0]!.id,
    actionIds: actions.map((action) => action.id),
    attempt: pickupAttempt,
  });
  await publishState(state, lifecycle, deps);
  await waitForStart(state);
  state = manualOverlayReducer(state, { type: 'start-pickup' });
  await publishState(state, lifecycle, deps);

  let captureResult: ManualPickupCaptureResult;
  let sourceProbe: ManualSourceProbe | null = null;
  try {
    captureResult = await capture({
      runDir: input.runDir,
      segmentId: input.segmentId,
      actions,
      displayMode: input.displayMode,
      outputPath,
      sourceId,
      attempt: pickupAttempt,
      overlay: {
        mode: 'pickup',
        segmentId: input.segmentId,
        actionId: actions[0]!.id,
        actionIds: actions.map((action) => action.id),
        attempt: pickupAttempt,
      },
    });
  } catch (error) {
    captureResult = {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      startMs: 0,
      endMs: null,
      firstFramePath: null,
      lastFramePath: null,
      attempts: [],
    };
  }

  state = manualOverlayReducer(state, { type: 'finish' });
  await publishState(state, lifecycle, deps);
  validateCaptureResult(captureResult, {
    segmentId: input.segmentId,
    sourceId,
    actionIds: actions.map((action) => action.id),
  });
  try {
    sourceProbe = await probe(outputPath);
  } catch (error) {
    if (captureResult.ok) {
      captureResult = {
        ...captureResult,
        ok: false,
        errorMessage: `Pickup artifact could not be probed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const captureSucceeded = captureResult.ok && sourceProbe !== null;
  const failureReason = captureSucceeded
    ? undefined
    : captureResult.errorMessage ?? 'Pickup capture did not produce a probeable artifact.';
  const appended = await appendPickupSource(bundle.sourceCatalogPath, {
    path: outputPath,
    segmentId: input.segmentId,
    attempt: pickupAttempt,
    status: captureSucceeded ? 'available' : 'failed',
    createdAt: (deps.now ?? (() => new Date()))().toISOString(),
    probe: sourceProbe,
    failureReason,
  });
  if (appended.source.id !== sourceId || appended.source.attempt !== pickupAttempt) {
    throw new Error(`Pickup source allocation changed while recording ${input.segmentId}.`);
  }

  const attempts = captureResult.attempts;
  await appendPickupAttempts(bundle.recordingManifestPath, attempts);

  state = manualOverlayReducer(state, { type: 'analyze' });
  await publishState(state, lifecycle, deps);
  let comparisons: PickupContinuityComparisons;
  if (captureSucceeded) {
    if (sourceProbe === null) {
      throw new Error(`Pickup source probe unexpectedly missing for ${sourceId}.`);
    }
    const continuityRequest = await buildContinuityRequest({
      runDir: input.runDir,
      bundle,
      plan: agentPlan,
      targetPlanIndex,
      sourceId,
      segmentId: input.segmentId,
      attempt: pickupAttempt,
      pickupPath: outputPath,
      pickupProbe: sourceProbe,
      catalog: appended.catalog,
      extractKeyframe,
    });
    await writeAtomicJson(bundle.reportPath(`pickup-continuity-${input.segmentId}`), {
      version: 1,
      segmentId: input.segmentId,
      sourceId,
      attempt: pickupAttempt,
      ...continuityRequest,
    });
    comparisons = await (deps.compareContinuity ?? comparePickupContinuityFrames)(continuityRequest);
  } else {
    comparisons = failedCaptureComparisons(
      agentPlan,
      targetPlanIndex,
      failureReason ?? 'Pickup capture failed.',
    );
  }
  const continuityGate = evaluatePickupContinuityGate({
    segmentId: input.segmentId,
    previous: comparisons.previous,
    next: comparisons.next,
  });
  state = manualOverlayReducer(state, { type: 'review-ready' });
  await publishState(state, lifecycle, deps);

  const base: ManualPickupControllerResultBase = {
    sourceId,
    sourceCatalogPath: bundle.sourceCatalogPath,
    attempts,
    lifecycle,
    continuityGate,
  };
  if (captureSucceeded) return { ...base, ok: true };
  return {
    ...base,
    ok: false,
    errorMessage: failureReason ?? `Pickup capture failed for ${input.segmentId}.`,
  };
}

async function publishState(
  state: ManualOverlayState,
  lifecycle: ManualOverlayStatus[],
  deps: ManualPickupControllerDeps,
): Promise<void> {
  lifecycle.push(state.status);
  await deps.onStateChange?.(state);
}

function validateCaptureResult(
  result: ManualPickupCaptureResult,
  scope: { segmentId: string; sourceId: string; actionIds: string[] },
): void {
  if (!Number.isFinite(result.startMs) || result.startMs < 0) {
    throw new Error('Pickup capture startMs must be a non-negative finite number.');
  }
  if (result.ok && (!Number.isFinite(result.endMs) || result.endMs === null || result.endMs <= result.startMs)) {
    throw new Error('Pickup capture endMs must be greater than startMs.');
  }
  if (!result.ok && (result.errorMessage === undefined || result.errorMessage.length === 0)) {
    throw new Error('Failed pickup capture must include errorMessage.');
  }
  if (!Array.isArray(result.attempts)) {
    throw new Error('Pickup capture must return its real RecordingAttempt list.');
  }
  const allowedActions = new Set(scope.actionIds);
  const seenAttempts = new Set<string>();
  const confirmedActions = new Set<string>();
  for (const attempt of result.attempts) {
    if (attempt.segmentId !== scope.segmentId) {
      throw new Error(`Pickup attempt segmentId must be ${scope.segmentId}: ${attempt.segmentId}`);
    }
    if (attempt.sourceId !== scope.sourceId) {
      throw new Error(`Pickup attempt sourceId must be ${scope.sourceId}: ${attempt.sourceId}`);
    }
    if (!allowedActions.has(attempt.actionId)) {
      throw new Error(`Pickup attempt actionId is outside target Segment: ${attempt.actionId}`);
    }
    if (!Number.isInteger(attempt.attempt) || attempt.attempt <= 0) {
      throw new Error(`Pickup attempt number must be a positive integer: ${attempt.attempt}`);
    }
    const key = `${attempt.actionId}:${attempt.attempt}`;
    if (seenAttempts.has(key)) {
      throw new Error(`Duplicate pickup attempt: ${key}`);
    }
    seenAttempts.add(key);
    if (!Number.isFinite(attempt.startMs) || attempt.startMs < 0) {
      throw new Error(`Pickup attempt startMs must be non-negative: ${key}`);
    }
    if (attempt.endMs !== null && (!Number.isFinite(attempt.endMs) || attempt.endMs < attempt.startMs)) {
      throw new Error(`Pickup attempt endMs must not precede startMs: ${key}`);
    }
    if (attempt.status === 'recording') {
      throw new Error(`Pickup capture returned an unfinished attempt: ${key}`);
    }
    if (attempt.status === 'confirmed') {
      if (attempt.endMs === null || attempt.confirmedAtMs === null || !Number.isFinite(attempt.confirmedAtMs)) {
        throw new Error(`Confirmed pickup attempt must include endMs and confirmedAtMs: ${key}`);
      }
      confirmedActions.add(attempt.actionId);
    } else if (attempt.confirmedAtMs !== null) {
      throw new Error(`Discarded pickup attempt must not include confirmedAtMs: ${key}`);
    }
  }
  if (result.ok) {
    const missing = scope.actionIds.filter((actionId) => !confirmedActions.has(actionId));
    if (missing.length > 0) {
      throw new Error(`Successful pickup capture is missing confirmed attempts for: ${missing.join(', ')}`);
    }
  } else if (confirmedActions.size > 0) {
    throw new Error('Failed pickup capture cannot return confirmed attempts.');
  }
}

interface SegmentBoundaryDescriptor {
  segmentId: string;
  sourceId: string;
  atMs: number;
}

async function buildContinuityRequest(input: {
  runDir: string;
  bundle: ManualBundle;
  plan: EditPlan;
  targetPlanIndex: number;
  segmentId: string;
  sourceId: string;
  attempt: number;
  pickupPath: string;
  pickupProbe: ManualSourceProbe;
  catalog: ManualSourceCatalog;
  extractKeyframe: (input: PickupKeyframeExtractionInput) => Promise<void>;
}): Promise<PickupContinuityComparisonRequest> {
  const prefix = `${input.segmentId}-attempt-${String(input.attempt).padStart(3, '0')}`;
  const firstFramePath = path.join(input.bundle.keyframesDir, `${prefix}-pickup-first.png`);
  const lastFramePath = path.join(input.bundle.keyframesDir, `${prefix}-pickup-last.png`);
  const endSeekSafetyMs = Math.max(100, 2_000 / input.pickupProbe.fps);
  await extractVerifiedKeyframe(input, input.pickupPath, 0, firstFramePath);
  await extractVerifiedKeyframe(
    input,
    input.pickupPath,
    Math.max(0, input.pickupProbe.durationMs - endSeekSafetyMs),
    lastFramePath,
  );
  const previous = await extractNeighborBoundary(
    input,
    segmentBoundary(input.plan.segments[input.targetPlanIndex - 1], 'end'),
    `${prefix}-previous-end.png`,
  );
  const next = await extractNeighborBoundary(
    input,
    segmentBoundary(input.plan.segments[input.targetPlanIndex + 1], 'start'),
    `${prefix}-next-start.png`,
  );
  return {
    pickup: {
      segmentId: input.segmentId,
      sourceId: input.sourceId,
      firstFramePath,
      lastFramePath,
    },
    previous,
    next,
  };
}

function segmentBoundary(
  segment: EditPlanSegment | undefined,
  edge: 'start' | 'end',
): SegmentBoundaryDescriptor | null {
  if (segment === undefined || segment.clips.length === 0) return null;
  const clip = edge === 'start' ? segment.clips[0]! : segment.clips.at(-1)!;
  return {
    segmentId: segment.segmentId,
    sourceId: clip.sourceId,
    atMs: edge === 'start' ? clip.sourceStartMs : clip.sourceEndMs,
  };
}

async function extractNeighborBoundary(
  input: {
    runDir: string;
    bundle: ManualBundle;
    catalog: ManualSourceCatalog;
    extractKeyframe: (input: PickupKeyframeExtractionInput) => Promise<void>;
  },
  boundary: SegmentBoundaryDescriptor | null,
  fileName: string,
): Promise<PickupNeighborKeyframe | null> {
  if (boundary === null) return null;
  const source = input.catalog.sources.find((candidate) => candidate.id === boundary.sourceId);
  if (source === undefined || source.status === 'failed') {
    throw new Error(`Continuity keyframe source is unavailable: ${boundary.sourceId}`);
  }
  const videoPath = assertPathInsideRun(source.path, input.runDir, `source ${source.id}`);
  const framePath = path.join(input.bundle.keyframesDir, fileName);
  await extractVerifiedKeyframe(input, videoPath, boundary.atMs, framePath);
  return { ...boundary, framePath };
}

async function extractVerifiedKeyframe(
  input: {
    runDir: string;
    extractKeyframe: (input: PickupKeyframeExtractionInput) => Promise<void>;
  },
  videoPath: string,
  atMs: number,
  outputPath: string,
): Promise<void> {
  const safeVideoPath = assertPathInsideRun(videoPath, input.runDir, 'continuity video');
  const safeOutputPath = assertPathInsideRun(outputPath, input.runDir, 'continuity keyframe');
  await input.extractKeyframe({ videoPath: safeVideoPath, atMs, outputPath: safeOutputPath });
  await access(safeOutputPath);
}

function failedCaptureComparisons(
  plan: EditPlan,
  targetPlanIndex: number,
  errorMessage: string,
): PickupContinuityComparisons {
  const comparison = (neighbor: SegmentBoundaryDescriptor | null): PickupBoundaryComparison | null => neighbor === null ? null : {
    neighborSegmentId: neighbor.segmentId,
    result: 'unknown',
    reason: `补录失败，无法比较关键帧：${errorMessage}`,
  };
  return {
    previous: comparison(segmentBoundary(plan.segments[targetPlanIndex - 1], 'end')),
    next: comparison(segmentBoundary(plan.segments[targetPlanIndex + 1], 'start')),
  };
}

export async function comparePickupContinuityFrames(
  request: PickupContinuityComparisonRequest,
): Promise<PickupContinuityComparisons> {
  const compare = async (
    neighbor: PickupNeighborKeyframe | null,
    pickupFramePath: string,
  ): Promise<PickupBoundaryComparison | null> => {
    if (neighbor === null) return null;
    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-i',
        neighbor.framePath,
        '-i',
        pickupFramePath,
        '-lavfi',
        'ssim',
        '-f',
        'null',
        '-',
      ], { maxBuffer: 1024 * 1024 });
      const score = parseSsimScore(stderr);
      const result: PickupContinuityResult = score >= 0.98
        ? 'continuous'
        : score <= 0.85
          ? 'discontinuous'
          : 'unknown';
      return {
        neighborSegmentId: neighbor.segmentId,
        result,
        reason: `SSIM=${score.toFixed(6)} (${result}).`,
      };
    } catch (error) {
      return {
        neighborSegmentId: neighbor.segmentId,
        result: 'unknown',
        reason: `SSIM comparison failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
  return {
    previous: await compare(request.previous, request.pickup.firstFramePath),
    next: await compare(request.next, request.pickup.lastFramePath),
  };
}

function parseSsimScore(output: string): number {
  const match = output.match(/\bAll:([0-9]+(?:\.[0-9]+)?)/);
  if (match === null) {
    throw new Error('ffmpeg did not report an aggregate SSIM score.');
  }
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`ffmpeg reported an invalid SSIM score: ${match[1]}`);
  }
  return score;
}

async function appendPickupAttempts(manifestPath: string, attempts: RecordingAttempt[]): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RecordingManifest;
  await writeRecordingManifest(manifestPath, {
    ...manifest,
    attempts: [...manifest.attempts, ...attempts],
  });
}

async function readCurrentJson<T>(
  pointerPath: string,
  runDir: string,
  label: string,
): Promise<T> {
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as { path?: string };
  if (pointer.path === undefined) throw new Error(`Current ${label} pointer is invalid: ${pointerPath}`);
  const resolvedTarget = resolvePathInsideRun(runDir, pointer.path, `Current ${label}`);
  return JSON.parse(await readFile(resolvedTarget, 'utf8')) as T;
}

function assertSafeSegmentId(segmentId: string): void {
  if (!SAFE_SEGMENT_ID.test(segmentId)) {
    throw new Error(`Invalid pickup segmentId: ${segmentId}`);
  }
}

function assertPathInsideRun(targetPath: string, runDir: string, label: string): string {
  return resolvePathInsideRun(runDir, targetPath, label);
}

async function defaultWaitForStart(): Promise<void> {
  throw new Error(
    'Manual pickup runtime adapter is unavailable: the product Electron capture session and overlay start-signal bridge must be implemented before video:pickup can record.',
  );
}

async function defaultCapture(): Promise<ManualPickupCaptureResult> {
  throw new Error('Manual pickup capture runtime adapter is unavailable.');
}

async function defaultProbe(videoPath: string): Promise<ManualSourceProbe> {
  const source = await probeEditSource('pickup-probe', videoPath);
  return {
    durationMs: source.durationMs,
    width: source.width,
    height: source.height,
    fps: source.fps,
    codecName: source.codecName,
    pixelFormat: source.pixelFormat,
    hasAudio: source.hasAudio,
  };
}

async function defaultExtractKeyframe(input: PickupKeyframeExtractionInput): Promise<void> {
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    (input.atMs / 1000).toFixed(3),
    '-i',
    input.videoPath,
    '-frames:v',
    '1',
    '-y',
    input.outputPath,
  ]);
}
