import type { ManualOverlayCommand, ManualOverlayStatus } from '../manual/state-machine.js';

export const MANUAL_OVERLAY_CHANNELS = {
  command: 'manual-overlay:command',
  snapshot: 'manual-overlay:snapshot',
  close: 'manual-overlay:close',
} as const;

export type ManualOverlayChannel = typeof MANUAL_OVERLAY_CHANNELS[keyof typeof MANUAL_OVERLAY_CHANNELS];

export type ManualOverlayConfidence = 'high' | 'medium' | 'low' | 'manual-confirmation-required' | null;

export interface ManualOverlaySnapshot {
  status: ManualOverlayStatus;
  sourceReady: boolean;
  elapsedMs: number;
  segmentId: string;
  actionId: string;
  attempt: number;
  nextStep: string;
  confidence: ManualOverlayConfidence;
  observerWarning: string | null;
  newTabNotice: string | null;
}

const COMMAND_TYPES = new Set([
  'begin-countdown',
  'start-pickup',
  'confirm-action',
  'previous-action',
  'discard-attempt',
  'finish',
  'analyze',
  'review-ready',
]);

const STATUS_TYPES = new Set([
  'preparing',
  'countdown',
  'recording',
  'finishing',
  'analyzing',
  'pickup-preparing',
  'pickup-recording',
  'pickup-finishing',
  'segment-analyzing',
  'review-ready',
]);

export function isManualOverlayCommand(value: unknown): value is ManualOverlayCommand {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'type' in value
    && typeof (value as { type: unknown }).type === 'string'
    && COMMAND_TYPES.has((value as { type: string }).type);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('snapshot must be an object');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): void {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
}

function requireNullableString(value: unknown, path: string): void {
  if (value !== null && typeof value !== 'string') throw new Error(`${path} must be null or a string`);
}

export function validateManualOverlaySnapshot(value: unknown): asserts value is ManualOverlaySnapshot {
  const snapshot = requireRecord(value);
  if (typeof snapshot.status !== 'string' || !STATUS_TYPES.has(snapshot.status)) {
    throw new Error('snapshot.status is invalid');
  }
  if (typeof snapshot.sourceReady !== 'boolean') {
    throw new Error('snapshot.sourceReady must be a boolean');
  }
  if (typeof snapshot.elapsedMs !== 'number' || !Number.isFinite(snapshot.elapsedMs) || snapshot.elapsedMs < 0) {
    throw new Error('snapshot.elapsedMs must be a non-negative finite number');
  }
  requireString(snapshot.segmentId, 'snapshot.segmentId');
  requireString(snapshot.actionId, 'snapshot.actionId');
  if (typeof snapshot.attempt !== 'number' || !Number.isInteger(snapshot.attempt) || snapshot.attempt < 1) {
    throw new Error('snapshot.attempt must be a positive integer');
  }
  requireString(snapshot.nextStep, 'snapshot.nextStep');
  if (
    snapshot.confidence !== null
    && snapshot.confidence !== 'high'
    && snapshot.confidence !== 'medium'
    && snapshot.confidence !== 'low'
    && snapshot.confidence !== 'manual-confirmation-required'
  ) {
    throw new Error('snapshot.confidence is invalid');
  }
  requireNullableString(snapshot.observerWarning, 'snapshot.observerWarning');
  requireNullableString(snapshot.newTabNotice, 'snapshot.newTabNotice');
}
