import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_EXPECTED_EVENT_TYPES,
  ALLOWED_EXPECTED_RESULT_TYPES,
  validateAgentProducer,
  validateGuideAgentResponse,
  validateManualSourceCatalog,
  validateRecordingGuide,
} from '../../src/lib/video-generator/manual/schema.js';
import type { GuideAgentResponse, ManualSourceCatalog, RecordingGuide } from '../../src/lib/video-generator/manual/types.js';

const producer = {
  agentId: 'agent.fixture',
  provider: 'local-test',
  model: 'fixture-model',
  generatedAt: '2026-07-28T00:00:00.000Z',
};

function validGuide(): RecordingGuide {
  return {
    version: 1,
    startUrl: 'https://example.com/form',
    actions: [
      {
        id: 'action-001',
        segmentId: 'segment-001',
        title: '填写名称',
        instruction: '在名称输入框中输入测试名称。',
        expectedEvents: [{ type: 'input', target: '名称输入框' }],
        expectedResults: [{ type: 'text-visible', text: '保存成功' }],
      },
    ],
  };
}

function validGuideResponse(): GuideAgentResponse {
  return {
    version: 1,
    kind: 'manual-guide-response',
    requestVersion: 1,
    producer,
    polishedMarkdown: '# 润色稿',
    executableMarkdown: '# 可执行稿',
    guide: validGuide(),
    warnings: [],
  };
}

test('exports one shared allow-list for expected event and result discriminants', () => {
  assert.deepEqual(ALLOWED_EXPECTED_EVENT_TYPES, ['click', 'input', 'change', 'scroll', 'navigation', 'tab']);
  assert.deepEqual(ALLOWED_EXPECTED_RESULT_TYPES, [
    'dialog-visible',
    'text-visible',
    'url-matches',
    'element-state',
    'selected-value',
    'tab-created',
  ]);
});

test('validates producer metadata for audit without binding a provider', () => {
  validateAgentProducer(producer);
  validateAgentProducer({ agentId: 'agent.only', generatedAt: '2026-07-28T00:00:00.000Z' });

  assert.throws(() => validateAgentProducer({ provider: 'missing-id', generatedAt: producer.generatedAt }), /agentId/);
  assert.throws(() => validateAgentProducer({ agentId: '', generatedAt: producer.generatedAt }), /agentId/);
  assert.throws(() => validateAgentProducer({ agentId: 'agent', generatedAt: 'not-a-date' }), /generatedAt/);
});

test('validates recording guide shape and rejects empty actions, duplicate ids, invalid URL, and unknown expectations', () => {
  const guide = validGuide();
  validateRecordingGuide(guide);

  assert.throws(() => validateRecordingGuide({ ...guide, actions: [] }), /actions/);
  assert.throws(() => validateRecordingGuide({ ...guide, startUrl: 'not a url' }), /startUrl/);
  assert.throws(() => validateRecordingGuide({
    ...guide,
    actions: [guide.actions[0]!, { ...guide.actions[0]! }],
  }), /duplicate/i);
  assert.throws(() => validateRecordingGuide({
    ...guide,
    actions: [{ ...guide.actions[0]!, expectedEvents: [{ type: 'keypress' }] }],
  }), /expectedEvents\[0\]\.type/);
  assert.throws(() => validateRecordingGuide({
    ...guide,
    actions: [{ ...guide.actions[0]!, expectedResults: [{ type: 'toast-magic' }] }],
  }), /expectedResults\[0\]\.type/);
});

test('validates guide agent response kind, version, producer, markdown, guide, and warnings', () => {
  const response = validGuideResponse();
  validateGuideAgentResponse(response);

  assert.throws(() => validateGuideAgentResponse({ ...response, kind: 'manual-edit-response' }), /kind/);
  assert.throws(() => validateGuideAgentResponse({ ...response, version: 2 }), /version/);
  assert.throws(() => validateGuideAgentResponse({ ...response, producer: { agentId: 'x' } }), /generatedAt/);
  assert.throws(() => validateGuideAgentResponse({ ...response, polishedMarkdown: '' }), /polishedMarkdown/);
  assert.throws(() => validateGuideAgentResponse({ ...response, warnings: ['ok', 1] }), /warnings\[1\]/);
});

test('validates manual source catalog including source metadata and pickup fields', () => {
  const catalog: ManualSourceCatalog = {
    version: 1,
    sources: [
      {
        id: 'original',
        path: 'capture/original-window.mp4',
        durationMs: 1000,
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
      },
    ],
  };

  validateManualSourceCatalog(catalog);
  assert.throws(() => validateManualSourceCatalog({ ...catalog, version: 2 }), /version/);
  assert.throws(() => validateManualSourceCatalog({ ...catalog, sources: [catalog.sources[0]!, { ...catalog.sources[0]! }] }), /duplicate/i);
  assert.throws(() => validateManualSourceCatalog({ ...catalog, sources: [{ ...catalog.sources[0]!, durationMs: 0 }] }), /durationMs/);
  assert.throws(() => validateManualSourceCatalog({ ...catalog, sources: [{ ...catalog.sources[0]!, kind: 'pickup', segmentId: null, attempt: 1 }] }), /segmentId/);
});

test('validates auditable failed sources without fabricated media metadata', () => {
  const failed = {
    version: 1,
    sources: [{
      id: 'segment-003-attempt-001',
      path: 'pickups/segment-003-attempt-001.mp4',
      durationMs: null,
      width: null,
      height: null,
      fps: null,
      codecName: null,
      pixelFormat: null,
      hasAudio: null,
      kind: 'pickup',
      segmentId: 'segment-003',
      attempt: 1,
      status: 'failed',
      failureReason: 'capture failed before creating a probeable artifact',
      createdAt: '2026-07-28T00:00:00.000Z',
    }],
  };

  validateManualSourceCatalog(failed);
  assert.throws(
    () => validateManualSourceCatalog({
      ...failed,
      sources: [{ ...failed.sources[0]!, failureReason: '' }],
    }),
    /failureReason/,
  );
  assert.throws(
    () => validateManualSourceCatalog({
      ...failed,
      sources: [{ ...failed.sources[0]!, status: 'available' }],
    }),
    /durationMs|available/i,
  );
});
