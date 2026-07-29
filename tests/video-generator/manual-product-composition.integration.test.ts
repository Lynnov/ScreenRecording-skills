import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  runManualProductComposition,
  type ManualProductCompositionDeps,
} from '../../src/lib/video-generator/manual/product-runtime-entry.js';

test('product composition binds source before navigation and owns ordered cleanup', async () => {
  const calls: string[] = [];
  const deps: ManualProductCompositionDeps = {
    loadInput: async () => {
      calls.push('load');
      return {
        guide: { startUrl: 'https://example.com', actionIds: ['action-001'] },
        segmentId: 'segment-001',
        sourceId: 'original',
      };
    },
    launchChromium: async () => {
      calls.push('launch');
      return {
        bindingTitle: 'VG-CAPTURE-session',
        navigateToStartUrl: async () => { calls.push('navigate'); },
        close: async () => { calls.push('close-chromium'); },
      };
    },
    bindSource: async (title) => {
      calls.push(`bind:${title}`);
      return { id: 'window:123:0', name: title };
    },
    applyDisplayMode: async (source) => {
      calls.push(`display:${source.id}`);
      return async () => { calls.push('restore-display'); };
    },
    installObservers: async () => {
      calls.push('observers');
      return { close: async () => { calls.push('close-observers'); } };
    },
    createCapture: () => {
      calls.push('capture');
      return { close: async () => { calls.push('close-capture'); } };
    },
    createRuntime: () => {
      calls.push('runtime');
      return { close: async () => { calls.push('close-runtime'); } };
    },
    startOverlay: async () => {
      calls.push('overlay');
      return { close: async () => { calls.push('close-overlay'); } };
    },
    runController: async () => {
      calls.push('controller');
      return { ok: true };
    },
    writeReport: async (report) => {
      calls.push(`report:${report.ok}`);
      return 'reports/manual-run-report.json';
    },
  };

  const result = await runManualProductComposition({
    mode: 'recording',
    runDir: 'C:\\run',
    displayMode: 'borderless-maximized',
  }, deps);

  assert.deepEqual(result, { exitCode: 0, reportPath: 'reports/manual-run-report.json' });
  assert.deepEqual(calls, [
    'load',
    'launch',
    'bind:VG-CAPTURE-session',
    'display:window:123:0',
    'observers',
    'navigate',
    'capture',
    'runtime',
    'overlay',
    'controller',
    'close-runtime',
    'close-capture',
    'close-observers',
    'restore-display',
    'close-overlay',
    'close-chromium',
    'report:true',
  ]);
});

test('product Electron main waits for app readiness before creating product resources', async () => {
  const source = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/product-main.ts'),
    'utf8',
  );
  const functionSource = source.slice(source.indexOf('export async function runProductMain'));
  const readyIndex = functionSource.indexOf('await app.whenReady()');
  const lockIndex = functionSource.indexOf('app.requestSingleInstanceLock()');
  assert.notEqual(readyIndex, -1);
  assert.ok(lockIndex > readyIndex);
  for (const resourceExpression of [
    'createManualBundle(',
    'runManualProductComposition(',
  ]) {
    assert.ok(
      readyIndex < functionSource.indexOf(resourceExpression),
      `app.whenReady must precede ${resourceExpression}`,
    );
  }
});

test('product Electron main keeps the process alive until the final report is written', async () => {
  const source = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/product-main.ts'),
    'utf8',
  );
  const functionSource = source.slice(source.indexOf('export async function runProductMain'));
  const keepAliveIndex = functionSource.indexOf("app.on('window-all-closed'");
  const compositionIndex = functionSource.indexOf('await runManualProductComposition(');
  const releaseIndex = functionSource.indexOf("app.off('window-all-closed'");

  assert.notEqual(keepAliveIndex, -1);
  assert.ok(compositionIndex > keepAliveIndex);
  assert.ok(releaseIndex > compositionIndex);
});

test('product Electron entry does not depend on argv path equality', async () => {
  const source = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/product-main.ts'),
    'utf8',
  );
  assert.match(source, /process\.argv\.includes\('--mode'\)/);
  assert.match(source, /process\.argv\.includes\('--run'\)/);
  assert.doesNotMatch(source, /process\.versions\.electron/);
  assert.doesNotMatch(source, /fileURLToPath\(import\.meta\.url\) === process\.argv\[1\]/);
});

test('product Electron adapter resolves a descriptor back to a native desktop source', async () => {
  const source = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/product-main.ts'),
    'utf8',
  );
  assert.match(source, /candidate\.id === resolution\.video\.id/);
  assert.match(source, /\{ video: nativeSource \}/);
  assert.doesNotMatch(source, /handler\(\{ frame: request\.frame \}, callback\)/);
});

test('pickup observers use attempt-scoped event and tab artifacts', async () => {
  const source = await readFile(
    path.resolve('src/lib/video-generator/recording-overlay/product-main.ts'),
    'utf8',
  );
  assert.match(source, /`\$\{loaded!\.sourceId\}\.events\.jsonl`/);
  assert.match(source, /`\$\{loaded!\.sourceId\}\.tabs\.json`/);
  assert.match(source, /input\.mode === 'recording'/);
});

test('product composition preserves the first failure while completing cleanup once', async () => {
  const calls: string[] = [];
  const deps: ManualProductCompositionDeps = {
    loadInput: async () => ({
      guide: { startUrl: 'https://example.com', actionIds: ['action-001'] },
      segmentId: 'segment-001',
      sourceId: 'original',
    }),
    launchChromium: async () => ({
      bindingTitle: 'VG-CAPTURE-session',
      navigateToStartUrl: async () => undefined,
      close: async () => { calls.push('chromium'); },
    }),
    bindSource: async (name) => ({ id: 'window:123:0', name }),
    applyDisplayMode: async () => async () => { calls.push('restore'); throw new Error('restore failed'); },
    installObservers: async () => ({ close: async () => { calls.push('observers'); } }),
    createCapture: () => ({ close: async () => { calls.push('capture'); } }),
    createRuntime: () => ({ close: async () => { calls.push('runtime'); } }),
    startOverlay: async () => ({ close: async () => { calls.push('overlay'); } }),
    runController: async () => { throw new Error('controller failed'); },
    writeReport: async (report) => {
      assert.equal(report.ok, false);
      assert.match(report.errorMessage ?? '', /controller failed/);
      assert.deepEqual(report.cleanupErrors, ['restore failed']);
      return 'reports/manual-run-report.json';
    },
  };

  const first = await runManualProductComposition({
    mode: 'recording',
    runDir: 'C:\\run',
    displayMode: 'borderless-maximized',
  }, deps);
  assert.equal(first.exitCode, 1);
  assert.deepEqual(calls, ['runtime', 'capture', 'observers', 'restore', 'overlay', 'chromium']);
});
