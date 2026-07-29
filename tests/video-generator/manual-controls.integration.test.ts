import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { mapShortcutToManualCommand } from '../../src/lib/video-generator/manual/action-tracker.js';
import { createManualCommandDispatcher } from '../../src/lib/video-generator/manual/product-runtime.js';
import { createEventLog } from '../../src/lib/video-generator/recording/event-log.js';

const expectedShortcuts = new Map([
  ['F7', 'begin-countdown'],
  ['F8', 'confirm-action'],
  ['Shift+F8', 'previous-action'],
  ['F9', 'discard-attempt'],
  ['F10', 'finish'],
]);

test('manual controls expose required keyboard semantics through one command mapping', () => {
  for (const [shortcut, commandType] of expectedShortcuts) {
    assert.equal(mapShortcutToManualCommand(shortcut)?.type, commandType);
  }
});

test('overlay buttons and global shortcuts share one runtime dispatch function', async () => {
  const commands: string[] = [];
  const dispatch = createManualCommandDispatcher(async (command) => {
    commands.push(command.type);
    return undefined;
  });

  await dispatch.fromOverlay({ type: 'confirm-action' });
  await dispatch.fromShortcut('F8');

  assert.deepEqual(commands, ['confirm-action', 'confirm-action']);
});

test('event log persists action-confirmed with segment source attempt and confirmation timestamp', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'manual-controls-'));
  const file = path.join(dir, 'events.jsonl');
  try {
    const log = await createEventLog(file);
    await log.append({
      type: 'action-confirmed',
      sessionTimeMs: 100,
      videoTimeMs: 80,
      payload: {
        actionId: 'action-001',
        segmentId: 'segment-001',
        sourceId: 'original',
        attempt: 1,
        confirmedAtMs: 100,
        method: 'manual',
      },
    });
    await log.close();

    const [line] = (await readFile(file, 'utf8')).trim().split('\n');
    const event = JSON.parse(line!) as { payload: Record<string, unknown> };
    assert.equal(event.payload.actionId, 'action-001');
    assert.equal(event.payload.segmentId, 'segment-001');
    assert.equal(event.payload.sourceId, 'original');
    assert.equal(event.payload.attempt, 1);
    assert.equal(event.payload.confirmedAtMs, 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
