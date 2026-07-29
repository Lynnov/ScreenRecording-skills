import type { RecordingAttempt } from '../recording/types.js';

export interface AttemptLedger {
  history: RecordingAttempt[];
  nowMs(): number;
}

export interface OpenAttemptInput {
  actionId: string;
  segmentId: string;
  sourceId: string;
}

export function createAttemptLedger(input: { nowMs?: () => number } = {}): AttemptLedger {
  return {
    history: [],
    nowMs: input.nowMs ?? (() => Date.now()),
  };
}

export function openAttempt(ledger: AttemptLedger, input: OpenAttemptInput): RecordingAttempt {
  const attemptNumber = ledger.history
    .filter((attempt) => attempt.actionId === input.actionId && attempt.segmentId === input.segmentId && attempt.sourceId === input.sourceId)
    .reduce((max, attempt) => Math.max(max, attempt.attempt), 0) + 1;
  const attempt: RecordingAttempt = {
    actionId: input.actionId,
    segmentId: input.segmentId,
    sourceId: input.sourceId,
    attempt: attemptNumber,
    startMs: ledger.nowMs(),
    endMs: null,
    confirmedAtMs: null,
    status: 'recording',
  };
  ledger.history.push(attempt);
  return attempt;
}

export function finalizeAttempt(ledger: AttemptLedger, attempt: RecordingAttempt): RecordingAttempt {
  const now = ledger.nowMs();
  return replaceAttempt(ledger, attempt, {
    ...attempt,
    endMs: now,
    confirmedAtMs: now,
    status: 'confirmed',
  });
}

export function markAttemptDiscarded(ledger: AttemptLedger, attempt: RecordingAttempt): RecordingAttempt {
  return replaceAttempt(ledger, attempt, {
    ...attempt,
    endMs: ledger.nowMs(),
    confirmedAtMs: null,
    status: 'discarded',
  });
}

function replaceAttempt(ledger: AttemptLedger, original: RecordingAttempt, replacement: RecordingAttempt): RecordingAttempt {
  const index = ledger.history.findIndex((attempt) => attempt === original
    || (attempt.actionId === original.actionId
      && attempt.segmentId === original.segmentId
      && attempt.sourceId === original.sourceId
      && attempt.attempt === original.attempt));
  if (index === -1) {
    ledger.history.push(replacement);
  } else {
    ledger.history[index] = replacement;
  }
  return replacement;
}
