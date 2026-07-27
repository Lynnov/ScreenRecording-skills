import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingEvent } from './types.js';

const EVENT_TYPES = [
  'pointer-click', 'input', 'change', 'scroll', 'navigation',
  'tab-created', 'tab-activated', 'tab-closed', 'observer-error',
] as const;

type CountedEventType = (typeof EVENT_TYPES)[number];

export interface ManualEventsPocReport {
  version: 1;
  status: 'passed' | 'incomplete' | 'failed';
  eventsPath: string;
  tabsPath: string;
  eventCaptureComplete: boolean;
  eventsTruncated: boolean;
  counts: Record<CountedEventType, number>;
  reloadReinjectionPassed: boolean;
  newTabReinjectionPassed: boolean;
  childFrameReinjectionPassed: boolean;
  dynamicDomPassed: boolean;
  cursorDidNotBlockInteraction: boolean;
  errors: string[];
}

export async function writeManualEventsPocReport(input: {
  eventsPath: string;
  tabsPath: string;
  reportPath: string;
  eventCaptureComplete: boolean;
}): Promise<ManualEventsPocReport> {
  let events: Record<string, unknown>[] = [];
  let eventsTruncated = false;
  const loadErrors: string[] = [];
  try {
    const loaded = await readRecordingEventsJsonl(input.eventsPath);
    events = loaded.events;
    eventsTruncated = loaded.truncated;
  } catch (error) {
    loadErrors.push(error instanceof Error ? error.message : String(error));
  }
  let registryTabs: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(await readFile(input.tabsPath, 'utf8')) as unknown;
    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.tabs)) {
      throw new Error('Invalid tabs registry structure.');
    }
    registryTabs = parsed.tabs.filter(isObject);
    if (registryTabs.length !== parsed.tabs.length) {
      throw new Error('Invalid tabs registry item.');
    }
    for (const tab of registryTabs) {
      if (typeof tab.tabId !== 'string' || typeof tab.url !== 'string' || typeof tab.title !== 'string'
        || typeof tab.createdSessionTimeMs !== 'number'
        || !(typeof tab.closedSessionTimeMs === 'number' || tab.closedSessionTimeMs === null)) {
        throw new Error('Invalid tabs registry item fields.');
      }
    }
  } catch (error) {
    loadErrors.push(`Tabs registry: ${error instanceof Error ? error.message : String(error)}`);
  }
  const counts = Object.fromEntries(EVENT_TYPES.map((type) => [
    type,
    events.filter((event) => event.type === type).length,
  ])) as Record<CountedEventType, number>;
  const observerErrors = events
    .filter((event) => event.type === 'observer-error')
    .map((event) => {
      const payload = isObject(event.payload) ? event.payload : {};
      return typeof payload.message === 'string' ? payload.message : 'Unknown observer error';
    });
  const createdTabIds = events
    .filter((event) => event.type === 'tab-created' && typeof event.tabId === 'string')
    .map((event) => event.tabId as string);
  const newTabId = createdTabIds[1] ?? null;
  const registryIds = new Set(registryTabs
    .map((tab) => tab.tabId)
    .filter((tabId): tabId is string => typeof tabId === 'string'));
  if (registryTabs.length < 2) loadErrors.push('Tabs registry must contain at least two tabs.');
  if (registryIds.size !== registryTabs.length) loadErrors.push('Tabs registry contains missing or duplicate tab ids.');
  const usedTabIds = new Set(events
    .map((event) => event.tabId)
    .filter((tabId): tabId is string => typeof tabId === 'string'));
  for (const tabId of new Set([...createdTabIds, ...usedTabIds])) {
    if (!registryIds.has(tabId)) loadErrors.push(`Event tab id ${tabId} is missing from tabs registry.`);
  }
  for (const tabId of registryIds) {
    if (!createdTabIds.includes(tabId)) loadErrors.push(`Tabs registry id ${tabId} has no tab-created event.`);
  }
  if (newTabId !== null) {
    const newTab = registryTabs.find((tab) => tab.tabId === newTabId);
    if (newTab === undefined || typeof newTab.closedSessionTimeMs !== 'number') {
      loadErrors.push(`New tab ${newTabId} must have a non-null closedSessionTimeMs.`);
    }
  }

  const reloadClickIndex = events.findIndex((event) => event.type === 'pointer-click'
    && isObject(event.target) && event.target.id === 'reload');
  const reloadTabId = reloadClickIndex < 0 ? null : events[reloadClickIndex].tabId;
  const reloadNavigationIndex = events.findIndex((event, index) => index > reloadClickIndex
    && event.type === 'navigation' && event.tabId === reloadTabId);
  const reloadReinjectionPassed = reloadNavigationIndex >= 0 && events.some((event, index) =>
    index > reloadNavigationIndex && event.tabId === reloadTabId && isPageInteraction(event));
  const newTabReinjectionPassed = newTabId !== null && events.some((event) =>
    event.tabId === newTabId && isPageInteraction(event));
  const childFrameReinjectionPassed = events.some((event) =>
    event.isMainFrame === false && typeof event.frameUrl === 'string' && isPageInteraction(event));
  const replacementIndex = events.findIndex((event) =>
    event.type === 'pointer-click' && isObject(event.target) && event.target.id === 'replace-dom');
  const dynamicDomPassed = events.some((event, index) =>
    index > replacementIndex && isObject(event.target)
    && (event.target.id === 'replacement-button' || event.target.id === 'replacement-input'));
  const cursorDidNotBlockInteraction = events.filter((event) =>
    event.type === 'pointer-click' && isObject(event.target)
    && event.target.id !== '__video-generator-manual-cursor').length >= 3;
  const eventCaptureComplete = input.eventCaptureComplete && counts['observer-error'] === 0;
  const errors = [...loadErrors, ...observerErrors];
  const minimumCounts: Partial<Record<CountedEventType, number>> = {
    'pointer-click': 3, input: 1, change: 1, scroll: 1, navigation: 2,
    'tab-created': 2, 'tab-activated': 2, 'tab-closed': 1,
  };
  for (const [type, minimum] of Object.entries(minimumCounts) as Array<[CountedEventType, number]>) {
    if (counts[type] < minimum) errors.push(`Missing required event count: ${type} >= ${minimum}`);
  }
  for (const [label, found] of Object.entries({
    reloadReinjectionPassed,
    newTabReinjectionPassed,
    childFrameReinjectionPassed,
    dynamicDomPassed,
    cursorDidNotBlockInteraction,
  })) {
    if (!found) {
      errors.push(`Missing required evidence: ${label}`);
    }
  }
  const report: ManualEventsPocReport = {
    version: 1,
    status: eventCaptureComplete
      ? (errors.length === 0 ? 'passed' : 'failed')
      : 'incomplete',
    eventsPath: input.eventsPath,
    tabsPath: input.tabsPath,
    eventCaptureComplete,
    eventsTruncated,
    counts,
    reloadReinjectionPassed,
    newTabReinjectionPassed,
    childFrameReinjectionPassed,
    dynamicDomPassed,
    cursorDidNotBlockInteraction,
    errors,
  };
  await mkdir(path.dirname(input.reportPath), { recursive: true });
  const tempPath = `${input.reportPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(tempPath, input.reportPath);
  return report;
}

export async function readRecordingEventsJsonl(filePath: string): Promise<{
  events: Array<RecordingEvent & Record<string, unknown>>;
  truncated: boolean;
}> {
  const content = await readFile(filePath, 'utf8');
  const endsWithNewline = content.endsWith('\n') || content.endsWith('\r\n');
  const lines = content.split(/\r?\n/u);
  const nonEmptyIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() !== '');
  const lastNonEmptyIndex = nonEmptyIndexes.at(-1)?.index ?? -1;
  const events: Array<RecordingEvent & Record<string, unknown>> = [];
  let truncated = false;
  for (const { line, index } of nonEmptyIndexes) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      if (index === lastNonEmptyIndex && !endsWithNewline) {
        truncated = true;
        continue;
      }
      throw new Error(`Invalid events JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isObject(parsed) || typeof parsed.type !== 'string'
      || typeof parsed.sessionTimeMs !== 'number'
      || !(typeof parsed.videoTimeMs === 'number' || parsed.videoTimeMs === null)) {
      throw new Error(`Invalid events JSONL at line ${index + 1}: event is missing recording timestamp fields`);
    }
    events.push(parsed as RecordingEvent & Record<string, unknown>);
  }
  return { events, truncated };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPageInteraction(event: Record<string, unknown>): boolean {
  return event.type === 'pointer-click' || event.type === 'input'
    || event.type === 'change' || event.type === 'scroll';
}
