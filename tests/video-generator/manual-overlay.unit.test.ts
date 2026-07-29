import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  createManualOverlayState,
  manualOverlayReducer,
  beginCountdown,
  type ManualOverlayCommand,
} from '../../src/lib/video-generator/manual/state-machine.js';
import {
  MANUAL_OVERLAY_CHANNELS,
  isManualOverlayCommand,
  validateManualOverlaySnapshot,
} from '../../src/lib/video-generator/recording-overlay/ipc.js';

test('manual overlay state machine follows normal recording lifecycle and emits recording-start after countdown', async () => {
  const emitted: string[] = [];
  let state = createManualOverlayState({
    mode: 'recording',
    segmentId: 'segment-001',
    actionId: 'action-001',
    attempt: 1,
  });

  assert.equal(state.status, 'preparing');
  state = await beginCountdown(state, 3000, {
    wait: async (durationMs) => {
      assert.equal(durationMs, 3000);
      emitted.push('waited');
    },
    emit: async (event) => {
      emitted.push(event.type);
    },
  });

  assert.equal(state.status, 'recording');
  assert.deepEqual(emitted, ['waited', 'recording-start']);
  state = manualOverlayReducer(state, { type: 'finish' });
  assert.equal(state.status, 'finishing');
  state = manualOverlayReducer(state, { type: 'analyze' });
  assert.equal(state.status, 'analyzing');
  state = manualOverlayReducer(state, { type: 'review-ready' });
  assert.equal(state.status, 'review-ready');
});

test('manual overlay state machine follows pickup lifecycle without normal countdown', () => {
  let state = createManualOverlayState({
    mode: 'pickup',
    segmentId: 'segment-003',
    actionId: 'action-009',
    attempt: 2,
  });

  assert.equal(state.status, 'pickup-preparing');
  state = manualOverlayReducer(state, { type: 'start-pickup' });
  assert.equal(state.status, 'pickup-recording');
  state = manualOverlayReducer(state, { type: 'finish' });
  assert.equal(state.status, 'pickup-finishing');
  state = manualOverlayReducer(state, { type: 'analyze' });
  assert.equal(state.status, 'segment-analyzing');
  state = manualOverlayReducer(state, { type: 'review-ready' });
  assert.equal(state.status, 'review-ready');
});

test('manual overlay command reducer maps F7/F8/Shift+F8/F9/F10 to shared commands', () => {
  const commands: ManualOverlayCommand[] = [
    { type: 'begin-countdown' },
    { type: 'confirm-action' },
    { type: 'previous-action' },
    { type: 'discard-attempt' },
    { type: 'finish' },
  ];
  for (const command of commands) {
    assert.equal(isManualOverlayCommand(command), true);
  }
  assert.equal(isManualOverlayCommand({ type: 'delete-everything' }), false);
});

test('manual overlay IPC channels are constant and snapshots are validated', () => {
  assert.deepEqual(MANUAL_OVERLAY_CHANNELS, {
    command: 'manual-overlay:command',
    snapshot: 'manual-overlay:snapshot',
    close: 'manual-overlay:close',
  });

  validateManualOverlaySnapshot({
    status: 'recording',
    sourceReady: true,
    elapsedMs: 1200,
    segmentId: 'segment-001',
    actionId: 'action-001',
    attempt: 1,
    nextStep: '点击保存',
    confidence: 'high',
    observerWarning: null,
    newTabNotice: null,
  });
  assert.throws(() => validateManualOverlaySnapshot({ status: 'unknown', sourceReady: true, elapsedMs: 0, attempt: 1 }), /status/);
  assert.throws(() => validateManualOverlaySnapshot({ status: 'recording', sourceReady: true, elapsedMs: -1, attempt: 1 }), /elapsedMs/);
});

test('preload exposes typed manual overlay API without Node globals', async () => {
  const preload = await readFile(path.resolve('src/lib/video-generator/recording-overlay/preload.cts'), 'utf8');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('manualOverlay'/);
  assert.match(preload, /ipcRenderer\.invoke\(channels\.command/);
  assert.doesNotMatch(preload, /require\('\.\/ipc\.js'\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^\n]+require/);
  assert.doesNotMatch(preload, /fs\/promises|node:fs|child_process/);
});
