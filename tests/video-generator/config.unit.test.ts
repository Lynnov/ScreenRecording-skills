import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadVideoGeneratorConfig } from '../../src/lib/video-generator/config.js';

test('loadVideoGeneratorConfig returns the Phase 1 defaults', () => {
  assert.deepEqual(loadVideoGeneratorConfig(), {
    viewport: { width: 1920, height: 1080 },
    speechRateCharsPerMinute: 220,
    segmentBufferMs: 500,
    actionTimeoutMs: 15000,
    ttsProvider: 'aliyun',
    subtitleMode: 'burn-in',
    outputDir: './video-runs',
  });
});

test('loadVideoGeneratorConfig merges overrides without dropping nested viewport defaults', () => {
  assert.deepEqual(loadVideoGeneratorConfig({ viewport: { width: 1280 }, outputDir: './custom' }), {
    viewport: { width: 1280, height: 1080 },
    speechRateCharsPerMinute: 220,
    segmentBufferMs: 500,
    actionTimeoutMs: 15000,
    ttsProvider: 'aliyun',
    subtitleMode: 'burn-in',
    outputDir: './custom',
  });
});
