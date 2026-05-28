import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { ensureCursorOverlay, locatorCenter } from '../../src/lib/video-generator/browser/cursor-overlay.js';

type CursorDebugState = { x: number; y: number; clicking: boolean } | undefined;
type EvaluatedElement = {
  style: { pointerEvents: string };
  classList: { contains(className: string): boolean };
  ownerDocument: { defaultView?: { getComputedStyle(element: unknown): { pointerEvents: string } } | null };
};

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const page = await context.newPage();
    await run(page);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

test('ensureCursorOverlay injects a single non-interactive cursor overlay', async () => {
  await withPage(async (page) => {
    await page.setContent('<main><button>保存</button></main>');

    await ensureCursorOverlay(page);
    await ensureCursorOverlay(page);

    const overlay = page.locator('#__video-generator-cursor-overlay');
    assert.equal(await overlay.count(), 1);
    assert.equal(await overlay.locator('svg').count(), 1);
    const pointerEvents = await overlay.evaluate((element: EvaluatedElement) => element.style.pointerEvents || element.ownerDocument.defaultView?.getComputedStyle(element).pointerEvents);
    assert.equal(pointerEvents, 'none');
  });
});

test('locatorCenter returns the center of a visible locator', async () => {
  await withPage(async (page) => {
    await page.setContent('<button id="target" style="position: fixed; left: 100px; top: 80px; width: 120px; height: 40px">保存</button>');

    const center = await locatorCenter(page.locator('#target'), 1000);

    assert.deepEqual(center, { x: 160, y: 100 });
  });
});

test('cursor overlay moves and plays click animation', async () => {
  await withPage(async (page) => {
    await page.setContent('<main><button>保存</button></main>');
    await ensureCursorOverlay(page);

    await page.evaluate('globalThis.__videoGeneratorCursorOverlay?.moveTo(123, 87)');
    let state = await page.evaluate<CursorDebugState>('globalThis.__videoGeneratorCursorOverlay?.debugState()');
    assert.deepEqual(state, { x: 123, y: 87, clicking: false });

    await page.evaluate('globalThis.__videoGeneratorCursorOverlay?.click()');
    state = await page.evaluate<CursorDebugState>('globalThis.__videoGeneratorCursorOverlay?.debugState()');
    assert.equal(state?.clicking, true);
    assert.equal(await page.locator('#__video-generator-cursor-overlay').evaluate((element: EvaluatedElement) => element.classList.contains('__video-generator-cursor-clicking')), true);
  });
});
