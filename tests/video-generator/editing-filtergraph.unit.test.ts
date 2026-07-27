import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEditFiltergraph } from '../../src/lib/video-generator/editing/filtergraph.js';
import type { EditPlan, EditSource } from '../../src/lib/video-generator/editing/types.js';

const sources: EditSource[] = [
  {
    id: 'original',
    path: 'C:\\录制 文件\\original.mp4',
    durationMs: 6000,
    width: 1280,
    height: 720,
    fps: 29.97,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
    hasAudio: false,
  },
  {
    id: 'pickup',
    path: 'C:\\录制 文件\\补录.mp4',
    durationMs: 3000,
    width: 1920,
    height: 1080,
    fps: 30,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
    hasAudio: true,
  },
];

function plan(): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [
      {
        segmentId: 'one',
        title: 'one',
        clips: [
          { sourceId: 'pickup', sourceStartMs: 250, sourceEndMs: 1250, playbackRate: 2 },
          { sourceId: 'original', sourceStartMs: 1000, sourceEndMs: 2500, playbackRate: 1 },
        ],
        holdLastFrameMs: 500,
        transition: 'short-fade',
        confidence: 'high',
        reason: 'fixture',
      },
      {
        segmentId: 'two',
        title: 'two',
        clips: [
          { sourceId: 'pickup', sourceStartMs: 1250, sourceEndMs: 2250, playbackRate: 1 },
        ],
        confidence: 'high',
        reason: 'fixture',
      },
    ],
  };
}

test('builds unique inputs in first-reference order and complete normalized clip chains', () => {
  const built = buildEditFiltergraph(plan(), sources);

  assert.deepEqual(built.inputSourceIds, ['pickup', 'original']);
  assert.match(
    built.filterComplex,
    /\[0:v\]trim=start=0\.25:end=1\.25,setpts=\(PTS-STARTPTS\)\/2,settb=AVTB,fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2:black,setsar=1,format=yuv420p\[clip0\]/,
  );
  assert.match(
    built.filterComplex,
    /\[1:v\]trim=start=1:end=2\.5,setpts=\(PTS-STARTPTS\)\/1,settb=AVTB,fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2:black,setsar=1,format=yuv420p\[clip1\]/,
  );
});

test('concatenates clips per segment, clones holds, applies non-overlapping short fades, and emits v', () => {
  const built = buildEditFiltergraph(plan(), sources);

  assert.match(built.filterComplex, /\[clip0\]\[clip1\]concat=n=2:v=1:a=0\[segment0content\]/);
  assert.match(built.filterComplex, /\[segment0content\]tpad=stop_mode=clone:stop_duration=0\.5\[segment0held\]/);
  assert.match(built.filterComplex, /\[segment0held\]fade=t=out:st=2\.38:d=0\.12\[segment0\]/);
  assert.match(built.filterComplex, /\[clip2\]fade=t=in:st=0:d=0\.12\[segment1\]/);
  assert.match(built.filterComplex, /\[segment0\]\[segment1\]concat=n=2:v=1:a=0\[v\]$/);
  assert.match(built.filterComplex, /pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2:black/);
});

test('uses shared rounded edit durations for the preview timeline without transition overlap', () => {
  const built = buildEditFiltergraph(plan(), sources);

  assert.equal(built.timeline.durationMs, 3500);
  assert.deepEqual(built.timeline.segments.map(({ startsAtMs, contentEndsAtMs, endsAtMs }) => ({
    startsAtMs,
    contentEndsAtMs,
    endsAtMs,
  })), [
    { startsAtMs: 0, contentEndsAtMs: 2000, endsAtMs: 2500 },
    { startsAtMs: 2500, contentEndsAtMs: 3500, endsAtMs: 3500 },
  ]);
  assert.deepEqual(built.timeline.segments[0]!.clips.map(({ outputStartMs, outputEndMs }) => ({
    outputStartMs,
    outputEndMs,
  })), [
    { outputStartMs: 0, outputEndMs: 500 },
    { outputStartMs: 500, outputEndMs: 2000 },
  ]);
});

test('validates the edit plan before building', () => {
  const invalid = plan();
  invalid.segments[0]!.clips[0]!.sourceId = 'unknown';
  assert.throws(() => buildEditFiltergraph(invalid, sources), /segments\[0\]\.clips\[0\]\.sourceId/);
});

test('chains fade-in and fade-out on a middle segment and preserves a 1.5 playback literal', () => {
  const input = plan();
  input.segments.splice(1, 0, {
    segmentId: 'middle',
    title: 'middle',
    clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1500, playbackRate: 1.5 }],
    transition: 'short-fade',
    confidence: 'high',
    reason: 'fixture',
  });
  const built = buildEditFiltergraph(input, sources);
  assert.match(built.filterComplex, /setpts=\(PTS-STARTPTS\)\/1\.5/);
  assert.match(built.filterComplex, /\[clip2\]fade=t=in:st=0:d=0\.12\[segment1fadein\]/);
  assert.match(built.filterComplex, /\[segment1fadein\]fade=t=out:st=0\.88:d=0\.12\[segment1\]/);
});

test('normalizes a single cut segment before the final concat and rejects empty plans', () => {
  const input = plan();
  input.segments = [input.segments[1]!];
  const built = buildEditFiltergraph(input, sources);
  assert.match(built.filterComplex, /\[clip0\]null\[segment0\];\[segment0\]concat=n=1:v=1:a=0\[v\]$/);

  input.segments = [];
  assert.throws(() => buildEditFiltergraph(input, sources), /segments/);
});
