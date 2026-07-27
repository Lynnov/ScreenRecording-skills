import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { installManualCursorOverlay } from '../browser/manual-cursor-overlay.js';
import { installManualObserver, type ManualObservedEvent } from '../browser/manual-observer.js';
import {
  installTabObserver,
  type ManualTabEvent,
  type TabObserverController,
} from '../browser/tab-observer.js';
import type { RecordingClock } from './clock.js';
import type { RecordingEvent } from './types.js';

export type ManualPocFixture = 'capture' | 'clock' | 'events';

export function manualPocFixtureFileName(fixture: ManualPocFixture): string {
  return fixture === 'events' ? 'event-fixture.html' : `${fixture}-fixture.html`;
}

export interface ManualChromiumSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  bindingTitle: string;
  navigateToFixture(fixture: ManualPocFixture): Promise<void>;
  close(): Promise<void>;
}

interface ManualObserverInstallers {
  manual: typeof installManualObserver;
  cursor: typeof installManualCursorOverlay;
  tabs: typeof installTabObserver;
}

export interface ManualCaptureObservers {
  readonly eventCaptureComplete: boolean;
  tabs: TabObserverController | null;
  flush(): Promise<void>;
}

type ObserverInputEvent = ManualTabEvent | {
  type: 'observer-error';
  payload: { observer: string; message: string };
};

export interface TimestampedObserverEventSink {
  readonly eventCaptureComplete: boolean;
  onEvent(event: ObserverInputEvent): Promise<void>;
  flush(): Promise<void>;
}

export function createTimestampedObserverEventSink(input: {
  clock: RecordingClock;
  append: (event: RecordingEvent & Record<string, unknown>) => Promise<void>;
}): TimestampedObserverEventSink {
  let eventCaptureComplete = true;
  let queue = Promise.resolve();

  const appendObserverError = async (error: unknown): Promise<void> => {
    eventCaptureComplete = false;
    const fallback: RecordingEvent & Record<string, unknown> = {
      type: 'observer-error',
      ...input.clock.stamp(),
      payload: { observer: 'event-sink', message: error instanceof Error ? error.message : String(error) },
    };
    try {
      await input.append(fallback);
    } catch {
      // The sink is already incomplete. Retrying recursively would only amplify a storage failure.
    }
  };

  return {
    get eventCaptureComplete() {
      return eventCaptureComplete;
    },
    async onEvent(event) {
      const timestamped = { ...event, ...input.clock.stamp() };
      queue = queue.then(async () => {
        try {
          await input.append(timestamped);
          if (event.type === 'observer-error') {
            eventCaptureComplete = false;
          }
        } catch (error) {
          await appendObserverError(error);
        }
      });
      await queue;
    },
    async flush() {
      await queue;
    },
  };
}

export async function installManualCaptureObservers(input: {
  context: BrowserContext;
  tabsPath: string;
  onEvent: (event: ObserverInputEvent) => Promise<void> | void;
  installers?: ManualObserverInstallers;
}): Promise<ManualCaptureObservers> {
  const installers = input.installers ?? {
    manual: installManualObserver,
    cursor: installManualCursorOverlay,
    tabs: installTabObserver,
  };
  let eventCaptureComplete = true;
  let tabs: TabObserverController | null = null;
  let reportingCallbackFailure = false;
  let acceptingEvents = true;
  const inFlightEvents = new Set<Promise<void>>();
  const emitSafely = async (event: ObserverInputEvent): Promise<void> => {
    try {
      await input.onEvent(event);
    } catch (error) {
      eventCaptureComplete = false;
      if (event.type === 'observer-error' || reportingCallbackFailure) return;
      reportingCallbackFailure = true;
      try {
        await input.onEvent({
          type: 'observer-error',
          payload: {
            observer: 'event-callback',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } catch {
        // A broken sink cannot persist its own failure; do not recurse or stop capture.
      } finally {
        reportingCallbackFailure = false;
      }
    }
  };
  const reportError = async (observer: string, error: unknown): Promise<void> => {
    eventCaptureComplete = false;
    await emitSafely({
      type: 'observer-error',
      payload: { observer, message: error instanceof Error ? error.message : String(error) },
    });
  };
  const dispatch = async (event: ObserverInputEvent): Promise<void> => {
    if (!acceptingEvents) return;
    const operation = emitSafely(event);
    inFlightEvents.add(operation);
    try {
      await operation;
    } finally {
      inFlightEvents.delete(operation);
    }
  };
  const waitForInFlightEvents = async (): Promise<void> => {
    while (inFlightEvents.size > 0) {
      await Promise.allSettled([...inFlightEvents]);
    }
  };

  try {
    await installers.manual(input.context, async (page, event: ManualObservedEvent) => {
      const tabId = tabs?.tabIdForPage(page);
      await dispatch(tabId === null || tabId === undefined ? event as ManualTabEvent : { ...event, tabId });
    });
  } catch (error) {
    await reportError('manual-observer', error);
  }
  try {
    await installers.cursor(input.context);
  } catch (error) {
    await reportError('cursor-overlay', error);
  }
  try {
    tabs = await installers.tabs(input.context, dispatch, { tabsPath: input.tabsPath });
  } catch (error) {
    await reportError('tab-observer', error);
  }

  return {
    get eventCaptureComplete() {
      return eventCaptureComplete;
    },
    get tabs() {
      return tabs;
    },
    async flush() {
      acceptingEvents = false;
      await waitForInFlightEvents();
      try {
        await tabs?.flush();
      } catch (error) {
        await reportError('tab-observer-flush', error);
      }
      await waitForInFlightEvents();
    },
  };
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
      const fixturePath = path.join(input.fixtureDir, manualPocFixtureFileName(fixture));
      await page.goto(pathToFileURL(fixturePath).href);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
