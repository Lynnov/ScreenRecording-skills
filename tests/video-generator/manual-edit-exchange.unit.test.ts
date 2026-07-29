import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import {
  applyEditAgentResponse,
  createEditAgentRequest,
  prepareEditAgentRequest,
  validateEditAgentResponseForRequest,
} from '../../src/lib/video-generator/manual/edit-request.js';
import type { EditAgentResponse } from '../../src/lib/video-generator/manual/edit-response.js';
import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';
import type { RecordingGuide } from '../../src/lib/video-generator/manual/types.js';
import type { ManualSourceCatalog } from '../../src/lib/video-generator/manual/types.js';
import type { RecordingManifest } from '../../src/lib/video-generator/recording/types.js';

async function withTempDir(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `manual-edit-${process.pid}-${Date.now()}-${name}`);
  await mkdir(dir, { recursive: true });
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const guide: RecordingGuide = {
  version: 1,
  startUrl: 'https://example.com/form',
  actions: [{
    id: 'action-001',
    segmentId: 'segment-001',
    title: '填写名称',
    instruction: '填写名称。',
    expectedEvents: [{ type: 'input', target: '名称' }],
    expectedResults: [{ type: 'text-visible', text: '保存成功' }],
  }],
};

function sourceCatalog(runDir: string): ManualSourceCatalog {
  return {
    version: 1,
    sources: [{
      id: 'original',
      path: path.join(runDir, 'capture', 'original-window.mp4'),
      durationMs: 3000,
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
}

function manifest(runDir: string): RecordingManifest {
  const bundle = createManualBundle(runDir);
  return {
    version: 1,
    platform: 'win32',
    video: { status: 'available', path: bundle.originalVideoPath, width: 1920, height: 1080, fps: 30, durationMs: 3000, hasAudio: false },
    rawVideoPath: bundle.rawVideoPath,
    eventsPath: bundle.eventsPath,
    tabsPath: bundle.tabsPath,
    recordingStartMs: 0,
    recordingEndMs: 3000,
    firstVideoFrameSessionTimeMs: 0,
    attempts: [{ actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original', attempt: 1, startMs: 0, endMs: 2500, confirmedAtMs: 2500, status: 'confirmed' }],
    clockStatus: 'ok',
    slopePpm: 0,
    maxResidualMs: 0,
    maxAllowedResidualMs: 250,
    ffprobeDurationDeltaMs: 0,
    maxAllowedFfprobeDurationDeltaMs: 250,
    markerEvidence: [],
    captureComplete: true,
  };
}

function response(): EditAgentResponse {
  return {
    version: 1,
    kind: 'manual-edit-response',
    requestVersion: 1,
    producer: { agentId: 'agent.fixture', generatedAt: '2026-07-28T00:00:00.000Z' },
    plan: {
      version: 1,
      canvas: { width: 1920, height: 1080, fps: 30 },
      segments: [{
        segmentId: 'segment-001',
        title: '填写名称',
        clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 2500, playbackRate: 1 }],
        confidence: 'high',
        reason: '保留完整操作和结果。',
      }],
    },
    decisions: [{ segmentId: 'segment-001', confidence: 'high', reason: '事件与结果匹配。', reviewReasons: [] }],
  };
}

test('createEditAgentRequest includes approved guide manifest catalog events keyframes and constraints', () => {
  const request = createEditAgentRequest({
    approvedGuide: guide,
    manifest: manifest('run'),
    events: [{ type: 'recording-start', sessionTimeMs: 0, videoTimeMs: 0 }],
    sourceCatalog: sourceCatalog('run'),
    keyframes: [{ atMs: 0, reason: 'recording-start', fileName: 'frame-000000.png' }],
  });

  assert.equal(request.version, 1);
  assert.equal(request.kind, 'manual-edit-request');
  assert.deepEqual(request.constraints, {
    noFullVideoUpload: true,
    maxNormalPlaybackRate: 2,
    maxHoldMs: 5000,
    requireReviewReasonsForLowConfidence: true,
  });
  assert.equal(request.approvedGuide.actions[0]?.id, 'action-001');
  assert.equal(request.keyframes.length, 1);
});

test('validateEditAgentResponseForRequest rejects wrong kind/version and low confidence without review reason', () => {
  const request = createEditAgentRequest({ approvedGuide: guide, manifest: manifest('run'), events: [], sourceCatalog: sourceCatalog('run'), keyframes: [] });
  validateEditAgentResponseForRequest(response(), request);

  assert.throws(() => validateEditAgentResponseForRequest({ ...response(), kind: 'wrong' }, request), /kind/);
  assert.throws(() => validateEditAgentResponseForRequest({ ...response(), requestVersion: 2 }, request), /requestVersion/);
  const low = response();
  low.decisions = [{ segmentId: 'segment-001', confidence: 'low', reason: '不确定。', reviewReasons: [] }];
  low.plan.segments[0]!.confidence = 'low';
  assert.throws(() => validateEditAgentResponseForRequest(low, request), /reviewReasons/);
});

test('prepare/apply edit agent response writes immutable plan report and current pointer', async () => {
  await withTempDir('apply', async (runDir) => {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.scriptsDir, { recursive: true });
    await mkdir(bundle.captureDir, { recursive: true });
    await writeFile(bundle.versionedScriptPath('recording-guide', 1), JSON.stringify(guide, null, 2), 'utf8');
    await writeFile(bundle.approvedGuidePath, JSON.stringify({ version: 1, guideVersion: 1, guidePath: bundle.versionedScriptPath('recording-guide', 1), approvedAt: '2026-07-28T00:00:00.000Z' }), 'utf8');
    await writeFile(bundle.recordingManifestPath, JSON.stringify(manifest(runDir), null, 2), 'utf8');
    await writeFile(bundle.sourceCatalogPath, JSON.stringify(sourceCatalog(runDir), null, 2), 'utf8');
    await writeFile(bundle.eventsPath, '{"type":"recording-start","sessionTimeMs":0,"videoTimeMs":0}\n', 'utf8');

    const prepared = await prepareEditAgentRequest({ runDir });
    assert.equal(prepared.requestVersion, 1);
    const responsePath = bundle.versionedAgentPath('edit-response', 1);
    await writeFile(responsePath, JSON.stringify(response(), null, 2), 'utf8');

    const applied = await applyEditAgentResponse({ runDir, responsePath });

    assert.equal(applied.version, 1);
    assert.deepEqual(JSON.parse(await readFile(bundle.versionedEditPath('edit-plan.agent', 1), 'utf8')), response().plan);
    assert.deepEqual(JSON.parse(await readFile(bundle.agentCurrentPlanPath, 'utf8')), { version: 1, path: bundle.versionedEditPath('edit-plan.agent', 1) });
    assert.match(await readFile(bundle.versionedEditPath('edit-report.agent', 1), 'utf8'), /事件与结果匹配/);
  });
});

test('segment-scoped prepare filters guide actions and apply rejects changes outside the target Segment', async () => {
  await withTempDir('segment-scope', async (runDir) => {
    const bundle = createManualBundle(runDir);
    await Promise.all([
      mkdir(bundle.scriptsDir, { recursive: true }),
      mkdir(bundle.agentDir, { recursive: true }),
      mkdir(bundle.captureDir, { recursive: true }),
      mkdir(bundle.editDir, { recursive: true }),
    ]);
    const scopedGuide: RecordingGuide = {
      ...guide,
      actions: [
        guide.actions[0]!,
        {
          ...guide.actions[0]!,
          id: 'action-002',
          segmentId: 'segment-002',
          title: '保存',
          instruction: '保存。',
        },
      ],
    };
    const baselinePlan: EditPlan = {
      version: 1,
      canvas: { width: 1920, height: 1080, fps: 30 },
      segments: [
        {
          segmentId: 'segment-001',
          title: '填写名称',
          clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }],
          confidence: 'high',
          reason: '已确认。',
        },
        {
          segmentId: 'segment-002',
          title: '保存',
          clips: [{ sourceId: 'original', sourceStartMs: 1000, sourceEndMs: 2000, playbackRate: 1 }],
          confidence: 'low',
          reason: '需要补录。',
        },
      ],
    };
    const guidePath = bundle.versionedScriptPath('recording-guide', 1);
    const baselinePath = bundle.versionedEditPath('edit-plan.agent', 1);
    await writeFile(guidePath, JSON.stringify(scopedGuide, null, 2), 'utf8');
    await writeFile(bundle.approvedGuidePath, JSON.stringify({ version: 1, guideVersion: 1, guidePath, approvedAt: '2026-07-28T00:00:00.000Z' }), 'utf8');
    await writeFile(bundle.recordingManifestPath, JSON.stringify(manifest(runDir), null, 2), 'utf8');
    const scopedCatalog = sourceCatalog(runDir);
    scopedCatalog.sources.push({
      id: 'segment-002-attempt-001',
      path: path.join(runDir, 'pickups', 'segment-002-attempt-001.mp4'),
      durationMs: 800,
      width: 1920,
      height: 1080,
      fps: 30,
      codecName: 'h264',
      pixelFormat: 'yuv420p',
      hasAudio: false,
      kind: 'pickup',
      segmentId: 'segment-002',
      attempt: 1,
      status: 'available',
      createdAt: '2026-07-28T00:30:00.000Z',
    });
    await writeFile(bundle.sourceCatalogPath, JSON.stringify(scopedCatalog, null, 2), 'utf8');
    await writeFile(bundle.eventsPath, [
      '{"type":"action-confirmed","sessionTimeMs":1000,"videoTimeMs":1000,"payload":{"actionId":"action-001","segmentId":"segment-001"}}',
      '{"type":"action-confirmed","sessionTimeMs":2000,"videoTimeMs":2000,"payload":{"actionId":"action-002","segmentId":"segment-002"}}',
      '',
    ].join('\n'), 'utf8');
    await writeFile(baselinePath, JSON.stringify(baselinePlan, null, 2), 'utf8');
    await writeFile(bundle.agentCurrentPlanPath, JSON.stringify({ version: 1, path: baselinePath }), 'utf8');
    await writeFile(bundle.versionedAgentPath('edit-request', 1), JSON.stringify({ prior: true }), 'utf8');

    const prepared = await prepareEditAgentRequest({ runDir, segmentId: 'segment-002' });
    const request = JSON.parse(await readFile(prepared.requestPath, 'utf8')) as {
      scope: { segmentId: string; baselinePlan: EditPlan; requiredSourceId: string };
      approvedGuide: RecordingGuide;
      events: Array<{ payload?: { segmentId?: string } }>;
    };
    assert.equal(request.scope.segmentId, 'segment-002');
    assert.equal(request.scope.requiredSourceId, 'segment-002-attempt-001');
    assert.deepEqual(request.scope.baselinePlan, baselinePlan);
    assert.deepEqual(request.approvedGuide.actions.map((action) => action.id), ['action-002']);
    assert.deepEqual(request.events.map((event) => event.payload?.segmentId), ['segment-002']);

    const scopedResponse: EditAgentResponse = {
      version: 1,
      kind: 'manual-edit-response',
      requestVersion: prepared.requestVersion,
      producer: { agentId: 'agent.fixture', generatedAt: '2026-07-28T00:00:00.000Z' },
      plan: {
        ...baselinePlan,
        segments: [
          baselinePlan.segments[0]!,
          {
            ...baselinePlan.segments[1]!,
            clips: [{ sourceId: 'original', sourceStartMs: 1200, sourceEndMs: 1900, playbackRate: 1 }],
            confidence: 'medium',
            reason: '只重算目标 Segment。',
          },
        ],
      },
      decisions: [{ segmentId: 'segment-002', confidence: 'medium', reason: '已重算。', reviewReasons: ['仍需审核。'] }],
    };
    const responsePath = bundle.versionedAgentPath('edit-response', prepared.requestVersion);
    await writeFile(responsePath, JSON.stringify(scopedResponse, null, 2), 'utf8');
    await assert.rejects(
      () => applyEditAgentResponse({ runDir, responsePath }),
      /requiredSourceId|segment-002-attempt-001|required pickup/i,
    );

    scopedResponse.plan.segments[1] = {
      ...scopedResponse.plan.segments[1]!,
      clips: [{ sourceId: 'segment-002-attempt-001', sourceStartMs: 0, sourceEndMs: 700, playbackRate: 1 }],
    };
    await writeFile(responsePath, JSON.stringify(scopedResponse, null, 2), 'utf8');
    await applyEditAgentResponse({ runDir, responsePath });

    const invalidResponse = structuredClone(scopedResponse);
    invalidResponse.plan.segments[0] = { ...invalidResponse.plan.segments[0]!, reason: '越权修改。' };
    const invalidPath = path.join(bundle.agentDir, `nested-edit-response.v${String(prepared.requestVersion).padStart(2, '0')}.json`);
    await writeFile(invalidPath, JSON.stringify(invalidResponse, null, 2), 'utf8');
    await assert.rejects(
      () => applyEditAgentResponse({ runDir, responsePath: invalidPath }),
      /outside target|segment-001|非目标/i,
    );
    await assert.rejects(
      () => prepareEditAgentRequest({ runDir, segmentId: '../segment-002' }),
      /segmentId|invalid|非法/i,
    );
  });
});
