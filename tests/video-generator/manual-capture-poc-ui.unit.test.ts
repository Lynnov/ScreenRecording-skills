import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const pocDir = path.resolve('pocs/manual-recording');

test('capture fixture labels the second tab from the query string', async () => {
  const html = await readFile(path.join(pocDir, 'capture-fixture.html'), 'utf8');
  assert.match(html, /URLSearchParams/);
  assert.match(html, /tab-label/);
  assert.match(html, /tab-\$\{tab\}/);
});

test('capture fixture differentiates the second tab content from the first tab', async () => {
  const html = await readFile(path.join(pocDir, 'capture-fixture.html'), 'utf8');
  assert.match(html, /second-tab-note/);
  assert.match(html, /这是第二标签页/);
});

test('capture control window updates the visible recording timer', async () => {
  const renderer = await readFile(path.join(pocDir, 'capture-renderer.ts'), 'utf8');
  assert.match(renderer, /#timer/);
  assert.match(renderer, /formatElapsedTime/);
  assert.match(renderer, /requestAnimationFrame|setInterval/);
});

test('capture checklist explains that multi-tab continuity means recorded page content switching', async () => {
  const html = await readFile(path.join(pocDir, 'capture.html'), 'utf8');
  assert.match(html, /录像中可看到 tab-1 和 tab-2 内容连续切换/);
});

test('capture main records sampled frame evidence paths in the report', async () => {
  const main = await readFile(path.join(pocDir, 'capture-main.ts'), 'utf8');
  assert.match(main, /sampledFrames/);
  assert.match(main, /captureEvidenceFramesDir/);
  assert.match(main, /ffmpeg/);
  assert.match(main, /frame-001/);
});
