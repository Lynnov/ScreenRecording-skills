import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

test('manual recording product tsconfig includes product overlay and excludes POC UI', async () => {
  const config = JSON.parse(await readFile(path.resolve('tsconfig.manual-recording.json'), 'utf8')) as {
    compilerOptions: { outDir: string };
    include: string[];
  };

  assert.equal(config.compilerOptions.outDir, 'dist/manual-recording');
  assert.ok(config.include.includes('src/lib/video-generator/recording-overlay/**/*.ts'));
  assert.ok(config.include.includes('src/lib/video-generator/recording-overlay/**/*.cts'));
  assert.ok(config.include.includes('src/lib/video-generator/manual/**/*.ts'));
  assert.ok(config.include.includes('src/lib/video-generator/browser/manual-*.ts'));
  assert.equal(config.include.some((entry) => entry.includes('pocs/manual-recording')), false);
});

test('manual overlay HTML and renderer expose product recording controls and status fields', async () => {
  const html = await readFile(path.resolve('src/lib/video-generator/recording-overlay/overlay.html'), 'utf8');
  const renderer = await readFile(path.resolve('src/lib/video-generator/recording-overlay/renderer.ts'), 'utf8');

  for (const id of ['status', 'timer', 'segment', 'action', 'attempt', 'next-step', 'confidence', 'observer-warning', 'new-tab-notice']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const command of ['begin-countdown', 'confirm-action', 'previous-action', 'discard-attempt', 'finish']) {
    assert.match(html, new RegExp(`data-command="${command}"`));
    assert.match(renderer, new RegExp(command));
  }
  assert.match(html, /data-drag-region/);
  assert.match(renderer, /manualOverlay\.sendCommand/);
  assert.match(renderer, /manualOverlay\.onSnapshot/);
  assert.match(renderer, /setInterval/);
  assert.match(renderer, /latestSnapshot\.elapsedMs \+ Math\.max/);
});

test('manual recording product Electron main uses always-on-top non-focusable overlay window and typed IPC', async () => {
  const main = await readFile(path.resolve('src/lib/video-generator/recording-overlay/main.ts'), 'utf8');

  assert.match(main, /alwaysOnTop:\s*true/);
  assert.match(main, /focusable:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /MANUAL_OVERLAY_CHANNELS\.command/);
  assert.match(main, /\['F7', 'F8', 'Shift\+F8', 'F9', 'F10'\]/);
  assert.match(main, /if \(!globalShortcut\.register/);
  assert.match(main, /another manual runtime may still be running/);
});

test('manual product scripts copy only product assets and run product entry', async () => {
  const copyScript = await readFile(path.resolve('scripts/copy-manual-recording-assets.mjs'), 'utf8');
  const runScript = await readFile(path.resolve('scripts/run-manual-recording.mjs'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as { scripts: Record<string, string> };

  assert.match(copyScript, /src\/lib\/video-generator\/recording-overlay/);
  assert.match(copyScript, /dist\/manual-recording\/src\/lib\/video-generator\/recording-overlay/);
  assert.doesNotMatch(copyScript, /pocs\/manual-recording/);
  assert.match(runScript, /path\.resolve\('dist\/manual-recording'\)/);
  assert.match(copyScript, /main: 'bootstrap\.cjs'/);
  assert.equal(packageJson.scripts['build:manual'], 'tsc -p tsconfig.manual-recording.json && node scripts/copy-manual-recording-assets.mjs');
  assert.equal(packageJson.scripts['manual:recording'], 'npm run build:manual && node scripts/run-manual-recording.mjs');
});
