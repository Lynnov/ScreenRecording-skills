import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeManualEventsPocReport } from '../../src/lib/video-generator/recording/events-poc-report.js';
import {
  createTimestampedObserverEventSink,
  installManualCaptureObservers,
  manualPocFixtureFileName,
} from '../../src/lib/video-generator/recording/session.js';
import { createRecordingClock } from '../../src/lib/video-generator/recording/clock.js';

async function withRunFiles(
  events: unknown[],
  eventCaptureComplete: boolean,
  tabs: unknown = {
    version: 1,
    tabs: [
      { tabId: 'tab-1', url: 'file:///fixture.html', title: 'Fixture', createdSessionTimeMs: 0, closedSessionTimeMs: null },
      { tabId: 'tab-2', url: 'file:///fixture.html?tab=2', title: 'Fixture tab 2', createdSessionTimeMs: 10, closedSessionTimeMs: 20 },
    ],
  },
): Promise<{ dir: string; report: Awaited<ReturnType<typeof writeManualEventsPocReport>> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-events-report-'));
  const eventsPath = path.join(dir, 'capture', 'events.jsonl');
  const tabsPath = path.join(dir, 'capture', 'tabs.json');
  const reportPath = path.join(dir, 'reports', 'manual-events-poc-report.json');
  await mkdir(path.dirname(eventsPath), { recursive: true });
  await writeFile(eventsPath, `${events.map((event, index) => JSON.stringify({
    ...event as Record<string, unknown>,
    sessionTimeMs: index,
    videoTimeMs: index,
  })).join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });
  await writeFile(tabsPath, JSON.stringify(tabs), { encoding: 'utf8', flag: 'wx' });
  const report = await writeManualEventsPocReport({ eventsPath, tabsPath, reportPath, eventCaptureComplete });
  return { dir, report };
}

const completeEvents = [
  { type: 'tab-created', tabId: 'tab-1' },
  { type: 'navigation', tabId: 'tab-1' },
  { type: 'tab-activated', tabId: 'tab-1' },
  { type: 'pointer-click', tabId: 'tab-1', target: { id: 'reload' } },
  { type: 'navigation', tabId: 'tab-1' },
  { type: 'pointer-click', tabId: 'tab-1', target: { id: 'replace-dom' } },
  { type: 'input', tabId: 'tab-1', target: { id: 'replacement-input' } },
  { type: 'pointer-click', tabId: 'tab-1', target: { id: 'plain-button' } },
  { type: 'input', tabId: 'tab-1' },
  { type: 'change', tabId: 'tab-1' },
  { type: 'scroll', tabId: 'tab-1' },
  { type: 'tab-created', tabId: 'tab-2' },
  { type: 'navigation', tabId: 'tab-2' },
  { type: 'tab-activated', tabId: 'tab-2' },
  { type: 'pointer-click', tabId: 'tab-2', target: { id: 'plain-button' } },
  { type: 'pointer-click', tabId: 'tab-1', isMainFrame: false, frameUrl: 'about:srcdoc' },
  { type: 'tab-closed', tabId: 'tab-2' },
];

test('writes a complete passing report atomically', async () => {
  const { dir, report } = await withRunFiles(completeEvents, true);
  try {
    assert.equal(report.version, 1);
    assert.equal(report.status, 'passed');
    assert.equal(report.eventCaptureComplete, true);
    assert.deepEqual(report.counts, {
      'pointer-click': 5, input: 2, change: 1, scroll: 1, navigation: 3,
      'tab-created': 2, 'tab-activated': 2, 'tab-closed': 1, 'observer-error': 0,
    });
    assert.deepEqual({
      reload: report.reloadReinjectionPassed,
      newTab: report.newTabReinjectionPassed,
      childFrame: report.childFrameReinjectionPassed,
      dynamicDom: report.dynamicDomPassed,
      cursor: report.cursorDidNotBlockInteraction,
    }, { reload: true, newTab: true, childFrame: true, dynamicDom: true, cursor: true });
    assert.deepEqual(report.errors, []);
    assert.deepEqual(await readFile(path.join(dir, 'reports', 'manual-events-poc-report.json'), 'utf8').then(JSON.parse), report);
    await assert.rejects(readFile(path.join(dir, 'reports', 'manual-events-poc-report.json.tmp'), 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('marks observer errors incomplete', async () => {
  const { dir, report } = await withRunFiles([...completeEvents, {
    type: 'observer-error',
    payload: { message: 'observer failed' },
  }], false);
  try {
    assert.equal(report.status, 'incomplete');
    assert.equal(report.eventCaptureComplete, false);
    assert.equal(report.counts['observer-error'], 1);
    assert.deepEqual(report.errors, ['observer failed']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('observer-error in the log forces incomplete even when the caller claims completion', async () => {
  const { dir, report } = await withRunFiles([...completeEvents, {
    type: 'observer-error',
    payload: { message: 'late sink failure' },
  }], true);
  try {
    assert.equal(report.status, 'incomplete');
    assert.equal(report.eventCaptureComplete, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects malformed and event-mismatched tab registries', async () => {
  const malformed = await withRunFiles(completeEvents, true, { version: 1, tabs: 'broken' });
  try {
    assert.equal(malformed.report.status, 'failed');
    assert.ok(malformed.report.errors.some((error) => /tabs/i.test(error)));
  } finally {
    await rm(malformed.dir, { recursive: true, force: true });
  }
  const mismatched = await withRunFiles(completeEvents, true, {
    version: 1,
    tabs: [
      { tabId: 'tab-1', url: 'file:///fixture.html', title: 'Fixture', createdSessionTimeMs: 0, closedSessionTimeMs: null },
      { tabId: 'tab-9', url: 'file:///other.html', title: 'Other', createdSessionTimeMs: 10, closedSessionTimeMs: null },
    ],
  });
  try {
    assert.equal(mismatched.report.status, 'failed');
    assert.ok(mismatched.report.errors.some((error) => /tab-2|registry|closed/i.test(error)));
  } finally {
    await rm(mismatched.dir, { recursive: true, force: true });
  }
});

test('accepts only a truncated final JSONL line and marks the report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-events-truncated-'));
  try {
    const eventsPath = path.join(dir, 'capture', 'events.jsonl');
    const tabsPath = path.join(dir, 'capture', 'tabs.json');
    const reportPath = path.join(dir, 'reports', 'manual-events-poc-report.json');
    await mkdir(path.dirname(eventsPath), { recursive: true });
    const timestampedEvents = completeEvents.map((event, index) => ({ ...event, sessionTimeMs: index, videoTimeMs: index }));
    await writeFile(eventsPath, `${timestampedEvents.map((event) => JSON.stringify(event)).join('\n')}\n{"type":"pointer-click"`, 'utf8');
    await writeFile(tabsPath, JSON.stringify({
      version: 1,
      tabs: [
        { tabId: 'tab-1', url: 'file:///fixture.html', title: 'Fixture', createdSessionTimeMs: 0, closedSessionTimeMs: null },
        { tabId: 'tab-2', url: 'file:///fixture.html?tab=2', title: 'Fixture tab 2', createdSessionTimeMs: 10, closedSessionTimeMs: 20 },
      ],
    }), 'utf8');
    const report = await writeManualEventsPocReport({ eventsPath, tabsPath, reportPath, eventCaptureComplete: true });
    assert.equal(report.status, 'passed');
    assert.equal(report.eventsTruncated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fails when a non-final JSONL line is malformed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-events-corrupt-'));
  try {
    const eventsPath = path.join(dir, 'capture', 'events.jsonl');
    const tabsPath = path.join(dir, 'capture', 'tabs.json');
    const reportPath = path.join(dir, 'reports', 'manual-events-poc-report.json');
    await mkdir(path.dirname(eventsPath), { recursive: true });
    const timestampedEvents = completeEvents.map((event, index) => ({ ...event, sessionTimeMs: index, videoTimeMs: index }));
    await writeFile(eventsPath, `${JSON.stringify(timestampedEvents[0])}\n{bad}\n${timestampedEvents.slice(1).map((event) => JSON.stringify(event)).join('\n')}`, 'utf8');
    await writeFile(tabsPath, JSON.stringify({ version: 1, tabs: [] }), 'utf8');
    const report = await writeManualEventsPocReport({ eventsPath, tabsPath, reportPath, eventCaptureComplete: true });
    assert.equal(report.status, 'failed');
    assert.ok(report.errors.some((error) => /line 2/i.test(error)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fails a malformed final JSONL line when the file ends with a newline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-events-complete-bad-line-'));
  try {
    const eventsPath = path.join(dir, 'capture', 'events.jsonl');
    const tabsPath = path.join(dir, 'capture', 'tabs.json');
    const reportPath = path.join(dir, 'reports', 'manual-events-poc-report.json');
    await mkdir(path.dirname(eventsPath), { recursive: true });
    const timestampedEvents = completeEvents.map((event, index) => ({ ...event, sessionTimeMs: index, videoTimeMs: index }));
    await writeFile(eventsPath, `${timestampedEvents.map((event) => JSON.stringify(event)).join('\n')}\n{bad}\n`, 'utf8');
    await writeFile(tabsPath, JSON.stringify({ version: 1, tabs: [] }), 'utf8');
    const report = await writeManualEventsPocReport({ eventsPath, tabsPath, reportPath, eventCaptureComplete: true });
    assert.equal(report.status, 'failed');
    assert.equal(report.eventsTruncated, false);
    assert.ok(report.errors.some((error) => /line 18/i.test(error)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('marks a capture with missing required events failed', async () => {
  const { dir, report } = await withRunFiles([{ type: 'pointer-click' }], true);
  try {
    assert.equal(report.status, 'failed');
    assert.ok(report.errors.some((error) => error.includes('input')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installs manual observer, cursor overlay, then tab observer', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const controller = await installManualCaptureObservers({
    context: {} as never,
    tabsPath: 'tabs.json',
    onEvent: (event) => { events.push(event); },
    installers: {
      manual: async () => { calls.push('manual'); },
      cursor: async () => { calls.push('cursor'); },
      tabs: async () => {
        calls.push('tabs');
        return { tabIdForPage: () => 'tab-1', flush: async () => {}, snapshot: () => ({ version: 1, tabs: [] }) };
      },
    },
  });
  assert.deepEqual(calls, ['manual', 'cursor', 'tabs']);
  assert.equal(controller.eventCaptureComplete, true);
  assert.deepEqual(events, []);
});

test('observer setup errors are recorded without stopping capture', async () => {
  const calls: string[] = [];
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const controller = await installManualCaptureObservers({
    context: {} as never,
    tabsPath: 'tabs.json',
    onEvent: (event) => { events.push(event); },
    installers: {
      manual: async () => { calls.push('manual'); throw new Error('binding unavailable'); },
      cursor: async () => { calls.push('cursor'); },
      tabs: async () => {
        calls.push('tabs');
        return { tabIdForPage: () => null, flush: async () => {}, snapshot: () => ({ version: 1, tabs: [] }) };
      },
    },
  });
  assert.deepEqual(calls, ['manual', 'cursor', 'tabs']);
  assert.equal(controller.eventCaptureComplete, false);
  assert.equal(events[0]?.type, 'observer-error');
  assert.match(String(events[0]?.payload?.message), /binding unavailable/);
});

test('a rejecting observer callback does not stop observer installation', async () => {
  const calls: string[] = [];
  const controller = await installManualCaptureObservers({
    context: {} as never,
    tabsPath: 'tabs.json',
    onEvent: async () => { throw new Error('consumer unavailable'); },
    installers: {
      manual: async (_context, onEvent) => {
        calls.push('manual');
        await onEvent({} as never, {
          type: 'pointer-click', url: '', frameUrl: '', isMainFrame: true,
        });
      },
      cursor: async () => { calls.push('cursor'); },
      tabs: async () => {
        calls.push('tabs');
        return { tabIdForPage: () => null, flush: async () => {}, snapshot: () => ({ version: 1, tabs: [] }) };
      },
    },
  });
  assert.deepEqual(calls, ['manual', 'cursor', 'tabs']);
  assert.equal(controller.eventCaptureComplete, false);
});

test('flush waits for in-flight manual callbacks and ignores callbacks arriving after shutdown', async () => {
  let deliverManualEvent: ((event: Parameters<Parameters<typeof installManualCaptureObservers>[0]['onEvent']>[0]) => Promise<void>) | undefined;
  let releaseAppend!: () => void;
  const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
  const events: string[] = [];
  const controller = await installManualCaptureObservers({
    context: {} as never,
    tabsPath: 'tabs.json',
    onEvent: async (event) => {
      await appendGate;
      events.push(event.type);
    },
    installers: {
      manual: async (_context, callback) => {
        deliverManualEvent = async (event) => callback({} as never, event as never);
      },
      cursor: async () => {},
      tabs: async () => ({
        tabIdForPage: () => 'tab-1',
        flush: async () => {},
        snapshot: () => ({ version: 1, tabs: [] }),
      }),
    },
  });
  const pending = deliverManualEvent!({
    type: 'pointer-click', tabId: 'tab-1', url: '', frameUrl: '', isMainFrame: true,
  } as never);
  let flushed = false;
  const flush = controller.flush().then(() => { flushed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flushed, false);
  releaseAppend();
  await Promise.all([pending, flush]);
  assert.deepEqual(events, ['pointer-click']);
  await deliverManualEvent!({
    type: 'input', tabId: 'tab-1', url: '', frameUrl: '', isMainFrame: true,
  } as never);
  assert.deepEqual(events, ['pointer-click']);
});

test('maps the events POC to the requested singular fixture filename', () => {
  assert.equal(manualPocFixtureFileName('events'), 'event-fixture.html');
  assert.equal(manualPocFixtureFileName('capture'), 'capture-fixture.html');
});

test('timestamps observer events and degrades append failures to one observer-error', async () => {
  const values = [0n, 2_000_000n, 4_000_000n, 6_000_000n];
  const clock = createRecordingClock(() => values.shift() ?? 6_000_000n);
  clock.markFirstVideoFrame();
  const written: Array<{ type: string; sessionTimeMs: number; videoTimeMs: number | null; payload?: Record<string, unknown> }> = [];
  let failed = false;
  const sink = createTimestampedObserverEventSink({
    clock,
    append: async (event) => {
      if (!failed && event.type === 'pointer-click') {
        failed = true;
        throw new Error('disk full');
      }
      written.push(event);
    },
  });
  await sink.onEvent({ type: 'pointer-click', tabId: 'tab-1', url: 'file:///fixture.html', frameUrl: 'file:///fixture.html', isMainFrame: true });
  assert.equal(sink.eventCaptureComplete, false);
  assert.equal(written.length, 1);
  assert.equal(written[0].type, 'observer-error');
  assert.match(String(written[0].payload?.message), /disk full/);
  assert.equal(typeof written[0].videoTimeMs, 'number');
});
