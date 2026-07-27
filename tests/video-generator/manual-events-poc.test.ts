import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { readRecordingEventsJsonl } from '../../src/lib/video-generator/recording/events-poc-report.js';

const runDir = process.env.MANUAL_POC_RUN;

test('accepts an independently produced manual events POC run', async () => {
  assert.ok(runDir, 'MANUAL_POC_RUN must point to a completed events POC run');
  const report = JSON.parse(await readFile(path.join(runDir, 'reports', 'manual-events-poc-report.json'), 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.eventCaptureComplete, true);
  assert.equal(report.reloadReinjectionPassed, true);
  assert.equal(report.newTabReinjectionPassed, true);
  assert.equal(report.childFrameReinjectionPassed, true);
  assert.equal(report.dynamicDomPassed, true);
  assert.equal(report.cursorDidNotBlockInteraction, true);

  const loadedEvents = await readRecordingEventsJsonl(path.join(runDir, 'capture', 'events.jsonl'));
  const events = loadedEvents.events;
  assert.equal(loadedEvents.truncated, report.eventsTruncated);
  const count = (type: string) => events.filter((event) => event.type === type).length;
  assert.ok(count('pointer-click') >= 3);
  assert.ok(count('navigation') >= 2);
  assert.ok(count('tab-created') >= 2);
  assert.ok(count('tab-activated') >= 2);
  assert.ok(count('tab-closed') >= 1);
  assert.equal(count('observer-error'), 0);
  for (const type of ['input', 'change', 'scroll']) assert.ok(count(type) >= 1, `missing ${type}`);
  assert.ok(events.every((event, index) => index === 0 || event.sessionTimeMs >= events[index - 1].sessionTimeMs));
  const firstVideoEvent = events.findIndex((event) => event.videoTimeMs !== null);
  assert.ok(firstVideoEvent >= 0);
  assert.ok(events.slice(firstVideoEvent).every((event) => event.videoTimeMs !== null));
  assert.ok(events.some((event) => event.isMainFrame === false && typeof event.frameUrl === 'string'));
  const pageEventTypes = new Set(['pointer-click', 'input', 'change', 'scroll', 'navigation', 'tab-created', 'tab-activated', 'tab-closed']);
  assert.ok(events.filter((event) => pageEventTypes.has(event.type)).every((event) => typeof event.tabId === 'string' && /^tab-\d+$/.test(event.tabId)));
  const createdTabIds = events.filter((event) => event.type === 'tab-created').map((event) => event.tabId);
  const newTabId = createdTabIds[1];
  assert.equal(typeof newTabId, 'string');
  assert.ok(events.some((event) => event.tabId === newTabId && ['pointer-click', 'input', 'change', 'scroll'].includes(event.type)));

  const tabs = JSON.parse(await readFile(path.join(runDir, 'capture', 'tabs.json'), 'utf8'));
  assert.equal(tabs.tabs.length, 2);
  assert.deepEqual(tabs.tabs.map((tab: { tabId: string }) => tab.tabId), createdTabIds);
  assert.ok(tabs.tabs.every((tab: { title: unknown; url: unknown }) => typeof tab.title === 'string' && typeof tab.url === 'string'));
  assert.equal(typeof tabs.tabs.find((tab: { tabId: string }) => tab.tabId === newTabId)?.closedSessionTimeMs, 'number');
});
