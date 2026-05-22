import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';

test('records a Chromium page session to a video file', async () => {
  const videoDir = await mkdtemp(join(tmpdir(), 'playwright-video-poc-'));
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      recordVideo: { dir: videoDir },
      viewport: { width: 640, height: 360 },
    });
    const page = await context.newPage();

    await page.goto('data:text/html,<main><h1>Playwright video POC</h1></main>');
    await page.waitForTimeout(500);
    const video = page.video();

    await context.close();
    context = undefined;
    await browser.close();
    browser = undefined;

    assert.ok(video, 'expected Playwright to attach a video recorder to the page');
    const videoPath = await video.path();
    assert.ok(existsSync(videoPath), `expected recorded video to exist at ${videoPath}`);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await rm(videoDir, { recursive: true, force: true });
  }
});
