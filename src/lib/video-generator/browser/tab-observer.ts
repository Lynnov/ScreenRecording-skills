import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { ManualObservedEvent } from './manual-observer.js';

export type ManualTabEvent = (ManualObservedEvent & { tabId: string }) | {
  type: 'tab-created' | 'tab-activated' | 'navigation' | 'tab-closed';
  tabId: string;
  title?: string;
  payload: { url: string };
};

export interface ManualTabSnapshotItem {
  tabId: string;
  url: string;
  title: string;
  createdSessionTimeMs: number;
  closedSessionTimeMs: number | null;
}

export interface ManualTabSnapshot {
  version: 1;
  tabs: ManualTabSnapshotItem[];
}

export interface TabObserverController {
  tabIdForPage(page: Page): string | null;
  flush(): Promise<void>;
  snapshot(): ManualTabSnapshot;
}

export async function installTabObserver(
  context: BrowserContext,
  onEvent: (event: ManualTabEvent) => Promise<void> | void,
  options: { tabsPath: string },
): Promise<TabObserverController> {
  const pageIds = new WeakMap<Page, string>();
  const tabs: ManualTabSnapshotItem[] = [];
  const startedAt = process.hrtime.bigint();
  let nextTabNumber = 1;
  let writeQueue = Promise.resolve();
  const pendingOperations = new Set<Promise<void>>();
  let firstOperationError: unknown;
  let hasOperationError = false;
  let lastActivatedTabId: string | null = null;

  const sessionTimeMs = (): number => Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);

  const emit = async (event: ManualTabEvent): Promise<void> => {
    await onEvent(event);
  };

  const track = (operation: Promise<void>): void => {
    pendingOperations.add(operation);
    void operation.then(
      () => pendingOperations.delete(operation),
      (error: unknown) => {
        pendingOperations.delete(operation);
        if (!hasOperationError) {
          hasOperationError = true;
          firstOperationError = error;
        }
      },
    );
  };

  const enqueueSnapshotWrite = (): void => {
    writeQueue = writeQueue.then(async () => {
      await writeTabsSnapshot(options.tabsPath, { version: 1, tabs });
    });
  };

  const tabIdForPage = (page: Page): string | null => pageIds.get(page) ?? null;

  const recordNavigation = async (page: Page, capturedUrl: string): Promise<void> => {
    const tabId = tabIdForPage(page);
    if (tabId === null) {
      return;
    }
    const item = tabs.find((tab) => tab.tabId === tabId);
    if (item !== undefined) {
      item.url = capturedUrl;
      item.title = await page.title().catch(() => item.title);
    }
    await emit({ type: 'navigation', tabId, payload: { url: capturedUrl } });
    enqueueSnapshotWrite();
  };

  const recordActivation = async (page: Page): Promise<void> => {
    const tabId = tabIdForPage(page);
    if (tabId === null || tabId === lastActivatedTabId) {
      return;
    }
    lastActivatedTabId = tabId;
    await emit({ type: 'tab-activated', tabId, payload: { url: page.url() } });
  };

  const registerPage = (page: Page): void => {
    if (pageIds.has(page)) {
      return;
    }
    const tabId = `tab-${nextTabNumber}`;
    nextTabNumber += 1;
    pageIds.set(page, tabId);
    tabs.push({
      tabId,
      url: page.url(),
      title: '',
      createdSessionTimeMs: sessionTimeMs(),
      closedSessionTimeMs: null,
    });
    track(emit({ type: 'tab-created', tabId, payload: { url: page.url() } }));
    enqueueSnapshotWrite();

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        track(recordNavigation(page, frame.url()));
      }
    });
    page.on('close', () => {
      const item = tabs.find((tab) => tab.tabId === tabId);
      if (item !== undefined) {
        item.url = page.url();
        item.closedSessionTimeMs = sessionTimeMs();
      }
      track(emit({ type: 'tab-closed', tabId, payload: { url: page.url() } }));
      enqueueSnapshotWrite();
    });
  };

  for (const page of context.pages()) {
    registerPage(page);
  }
  context.on('page', registerPage);

  await context.exposeBinding('__videoGeneratorRecordTabEvent', async ({ page }, event: unknown) => {
    if (!isPlainObject(event)) {
      return;
    }
    if (event.type === 'tab-activated'
      && event.visibilityState === 'visible'
      && event.hasFocus === true) {
      await recordActivation(page);
    }
  });
  await context.addInitScript({ content: TAB_OBSERVER_SCRIPT });
  await Promise.all(context.pages().map(async (page) => {
    await page.addScriptTag({ content: TAB_OBSERVER_SCRIPT });
  }));

  return {
    tabIdForPage,
    async flush() {
      while (pendingOperations.size > 0) {
        await Promise.allSettled([...pendingOperations]);
      }
      enqueueSnapshotWrite();
      await writeQueue;
      if (hasOperationError) {
        throw firstOperationError;
      }
    },
    snapshot() {
      return { version: 1, tabs: tabs.map((tab) => ({ ...tab })) };
    },
  };
}

async function writeTabsSnapshot(filePath: string, snapshot: ManualTabSnapshot): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

const TAB_OBSERVER_SCRIPT = `
(() => {
  if (globalThis.__videoGeneratorTabObserverInstalled) return;
  globalThis.__videoGeneratorTabObserverInstalled = true;

  const reportActivation = () => {
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      globalThis.__videoGeneratorRecordTabEvent?.({
        type: 'tab-activated',
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
    }
  };

  addEventListener('focus', reportActivation, { passive: true });
  document.addEventListener('visibilitychange', reportActivation, { passive: true });
  reportActivation();
})();
`;
