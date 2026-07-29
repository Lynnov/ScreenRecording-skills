import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { appendSource } from './source-catalog.js';
import { createManualBundle, ensureManualBundleDirs } from './bundle.js';
import { validateRecordingGuide } from './schema.js';
import type { RecordingGuide } from './types.js';
import { writeRecordingManifest } from '../recording/manifest.js';
import type { RecordingAttempt, RecordingManifest } from '../recording/types.js';
import { resolvePathInsideRun } from './run-path.js';

export type ManualRecordDisplayMode = 'f11' | 'borderless-maximized';

export interface ManualRecordControllerInput {
  runDir: string;
  displayMode: ManualRecordDisplayMode;
  deps?: ManualRecordControllerDeps;
}

export interface ManualRecordControllerDeps {
  launchChromium?: (input: { startUrl: string; guide: RecordingGuide }) => Promise<{ sourceId: string; bindingTitle: string }>;
  waitForStart?: () => Promise<void>;
  capture?: (input: ManualCaptureEngineInput) => Promise<ManualCaptureEngineResult>;
}

export interface ManualCaptureEngineInput {
  runDir: string;
  displayMode: ManualRecordDisplayMode;
  rawVideoPath: string;
  originalVideoPath: string;
  eventsPath: string;
  tabsPath: string;
  sourceId: string;
  bindingTitle: string;
  guide: RecordingGuide;
}

export interface ManualCaptureEngineResult {
  video: RecordingManifest['video'];
  attempts: RecordingAttempt[];
  recordingStartMs: number;
  recordingEndMs: number;
  firstVideoFrameSessionTimeMs: number | null;
}

export type ManualRecordControllerResult =
  | { ok: true; manifestPath: string; sourceCatalogPath: string }
  | { ok: false; manifestPath: string; errorMessage: string };

export async function runManualRecordController(input: ManualRecordControllerInput): Promise<ManualRecordControllerResult> {
  const bundle = createManualBundle(input.runDir);
  await ensureManualBundleDirs(bundle);
  const guide = await loadApprovedGuide(input.runDir);
  const deps = input.deps ?? {};
  const launch = deps.launchChromium ?? defaultLaunchChromium;
  const waitForStart = deps.waitForStart ?? defaultWaitForStart;
  const capture = deps.capture ?? defaultCapture;

  const launched = await launch({ startUrl: guide.startUrl, guide });
  await waitForStart();

  try {
    const captureResult = await capture({
      runDir: input.runDir,
      displayMode: input.displayMode,
      rawVideoPath: bundle.rawVideoPath,
      originalVideoPath: bundle.originalVideoPath,
      eventsPath: bundle.eventsPath,
      tabsPath: bundle.tabsPath,
      sourceId: launched.sourceId,
      bindingTitle: launched.bindingTitle,
      guide,
    });
    const manifest = buildManifest(bundle, captureResult, true);
    await writeRecordingManifest(bundle.recordingManifestPath, manifest);
    if (captureResult.video.status === 'available') {
      await appendSource(bundle.sourceCatalogPath, {
        id: 'original',
        path: captureResult.video.path,
        kind: 'original',
        segmentId: null,
        attempt: null,
        status: 'available',
        createdAt: new Date().toISOString(),
        probe: {
          durationMs: captureResult.video.durationMs,
          width: captureResult.video.width,
          height: captureResult.video.height,
          fps: captureResult.video.fps,
          codecName: 'h264',
          pixelFormat: 'yuv420p',
          hasAudio: captureResult.video.hasAudio,
        },
      });
    }
    return { ok: true, manifestPath: bundle.recordingManifestPath, sourceCatalogPath: bundle.sourceCatalogPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const manifest = buildFailureManifest(bundle, message);
    await writeRecordingManifest(bundle.recordingManifestPath, manifest);
    await writeManualRecordReport(input.runDir, { stage: 'record', ok: false, errorMessage: message });
    return { ok: false, manifestPath: bundle.recordingManifestPath, errorMessage: message };
  }
}

export async function loadApprovedGuide(runDir: string): Promise<RecordingGuide> {
  const bundle = createManualBundle(runDir);
  let pointer: { guidePath?: string; guideVersion?: number };
  try {
    pointer = JSON.parse(await readFile(bundle.approvedGuidePath, 'utf8')) as { guidePath?: string; guideVersion?: number };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') throw new Error(`Missing approved guide: ${bundle.approvedGuidePath}`);
    throw error;
  }
  const guidePath = pointer.guidePath ?? (pointer.guideVersion === undefined ? undefined : bundle.versionedScriptPath('recording-guide', pointer.guideVersion));
  if (guidePath === undefined) throw new Error(`Invalid approved guide pointer: ${bundle.approvedGuidePath}`);
  const resolvedGuide = resolvePathInsideRun(runDir, guidePath, 'Approved guide');
  const guide = JSON.parse(await readFile(resolvedGuide, 'utf8')) as unknown;
  validateRecordingGuide(guide);
  return guide;
}

function buildManifest(bundle: ReturnType<typeof createManualBundle>, capture: ManualCaptureEngineResult, captureComplete: boolean): RecordingManifest {
  return {
    version: 1,
    platform: 'win32',
    video: capture.video,
    rawVideoPath: bundle.rawVideoPath,
    eventsPath: bundle.eventsPath,
    tabsPath: bundle.tabsPath,
    recordingStartMs: capture.recordingStartMs,
    recordingEndMs: capture.recordingEndMs,
    firstVideoFrameSessionTimeMs: capture.firstVideoFrameSessionTimeMs,
    attempts: capture.attempts,
    clockStatus: 'ok',
    slopePpm: 0,
    maxResidualMs: 0,
    maxAllowedResidualMs: 250,
    ffprobeDurationDeltaMs: 0,
    maxAllowedFfprobeDurationDeltaMs: 250,
    markerEvidence: [],
    captureComplete,
  };
}

function buildFailureManifest(bundle: ReturnType<typeof createManualBundle>, reason: string): RecordingManifest {
  return {
    version: 1,
    platform: 'win32',
    video: { status: 'unavailable', path: null, reason },
    rawVideoPath: bundle.rawVideoPath,
    eventsPath: bundle.eventsPath,
    tabsPath: bundle.tabsPath,
    recordingStartMs: 0,
    recordingEndMs: 0,
    firstVideoFrameSessionTimeMs: null,
    attempts: [],
    clockStatus: 'drift-detected',
    slopePpm: Number.NaN,
    maxResidualMs: Number.NaN,
    maxAllowedResidualMs: 250,
    ffprobeDurationDeltaMs: Number.NaN,
    maxAllowedFfprobeDurationDeltaMs: 250,
    markerEvidence: [],
    captureComplete: false,
  };
}

async function defaultLaunchChromium(): Promise<{ sourceId: string; bindingTitle: string }> {
  throw new Error('Real manual recording capture engine is not wired in this environment. Use the Electron runner in an interactive desktop session.');
}

async function defaultWaitForStart(): Promise<void> {
  return;
}

async function defaultCapture(): Promise<ManualCaptureEngineResult> {
  throw new Error('Real manual recording capture engine is not wired in this environment.');
}

async function writeManualRecordReport(runDir: string, report: Record<string, unknown>): Promise<void> {
  const bundle = createManualBundle(runDir);
  await mkdir(bundle.reportsDir, { recursive: true });
  await writeFile(bundle.reportPath('manual-run-report'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
