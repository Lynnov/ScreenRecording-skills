import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  appendSource,
  getNextPickupAttempt,
  getNextPickupAttemptFromArtifacts,
  readManualSourceCatalog,
} from '../../src/lib/video-generator/manual/source-catalog.js';

const probe = {
  durationMs: 1234,
  width: 1920,
  height: 1080,
  fps: 30,
  codecName: 'h264',
  pixelFormat: 'yuv420p',
  hasAudio: false,
};

test('appendSource creates a catalog and appends original source from probe metadata', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-source-'));
  const catalogPath = path.join(tempDir, 'capture', 'source-catalog.json');
  try {
    const catalog = await appendSource(catalogPath, {
      id: 'original',
      path: 'capture/original-window.mp4',
      kind: 'original',
      segmentId: null,
      attempt: null,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      probe,
    });

    assert.equal(catalog.version, 1);
    assert.equal(catalog.sources.length, 1);
    assert.deepEqual(catalog.sources[0], {
      id: 'original',
      path: 'capture/original-window.mp4',
      kind: 'original',
      segmentId: null,
      attempt: null,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      ...probe,
    });
    assert.deepEqual(await readManualSourceCatalog(catalogPath), catalog);
    assert.deepEqual(JSON.parse(await readFile(catalogPath, 'utf8')), catalog);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('appendSource appends pickup sources and calculates the next attempt per segment', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-pickup-source-'));
  const catalogPath = path.join(tempDir, 'capture', 'source-catalog.json');
  try {
    await appendSource(catalogPath, {
      id: 'segment-003-attempt-001',
      path: 'pickups/segment-003-attempt-001.mp4',
      kind: 'pickup',
      segmentId: 'segment-003',
      attempt: 1,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      probe,
    });
    await appendSource(catalogPath, {
      id: 'segment-003-attempt-002',
      path: 'pickups/segment-003-attempt-002.mp4',
      kind: 'pickup',
      segmentId: 'segment-003',
      attempt: 2,
      status: 'failed',
      failureReason: 'capture failed after writing a partial artifact',
      createdAt: '2026-07-28T00:01:00.000Z',
      probe: { ...probe, durationMs: 800 },
    });

    const catalog = await readManualSourceCatalog(catalogPath);
    assert.equal(catalog.sources.length, 2);
    assert.equal(getNextPickupAttempt(catalog, 'segment-003'), 3);
    assert.equal(getNextPickupAttempt(catalog, 'segment-004'), 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('pickup attempt allocation preserves orphaned artifacts from a failed preflight', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-pickup-orphan-'));
  const pickupsDir = path.join(tempDir, 'pickups');
  try {
    await mkdir(pickupsDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(pickupsDir, 'segment-003-attempt-002.events.jsonl'), '', 'utf8'),
      writeFile(path.join(pickupsDir, 'segment-003-attempt-002.tabs.json'), '{}\n', 'utf8'),
      writeFile(path.join(pickupsDir, 'segment-004-attempt-099.mp4'), '', 'utf8'),
      writeFile(path.join(pickupsDir, 'unrelated.txt'), '', 'utf8'),
    ]);
    const catalog = {
      version: 1 as const,
      sources: [{
        id: 'segment-003-attempt-001',
        path: 'pickups/segment-003-attempt-001.mp4',
        kind: 'pickup' as const,
        segmentId: 'segment-003',
        attempt: 1,
        status: 'available' as const,
        createdAt: '2026-07-28T00:00:00.000Z',
        ...probe,
      }],
    };

    assert.equal(
      await getNextPickupAttemptFromArtifacts(catalog, pickupsDir, 'segment-003'),
      3,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('appendSource rejects duplicate ids, invalid probe data, and mismatched pickup fields', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-source-invalid-'));
  const catalogPath = path.join(tempDir, 'capture', 'source-catalog.json');
  try {
    await appendSource(catalogPath, {
      id: 'original',
      path: 'capture/original-window.mp4',
      kind: 'original',
      segmentId: null,
      attempt: null,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      probe,
    });

    await assert.rejects(() => appendSource(catalogPath, {
      id: 'original',
      path: 'capture/duplicate.mp4',
      kind: 'original',
      segmentId: null,
      attempt: null,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      probe,
    }), /duplicate/i);

    await assert.rejects(() => appendSource(catalogPath, {
      id: 'bad-probe',
      path: 'capture/bad.mp4',
      kind: 'original',
      segmentId: null,
      attempt: null,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      probe: { ...probe, durationMs: 0 },
    }), /durationMs/);

    await assert.rejects(() => appendSource(catalogPath, {
      id: 'bad-pickup',
      path: 'pickups/bad.mp4',
      kind: 'pickup',
      segmentId: null,
      attempt: 1,
      status: 'available',
      createdAt: '2026-07-28T00:00:00.000Z',
      probe,
    }), /segmentId/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
