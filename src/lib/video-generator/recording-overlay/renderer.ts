/// <reference lib="dom" />

import type { ManualOverlayCommand } from '../manual/state-machine.js';
import type { ManualOverlaySnapshot } from './ipc.js';

declare global {
  interface Window {
    manualOverlay: {
      sendCommand(command: ManualOverlayCommand): Promise<void>;
      onSnapshot(callback: (snapshot: ManualOverlaySnapshot) => void): () => void;
    };
  }
}

const OVERLAY_COMMAND_TYPES = [
  'begin-countdown',
  'confirm-action',
  'previous-action',
  'discard-attempt',
  'finish',
] satisfies Array<ManualOverlayCommand['type']>;

const statusText = document.querySelector<HTMLElement>('#status');
const timerText = document.querySelector<HTMLElement>('#timer');
const segmentText = document.querySelector<HTMLElement>('#segment');
const actionText = document.querySelector<HTMLElement>('#action');
const attemptText = document.querySelector<HTMLElement>('#attempt');
const nextStepText = document.querySelector<HTMLElement>('#next-step');
const confidenceText = document.querySelector<HTMLElement>('#confidence');
const observerWarningText = document.querySelector<HTMLElement>('#observer-warning');
const newTabNoticeText = document.querySelector<HTMLElement>('#new-tab-notice');
let latestSnapshot: ManualOverlaySnapshot | null = null;
let snapshotReceivedAtMs = 0;

document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    const type = button.dataset.command;
    if (type === undefined || !isOverlayCommandType(type)) return;
    void window.manualOverlay.sendCommand({ type }).catch((error: unknown) => {
      console.error(`Manual overlay command ${type} failed:`, error);
    });
  });
});

function isOverlayCommandType(value: string): value is typeof OVERLAY_COMMAND_TYPES[number] {
  return (OVERLAY_COMMAND_TYPES as readonly string[]).includes(value);
}

window.manualOverlay.onSnapshot((snapshot) => {
  latestSnapshot = snapshot;
  snapshotReceivedAtMs = Date.now();
  renderSnapshot(snapshot);
});

setInterval(() => {
  if (latestSnapshot === null || !isActiveRecording(latestSnapshot.status)) return;
  setText(
    timerText,
    formatElapsedTime(latestSnapshot.elapsedMs + Math.max(0, Date.now() - snapshotReceivedAtMs)),
  );
}, 100);

function renderSnapshot(snapshot: ManualOverlaySnapshot): void {
  setText(statusText, snapshot.status);
  setText(timerText, formatElapsedTime(snapshot.elapsedMs));
  setText(segmentText, snapshot.segmentId);
  setText(actionText, snapshot.actionId);
  setText(attemptText, String(snapshot.attempt));
  setText(nextStepText, snapshot.nextStep);
  setText(confidenceText, snapshot.confidence ?? 'manual');
  setText(observerWarningText, snapshot.observerWarning ?? '无异常');
  setText(newTabNoticeText, snapshot.newTabNotice ?? '无');
}

function isActiveRecording(status: ManualOverlaySnapshot['status']): boolean {
  return status === 'recording' || status === 'pickup-recording';
}

function setText(element: HTMLElement | null, value: string): void {
  if (element !== null) element.textContent = value;
}

function formatElapsedTime(milliseconds: number): string {
  const totalMilliseconds = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = totalMilliseconds % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
