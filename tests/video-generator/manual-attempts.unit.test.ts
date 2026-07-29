import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createAttemptLedger,
  finalizeAttempt,
  markAttemptDiscarded,
  openAttempt,
} from '../../src/lib/video-generator/manual/attempts.js';

test('attempt ledger increments pickup and action attempts separately with segment and source identity', () => {
  const ledger = createAttemptLedger();
  const first = openAttempt(ledger, { actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original' });
  const second = openAttempt(ledger, { actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original' });
  const pickup = openAttempt(ledger, { actionId: 'action-010', segmentId: 'segment-010', sourceId: 'pickup-003' });

  assert.equal(first.attempt, 1);
  assert.equal(second.attempt, 2);
  assert.equal(pickup.attempt, 1);
  assert.equal(first.segmentId, 'segment-001');
  assert.equal(first.sourceId, 'original');
});

test('finalizeAttempt stamps confirmation time and preserves immutable history', () => {
  const ledger = createAttemptLedger({ nowMs: () => 5000 });
  const attempt = openAttempt(ledger, { actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original' });
  const confirmed = finalizeAttempt(ledger, attempt);

  assert.equal(confirmed.confirmedAtMs, 5000);
  assert.equal(ledger.history.length, 1);
  assert.equal(ledger.history[0]!.status, 'confirmed');
});

test('markAttemptDiscarded closes only the current attempt and leaves previous history intact', () => {
  const ledger = createAttemptLedger();
  const attempt = openAttempt(ledger, { actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original' });
  const discarded = markAttemptDiscarded(ledger, attempt);

  assert.equal(discarded.status, 'discarded');
  assert.equal(ledger.history[0]!.status, 'discarded');
  const next = openAttempt(ledger, { actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original' });
  assert.equal(next.attempt, 2);
});
