import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectMarkerEvidence } from '../../src/lib/video-generator/recording/marker-evidence.js';

test('accepts red green and blue marker pixels within one frame', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'marker-evidence-'));
  const colors = [
    [10, 10, 10], [250, 5, 5], [10, 10, 10],
    [10, 10, 10], [5, 250, 5], [10, 10, 10],
    [10, 10, 10], [5, 5, 250], [10, 10, 10],
  ];
  let rawIndex = 0;
  try {
    const evidence = await collectMarkerEvidence({
      videoPath: 'capture/original-window.mp4',
      outputDir: dir,
      fps: 30,
      markers: [
        { type: 'recording-start', videoTimeMs: 3000 },
        { type: 'retry-start', videoTimeMs: 8000 },
        { type: 'recording-stop', videoTimeMs: 15000 },
      ],
      runCommand: async (_command, args) => {
        if (args.at(-1) !== '-') return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
        assert.ok(args.includes('crop=2:2:120:120'));
        const color = colors[rawIndex++]!;
        return {
          stdout: Buffer.from([...color, ...color, ...color, ...color]),
          stderr: Buffer.alloc(0),
        };
      },
    });

    assert.deepEqual(evidence.map((item) => [item.type, item.passed, item.matchedFrameOffset]), [
      ['recording-start', true, 0],
      ['retry-start', true, 0],
      ['recording-stop', true, 0],
    ]);
    assert.equal(evidence.every((item) => item.samples.length === 3), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('returns failed evidence for missing timestamps wrong colors and ffmpeg errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'marker-evidence-failed-'));
  try {
    const evidence = await collectMarkerEvidence({
      videoPath: 'capture/original-window.mp4',
      outputDir: dir,
      fps: 30,
      markers: [
        { type: 'recording-start', videoTimeMs: null },
        { type: 'retry-start', videoTimeMs: 8000 },
        { type: 'recording-stop', videoTimeMs: 15000 },
      ],
      runCommand: async (_command, args) => {
        if (args.includes('15.000')) throw new Error('ffmpeg failed');
        return {
          stdout: args.at(-1) === '-'
            ? Buffer.from(Array.from({ length: 4 }, () => [120, 120, 120]).flat())
            : Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        };
      },
    });

    assert.deepEqual(evidence.map((item) => item.passed), [false, false, false]);
    assert.match(evidence[0]!.errors[0]!, /timestamp/i);
    assert.match(evidence[1]!.errors[0]!, /color/i);
    assert.ok(evidence[2]!.errors.some((error) => /ffmpeg failed/i.test(error)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
