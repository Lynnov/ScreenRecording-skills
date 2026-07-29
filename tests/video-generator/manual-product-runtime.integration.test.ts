import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createManualProductRuntime,
  createManualRuntimeCleanup,
} from '../../src/lib/video-generator/manual/product-runtime.js';

function createHarness(input: {
  mode?: 'recording' | 'pickup';
  sourceReady?: boolean;
  sourceId?: string;
} = {}) {
  let nowMs = 1_000;
  let sourceReady = input.sourceReady ?? true;
  const calls: string[] = [];
  const runtime = createManualProductRuntime({
    mode: input.mode ?? 'recording',
    segmentId: 'segment-001',
    actionIds: ['action-001', 'action-002'],
    sourceId: input.sourceId ?? 'original',
    sourceReady: () => sourceReady,
    nowMs: () => nowMs,
    wait: async (durationMs) => {
      calls.push(`wait:${durationMs}`);
      nowMs += durationMs;
    },
    capture: {
      async start() {
        calls.push('capture:start');
      },
      async stop() {
        calls.push('capture:stop');
      },
    },
    emit: async (event) => {
      calls.push(`event:${event.type}`);
    },
  });
  return {
    runtime,
    calls,
    advance(ms: number) {
      nowMs += ms;
    },
    setSourceReady(value: boolean) {
      sourceReady = value;
    },
  };
}

test('F7 fails closed until the capture source is ready', async () => {
  const harness = createHarness({ sourceReady: false });

  const blocked = await harness.runtime.dispatch({ type: 'begin-countdown' });
  assert.equal(blocked.status, 'preparing');
  assert.deepEqual(harness.calls, []);

  harness.setSourceReady(true);
  await harness.runtime.dispatch({ type: 'begin-countdown' });
  assert.deepEqual(harness.calls, ['wait:3000', 'capture:start', 'event:recording-start']);
});

test('record F7 uses the command path and starts capture after the three-second countdown', async () => {
  const harness = createHarness();
  const started = harness.runtime.waitForStart();

  const snapshot = await harness.runtime.dispatch({ type: 'begin-countdown' });

  await started;
  assert.equal(snapshot.status, 'recording');
  assert.deepEqual(harness.calls, ['wait:3000', 'capture:start', 'event:recording-start']);
});

test('pickup F7 starts immediately and writes pickup-start without changing pickup source', async () => {
  const harness = createHarness({ mode: 'pickup', sourceId: 'pickup-003' });

  const snapshot = await harness.runtime.dispatch({ type: 'begin-countdown' });
  await harness.runtime.dispatch({ type: 'discard-attempt' });

  assert.equal(snapshot.status, 'pickup-recording');
  assert.deepEqual(harness.calls.slice(0, 2), ['capture:start', 'event:pickup-start']);
  assert.equal(harness.runtime.attempts()[0]?.sourceId, 'pickup-003');
  assert.equal(harness.runtime.attempts()[1]?.sourceId, 'pickup-003');
});

test('F8 confirms the current attempt, F9 retries the same action, and Shift+F8 only moves the action pointer', async () => {
  const harness = createHarness();
  await harness.runtime.dispatch({ type: 'begin-countdown' });

  const confirmed = await harness.runtime.dispatch({ type: 'confirm-action' });
  assert.equal(confirmed.actionId, 'action-002');
  assert.equal(harness.runtime.attempts()[0]?.status, 'confirmed');
  assert.equal(harness.runtime.attempts()[0]?.confirmedAtMs, 4_000);

  const retried = await harness.runtime.dispatch({ type: 'discard-attempt' });
  assert.equal(retried.actionId, 'action-002');
  assert.equal(retried.attempt, 2);
  assert.equal(harness.runtime.attempts().at(-2)?.status, 'discarded');
  assert.equal(harness.runtime.attempts().at(-1)?.status, 'recording');

  const previous = await harness.runtime.dispatch({ type: 'previous-action' });
  assert.equal(previous.actionId, 'action-001');
  assert.equal(previous.attempt, 2);
  assert.equal(harness.runtime.attempts().at(-2)?.status, 'discarded');
  assert.equal(harness.runtime.attempts().at(-1)?.actionId, 'action-001');
});

