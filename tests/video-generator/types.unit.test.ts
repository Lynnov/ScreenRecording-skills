import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Timeline } from '../../src/lib/video-generator/types.js';

test('timeline supports top-level continuous recording assets', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Continuous recording',
    assets: { continuousClipPath: '/clips/full.webm' },
    segments: [
      {
        id: 'seg-001',
        sourceText: 'source',
        narration: 'narration',
        subtitle: 'subtitle',
        actions: [
          { type: 'waitFor', target: { type: 'selector', value: '.ready' } },
          { type: 'scrollTo', target: { type: 'selector', value: '.card' } },
        ],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: {},
      },
    ],
  };

  assert.equal(timeline.assets?.continuousClipPath, '/clips/full.webm');
  assert.equal(timeline.segments[0]?.actions[1]?.type, 'scrollTo');
});
