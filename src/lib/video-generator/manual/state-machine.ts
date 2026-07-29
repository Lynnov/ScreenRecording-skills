export type ManualOverlayStatus =
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'finishing'
  | 'analyzing'
  | 'pickup-preparing'
  | 'pickup-recording'
  | 'pickup-finishing'
  | 'segment-analyzing'
  | 'review-ready';

export type ManualOverlayMode = 'recording' | 'pickup';

export const PICKUP_LIFECYCLE_STATUSES = [
  'pickup-preparing',
  'pickup-recording',
  'pickup-finishing',
  'segment-analyzing',
  'review-ready',
] as const satisfies readonly ManualOverlayStatus[];

export interface ManualOverlayState {
  mode: ManualOverlayMode;
  status: ManualOverlayStatus;
  segmentId: string;
  actionId: string;
  actionIds: string[];
  actionIndex: number;
  attempt: number;
  countdownMs: number | null;
}

export type ManualOverlayCommand =
  | { type: 'begin-countdown' }
  | { type: 'start-pickup' }
  | { type: 'confirm-action' }
  | { type: 'previous-action' }
  | { type: 'discard-attempt' }
  | { type: 'finish' }
  | { type: 'analyze' }
  | { type: 'review-ready' };

export interface CreateManualOverlayStateInput {
  mode: ManualOverlayMode;
  segmentId: string;
  actionId: string;
  actionIds?: string[];
  attempt: number;
}

export interface ManualOverlayEvent {
  type: 'recording-start' | 'pickup-start' | 'action-confirmed' | 'action-previous' | 'attempt-discarded' | 'finish-requested';
}

export interface BeginCountdownDeps {
  wait(durationMs: number): Promise<void>;
  emit(event: ManualOverlayEvent): Promise<void>;
}

export function createManualOverlayState(input: CreateManualOverlayStateInput): ManualOverlayState {
  const actionIds = input.actionIds === undefined || input.actionIds.length === 0
    ? [input.actionId]
    : [...input.actionIds];
  const actionIndex = Math.max(0, actionIds.indexOf(input.actionId));
  return {
    mode: input.mode,
    status: input.mode === 'recording' ? 'preparing' : 'pickup-preparing',
    segmentId: input.segmentId,
    actionId: actionIds[actionIndex]!,
    actionIds,
    actionIndex,
    attempt: input.attempt,
    countdownMs: null,
  };
}

export function manualOverlayReducer(state: ManualOverlayState, command: ManualOverlayCommand): ManualOverlayState {
  switch (command.type) {
    case 'begin-countdown':
      if (state.status !== 'preparing') return state;
      return { ...state, status: 'countdown', countdownMs: 3000 };
    case 'start-pickup':
      if (state.mode !== 'pickup' || state.status !== 'pickup-preparing') return state;
      return { ...state, status: 'pickup-recording' };
    case 'confirm-action':
      if (state.actionIndex >= state.actionIds.length - 1) return state;
      return {
        ...state,
        actionIndex: state.actionIndex + 1,
        actionId: state.actionIds[state.actionIndex + 1]!,
      };
    case 'previous-action':
      if (state.actionIndex === 0) return state;
      return {
        ...state,
        actionIndex: state.actionIndex - 1,
        actionId: state.actionIds[state.actionIndex - 1]!,
      };
    case 'discard-attempt':
      return { ...state, attempt: state.attempt + 1 };
    case 'finish':
      if (state.status === 'recording') return { ...state, status: 'finishing' };
      if (state.status === 'pickup-recording') return { ...state, status: 'pickup-finishing' };
      return state;
    case 'analyze':
      if (state.status === 'finishing') return { ...state, status: 'analyzing' };
      if (state.status === 'pickup-finishing') return { ...state, status: 'segment-analyzing' };
      return state;
    case 'review-ready':
      if (state.status === 'analyzing' || state.status === 'segment-analyzing') {
        return { ...state, status: 'review-ready' };
      }
      return state;
    default:
      return state;
  }
}

export async function beginCountdown(
  state: ManualOverlayState,
  durationMs: number,
  deps: BeginCountdownDeps,
): Promise<ManualOverlayState> {
  if (state.status !== 'preparing') return state;
  const countdownState: ManualOverlayState = { ...state, status: 'countdown', countdownMs: durationMs };
  await deps.wait(durationMs);
  await deps.emit({ type: 'recording-start' });
  return { ...countdownState, status: 'recording', countdownMs: null };
}

export function isManualOverlayCapturing(state: ManualOverlayState): boolean {
  return state.status === 'recording' || state.status === 'pickup-recording';
}