test('F10 requires a second press within five seconds before stopping capture', async () => {
  const harness = createHarness();
  await harness.runtime.dispatch({ type: 'begin-countdown' });
  let stopped = false;
  void harness.runtime.waitForStop().then(() => {
    stopped = true;
  });

  const first = await harness.runtime.dispatch({ type: 'finish' });
  assert.equal(first.status, 'recording');
  assert.match(first.nextStep, /F10/);
  assert.equal(stopped, false);
  assert.equal(harness.calls.includes('capture:stop'), false);

  harness.advance(5_001);
  await harness.runtime.dispatch({ type: 'finish' });
  assert.equal(harness.calls.includes('capture:stop'), false);

  const stoppedSnapshot = await harness.runtime.dispatch({ type: 'finish' });
  await harness.runtime.waitForStop();
  assert.equal(stoppedSnapshot.status, 'finishing');
  assert.equal(harness.calls.filter((call) => call === 'capture:stop').length, 1);
});

test('cleanup is ordered, idempotent, continues after failures, and preserves the first error', async () => {
  const calls: string[] = [];
  const step = (name: string, error?: Error) => async () => {
    calls.push(name);
    if (error !== undefined) throw error;
  };
  const firstError = new Error('flush capture failed');
  const cleanup = createManualRuntimeCleanup({
    stopRecorder: step('stop-recorder'),
    flushCapture: step('flush-capture', firstError),
    flushObserversAndEvents: step('flush-observers'),
    restoreWindow: step('restore-window'),
    unregisterBoundaries: step('unregister-boundaries', new Error('unregister failed')),
    closeWindows: step('close-windows'),
  });

  const first = cleanup();
  const second = cleanup();
  assert.equal(first, second);
  await assert.rejects(first, firstError);
  assert.deepEqual(calls, [
    'stop-recorder',
    'flush-capture',
    'flush-observers',
    'restore-window',
    'unregister-boundaries',
    'close-windows',
  ]);
});

test('confirming the final action clears the active attempt and repeated F8/F9 cannot discard it', async () => {
  const harness = createHarness();
  await harness.runtime.dispatch({ type: 'begin-countdown' });
  await harness.runtime.dispatch({ type: 'confirm-action' });
  const final = await harness.runtime.dispatch({ type: 'confirm-action' });

  assert.equal(final.actionId, 'action-002');
  assert.equal(final.attempt, 1);
  assert.deepEqual(
    harness.runtime.attempts().map(({ actionId, attempt, status }) => ({ actionId, attempt, status })),
    [
      { actionId: 'action-001', attempt: 1, status: 'confirmed' },
      { actionId: 'action-002', attempt: 1, status: 'confirmed' },
    ],
  );

  await harness.runtime.dispatch({ type: 'confirm-action' });
  await harness.runtime.dispatch({ type: 'discard-attempt' });
  assert.equal(harness.runtime.attempts().length, 2);
  assert.equal(harness.runtime.attempts()[1]?.status, 'confirmed');
});

test('Shift+F8 terminals the current attempt and opens an aligned attempt for the previous action', async () => {
  const harness = createHarness({ sourceId: 'pickup-004' });
  await harness.runtime.dispatch({ type: 'begin-countdown' });
  await harness.runtime.dispatch({ type: 'confirm-action' });

  const previous = await harness.runtime.dispatch({ type: 'previous-action' });

  assert.equal(previous.actionId, 'action-001');
  assert.equal(previous.attempt, 2);
  assert.deepEqual(
    harness.runtime.attempts().map(({ actionId, sourceId, attempt, status }) => ({
      actionId,
      sourceId,
      attempt,
      status,
    })),
    [
      { actionId: 'action-001', sourceId: 'pickup-004', attempt: 1, status: 'confirmed' },
      { actionId: 'action-002', sourceId: 'pickup-004', attempt: 1, status: 'discarded' },
      { actionId: 'action-001', sourceId: 'pickup-004', attempt: 2, status: 'recording' },
    ],
  );
  assert.deepEqual(harness.calls.slice(-2), ['event:attempt-discarded', 'event:action-previous']);
});

