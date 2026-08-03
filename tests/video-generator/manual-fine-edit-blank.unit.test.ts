import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectWhiteScreenIntervals,
  parseWhiteScreenIntervals,
} from '../../src/lib/video-generator/manual/fine-edit-blank.js';

test('parses negated blackdetect output as high-confidence white intervals', () => {
  const intervals = parseWhiteScreenIntervals([
    '[blackdetect @ x] black_start:1.25 black_end:3.75 black_duration:2.5',
    '[blackdetect @ x] black_start:8 black_end:8.8 black_duration:0.8',
  ].join('\n'));

  assert.deepEqual(intervals, [
    { startMs: 1250, endMs: 3750, confidence: 'high' },
    { startMs: 8000, endMs: 8800, confidence: 'high' },
  ]);
});
test('runs white-screen detection against the browser content region', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const intervals = await detectWhiteScreenIntervals({
    sourcePath: 'source.mp4',
    whiteFrameRatio: 0.92,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: 'black_start:2 black_end:4 black_duration:2' };
    },
  });

  assert.equal(calls[0]?.command, 'ffmpeg');
  assert.match(calls[0]?.args.join(' '), /crop=.*negate,blackdetect=.*pic_th=0\.92/);
  assert.deepEqual(intervals, [{ startMs: 2000, endMs: 4000, confidence: 'high' }]);
});
