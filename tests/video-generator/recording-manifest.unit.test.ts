import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeRecordingManifest } from '../../src/lib/video-generator/recording/manifest.js';
import type { RecordingManifest } from '../../src/lib/video-generator/recording/types.js';

const manifest: RecordingManifest = {
  version: 1,
  platform: 'win32',
  video: {
    status: 'available',
    path: 'capture/original-window.mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 1000,
    hasAudio: false,
  },
  rawVideoPath: 'capture/raw-window.webm',
  eventsPath: 'capture/events.jsonl',
  tabsPath: 'capture/tabs.json',
  recordingStartMs: 0,
  recordingEndMs: 1000,
  firstVideoFrameSessionTimeMs: 10,
  attempts: [],
  clockStatus: 'ok',
  maxObservedDriftMs: 5,
  maxAllowedDriftMs: 250,
  captureComplete: true,
};

test('writes recording manifest atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-manifest-'));
  const file = path.join(dir, 'capture', 'recording-manifest.json');
  try {
    await writeRecordingManifest(file, manifest);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), manifest);
    await assert.rejects(() => readFile(`${file}.tmp`, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects manifest marked complete without an available video or first frame', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recording-manifest-invalid-'));
  const file = path.join(dir, 'recording-manifest.json');
  try {
    await assert.rejects(() => writeRecordingManifest(file, {
      ...manifest,
      video: { status: 'unavailable', path: null, reason: 'ffmpeg failed' },
      captureComplete: true,
    }), /complete/i);
    await assert.rejects(() => writeRecordingManifest(file, {
      ...manifest,
      firstVideoFrameSessionTimeMs: null,
      clockStatus: 'ok',
      captureComplete: true,
    }), /first video frame/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
