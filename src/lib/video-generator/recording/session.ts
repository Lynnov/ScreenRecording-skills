import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export type ManualPocFixture = 'capture' | 'clock' | 'events';

export interface ManualChromiumSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  bindingTitle: string;
  navigateToFixture(fixture: ManualPocFixture): Promise<void>;
  close(): Promise<void>;
}

export async function launchManualChromiumSession(input: {
  sessionId: string;
  fixtureDir: string;
}): Promise<ManualChromiumSession> {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  const bindingTitle = `VG-CAPTURE-${input.sessionId}`;
  await page.setContent(`<title>${bindingTitle}</title><main>正在绑定窗口…</main>`);
  await page.waitForFunction((title) => ((globalThis as unknown) as { document: { title: string } }).document.title === title, bindingTitle);

  return {
    browser,
    context,
    page,
    bindingTitle,
    async navigateToFixture(fixture) {
      const fixturePath = path.join(input.fixtureDir, `${fixture}-fixture.html`);
      await page.goto(pathToFileURL(fixturePath).href);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
