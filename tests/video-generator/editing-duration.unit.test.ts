import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateEditClipDurationMs,
  calculateEditSegmentDurationMs,
} from '../../src/lib/video-generator/editing/duration.js';

test('calculates rounded clip output duration from source range and playback rate', () => {
  assert.equal(calculateEditClipDurationMs({
    sourceId: 'original',
    sourceStartMs: 0,
    sourceEndMs: 2001,
    playbackRate: 2,
  }), 1001);
});

test('adds clip durations and hold without subtracting short-fade duration', () => {
  assert.equal(calculateEditSegmentDurationMs({
    segmentId: 'segment-1',
    title: 'one',
    confidence: 'high',
    reason: 'fixture',
    transition: 'short-fade',
    holdLastFrameMs: 500,
    clips: [
      { sourceId: 'original', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 2 },
      { sourceId: 'pickup', sourceStartMs: 0, sourceEndMs: 250, playbackRate: 1 },
    ],
  }), 1750);
});
