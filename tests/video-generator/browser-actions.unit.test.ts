import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { executeBrowserAction, waitForTarget } from '../../src/lib/video-generator/browser/actions.js';
import { VideoGeneratorError } from '../../src/lib/video-generator/types.js';

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

test('executeBrowserAction clicks exact text and waits for text', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button>Reveal</button>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          document.body.insertAdjacentHTML('beforeend', '<p>Revealed message</p>');
        });
      </script>
    `);

    await executeBrowserAction(page, {
      type: 'click',
      text: 'Reveal',
      waitFor: { type: 'text', value: 'Revealed message' },
    }, 1000);

    assert.equal(await page.getByText('Revealed message').count(), 1);
  });
});

test('executeBrowserAction fills selector and text targets', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>Name <input id="name" /></label>
      <input id="email" placeholder="Email address" />
    `);

    await executeBrowserAction(page, { type: 'fill', selector: '#name', value: 'Ada' }, 1000);
    await executeBrowserAction(page, { type: 'fill', text: 'Email address', value: 'ada@example.com' }, 1000);

    assert.equal(await page.locator('#name').inputValue(), 'Ada');
    assert.equal(await page.locator('#email').inputValue(), 'ada@example.com');
  });
});

test('waitForTarget supports selector, url, and networkIdle', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <button>Next</button>
        <div class="ready">Ready</div>
      </main>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          history.pushState({}, '', '#next');
        });
      </script>
    `);

    await waitForTarget(page, { type: 'selector', value: '.ready' }, 1000);
    await executeBrowserAction(page, { type: 'click', selector: 'button', waitFor: { type: 'url', value: '#next' } }, 1000);
    await waitForTarget(page, { type: 'networkIdle' }, 1000);

    assert.ok(page.url().endsWith('#next'));
  });
});

test('executeBrowserAction scrolls by wheel delta', async () => {
  await withPage(async (page) => {
    await page.setContent('<main style="height: 3000px"><h1>Scrollable</h1></main>');

    await executeBrowserAction(page, { type: 'scroll', y: 500 }, 1000);

    await page.waitForFunction('window.scrollY > 0', undefined, { timeout: 1000 });
    assert.ok(await page.evaluate('window.scrollY > 0'));
  });
});

test('executeBrowserAction uses specific error codes for action failures', async () => {
  await withPage(async (page) => {
    await page.setContent('<button>Exists</button>');

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'goto', url: 'http://127.0.0.1:1/missing' }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_GOTO_URL'
        && error.message.includes('goto'),
    );

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'click', text: 'Missing' }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_CLICK_TARGET'
        && error.message.includes('click')
        && error.message.includes('Missing'),
    );

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'fill', value: 'Ada' }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_FILL_TARGET'
        && error.message.includes('fill'),
    );
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unsupportedAction = { type: 'hover', selector: 'button' } as any;

test('executeBrowserAction reports unsupported action separately from missing action', async () => {
  await withPage(async (page) => {
    await page.setContent('<button>Exists</button>');

    await assert.rejects(
      () => executeBrowserAction(page, unsupportedAction, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'UNSUPPORTED_SCRIPT_ACTION'
        && error.message.includes('Unsupported action type: hover'),
    );
  });
});

test('executeBrowserAction preserves label fill failure when placeholder fallback exists', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>Locked <button aria-label="Locked">Not an input</button></label>
      <input id="fallback" placeholder="Locked" />
    `);

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'fill', text: 'Locked', value: 'Ada' }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_FILL_TARGET'
        && error.message.includes('label')
        && error.message.includes('Locked'),
    );

    assert.equal(await page.locator('#fallback').inputValue(), '');
  });
});
