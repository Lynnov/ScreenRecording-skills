import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  createManualChromiumSessionLifecycle,
  launchProductManualChromiumSession,
  type ManualChromiumPlaywrightAdapter,
} from '../../src/lib/video-generator/recording/session.js';

function createAdapter(input: { failAt?: 'setContent' | 'waitForFunction' | 'goto' | 'contextClose' } = {}) {
  const calls: string[] = [];
  let title = '';
  const page = {
    async setContent(html: string) {
      calls.push('page.setContent');
      if (input.failAt === 'setContent') throw new Error('setContent failed');
      title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? '';
    },
    async waitForFunction(_fn: unknown, expectedTitle: string) {
      calls.push(`page.waitForFunction:${expectedTitle}`);
      if (input.failAt === 'waitForFunction') throw new Error('waitForFunction failed');
      assert.equal(title, expectedTitle);
    },
    async goto(url: string) {
      calls.push(`page.goto:${url}`);
      if (input.failAt === 'goto') throw new Error('goto failed');
    },
  };
  const context = {
    async newPage() {
      calls.push('context.newPage');
      return page;
    },
    async close() {
      calls.push('context.close');
      if (input.failAt === 'contextClose') throw new Error('context close failed');
    },
  };
  const browser = {
    async newContext(options: unknown) {
      calls.push(`browser.newContext:${JSON.stringify(options)}`);
      return context;
    },
    async close() {
      calls.push('browser.close');
    },
  };
  const adapter: ManualChromiumPlaywrightAdapter = {
    async launch(options) {
      calls.push(`chromium.launch:${JSON.stringify(options)}`);
      return browser as never;
    },
  };
  return { adapter, calls };
}

test('shows the unique binding title before navigating to the validated startUrl', async () => {
  const { adapter, calls } = createAdapter();
  const session = await launchProductManualChromiumSession({
    sessionId: 'product-42',
    startUrl: 'https://example.test/manual/start',
    playwright: adapter,
  });

  assert.equal(session.bindingTitle, 'VG-CAPTURE-product-42');
  assert.deepEqual(calls, [
    'chromium.launch:{"headless":false,"args":["--start-maximized"]}',
    'browser.newContext:{"viewport":null}',
    'context.newPage',
    'page.setContent',
    'page.waitForFunction:VG-CAPTURE-product-42',
  ]);

  // The composition root binds the desktop source while the title page is still visible.
  calls.push('source.bound');
  await session.navigateToStartUrl();
  await session.navigateToStartUrl();
  assert.deepEqual(calls.slice(-2), [
    'source.bound',
    'page.goto:https://example.test/manual/start',
  ]);
});

test('rejects an invalid startUrl before launching Chromium', async () => {
  const { adapter, calls } = createAdapter();
  await assert.rejects(
    launchProductManualChromiumSession({
      sessionId: 'invalid-url',
      startUrl: 'not a url',
      playwright: adapter,
    }),
    /startUrl|URL/i,
  );
  assert.deepEqual(calls, []);
});

test('close is idempotent and still closes the browser if context close fails', async () => {
  const { adapter, calls } = createAdapter({ failAt: 'contextClose' });
  const session = await launchProductManualChromiumSession({
    sessionId: 'close',
    startUrl: 'https://example.test/',
    playwright: adapter,
  });

  await assert.rejects(session.close(), /context close failed/);
  await assert.rejects(session.close(), /context close failed/);
  assert.deepEqual(calls.slice(-2), ['context.close', 'browser.close']);
  assert.equal(calls.filter((call) => call === 'context.close').length, 1);
  assert.equal(calls.filter((call) => call === 'browser.close').length, 1);
});

test('launch failure closes context and browser in order', async () => {
  const { adapter, calls } = createAdapter({ failAt: 'goto' });
  const session = await launchProductManualChromiumSession({
    sessionId: 'failed-launch',
    startUrl: 'https://example.test/failure',
    playwright: adapter,
  });
  await assert.rejects(session.navigateToStartUrl(), /goto failed/);
  await assert.rejects(session.navigateToStartUrl(), /goto failed/);
  assert.deepEqual(calls.slice(-2), ['context.close', 'browser.close']);
  assert.equal(calls.filter((call) => call.startsWith('page.goto:')).length, 1);
});

test('product session implementation has no fixture dependency or automatic tab operations', async () => {
  const source = await readFile(
    path.resolve('src/lib/video-generator/recording/session.ts'),
    'utf8',
  );
  const productImplementation = source.slice(source.indexOf('export async function launchProductManualChromiumSession'));
  assert.doesNotMatch(productImplementation, /fixtureDir|manualPocFixtureFileName|pathToFileURL/);
  assert.doesNotMatch(productImplementation, /\.bringToFront\(|context\.pages\(|page\.click\(|page\.fill\(/);
  const { adapter } = createAdapter();
  const session = await launchProductManualChromiumSession({
    sessionId: 'product-shape',
    startUrl: 'https://example.test/',
    playwright: adapter,
  });
  assert.equal('navigateToFixture' in session, false);
});

test('rejects sessionId values that could inject binding-page markup before launching', async () => {
  const { adapter, calls } = createAdapter();
  await assert.rejects(
    launchProductManualChromiumSession({
      sessionId: 'unsafe</title><script>alert(1)</script>',
      startUrl: 'https://example.test/',
      playwright: adapter,
    }),
    /sessionId|safe token/i,
  );
  assert.deepEqual(calls, []);
});

test('lifecycle flushes observers, sink, and event log before Chromium and is failure-safe and idempotent', async () => {
  const calls: string[] = [];
  const lifecycle = createManualChromiumSessionLifecycle({
    observers: {
      async flush() {
        calls.push('observers.flush');
        throw new Error('observer flush failed');
      },
    },
    sink: {
      async flush() { calls.push('sink.flush'); },
    },
    eventLog: {
      async close() { calls.push('eventLog.close'); },
    },
    session: {
      async close() { calls.push('session.close'); },
    },
  });

  await assert.rejects(lifecycle.close(), /observer flush failed/);
  await assert.rejects(lifecycle.close(), /observer flush failed/);
  assert.deepEqual(calls, ['observers.flush', 'sink.flush', 'eventLog.close', 'session.close']);
});
