import type { ManualOverlayCommand } from './state-machine.js';
import type { ExpectedEvent, RecordingGuide, RecordingGuideAction } from './types.js';
import { evaluateExpectedResults, type ManualResultSnapshot } from './result-evaluator.js';

export interface TrackerObservedEvent {
  type: string;
  targetText?: string;
  url?: string;
  tabId?: string;
}

export interface ActionConfirmedEvent {
  type: 'action-confirmed';
  actionId: string;
  segmentId: string;
  sourceId: string;
  attempt: number;
  confirmedAtMs: number;
  method: 'manual' | 'auto';
}

export interface CreateActionTrackerOptions {
  sourceId: string;
  nowMs: () => number;
  onActionConfirmed?: (event: ActionConfirmedEvent) => void;
}

export interface ActionTracker {
  currentAction(): RecordingGuideAction;
  observeEvent(event: TrackerObservedEvent, snapshot: ManualResultSnapshot): { status: 'waiting-for-result' | 'confirmed' | 'manual-confirmation-required' };
  confirmAction(method: 'manual' | 'auto'): ActionConfirmedEvent;
  previousAction(): RecordingGuideAction;
  confirmedEvents(): ActionConfirmedEvent[];
  isComplete(): boolean;
}

export function createActionTracker(guide: RecordingGuide, options: CreateActionTrackerOptions): ActionTracker {
  if (guide.actions.length === 0) throw new Error('Recording guide must contain actions.');
  let index = 0;
  const confirmed: ActionConfirmedEvent[] = [];

  const currentAction = (): RecordingGuideAction => guide.actions[Math.min(index, guide.actions.length - 1)]!;

  const emitConfirmation = (method: 'manual' | 'auto'): ActionConfirmedEvent => {
    const action = currentAction();
    const event: ActionConfirmedEvent = {
      type: 'action-confirmed',
      actionId: action.id,
      segmentId: action.segmentId,
      sourceId: options.sourceId,
      attempt: 1,
      confirmedAtMs: options.nowMs(),
      method,
    };
    confirmed.push(event);
    options.onActionConfirmed?.(event);
    index = Math.min(index + 1, guide.actions.length);
    return event;
  };

  return {
    currentAction,
    observeEvent(event, snapshot) {
      if (index >= guide.actions.length) return { status: 'manual-confirmation-required' };
      const action = currentAction();
      const eventMatched = action.expectedEvents.some((expected) => matchesExpectedEvent(expected, event));
      if (!eventMatched) return { status: 'manual-confirmation-required' };
      const resultMatched = action.expectedResults.length === 0
        ? false
        : evaluateExpectedResults(action.expectedResults, snapshot).matched;
      if (!resultMatched) return { status: 'waiting-for-result' };
      emitConfirmation('auto');
      return { status: 'confirmed' };
    },
    confirmAction(method) {
      return emitConfirmation(method);
    },
    previousAction() {
      index = Math.max(0, index - 1);
      return currentAction();
    },
    confirmedEvents() {
      return [...confirmed];
    },
    isComplete() {
      return index >= guide.actions.length;
    },
  };
}

function matchesExpectedEvent(expected: ExpectedEvent, event: TrackerObservedEvent): boolean {
  const normalizedType = event.type === 'pointer-click' ? 'click' : event.type;
  if (expected.type !== normalizedType) return false;
  if (expected.target === undefined) return true;
  return (event.targetText ?? '').includes(expected.target);
}

export function mapShortcutToManualCommand(shortcut: string): ManualOverlayCommand | null {
  switch (shortcut) {
    case 'F7':
      return { type: 'begin-countdown' };
    case 'F8':
      return { type: 'confirm-action' };
    case 'Shift+F8':
      return { type: 'previous-action' };
    case 'F9':
      return { type: 'discard-attempt' };
    case 'F10':
      return { type: 'finish' };
    default:
      return null;
  }
}