test('confirmed F10 terminals an unconfirmed active attempt before capture stop', async () => {
  const harness = createHarness();
  await harness.runtime.dispatch({ type: 'begin-countdown' });

  await harness.runtime.dispatch({ type: 'finish' });
  assert.equal(harness.runtime.attempts()[0]?.status, 'recording');
  await harness.runtime.dispatch({ type: 'finish' });

  assert.equal(harness.runtime.attempts()[0]?.status, 'discarded');
  assert.equal(harness.runtime.attempts().some((attempt) => attempt.status === 'recording'), false);
  assert.deepEqual(harness.calls.slice(-2), ['event:attempt-discarded', 'capture:stop']);
});

test('capture start failure rejects both dispatch and waitForStart exactly once', async () => {
  const failure = new Error('capture start failed');
  const runtime = createManualProductRuntime({
    mode: 'recording',
    segmentId: 'segment-001',
    actionIds: ['action-001'],
    sourceId: 'original',
    sourceReady: () => true,
    wait: async () => undefined,
    capture: {
      start: async () => { throw failure; },
      stop: async () => undefined,
    },
  });
  const started = runtime.waitForStart();

  await assert.rejects(runtime.dispatch({ type: 'begin-countdown' }), failure);
  await assert.rejects(started, failure);
  await assert.rejects(runtime.waitForStart(), failure);
  assert.equal(runtime.snapshot().status, 'preparing');
});

test('capture stop failure rejects both dispatch and waitForStop after attempts are terminal', async () => {
  const failure = new Error('capture stop failed');
  const runtime = createManualProductRuntime({
    mode: 'recording',
    segmentId: 'segment-001',
    actionIds: ['action-001'],
    sourceId: 'original',
    sourceReady: () => true,
    wait: async () => undefined,
    capture: {
      start: async () => undefined,
      stop: async () => { throw failure; },
    },
  });
  await runtime.dispatch({ type: 'begin-countdown' });
  await runtime.dispatch({ type: 'finish' });
  const stopped = runtime.waitForStop();

  await assert.rejects(runtime.dispatch({ type: 'finish' }), failure);
  await assert.rejects(stopped, failure);
  await assert.rejects(runtime.waitForStop(), failure);
  assert.equal(runtime.snapshot().status, 'finishing');
  assert.equal(runtime.attempts()[0]?.status, 'discarded');
});

test('record runtime assigns each real attempt to its guide Segment', async () => {
  const runtime = createManualProductRuntime({
    mode: 'recording',
    segmentId: 'segment-001',
    actionIds: ['action-001', 'action-002'],
    segmentIdForAction: (actionId) => actionId === 'action-002' ? 'segment-002' : 'segment-001',
    sourceId: 'original',
    sourceReady: () => true,
    wait: async () => undefined,
    capture: {
      start: async () => undefined,
      stop: async () => undefined,
    },
  });
  await runtime.dispatch({ type: 'begin-countdown' });
  await runtime.dispatch({ type: 'confirm-action' });
  await runtime.dispatch({ type: 'confirm-action' });

  assert.deepEqual(runtime.attempts().map(({ actionId, segmentId }) => ({ actionId, segmentId })), [
    { actionId: 'action-001', segmentId: 'segment-001' },
    { actionId: 'action-002', segmentId: 'segment-002' },
  ]);
});

test('F11 display mode is an operator hint and never a simulated command', () => {
  const runtime = createManualProductRuntime({
    mode: 'recording',
    segmentId: 'segment-001',
    actionIds: ['action-001'],
    sourceId: 'original',
    preparationHint: '请先在 Chromium 中手动按 F11，再按 F7 开始录制。',
    sourceReady: () => true,
    capture: {
      start: async () => undefined,
      stop: async () => undefined,
    },
  });

  assert.match(runtime.snapshot().nextStep, /手动按 F11/);
});
