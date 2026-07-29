import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import {
  createNarrationAgentRequest,
  validateNarrationAgentResponseForRequest,
} from '../../src/lib/video-generator/manual/narration-request.js';
import {
  applyNarrationAgentResponse,
  approveNarrationVersion,
  parseNarrationMarkdown,
  prepareNarrationAgentRequest,
} from '../../src/lib/video-generator/manual/narration-response.js';
import type { RecordingGuide } from '../../src/lib/video-generator/manual/types.js';
import type { PreviewTimeline } from '../../src/lib/video-generator/editing/types.js';

const guide: RecordingGuide = {
  version: 1,
  startUrl: 'https://example.test',
  actions: [
    {
      id: 'action-001',
      segmentId: 'segment-001',
      title: '保存设置',
      instruction: '点击保存并确认成功提示',
      expectedEvents: [{ type: 'click', target: '保存' }],
      expectedResults: [{ type: 'text-visible', text: '保存成功' }],
    },
  ],
};

const preview: PreviewTimeline = {
  version: 1,
  durationMs: 2400,
  segments: [{
    segmentId: 'segment-001',
    startsAtMs: 0,
    contentEndsAtMs: 2000,
    endsAtMs: 2400,
    clips: [],
  }],
};

test('narration request includes approved semantics and available duration', () => {
  const request = createNarrationAgentRequest({ approvedGuide: guide, effectivePreviewTimeline: preview });
  assert.equal(request.kind, 'manual-narration-request');
  assert.equal(request.segments[0]?.availableDurationMs, 2400);
  assert.deepEqual(request.segments[0]?.semanticConstraints, {
    title: '保存设置',
    instruction: '点击保存并确认成功提示',
    expectedResults: guide.actions[0]?.expectedResults,
    preserveBusinessFacts: true,
  });
});

test('narration response rejects missing extra duplicate and out-of-order segment ids', () => {
  const request = createNarrationAgentRequest({
    approvedGuide: {
      ...guide,
      actions: [guide.actions[0]!, { ...guide.actions[0]!, id: 'action-002', segmentId: 'segment-002' }],
    },
    effectivePreviewTimeline: {
      ...preview,
      segments: [
        preview.segments[0]!,
        { ...preview.segments[0]!, segmentId: 'segment-002', startsAtMs: 2400, contentEndsAtMs: 4000, endsAtMs: 4200 },
      ],
      durationMs: 4200,
    },
  });
  const base = {
    version: 1,
    kind: 'manual-narration-response',
    requestVersion: 1,
    producer: { agentId: 'agent', generatedAt: '2026-07-29T00:00:00.000Z' },
    warnings: [],
  } as const;
  const segment = (segmentId: string) => ({ segmentId, text: `旁白 ${segmentId}`, estimatedDurationMs: 1000 });
  assert.throws(() => validateNarrationAgentResponseForRequest({ ...base, segments: [segment('segment-001')] }, request), /missing|exactly/i);
  assert.throws(() => validateNarrationAgentResponseForRequest({ ...base, segments: [segment('segment-001'), segment('segment-003')] }, request), /segment-002|order/i);
  assert.throws(() => validateNarrationAgentResponseForRequest({ ...base, segments: [segment('segment-001'), segment('segment-001')] }, request), /duplicate|order/i);
  assert.throws(() => validateNarrationAgentResponseForRequest({ ...base, segments: [segment('segment-002'), segment('segment-001')] }, request), /order/i);
});

test('approved narration parser preserves multiple Markdown paragraphs per Segment', () => {
  assert.deepEqual(parseNarrationMarkdown(
    '# Final Narration\n\n## segment-001\n\nFirst paragraph.\n\nSecond paragraph.\n\n## segment-002\n\nDone.\n',
  ), [
    { segmentId: 'segment-001', text: 'First paragraph.\n\nSecond paragraph.' },
    { segmentId: 'segment-002', text: 'Done.' },
  ]);
});

test('narration prepare apply and approve preserve versioned artifacts', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-narration-'));
  const bundle = createManualBundle(runDir);
  await Promise.all([mkdir(bundle.scriptsDir, { recursive: true }), mkdir(bundle.agentDir, { recursive: true }), mkdir(bundle.editDir, { recursive: true }), mkdir(bundle.captureDir, { recursive: true })]);
  const guidePath = bundle.versionedScriptPath('recording-guide', 1);
  await writeFile(guidePath, `${JSON.stringify(guide)}\n`);
  await writeFile(bundle.approvedGuidePath, `${JSON.stringify({ version: 1, guideVersion: 1, guidePath, approvedAt: '2026-07-29T00:00:00.000Z' })}\n`);
  await writeFile(bundle.previewTimelinePath, `${JSON.stringify(preview)}\n`);
  const source = { id: 'source-001', path: path.join(bundle.captureDir, 'original-window.mp4'), kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-29T00:00:00.000Z', durationMs: 2000, width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false };
  await writeFile(bundle.sourceCatalogPath, `${JSON.stringify({ version: 1, sources: [source] })}\n`);
  const effectivePath = bundle.versionedEditPath('edit-plan.effective', 1);
  await writeFile(effectivePath, `${JSON.stringify({ version: 1, canvas: { width: 1920, height: 1080, fps: 30 }, segments: [{ segmentId: 'segment-001', title: '保存设置', clips: [{ sourceId: 'source-001', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 1 }], holdLastFrameMs: 400, confidence: 'high', reason: 'approved' }] })}\n`);
  await writeFile(bundle.effectiveCurrentPlanPath, `${JSON.stringify({ version: 1, path: effectivePath })}\n`);
  await writeFile(bundle.reviewCurrentPath, `${JSON.stringify({ version: 1, path: path.join(bundle.editDir, 'edit-review.v01.json') })}\n`);
  await writeFile(path.join(bundle.editDir, 'edit-review.v01.json'), `${JSON.stringify({ version: 1, reviewComplete: true, createdAt: '2026-07-29T00:00:00.000Z', segments: [{ segmentId: 'segment-001', status: 'approved', reviewReasons: [] }] })}\n`);

  const prepared = await prepareNarrationAgentRequest({ runDir });
  const responsePath = bundle.versionedAgentPath('narration-response', prepared.requestVersion);
  await writeFile(responsePath, `${JSON.stringify({
    version: 1,
    kind: 'manual-narration-response',
    requestVersion: 1,
    producer: { agentId: 'agent', generatedAt: '2026-07-29T00:00:00.000Z' },
    segments: [{ segmentId: 'segment-001', text: '点击保存，确认保存成功。', estimatedDurationMs: 1800 }],
    warnings: [],
  })}\n`);

  const applied = await applyNarrationAgentResponse({ runDir, responsePath });
  assert.match(await readFile(applied.narrationPath, 'utf8'), /segment-001[\s\S]*点击保存/);
  const approved = await approveNarrationVersion({ runDir, version: 1, approvedAt: '2026-07-29T01:00:00.000Z' });
  assert.equal(approved.narrationPath, applied.narrationPath);
  assert.deepEqual(JSON.parse(await readFile(bundle.approvedNarrationPath, 'utf8')), approved);
});
