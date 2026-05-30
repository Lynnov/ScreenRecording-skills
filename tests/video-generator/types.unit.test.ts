import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Timeline } from '../../src/lib/video-generator/types.js';

test('timeline supports top-level continuous recording assets and stage definitions', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Continuous recording',
    assets: { continuousClipPath: '/clips/full.webm' },
    stages: [
      { name: 'orderEntry.list', anchors: [] },
      { name: 'orderEntry.createDialog', scope: '.el-dialog:visible', anchors: ['text=新增订单'] },
    ],
    segments: [
      {
        id: 'seg-001',
        sourceText: 'source',
        narration: 'narration',
        subtitle: 'subtitle',
        actions: [
          { type: 'waitFor', target: { type: 'selector', value: '.ready' }, stageName: 'orderEntry.list' },
          { type: 'scrollTo', target: { type: 'selector', value: '.card' }, stageName: 'orderEntry.list' },
        ],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: {},
      },
    ],
  };

  assert.equal(timeline.assets?.continuousClipPath, '/clips/full.webm');
  assert.equal(timeline.stages?.[1]?.scope, '.el-dialog:visible');
  assert.equal(timeline.segments[0]?.actions[1]?.type, 'scrollTo');
  assert.equal(timeline.segments[0]?.actions[1]?.stageName, 'orderEntry.list');
});
