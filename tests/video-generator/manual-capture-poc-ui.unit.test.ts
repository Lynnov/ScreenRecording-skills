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

test('clock fixture exposes marker colors for clock POC validation', async () => {
  const html = await readFile(path.join(pocDir, 'clock-fixture.html'), 'utf8');
  assert.match(html, /showMarker/);
  assert.match(html, /recording-start/);
  assert.match(html, /retry-start/);
  assert.match(html, /recording-stop/);
});

test('capture main records sampled frame evidence paths in the report', async () => {
  const main = await readFile(path.join(pocDir, 'capture-main.ts'), 'utf8');
  assert.match(main, /sampledFrames/);
  assert.match(main, /captureEvidenceFramesDir/);
  assert.match(main, /ffmpeg/);
  assert.match(main, /frame-001/);
});

test('capture main routes manual markers through the unified recording clock', async () => {
  const main = await readFile(path.join(pocDir, 'capture-main.ts'), 'utf8');
  assert.match(main, /createRecordingClock/);
  assert.match(main, /recordUserMarker/);
  assert.match(main, /recording-start/);
  assert.match(main, /retry-start/);
  assert.match(main, /recording-stop-requested/);
  assert.match(main, /recording-stop/);
  assert.match(main, /globalShortcut\.register\('F7'/);
  assert.match(main, /globalShortcut\.register\('F9'/);
  assert.match(main, /globalShortcut\.register\('F10'/);
});

test('capture main writes clock samples and recording manifest artifacts', async () => {
  const main = await readFile(path.join(pocDir, 'capture-main.ts'), 'utf8');
  assert.match(main, /createEventLog/);
  assert.match(main, /capture-clock-sample/);
  assert.match(main, /mediaTimeMs/);
  assert.match(main, /analyzeClockDrift/);
  assert.match(main, /writeRecordingManifest/);
  assert.match(main, /recording-manifest\.json|manifestPath/);
});

test('events fixture is wired through timestamped observers and writes its report after close and flush', async () => {
  const main = await readFile(path.join(pocDir, 'capture-main.ts'), 'utf8');
  assert.match(main, /installManualCaptureObservers/);
  assert.match(main, /createTimestampedObserverEventSink/);
  assert.match(main, /args\.fixture === 'events'/);
  assert.match(main, /chromiumSession\?\.close[\s\S]*observers\?\.flush[\s\S]*writeManualEventsPocReport/);
});
