import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderSrt } from '../../src/lib/video-generator/subtitles.js';
import type { Timeline } from '../../src/lib/video-generator/types.js';

test('renderSrt uses explicit segment start and end timestamps', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Subtitles',
    segments: [
      {
        id: 'intro',
        sourceText: 'intro',
        narration: 'intro',
        subtitle: '欢迎使用 CodePilot',
        actions: [],
        estimatedDurationMs: 1000,
        bufferMs: 500,
        startsAtMs: 0,
        endsAtMs: 2000,
        assets: {},
      },
      {
        id: 'details',
        sourceText: 'details',
        narration: 'details',
        subtitle: '现在打开设置页面',
        actions: [],
        estimatedDurationMs: 1000,
        bufferMs: 500,
        startsAtMs: 2000,
        endsAtMs: 4500,
        assets: {},
      },
    ],
  };

  assert.equal(renderSrt(timeline), [
    '1',
    '00:00:00,000 --> 00:00:02,000',
    '欢迎使用 CodePilot',
    '',
    '2',
    '00:00:02,000 --> 00:00:04,500',
    '现在打开设置页面',
    '',
  ].join('\n'));
});

test('renderSrt accumulates durations when explicit timestamps are missing', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Subtitles',
    segments: [
      {
        id: 'intro',
        sourceText: 'intro',
        narration: 'intro',
        subtitle: '第一段',
        actions: [],
        estimatedDurationMs: 1000,
        actualAudioDurationMs: 1500,
        bufferMs: 500,
        assets: {},
      },
      {
        id: 'details',
        sourceText: 'details',
        narration: 'details',
        subtitle: '第二段',
        actions: [],
        estimatedDurationMs: 1250,
        bufferMs: 250,
        assets: {},
      },
    ],
  };

  assert.equal(renderSrt(timeline), [
    '1',
    '00:00:00,000 --> 00:00:02,000',
    '第一段',
    '',
    '2',
    '00:00:02,000 --> 00:00:03,500',
    '第二段',
    '',
  ].join('\n'));
});
