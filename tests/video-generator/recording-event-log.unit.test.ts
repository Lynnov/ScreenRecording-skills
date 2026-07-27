import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createEventLog } from '../../src/lib/video-generator/recording/event-log.js';

test('appends one durable JSON object per line', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'event-log-'));
  const file = path.join(dir, 'events.jsonl');
  try {
    const log = await createEventLog(file);
    await log.append({ sessionTimeMs: 100, videoTimeMs: 20, type: 'recording-start' });
    await log.append({ sessionTimeMs: 200, videoTimeMs: 120, type: 'retry-start' });
    await log.close();

    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]!), { sessionTimeMs: 100, videoTimeMs: 20, type: 'recording-start' });
    assert.deepEqual(JSON.parse(lines[1]!), { sessionTimeMs: 200, videoTimeMs: 120, type: 'retry-start' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses to overwrite an existing event log', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'event-log-existing-'));
  const file = path.join(dir, 'events.jsonl');
  try {
    await writeFile(file, '{"type":"old"}\n', 'utf8');
    await assert.rejects(() => createEventLog(file), /exist/i);
    assert.equal(await readFile(file, 'utf8'), '{"type":"old"}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
