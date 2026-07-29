import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';
import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import {
  runManualPickupController,
  type PickupContinuityComparisonRequest,
} from '../../src/lib/video-generator/manual/pickup-controller.js';
import { prepareEditAgentRequest } from '../../src/lib/video-generator/manual/edit-request.js';
import type { EditReview } from '../../src/lib/video-generator/manual/review.js';
import type { ManualSourceCatalog, RecordingGuide } from '../../src/lib/video-generator/manual/types.js';
import type { RecordingManifest } from '../../src/lib/video-generator/recording/types.js';

const probe = {
  durationMs: 800,
  width: 1920,
  height: 1080,
  fps: 30,
  codecName: 'h264',
  pixelFormat: 'yuv420p',
  hasAudio: false,
};

function guide(): RecordingGuide {
  return {
    version: 1,
    startUrl: 'https://example.com',
    actions: [
      { id: 'action-001', segmentId: 'segment-001', title: '一', instruction: '一', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: '一' }] },
      { id: 'action-002', segmentId: 'segment-002', title: '二', instruction: '二', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: '二' }] },
      { id: 'action-003', segmentId: 'segment-003', title: '三', instruction: '三', expectedEvents: [{ type: 'input' }], expectedResults: [{ type: 'text-visible', text: '三' }] },
      { id: 'action-003b', segmentId: 'segment-003', title: '三-保存', instruction: '保存三。', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: '三完成' }] },
      { id: 'action-004', segmentId: 'segment-004', title: '四', instruction: '四', expectedEvents: [{ type: 'click' }], expectedResults: [{ type: 'text-visible', text: '四' }] },
    ],
  };
}

function agentPlan(): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [
      { segmentId: 'segment-001', title: '一', clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }], confidence: 'high', reason: 'ok' },
      { segmentId: 'segment-002', title: '二', clips: [{ sourceId: 'original', sourceStartMs: 1000, sourceEndMs: 2000, playbackRate: 1 }], confidence: 'high', reason: 'ok' },
      { segmentId: 'segment-003', title: '三', clips: [{ sourceId: 'original', sourceStartMs: 2000, sourceEndMs: 3000, playbackRate: 1 }], confidence: 'low', reason: 'pickup' },
      { segmentId: 'segment-004', title: '四', clips: [{ sourceId: 'original', sourceStartMs: 3000, sourceEndMs: 4000, playbackRate: 1 }], confidence: 'high', reason: 'ok' },
    ],
  };
}

