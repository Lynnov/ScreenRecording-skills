import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatReviewStatus,
  formatSegmentLabel,
  formatSourceLabel,
  formatWaitStrategy,
  getSegmentPlaybackRange,
} from '../../src/lib/video-generator/review-ui/review-presenter.js';

const timeline = {
  segments: [
    { segmentId: 'segment-001', startsAtMs: 0, endsAtMs: 12_000 },
    { segmentId: 'segment-002', startsAtMs: 14_000, endsAtMs: 20_800 },
  ],
};

test('gets the selected segment playback interval in seconds', () => {
  assert.deepEqual(getSegmentPlaybackRange(timeline, 'segment-002'), {
    startSeconds: 14,
    endSeconds: 20.8,
  });
});

test('rejects missing and malformed preview timeline segments', () => {
  assert.throws(() => getSegmentPlaybackRange(timeline, 'segment-003'), /找不到片段.*segment-003/);
  assert.throws(() => getSegmentPlaybackRange({ segments: [] }, 'segment-001'), /找不到片段/);
  assert.throws(() => getSegmentPlaybackRange({
    segments: [{ segmentId: 'segment-001', startsAtMs: 1000, endsAtMs: 1000 }],
  }, 'segment-001'), /播放区间无效/);
});

test('formats review protocol values as concise Chinese labels', () => {
  assert.equal(formatReviewStatus('approved'), '已通过');
  assert.equal(formatReviewStatus('pickup-required'), '需要补录');
  assert.equal(formatReviewStatus('rejected'), '已拒绝');
  assert.equal(formatReviewStatus('unexpected'), '状态未知');
  assert.equal(formatWaitStrategy('keep'), '保留');
  assert.equal(formatWaitStrategy('compress'), '压缩等待');
  assert.equal(formatWaitStrategy('unexpected'), '策略未知');
  assert.equal(formatSegmentLabel('segment-001', 'approved', 0), '片段 1 · 已通过');
  assert.equal(formatSegmentLabel('custom-id', 'pickup-required', 2), '片段 3 · 需要补录');
});

test('formats original and pickup sources with localized status', () => {
  assert.equal(formatSourceLabel({ kind: 'original', status: 'available' }), '原始录像 · 可用');
  assert.equal(formatSourceLabel({ kind: 'pickup', attempt: 2, status: 'failed' }), '补录素材 2 · 失败');
  assert.equal(formatSourceLabel({ kind: 'pickup', status: 'superseded' }), '补录素材 · 已替换');
  assert.equal(formatSourceLabel({ kind: 'unknown', status: 'unknown' }), '素材 · 状态未知');
});
