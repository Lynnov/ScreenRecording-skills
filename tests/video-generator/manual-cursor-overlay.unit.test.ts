import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { installManualCursorOverlay } from '../../src/lib/video-generator/browser/manual-cursor-overlay.js';

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

test('manual cursor overlay does not intercept pointer interaction and follows reloads', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    await installManualCursorOverlay(context);
    const page = await context.newPage();
    const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-cursor-overlay-fixture.html')).href;
    await page.goto(fixtureUrl);
    await page.mouse.move(120, 120);
    const buttonBounds = await page.locator('#click-count').boundingBox();
    assert.ok(buttonBounds !== null);
    await page.mouse.click(
      buttonBounds.x + buttonBounds.width / 2,
      buttonBounds.y + buttonBounds.height / 2,
    );
    assert.equal(await page.locator('#click-count').textContent(), '1');
    const overlayState = await page.evaluate(`(() => {
      const overlay = document.getElementById('__video-generator-manual-cursor');
      return overlay === null ? null : {
        pointerEvents: getComputedStyle(overlay).pointerEvents,
        hidden: overlay.hidden,
        rootCursor: getComputedStyle(document.documentElement).cursor,
      };
    })()`) as { pointerEvents: string; hidden: boolean; rootCursor: string } | null;
    assert.ok(overlayState !== null);
    assert.equal(overlayState?.pointerEvents, 'none');
    assert.equal(overlayState?.rootCursor, 'none');
    const pointerState = await page.evaluate(`(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 120,
        clientY: 120,
      }));
      return document.getElementById('__video-generator-manual-cursor')?.getAttribute('data-pointer-state');
    })()`) as string | null;
    assert.equal(pointerState, 'down');
    await page.reload();
    const afterReload = await page.evaluate("document.getElementById('__video-generator-manual-cursor') !== null");
    assert.equal(afterReload, true);
    await page.mouse.move(80, 80);
    assert.equal(await page.locator('#click-count').textContent(), '0');
  } finally {
    await context.close();
  }
});

test('injects into new tabs and hides on blur or visibility change', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    await installManualCursorOverlay(context);
    const page = await context.newPage();
    const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-cursor-overlay-fixture.html')).href;
    await page.goto(fixtureUrl);

    await page.mouse.move(44, 55);
    const position = await page.locator('#__video-generator-manual-cursor').evaluate((root) => ({
      x: root.getAttribute('data-x'),
      y: root.getAttribute('data-y'),
    }));
    assert.deepEqual(position, { x: '44', y: '55' });

    await page.evaluate("document.body.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.querySelector('main') }))");
    assert.equal(await page.locator('#__video-generator-manual-cursor').getAttribute('data-visible'), 'true');

    await page.evaluate("dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }))");
    assert.equal(await page.locator('#__video-generator-manual-cursor').getAttribute('data-visible'), 'false');
    assert.equal(await page.evaluate("document.documentElement.classList.contains('__video-generator-hide-native-cursor')"), false);

    await page.mouse.move(45, 56);
    assert.equal(await page.locator('#__video-generator-manual-cursor').getAttribute('data-visible'), 'true');
    assert.equal(await page.evaluate("document.documentElement.classList.contains('__video-generator-hide-native-cursor')"), true);
    await page.evaluate("dispatchEvent(new Event('blur'))");
    assert.equal(await page.locator('#__video-generator-manual-cursor').getAttribute('data-visible'), 'false');
    assert.equal(await page.evaluate("document.documentElement.classList.contains('__video-generator-hide-native-cursor')"), false);
    await page.mouse.move(46, 57);
    await page.evaluate(`(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    assert.equal(await page.locator('#__video-generator-manual-cursor').getAttribute('data-visible'), 'false');
    assert.equal(await page.evaluate("document.documentElement.classList.contains('__video-generator-hide-native-cursor')"), false);
    await page.mouse.move(47, 58);
    assert.equal(await page.locator('#__video-generator-manual-cursor').getAttribute('data-visible'), 'true');
    assert.equal(await page.evaluate("document.documentElement.classList.contains('__video-generator-hide-native-cursor')"), true);

    const page2 = await context.newPage();
    await page2.goto(fixtureUrl + '?tab=2');
    await page2.mouse.move(66, 77);
    assert.deepEqual(await page2.locator('#__video-generator-manual-cursor').evaluate((root) => ({
      x: root.getAttribute('data-x'),
      y: root.getAttribute('data-y'),
    })), { x: '66', y: '77' });

    await page2.reload();
    await page2.mouse.move(88, 99);
    assert.deepEqual(await page2.locator('#__video-generator-manual-cursor').evaluate((root) => ({
      x: root.getAttribute('data-x'),
      y: root.getAttribute('data-y'),
    })), { x: '88', y: '99' });
  } finally {
    await context.close();
  }
});

test('injects into an already-loaded page when installed after the tab exists', async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    const page = await context.newPage();
    const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-cursor-overlay-fixture.html')).href;
    await page.goto(fixtureUrl);

    await installManualCursorOverlay(context);
    await page.mouse.move(101, 102);

    assert.deepEqual(await page.locator('#__video-generator-manual-cursor').evaluate((root) => ({
      x: root.getAttribute('data-x'),
      y: root.getAttribute('data-y'),
    })), { x: '101', y: '102' });
  } finally {
    await context.close();
  }
});
