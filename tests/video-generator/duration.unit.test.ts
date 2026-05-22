import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateSegmentDurationMs,
  countChineseVisibleChars,
  estimateNarrationDurationMs,
} from '../../src/lib/video-generator/duration.js';

test('countChineseVisibleChars counts Han letters and digits while ignoring punctuation and spaces', () => {
  assert.equal(countChineseVisibleChars('你好，CodePilot 2.0!'), 13);
});

test('estimateNarrationDurationMs rounds up duration from visible characters and speaking rate', () => {
  assert.equal(estimateNarrationDurationMs('你好ABC123', 220), 2182);
});

test('calculateSegmentDurationMs uses the larger narration estimate or actual audio plus buffer', () => {
  assert.equal(calculateSegmentDurationMs({ estimatedMs: 1000, actualAudioMs: 1501.2, bufferMs: 500 }), 2002);
  assert.equal(calculateSegmentDurationMs({ estimatedMs: 1200.1, bufferMs: 300 }), 1501);
});
