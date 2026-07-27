import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { installManualObserver, type ManualObservedEvent } from '../../src/lib/video-generator/browser/manual-observer.js';

let browser: Browser;
let context: BrowserContext;

before(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 640, height: 360 } });
});

after(async () => {
  await context?.close();
  await browser?.close();
});

test('observes manual page events across reloads and dynamic DOM replacement', async () => {
  const events: ManualObservedEvent[] = [];
  await installManualObserver(context, async (_page, event) => {
    events.push(event);
  });

  const fixtureUrl = pathToFileURL(path.resolve('tests/fixtures/video-generator/manual-observer-fixture.html')).href;
  const page = await context.newPage();
  await page.goto(fixtureUrl);

  await page.locator('#click-target').click();
  await page.locator('#text-input').fill('Alice');
  await page.locator('#select-target').selectOption({ label: '二' });
  await page.locator('#scroll-box').evaluate((element) => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.locator('#push-state').click();
  await page.reload();
  await page.locator('#replace-form').click();
  await page.locator('#text-input').fill('Bob');

  const types = events.map((event) => event.type);
  assert.ok(types.includes('pointer-click'));
  assert.ok(types.includes('input'));
  assert.ok(types.includes('change'));
  assert.ok(types.includes('scroll'));
  assert.ok(types.includes('navigation'));
  assert.ok(events.every((event) => typeof event.url === 'string'));
});

test('manual observer stays independent from automatic action modules', async () => {
  const source = await readFile(path.resolve('src/lib/video-generator/browser/manual-observer.ts'), 'utf8');
  assert.doesNotMatch(source, /actions\.js/);
  assert.doesNotMatch(source, /interaction-rules\.js/);
});
