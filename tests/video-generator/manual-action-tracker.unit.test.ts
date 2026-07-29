import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createActionTracker,
  mapShortcutToManualCommand,
} from '../../src/lib/video-generator/manual/action-tracker.js';
import type { RecordingGuide } from '../../src/lib/video-generator/manual/types.js';

function guide(): RecordingGuide {
  return {
    version: 1,
    startUrl: 'https://example.com/form',
    actions: [
      {
        id: 'action-001',
        segmentId: 'segment-001',
        title: '点击保存',
        instruction: '点击保存按钮。',
        expectedEvents: [{ type: 'click', target: '保存' }],
        expectedResults: [{ type: 'text-visible', text: '保存成功' }],
      },
      {
        id: 'action-002',
        segmentId: 'segment-002',
        title: '查看详情',
        instruction: '确认详情页。',
        expectedEvents: [{ type: 'navigation' }],
        expectedResults: [{ type: 'url-matches', pattern: '/detail' }],
      },
    ],
  };
}

test('action tracker only auto-confirms when expected event and expected result match', () => {
  const confirmed: string[] = [];
  const tracker = createActionTracker(guide(), {
    sourceId: 'original',
    nowMs: () => 1000,
    onActionConfirmed: (event) => confirmed.push(event.actionId),
  });

  const clickOnly = tracker.observeEvent({ type: 'pointer-click', targetText: '保存' }, { visibleTexts: [] });
  assert.equal(clickOnly.status, 'waiting-for-result');
  assert.equal(tracker.currentAction().id, 'action-001');

  const matched = tracker.observeEvent({ type: 'pointer-click', targetText: '保存按钮' }, { visibleTexts: ['保存成功'] });
  assert.equal(matched.status, 'confirmed');
  assert.deepEqual(confirmed, ['action-001']);
  assert.equal(tracker.currentAction().id, 'action-002');
});

test('manual F8 confirmation and high-confidence auto confirmation share confirmAction event path', () => {
  const events: Array<{ type: string; actionId: string }> = [];
  const tracker = createActionTracker(guide(), {
    sourceId: 'original',
    nowMs: () => 2000,
    onActionConfirmed: (event) => events.push(event),
  });

  tracker.confirmAction('manual');
  tracker.confirmAction('auto');

  assert.deepEqual(events, [
    { type: 'action-confirmed', actionId: 'action-001', segmentId: 'segment-001', sourceId: 'original', attempt: 1, confirmedAtMs: 2000, method: 'manual' },
    { type: 'action-confirmed', actionId: 'action-002', segmentId: 'segment-002', sourceId: 'original', attempt: 1, confirmedAtMs: 2000, method: 'auto' },
  ]);
  assert.equal(tracker.isComplete(), true);
});

test('previous action moves pointer back without deleting events or restoring page state', () => {
  const tracker = createActionTracker(guide(), { sourceId: 'original', nowMs: () => 1 });

  tracker.confirmAction('manual');
  assert.equal(tracker.currentAction().id, 'action-002');
  const moved = tracker.previousAction();

  assert.equal(moved.id, 'action-001');
  assert.equal(tracker.currentAction().id, 'action-001');
  assert.equal(tracker.confirmedEvents().length, 1);
});

test('maps F7/F8/Shift+F8/F9/F10 shortcuts to semantic manual commands', () => {
  assert.deepEqual(mapShortcutToManualCommand('F7'), { type: 'begin-countdown' });
  assert.deepEqual(mapShortcutToManualCommand('F8'), { type: 'confirm-action' });
  assert.deepEqual(mapShortcutToManualCommand('Shift+F8'), { type: 'previous-action' });
  assert.deepEqual(mapShortcutToManualCommand('F9'), { type: 'discard-attempt' });
  assert.deepEqual(mapShortcutToManualCommand('F10'), { type: 'finish' });
  assert.equal(mapShortcutToManualCommand('F6'), null);
});
