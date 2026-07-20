import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchUniqueWindowSource, parseWindowsHandle } from '../../src/lib/video-generator/capture/source-matcher.js';

test('rejects missing and ambiguous Chromium window sources', () => {
  assert.throws(() => matchUniqueWindowSource([], 'VG-CAPTURE-abc'), /not found/i);
  assert.throws(() => matchUniqueWindowSource([
    { id: 'window:101:0', name: 'VG-CAPTURE-abc' },
    { id: 'window:102:0', name: 'VG-CAPTURE-abc' },
  ], 'VG-CAPTURE-abc'), /multiple/i);
});

test('returns the only exact title match', () => {
  assert.deepEqual(matchUniqueWindowSource([
    { id: 'window:101:0', name: 'Other' },
    { id: 'window:102:0', name: 'VG-CAPTURE-abc' },
  ], 'VG-CAPTURE-abc'), { id: 'window:102:0', name: 'VG-CAPTURE-abc' });
});

test('parses Windows handles from Electron desktop capturer source ids', () => {
  assert.equal(parseWindowsHandle('window:102:0'), 102n);
  assert.throws(() => parseWindowsHandle('screen:102:0'), /unsupported/i);
});
