import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { executeBrowserAction } from '../../src/lib/video-generator/browser/actions.js';
import { VideoGeneratorError, type ActionFailureDiagnostics } from '../../src/lib/video-generator/types.js';

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

test('remoteSelect failure includes dropdown diagnostics', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="city">City</button>
      <div class="el-select-dropdown" style="display:none"><div>Hidden choice</div></div>
      <div class="el-popper" style="display:block"><div class="el-select-dropdown__item">Shanghai</div></div>
    `);

    await assert.rejects(
      () => executeBrowserAction(page, {
        type: 'remoteSelect',
        selector: '#city',
        keyword: 'Bei',
        optionText: 'Beijing',
        stageName: 'order.city',
      }, 100),
      (error) => {
        const diagnostics = error instanceof VideoGeneratorError ? error.diagnostics : undefined;
        assert.equal(diagnostics?.stageName, 'order.city');
        assert.equal(diagnostics?.selector, '#city');
        assert.equal(diagnostics?.missingText, 'Beijing');
        assert.equal(diagnostics?.dropdowns?.popperCount, 2);
        assert.equal(diagnostics?.dropdowns?.visibleItemCount, 1);
        assert.equal(diagnostics?.dropdowns?.hiddenContainerCount, 1);
        assert.equal(diagnostics?.dropdowns?.failureReason, 'option text not found');
        return error instanceof VideoGeneratorError && error.code === 'INVALID_REMOTE_SELECT_TARGET';
      },
    );
  });
});

function assertDiagnostic(_diagnostic: ActionFailureDiagnostics): void {
  assert.ok(true);
}

void assertDiagnostic;
