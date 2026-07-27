import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecordingClock } from '../../src/lib/video-generator/recording/clock.js';

test('keeps session time monotonic and maps video time from first frame', () => {
  let nowNs = 1_000_000_000n;
  const clock = createRecordingClock(() => nowNs);
  assert.deepEqual(clock.stamp(), { sessionTimeMs: 0, videoTimeMs: null });

  nowNs += 250_000_000n;
  assert.deepEqual(clock.markFirstVideoFrame(), { sessionTimeMs: 250, videoTimeMs: 0 });

  nowNs += 1_250_000_000n;
  assert.deepEqual(clock.stamp(), { sessionTimeMs: 1500, videoTimeMs: 1250 });
});

test('does not reset session or video time when formal recording markers are stamped', () => {
  let nowNs = 0n;
  const clock = createRecordingClock(() => nowNs);

  nowNs = 500_000_000n;
  clock.markFirstVideoFrame();

  nowNs = 2_000_000_000n;
  const f7 = clock.stamp();
  assert.deepEqual(f7, { sessionTimeMs: 2000, videoTimeMs: 1500 });

  nowNs = 3_000_000_000n;
  assert.deepEqual(clock.markFirstVideoFrame(), { sessionTimeMs: 3000, videoTimeMs: 2500 });
  assert.equal(clock.firstVideoFrameSessionTimeMs(), 500);
});

test('rejects a clock source that moves backwards', () => {
  let nowNs = 1_000_000_000n;
  const clock = createRecordingClock(() => nowNs);
  assert.deepEqual(clock.stamp(), { sessionTimeMs: 0, videoTimeMs: null });

  nowNs = 900_000_000n;
  assert.throws(() => clock.stamp(), /moved backwards/i);
});

test('manual marker controller requires a second F10 before stopping', async () => {
  const { createManualMarkerController } = await import('../../pocs/manual-recording/capture-main.js');
  let nowNs = 0n;
  const clock = createRecordingClock(() => nowNs);
  let stopRequests = 0;
  const controller = createManualMarkerController(clock, () => {
    stopRequests += 1;
  }, () => undefined);

  nowNs = 100_000_000n;
  assert.equal(controller.recordUserMarker('recording-start').type, 'recording-start');

  nowNs = 200_000_000n;
  assert.equal(controller.recordUserMarker('retry-start').type, 'retry-start');

  nowNs = 300_000_000n;
  controller.requestStopConfirmation();
  assert.equal(stopRequests, 0);
  assert.equal(controller.events().at(-1)?.type, 'recording-stop-requested');

  nowNs = 400_000_000n;
  controller.requestStopConfirmation();
  assert.equal(stopRequests, 1);
  assert.equal(controller.events().at(-1)?.type, 'recording-stop');
});

test('shows a clock marker before stamping its formal recording event', async () => {
  const { createManualMarkerController, recordClockFixtureMarker } =
    await import('../../pocs/manual-recording/capture-main.js');
  const order: string[] = [];
  let nowNs = 0n;
  const clock = createRecordingClock(() => nowNs);
  clock.markFirstVideoFrame();
  const controller = createManualMarkerController(clock, () => {}, () => {}, async () => {
    order.push('event');
  });
  nowNs = 1_000_000n;
  const page = {
    async evaluate(_callback: unknown, request: { name: string; requestedVideoTimeMs: number | null }) {
      order.push(`visible:${request.name}:${request.requestedVideoTimeMs}`);
      nowNs = 3_000_000n;
      return 123;
    },
  };

  nowNs = 2_000_000n;
  const event = await recordClockFixtureMarker(page, controller, 'retry-start');

  assert.deepEqual(order, ['visible:retry-start:2', 'event']);
  assert.equal(event.type, 'retry-start');
  assert.equal(event.videoTimeMs, 3);
});

test('drains the final clock marker frame before stopping the recorder', async () => {
  const { finalizeClockStopMarker } =
    await import('../../pocs/manual-recording/capture-main.js');
  const order: string[] = [];

  await finalizeClockStopMarker(
    async () => {
      order.push('marker');
    },
    async () => {
      order.push('drain');
    },
    () => {
      order.push('stop');
    },
  );

  assert.deepEqual(order, ['marker', 'drain', 'stop']);
});
