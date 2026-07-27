import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { installTabObserver, type ManualTabEvent } from '../../src/lib/video-generator/browser/tab-observer.js';
import { installManualObserver } from '../../src/lib/video-generator/browser/manual-observer.js';

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

test('tracks stable tab lifecycle events and writes a tabs snapshot', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const dir = await mkdtemp(path.join(tmpdir(), 'tab-observer-'));
  const tabsPath = path.join(dir, 'tabs.json');
  const events: ManualTabEvent[] = [];
  let tabs: Awaited<ReturnType<typeof installTabObserver>> | undefined;
  try {
    const installedTabs = await installTabObserver(context, async (event) => {
      events.push(event);
    }, { tabsPath });
    tabs = installedTabs;
    await installManualObserver(context, async (page, event) => {
      const tabId = installedTabs.tabIdForPage(page);
      if (tabId !== null) {
        events.push({ ...event, tabId } as ManualTabEvent);
      }
    });

    const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-observer-fixture.html')).href;
    const page1 = await context.newPage();
    await page1.goto(fixtureUrl);
    await page1.locator('#click-target').click();

    const popupPromise = context.waitForEvent('page');
    await page1.evaluate("window.open(location.href + '?popup=1', '_blank')");
    const page2 = await popupPromise;
    await page2.waitForLoadState('domcontentloaded');
    const popupTabId = tabs.tabIdForPage(page2);
    await page2.bringToFront();
    await page2.evaluate("dispatchEvent(new Event('focus'))");
    await page2.evaluate("globalThis.__videoGeneratorRecordTabEvent?.({ type: 'tab-activated', visibilityState: 'hidden', hasFocus: true })");
    await page2.evaluate("globalThis.__videoGeneratorRecordTabEvent?.({ type: 'tab-activated', visibilityState: 'visible', hasFocus: true })");
    await page2.evaluate("globalThis.__videoGeneratorRecordTabEvent?.({ type: 'tab-activated', visibilityState: 'visible', hasFocus: true })");
    await page2.reload();
    assert.equal(tabs.tabIdForPage(page2), popupTabId);
    await page2.locator('#click-target').click();
    await page2.close();
    await tabs.flush();

    assert.deepEqual(events.filter((event) => event.type === 'tab-created').map((event) => event.tabId), ['tab-1', 'tab-2']);
    assert.ok(events.some((event) => event.type === 'navigation'
      && event.tabId === 'tab-2'
      && event.payload?.url === page2.url()));
    assert.ok(events.some((event) => event.type === 'pointer-click' && event.tabId === 'tab-2'));
    assert.ok(events.some((event) => event.type === 'tab-closed'
      && event.tabId === 'tab-2'
      && event.payload?.url === page2.url()));
    assert.equal(events.filter((event) => event.type === 'tab-activated' && event.tabId === 'tab-2').length, 1);

    const snapshot = JSON.parse(await readFile(tabsPath, 'utf8'));
    assert.equal(snapshot.tabs.length, 2);
    assert.deepEqual(snapshot.tabs.map((tab: { tabId: string }) => tab.tabId), ['tab-1', 'tab-2']);
    assert.ok(snapshot.tabs[0].url.includes('manual-observer-fixture.html'));
    assert.ok(snapshot.tabs[1].url.includes('manual-observer-fixture.html?popup=1'));
    assert.equal(snapshot.tabs[0].title, 'Manual Observer Fixture');
    assert.equal(snapshot.tabs[1].title, 'Manual Observer Fixture');
    assert.equal(typeof snapshot.tabs[1].closedSessionTimeMs, 'number');
    await tabs.flush();
    const repeatedSnapshot = JSON.parse(await readFile(tabsPath, 'utf8'));
    assert.deepEqual(repeatedSnapshot, snapshot);
  } finally {
    await context.close();
    await tabs?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not change the active page while observing tabs', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const dir = await mkdtemp(path.join(tmpdir(), 'tab-observer-focus-'));
  const pages: Page[] = [];
  let tabs: Awaited<ReturnType<typeof installTabObserver>> | undefined;
  try {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    pages.push(page1, page2);
    let bringToFrontCalls = 0;
    for (const page of pages) {
      const original = page.bringToFront.bind(page);
      page.bringToFront = async () => {
        bringToFrontCalls += 1;
        await original();
      };
    }

    tabs = await installTabObserver(context, () => {}, { tabsPath: path.join(dir, 'tabs.json') });
    await page1.reload();
    await page2.close();
    await tabs.flush();

    assert.equal(bringToFrontCalls, 0);
    await tabs.flush();
  } finally {
    for (const page of pages) {
      if (!page.isClosed()) {
        await page.close();
      }
    }
    await context.close();
    await tabs?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('injects activation reporting into an already-loaded tab-1', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const dir = await mkdtemp(path.join(tmpdir(), 'tab-observer-existing-'));
  const events: ManualTabEvent[] = [];
  let tabs: Awaited<ReturnType<typeof installTabObserver>> | undefined;
  try {
    const page = await context.newPage();
    const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-observer-fixture.html')).href;
    await page.goto(fixtureUrl);

    tabs = await installTabObserver(context, (event) => {
      events.push(event);
    }, { tabsPath: path.join(dir, 'tabs.json') });
    assert.equal(tabs.tabIdForPage(page), 'tab-1');

    await page.bringToFront();
    await page.evaluate("dispatchEvent(new Event('focus'))");
    await tabs.flush();

    assert.equal(events.filter((event) => event.type === 'tab-activated' && event.tabId === 'tab-1').length, 1);
  } finally {
    await context.close();
    await tabs?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('flush reports an event callback rejection even after the operation already settled', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const dir = await mkdtemp(path.join(tmpdir(), 'tab-observer-rejection-'));
  let tabs: Awaited<ReturnType<typeof installTabObserver>> | undefined;
  try {
    tabs = await installTabObserver(context, async (event) => {
      if (event.type === 'tab-created') {
        await Promise.resolve();
        throw new Error('event sink failed');
      }
    }, { tabsPath: path.join(dir, 'tabs.json') });
    await context.newPage();
    await new Promise((resolve) => setImmediate(resolve));

    await assert.rejects(tabs.flush(), /event sink failed/);
  } finally {
    await context.close();
    await assert.rejects(tabs?.flush() ?? Promise.resolve(), /event sink failed/);
    await rm(dir, { recursive: true, force: true });
  }
});

test('captures each navigation URL before asynchronous metadata lookup', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const dir = await mkdtemp(path.join(tmpdir(), 'tab-observer-navigation-'));
  const events: ManualTabEvent[] = [];
  let tabs: Awaited<ReturnType<typeof installTabObserver>> | undefined;
  try {
    tabs = await installTabObserver(context, (event) => {
      events.push(event);
    }, { tabsPath: path.join(dir, 'tabs.json') });
    const page = await context.newPage();
    const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-observer-fixture.html')).href;
    await page.goto(fixtureUrl);
    await page.evaluate(`(() => {
      history.pushState({}, '', '?route=first');
      history.pushState({}, '', '?route=second');
    })()`);
    await tabs.flush();

    const navigationUrls = events
      .filter((event) => event.type === 'navigation')
      .map((event) => event.payload?.url);
    assert.ok(navigationUrls.some((url) => typeof url === 'string' && url.endsWith('?route=first')));
    assert.ok(navigationUrls.some((url) => typeof url === 'string' && url.endsWith('?route=second')));
  } finally {
    await context.close();
    await tabs?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