async function createRunFixture(runDir: string): Promise<{
  bundle: ReturnType<typeof createManualBundle>;
  reviewBytes: string;
  effectiveBytes: string;
}> {
  const bundle = createManualBundle(runDir);
  await Promise.all([
    mkdir(bundle.scriptsDir, { recursive: true }),
    mkdir(bundle.captureDir, { recursive: true }),
    mkdir(bundle.editDir, { recursive: true }),
  ]);

  const guidePath = bundle.versionedScriptPath('recording-guide', 1);
  await writeFile(guidePath, `${JSON.stringify(guide(), null, 2)}\n`, 'utf8');
  await writeFile(bundle.approvedGuidePath, `${JSON.stringify({ version: 1, guideVersion: 1, guidePath, approvedAt: '2026-07-28T00:00:00.000Z' }, null, 2)}\n`, 'utf8');

  const plan = agentPlan();
  const agentPlanPath = bundle.versionedEditPath('edit-plan.agent', 1);
  await writeFile(agentPlanPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await writeFile(bundle.agentCurrentPlanPath, `${JSON.stringify({ version: 1, path: agentPlanPath }, null, 2)}\n`, 'utf8');

  const review: EditReview = {
    version: 1,
    createdAt: '2026-07-28T00:00:00.000Z',
    reviewComplete: false,
    segments: plan.segments.map((segment) => ({
      segmentId: segment.segmentId,
      status: segment.segmentId === 'segment-003' ? 'pickup-required' : 'approved',
      reviewReasons: segment.segmentId === 'segment-003' ? ['画面被遮挡，需要补录。'] : [],
    })),
  };
  const reviewPath = bundle.versionedEditPath('edit-review', 1);
  const reviewBytes = `${JSON.stringify(review, null, 2)}\n`;
  await writeFile(reviewPath, reviewBytes, 'utf8');
  await writeFile(bundle.reviewCurrentPath, `${JSON.stringify({ version: 1, path: reviewPath }, null, 2)}\n`, 'utf8');

  const catalog: ManualSourceCatalog = {
    version: 1,
    sources: [{
      id: 'original',
      path: path.join(runDir, 'capture', 'original-window.mp4'),
      durationMs: 4000,
      width: 1920,
      height: 1080,
      fps: 30,
      codecName: 'h264',
      pixelFormat: 'yuv420p',
      hasAudio: false,
      kind: 'original',
      segmentId: null,
      attempt: null,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
    }],
  };
  await writeFile(bundle.sourceCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  const manifest: RecordingManifest = {
    version: 1,
    platform: 'win32',
    video: { status: 'available', path: catalog.sources[0]!.path, width: 1920, height: 1080, fps: 30, durationMs: 4000, hasAudio: false },
    rawVideoPath: bundle.rawVideoPath,
    eventsPath: bundle.eventsPath,
    tabsPath: bundle.tabsPath,
    recordingStartMs: 0,
    recordingEndMs: 4000,
    firstVideoFrameSessionTimeMs: 0,
    attempts: [],
    clockStatus: 'ok',
    slopePpm: 0,
    maxResidualMs: 0,
    maxAllowedResidualMs: 250,
    ffprobeDurationDeltaMs: 0,
    maxAllowedFfprobeDurationDeltaMs: 250,
    markerEvidence: [],
    captureComplete: true,
  };
  await writeFile(bundle.recordingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(bundle.eventsPath, '{"type":"action-confirmed","sessionTimeMs":2500,"videoTimeMs":2500,"payload":{"actionId":"action-003","segmentId":"segment-003"}}\n', 'utf8');

  const effectivePath = bundle.versionedEditPath('edit-plan.effective', 1);
  const effectiveBytes = `${JSON.stringify(plan, null, 2)}\n`;
  await writeFile(effectivePath, effectiveBytes, 'utf8');
  await writeFile(bundle.effectiveCurrentPlanPath, `${JSON.stringify({ version: 1, path: effectivePath }, null, 2)}\n`, 'utf8');
  return { bundle, reviewBytes, effectiveBytes };
}

test('pickup controller scopes overlay/capture to one pickup-required segment and preserves reviewed plans byte-for-byte', async () => {
  const absoluteRunDir = await mkdtemp(path.join(process.cwd(), '.tmp-manual-pickup-success-'));
  const runDir = path.relative(process.cwd(), absoluteRunDir);
  try {
    const { bundle, reviewBytes, effectiveBytes } = await createRunFixture(runDir);
    const lifecycle: string[] = [];
    const coordination: string[] = [];
    const extractedFrames: string[] = [];
    const extractedAtMs: number[] = [];
    const comparisonRequests: PickupContinuityComparisonRequest[] = [];

    const result = await runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'borderless-maximized',
      deps: {
        waitForStart: async (state) => {
          coordination.push(`wait:${state.status}`);
        },
        capture: async (input) => {
          coordination.push('capture');
          assert.equal(input.segmentId, 'segment-003');
          assert.deepEqual(input.actions.map((action) => action.id), ['action-003', 'action-003b']);
          assert.equal(input.displayMode, 'borderless-maximized');
          assert.deepEqual(input.overlay, {
            mode: 'pickup',
            segmentId: 'segment-003',
            actionId: 'action-003',
            actionIds: ['action-003', 'action-003b'],
            attempt: 1,
          });
          await writeFile(input.outputPath, 'pickup-video', 'utf8');
          return {
            ok: true,
            startMs: 100,
            endMs: 900,
            firstFramePath: path.join(runDir, 'pickups', 'segment-003-first.png'),
            lastFramePath: path.join(runDir, 'pickups', 'segment-003-last.png'),
            attempts: [
              {
                actionId: 'action-003',
                segmentId: 'segment-003',
                sourceId: input.sourceId,
                attempt: 1,
                startMs: 100,
                endMs: 250,
                confirmedAtMs: null,
                status: 'discarded',
              },
              {
                actionId: 'action-003',
                segmentId: 'segment-003',
                sourceId: input.sourceId,
                attempt: 2,
                startMs: 260,
                endMs: 600,
                confirmedAtMs: 600,
                status: 'confirmed',
              },
              {
                actionId: 'action-003b',
                segmentId: 'segment-003',
                sourceId: input.sourceId,
                attempt: 1,
                startMs: 610,
                endMs: 900,
                confirmedAtMs: 900,
                status: 'confirmed',
              },
            ],
          };
        },
        probe: async () => probe,
        extractKeyframe: async (input) => {
          extractedFrames.push(input.outputPath);
          extractedAtMs.push(input.atMs);
          await mkdir(path.dirname(input.outputPath), { recursive: true });
          await writeFile(input.outputPath, `frame:${input.videoPath}:${input.atMs}`, 'utf8');
        },
        compareContinuity: async (input) => {
          await Promise.all([
            access(input.pickup.firstFramePath),
            access(input.pickup.lastFramePath),
            access(input.previous!.framePath),
            access(input.next!.framePath),
          ]);
          comparisonRequests.push(input);
          return {
            previous: { neighborSegmentId: 'segment-002', result: 'continuous', reason: '首帧连续。' },
            next: { neighborSegmentId: 'segment-004', result: 'discontinuous', reason: '末帧与下一段明显不连续。' },
          };
        },
        onStateChange: async (state) => { lifecycle.push(state.status); },
        now: () => new Date('2026-07-28T01:00:00.000Z'),
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(lifecycle, [
      'pickup-preparing',
      'pickup-recording',
      'pickup-finishing',
      'segment-analyzing',
      'review-ready',
    ]);
    assert.deepEqual(result.lifecycle, lifecycle);
    assert.deepEqual(coordination, ['wait:pickup-preparing', 'capture']);
    assert.equal(extractedFrames.length, 4);
    assert.equal(extractedAtMs[0], 0);
    assert.equal(extractedAtMs[1], probe.durationMs - 100);
    assert.ok(extractedFrames.every((framePath) => !path.relative(runDir, framePath).startsWith('..')));
    assert.equal(comparisonRequests.length, 1);
    assert.equal(comparisonRequests[0]!.pickup.segmentId, 'segment-003');
    assert.deepEqual({
      segmentId: comparisonRequests[0]!.previous!.segmentId,
      sourceId: comparisonRequests[0]!.previous!.sourceId,
      atMs: comparisonRequests[0]!.previous!.atMs,
    }, { segmentId: 'segment-002', sourceId: 'original', atMs: 2000 });
    assert.deepEqual({
      segmentId: comparisonRequests[0]!.next!.segmentId,
      sourceId: comparisonRequests[0]!.next!.sourceId,
      atMs: comparisonRequests[0]!.next!.atMs,
    }, { segmentId: 'segment-004', sourceId: 'original', atMs: 3000 });
    assert.equal(result.continuityGate.status, 'pickup-required');
    assert.match(result.continuityGate.reviewReasons.join('\n'), /明显不连续/);

    const catalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
    assert.deepEqual(catalog.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      segmentId: source.segmentId,
      attempt: source.attempt,
      status: source.status,
    })), [
      { id: 'original', kind: 'original', segmentId: null, attempt: null, status: 'available' },
      { id: 'segment-003-attempt-001', kind: 'pickup', segmentId: 'segment-003', attempt: 1, status: 'available' },
    ]);
    const manifest = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as RecordingManifest;
    assert.deepEqual(manifest.attempts, result.attempts);
    assert.deepEqual(manifest.attempts.map((attempt) => [attempt.actionId, attempt.attempt, attempt.status]), [
      ['action-003', 1, 'discarded'],
      ['action-003', 2, 'confirmed'],
      ['action-003b', 1, 'confirmed'],
    ]);

    const prepared = await prepareEditAgentRequest({ runDir, segmentId: 'segment-003' });
    const request = JSON.parse(await readFile(prepared.requestPath, 'utf8')) as {
      continuityKeyframes: {
        pickup: { firstFramePath: string; lastFramePath: string };
        previous: { framePath: string } | null;
        next: { framePath: string } | null;
      };
    };
    const continuityPaths = [
      request.continuityKeyframes.pickup.firstFramePath,
      request.continuityKeyframes.pickup.lastFramePath,
      request.continuityKeyframes.previous!.framePath,
      request.continuityKeyframes.next!.framePath,
    ];
    await Promise.all(continuityPaths.map((framePath) => access(framePath)));
    assert.ok(continuityPaths.every((framePath) => !path.relative(runDir, framePath).startsWith('..')));

    assert.equal(await readFile(bundle.versionedEditPath('edit-review', 1), 'utf8'), reviewBytes);
    assert.equal(await readFile(bundle.versionedEditPath('edit-plan.effective', 1), 'utf8'), effectiveBytes);
    const currentReview = JSON.parse(reviewBytes) as EditReview;
    assert.equal(currentReview.segments[2]!.status, 'pickup-required');
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});

test('pickup controller honors the attempt reserved by the Electron composition', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-pickup-reserved-'));
  try {
    const { bundle } = await createRunFixture(runDir);
    await mkdir(bundle.pickupsDir, { recursive: true });
    await writeFile(
      path.join(bundle.pickupsDir, 'segment-003-attempt-002.events.jsonl'),
      '',
      'utf8',
    );

    const result = await runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'borderless-maximized',
      deps: {
        reservedPickupAttempt: 2,
        waitForStart: async () => undefined,
        capture: async (input) => {
          assert.equal(input.attempt, 2);
          assert.equal(input.sourceId, 'segment-003-attempt-002');
          return {
            ok: false,
            errorMessage: 'intentional reserved-attempt failure',
            startMs: 100,
            endMs: 200,
            firstFramePath: null,
            lastFramePath: null,
            attempts: [{
              actionId: 'action-003',
              segmentId: 'segment-003',
              sourceId: input.sourceId,
              attempt: 1,
              startMs: 100,
              endMs: 200,
              confirmedAtMs: null,
              status: 'discarded',
            }],
          };
        },
        probe: async () => { throw new Error('intentional unprobeable artifact'); },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.sourceId, 'segment-003-attempt-002');
    const catalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
    assert.equal(catalog.sources.at(-1)?.id, 'segment-003-attempt-002');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('pickup controller rejects absent/non-pickup segments and catalogs a probeable failed source', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-pickup-failed-'));
  try {
    const { bundle } = await createRunFixture(runDir);
    let captureCalls = 0;
    await assert.rejects(() => runManualPickupController({
      runDir,
      segmentId: '../segment-003',
      displayMode: 'f11',
      deps: {
        capture: async () => { captureCalls += 1; throw new Error('must not capture'); },
        probe: async () => probe,
      },
    }), /segmentId|invalid|非法/i);
    await assert.rejects(() => runManualPickupController({
      runDir,
      segmentId: 'segment-999',
      displayMode: 'f11',
      deps: {
        capture: async () => { captureCalls += 1; throw new Error('must not capture'); },
        probe: async () => probe,
      },
    }), /segment-999.*exist|不存在/i);
    await assert.rejects(() => runManualPickupController({
      runDir,
      segmentId: 'segment-002',
      displayMode: 'f11',
      deps: {
        capture: async () => { captureCalls += 1; throw new Error('must not capture'); },
        probe: async () => probe,
      },
    }), /pickup-required/i);
    assert.equal(captureCalls, 0);
    await assert.rejects(() => runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'f11',
    }), /runtime adapter.*unavailable|capture session.*start-signal/i);

    await assert.rejects(() => runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'f11',
      deps: {
        waitForStart: async () => undefined,
        capture: async (input) => ({
          ok: false,
          errorMessage: 'invalid adapter attempt',
          startMs: 0,
          endMs: null,
          firstFramePath: null,
          lastFramePath: null,
          attempts: [{
            actionId: 'action-outside-scope',
            segmentId: 'segment-003',
            sourceId: input.sourceId,
            attempt: 1,
            startMs: 0,
            endMs: null,
            confirmedAtMs: null,
            status: 'discarded',
          }],
        }),
        probe: async () => probe,
      },
    }), /actionId.*outside target Segment/i);
    const catalogBeforeFailedCapture = JSON.parse(
      await readFile(bundle.sourceCatalogPath, 'utf8'),
    ) as ManualSourceCatalog;
    assert.equal(catalogBeforeFailedCapture.sources.length, 1);

    const result = await runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'f11',
      deps: {
        capture: async (input) => {
          await writeFile(input.outputPath, 'partial-pickup', 'utf8');
          return {
            ok: false,
            errorMessage: 'capture binding was lost',
            startMs: 100,
            endMs: 180,
            firstFramePath: null,
            lastFramePath: null,
            attempts: [{
              actionId: 'action-003',
              segmentId: 'segment-003',
              sourceId: input.sourceId,
              attempt: 1,
              startMs: 100,
              endMs: 180,
              confirmedAtMs: null,
              status: 'discarded',
            }],
          };
        },
        probe: async () => ({ ...probe, durationMs: 200 }),
        waitForStart: async () => undefined,
        now: () => new Date('2026-07-28T02:00:00.000Z'),
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.errorMessage, /binding was lost/);
    assert.equal(result.attempts[0]!.status, 'discarded');
    const catalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
    assert.equal(catalog.sources.at(-1)!.status, 'failed');
    assert.equal(catalog.sources.at(-1)!.segmentId, 'segment-003');
    const manifest = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as RecordingManifest;
    assert.equal(manifest.attempts.at(-1)!.status, 'discarded');

    const catalogLengthBeforeUnprobeableFailure = catalog.sources.length;
    const unprobeable = await runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'f11',
      deps: {
        capture: async (input) => ({
          ok: false,
          errorMessage: 'capture failed before creating an artifact',
          startMs: 0,
          endMs: null,
          firstFramePath: null,
          lastFramePath: null,
          attempts: [{
            actionId: 'action-003',
            segmentId: 'segment-003',
            sourceId: input.sourceId,
            attempt: 1,
            startMs: 0,
            endMs: null,
            confirmedAtMs: null,
            status: 'discarded',
          }],
        }),
        probe: async () => { throw new Error('pickup artifact is not probeable'); },
        waitForStart: async () => undefined,
      },
    });
    assert.equal(unprobeable.ok, false);
    assert.match(unprobeable.errorMessage, /capture failed before creating an artifact/);
    const catalogAfterUnprobeableFailure = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as ManualSourceCatalog;
    assert.equal(catalogAfterUnprobeableFailure.sources.length, catalogLengthBeforeUnprobeableFailure + 1);
    const failed = catalogAfterUnprobeableFailure.sources.at(-1)!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.durationMs, null);
    assert.match(failed.status === 'failed' ? failed.failureReason : '', /capture failed before creating an artifact/);
    const manifestAfterUnprobeableFailure = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as RecordingManifest;
    assert.deepEqual(manifestAfterUnprobeableFailure.attempts.slice(-1), unprobeable.attempts);

    await writeFile(bundle.approvedGuidePath, JSON.stringify({
      version: 1,
      guidePath: path.resolve(runDir, '..', 'outside-guide.json'),
      approvedAt: '2026-07-28T00:00:00.000Z',
    }), 'utf8');
    await assert.rejects(() => runManualPickupController({
      runDir,
      segmentId: 'segment-003',
      displayMode: 'f11',
    }), /approved guide.*outside|outside run directory/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
