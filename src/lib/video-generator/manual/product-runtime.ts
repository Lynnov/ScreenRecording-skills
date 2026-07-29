import { mapShortcutToManualCommand } from './action-tracker.js';
import {
  createAttemptLedger,
  finalizeAttempt,
  markAttemptDiscarded,
  openAttempt,
  type AttemptLedger,
} from './attempts.js';
import {
  createManualOverlayState,
  isManualOverlayCapturing,
  manualOverlayReducer,
  type ManualOverlayCommand,
  type ManualOverlayEvent,
  type ManualOverlayMode,
  type ManualOverlayState,
} from './state-machine.js';
import type { RecordingAttempt } from '../recording/types.js';
import type { ManualOverlaySnapshot } from '../recording-overlay/ipc.js';

export interface ManualRuntimeSignals {
  waitForStart(): Promise<void>;
  waitForStop(): Promise<void>;
  dispatch(command: ManualOverlayCommand): Promise<ManualOverlaySnapshot>;
}

export interface ManualProductRuntime extends ManualRuntimeSignals {
  snapshot(): ManualOverlaySnapshot;
  attempts(): RecordingAttempt[];
}

export interface ManualProductRuntimeInput {
  mode: ManualOverlayMode;
  segmentId: string;
  actionIds: string[];
  segmentIdForAction?(actionId: string): string;
  sourceId: string;
  preparationHint?: string;
  sourceReady(): boolean;
  capture: {
    start(): Promise<void>;
    stop(): Promise<unknown>;
  };
  wait?(durationMs: number): Promise<void>;
  nowMs?(): number;
  emit?(event: ManualOverlayEvent): Promise<void>;
}

export interface ManualCommandDispatcher<T> {
  fromOverlay(command: ManualOverlayCommand): Promise<T>;
  fromShortcut(shortcut: string): Promise<T | undefined>;
}

export interface ManualRuntimeCleanupSteps {
  stopRecorder(): void | Promise<void>;
  flushCapture(): void | Promise<void>;
  flushObserversAndEvents(): void | Promise<void>;
  restoreWindow(): void | Promise<void>;
  unregisterBoundaries(): void | Promise<void>;
  closeWindows(): void | Promise<void>;
}

