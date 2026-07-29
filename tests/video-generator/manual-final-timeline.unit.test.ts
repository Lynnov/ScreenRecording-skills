import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFinalTimeline } from '../../src/lib/video-generator/manual/final-timeline.js';
import { renderFinalTimelineSrt } from '../../src/lib/video-generator/subtitles.js';

const plan = {
  version: 1 as const,
  canvas: { width: 1920 as const, height: 1080 as const, fps: 30 as const },
  segments: [{
    segmentId: 'segment-001',
    title: '保存',
    clips: [{ sourceId: 'source-001', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 1 }],
    holdLastFrameMs: 500,
    transition: 'short-fade' as const,
    confidence: 'high' as const,
    reason: 'ok',
  }, {
    segmentId: 'segment-002',
    title: '完成',
    clips: [{ sourceId: 'source-001', sourceStartMs: 2000, sourceEndMs: 4000, playbackRate: 1 }],
    confidence: 'high' as const,
    reason: 'ok',
  }],
};

test('final timeline pads short audio and extends result hold for slightly long audio', () => {
  const timeline = buildFinalTimeline({
    effectivePlan: plan,
    narration: [
      { segmentId: 'segment-001', text: '第一段', estimatedDurationMs: 1000, audioDurationMs: 1000 },
      { segmentId: 'segment-002', text: '第二段', estimatedDurationMs: 3000, audioDurationMs: 3000 },
    ],
  });
  assert.deepEqual(timeline.segments[0], {
    segmentId: 'segment-001',
    videoStartMs: 0,
    contentEndMs: 2000,
    videoEndMs: 2500,
    holdLastFrameMs: 500,
    transition: 'short-fade',
    narrationText: '第一段',
    audioDurationMs: 1000,
    subtitleStartMs: 0,
    subtitleEndMs: 1000,
  });
  assert.equal(timeline.segments[1]?.videoStartMs, 2500);
  assert.equal(timeline.segments[1]?.videoEndMs, 5500);
  assert.equal(timeline.segments[1]?.holdLastFrameMs, 1000);
  assert.match(renderFinalTimelineSrt(timeline), /00:00:02,500 --> 00:00:05,500[\s\S]*第二段/);
});

test('final timeline rejects narration that requires more than five seconds total hold', () => {
  assert.throws(() => buildFinalTimeline({
    effectivePlan: { ...plan, segments: [plan.segments[0]!] },
    narration: [{ segmentId: 'segment-001', text: '过长旁白', estimatedDurationMs: 7100, audioDurationMs: 7100 }],
  }), /5 seconds|精简|pickup/i);
});