export function createManualRuntimeCleanup(
  steps: ManualRuntimeCleanupSteps,
): () => Promise<void> {
  let cleanupPromise: Promise<void> | null = null;
  return () => {
    cleanupPromise ??= (async () => {
      let firstError: unknown;
      for (const operation of [
        steps.stopRecorder,
        steps.flushCapture,
        steps.flushObserversAndEvents,
        steps.restoreWindow,
        steps.unregisterBoundaries,
        steps.closeWindows,
      ]) {
        try {
          await operation();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) throw firstError;
    })();
    return cleanupPromise;
  };
}

export function createManualCommandDispatcher<T>(
  dispatch: (command: ManualOverlayCommand) => Promise<T>,
): ManualCommandDispatcher<T> {
  return {
    fromOverlay: dispatch,
    async fromShortcut(shortcut) {
      const command = mapShortcutToManualCommand(shortcut);
      return command === null ? undefined : dispatch(command);
    },
  };
}

export function createManualProductRuntime(input: ManualProductRuntimeInput): ManualProductRuntime {
  if (input.actionIds.length === 0) throw new Error('Manual product runtime requires at least one action.');
  const nowMs = input.nowMs ?? Date.now;
  const wait = input.wait ?? ((durationMs) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const emit = input.emit ?? (async () => undefined);
  const ledger: AttemptLedger = createAttemptLedger({ nowMs });
  let recordingStartedAtMs: number | null = null;
  let state = createManualOverlayState({
    mode: input.mode,
    segmentId: input.segmentId,
    actionId: input.actionIds[0]!,
    actionIds: input.actionIds,
    attempt: 1,
  });
  let activeAttempt: RecordingAttempt | null = null;
  let finishRequestedAtMs: number | null = null;
  let dispatchChain = Promise.resolve();
  let resolveStarted!: () => void;
  let rejectStarted!: (error: Error) => void;
  let resolveStopped!: () => void;
  let rejectStopped!: (error: Error) => void;
  let startSettled = false;
  let stopSettled = false;
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  void started.catch(() => undefined);
  void stopped.catch(() => undefined);

  const currentSnapshot = (): ManualOverlaySnapshot => ({
    status: state.status,
    sourceReady: input.sourceReady(),
    elapsedMs: recordingStartedAtMs === null ? 0 : Math.max(0, nowMs() - recordingStartedAtMs),
    segmentId: state.segmentId,
    actionId: state.actionId,
    attempt: activeAttempt?.attempt ?? state.attempt,
    nextStep: finishRequestedAtMs === null
      ? (state.status === 'preparing' && input.preparationHint !== undefined
          ? input.preparationHint
          : defaultNextStep(state))
      : '5 秒内再次按 F10 确认结束录制',
    confidence: null,
    observerWarning: null,
    newTabNotice: null,
  });

  const runCommand = async (command: ManualOverlayCommand): Promise<ManualOverlaySnapshot> => {
    if (command.type === 'begin-countdown') {
      if (!input.sourceReady() || (state.status !== 'preparing' && state.status !== 'pickup-preparing')) {
        return currentSnapshot();
      }
      const preparingState = state;
      try {
        if (state.mode === 'recording') {
          state = manualOverlayReducer(state, command);
          await wait(3_000);
          await input.capture.start();
          recordingStartedAtMs = nowMs();
          state = { ...state, status: 'recording', countdownMs: null };
          await emit({ type: 'recording-start' });
        } else {
          await input.capture.start();
          recordingStartedAtMs = nowMs();
          state = manualOverlayReducer(state, { type: 'start-pickup' });
          await emit({ type: 'pickup-start' });
        }
      } catch (error) {
        state = preparingState;
        settleStartFailure(toError(error));
        throw error;
      }
      activeAttempt = openCurrentAttempt(ledger, state, input.sourceId, input.segmentIdForAction);
      state = { ...state, attempt: activeAttempt.attempt };
      settleStartSuccess();
      return currentSnapshot();
    }

    if (command.type === 'confirm-action') {
      if (!isManualOverlayCapturing(state) || activeAttempt === null) return currentSnapshot();
      const wasFinalAction = state.actionIndex >= state.actionIds.length - 1;
      finalizeAttempt(ledger, activeAttempt);
      await emit({ type: 'action-confirmed' });
      state = manualOverlayReducer(state, command);
      if (wasFinalAction) {
        activeAttempt = null;
      } else {
        activeAttempt = openCurrentAttempt(ledger, state, input.sourceId, input.segmentIdForAction);
        state = { ...state, attempt: activeAttempt.attempt };
      }
      return currentSnapshot();
    }

    if (command.type === 'previous-action') {
      if (!isManualOverlayCapturing(state) || state.actionIndex === 0) return currentSnapshot();
      if (activeAttempt !== null) {
        markAttemptDiscarded(ledger, activeAttempt);
        await emit({ type: 'attempt-discarded' });
      }
      state = manualOverlayReducer(state, command);
      await emit({ type: 'action-previous' });
      activeAttempt = openCurrentAttempt(ledger, state, input.sourceId, input.segmentIdForAction);
      state = { ...state, attempt: activeAttempt.attempt };
      return currentSnapshot();
    }

    if (command.type === 'discard-attempt') {
      if (!isManualOverlayCapturing(state) || activeAttempt === null) return currentSnapshot();
      markAttemptDiscarded(ledger, activeAttempt);
      await emit({ type: 'attempt-discarded' });
      activeAttempt = openCurrentAttempt(ledger, {
        ...state,
        actionId: activeAttempt.actionId,
      }, input.sourceId, input.segmentIdForAction);
      state = { ...state, attempt: activeAttempt.attempt };
      return currentSnapshot();
    }

    if (command.type === 'finish') {
      if (!isManualOverlayCapturing(state)) return currentSnapshot();
      const now = nowMs();
      if (finishRequestedAtMs === null || now - finishRequestedAtMs > 5_000) {
        finishRequestedAtMs = now;
        await emit({ type: 'finish-requested' });
        return currentSnapshot();
      }
      finishRequestedAtMs = null;
      state = manualOverlayReducer(state, command);
      if (activeAttempt !== null) {
        markAttemptDiscarded(ledger, activeAttempt);
        activeAttempt = null;
        await emit({ type: 'attempt-discarded' });
      }
      try {
        await input.capture.stop();
        settleStopSuccess();
      } catch (error) {
        settleStopFailure(toError(error));
        throw error;
      }
      return currentSnapshot();
    }

    state = manualOverlayReducer(state, command);
    return currentSnapshot();
  };

  return {
    waitForStart: () => started,
    waitForStop: () => stopped,
    dispatch(command) {
      const result = dispatchChain.then(() => runCommand(command));
      dispatchChain = result.then(() => undefined, () => undefined);
      return result;
    },
    snapshot: currentSnapshot,
    attempts: () => ledger.history.map((attempt) => ({ ...attempt })),
  };

  function settleStartSuccess() {
    if (startSettled) return;
    startSettled = true;
    resolveStarted();
  }

  function settleStartFailure(error: Error) {
    if (startSettled) return;
    startSettled = true;
    rejectStarted(error);
  }

  function settleStopSuccess() {
    if (stopSettled) return;
    stopSettled = true;
    resolveStopped();
  }

  function settleStopFailure(error: Error) {
    if (stopSettled) return;
    stopSettled = true;
    rejectStopped(error);
  }
}

function openCurrentAttempt(
  ledger: AttemptLedger,
  state: Pick<ManualOverlayState, 'actionId' | 'segmentId'>,
  sourceId: string,
  segmentIdForAction?: (actionId: string) => string,
): RecordingAttempt {
  return openAttempt(ledger, {
    actionId: state.actionId,
    segmentId: segmentIdForAction?.(state.actionId) ?? state.segmentId,
    sourceId,
  });
}

function defaultNextStep(state: ManualOverlayState): string {
  if (state.status === 'preparing') return '按 F7 开始 3 秒倒计时';
  if (state.status === 'pickup-preparing') return '按 F7 开始当前 Segment 补录';
  if (isManualOverlayCapturing(state)) return '按 F8 确认当前 Action';
  return '';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
