import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { runManualRecordController } from '../../src/lib/video-generator/manual/record-controller.js';
import type { RecordingGuide } from '../../src/lib/video-generator/manual/types.js';

function guide(): RecordingGuide {
  return {
    version: 1,
    startUrl: 'https://example.com/form',
    actions: [{
      id: 'action-001',
      segmentId: 'segment-001',
      title: '填写表单',
      instruction: '填写表单。',
      expectedEvents: [{ type: 'input', target: '客户名称' }],
      expectedResults: [{ type: 'text-visible', text: '保存成功' }],
    }],
  };
}

test('manual record controller loads approved guide, waits for F7 countdown, records artifacts and source catalog', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-record-controller-'));
  try {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.scriptsDir, { recursive: true });
    await writeFile(bundle.versionedScriptPath('recording-guide', 1), JSON.stringify(guide(), null, 2), { encoding: 'utf8', flag: 'wx' });
    await writeFile(bundle.approvedGuidePath, JSON.stringify({
      version: 1,
      guideVersion: 1,
      guidePath: bundle.versionedScriptPath('recording-guide', 1),
      approvedAt: '2026-07-28T00:00:00.000Z',
    }), 'utf8');

    const calls: string[] = [];
    const result = await runManualRecordController({
      runDir,
      displayMode: 'f11',
      deps: {
        launchChromium: async (input) => {
          calls.push(`launch:${input.startUrl}`);
          return { sourceId: 'original', bindingTitle: 'VG-CAPTURE-test' };
        },
        waitForStart: async () => { calls.push('wait:F7'); },
        capture: async (input) => {
          calls.push(`capture:${input.displayMode}`);
          await writeFile(input.rawVideoPath, 'raw', 'utf8');
          await writeFile(input.originalVideoPath, 'mp4', 'utf8');
          await writeFile(input.eventsPath, '{"type":"recording-start"}\n', 'utf8');
          await writeFile(input.tabsPath, '{"version":1,"tabs":[]}\n', 'utf8');
          return {
            video: { status: 'available', path: input.originalVideoPath, width: 1920, height: 1080, fps: 30, durationMs: 1000, hasAudio: false },
            attempts: [],
            recordingStartMs: 0,
            recordingEndMs: 1000,
            firstVideoFrameSessionTimeMs: 10,
          };
        },
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['launch:https://example.com/form', 'wait:F7', 'capture:f11']);
    const manifest = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as { captureComplete: boolean; video: { status: string } };
    assert.equal(manifest.captureComplete, true);
    assert.equal(manifest.video.status, 'available');
    const catalog = JSON.parse(await readFile(bundle.sourceCatalogPath, 'utf8')) as { sources: Array<{ id: string; kind: string; status: string }> };
    assert.deepEqual(catalog.sources.map((source) => ({ id: source.id, kind: source.kind, status: source.status })), [
      { id: 'original', kind: 'original', status: 'available' },
    ]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('manual record controller fail-closes and preserves incomplete artifacts on capture failure', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-record-failure-'));
  try {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.scriptsDir, { recursive: true });
    await writeFile(bundle.versionedScriptPath('recording-guide', 1), JSON.stringify(guide(), null, 2), { encoding: 'utf8', flag: 'wx' });
    await writeFile(bundle.approvedGuidePath, JSON.stringify({ version: 1, guideVersion: 1, guidePath: bundle.versionedScriptPath('recording-guide', 1), approvedAt: '2026-07-28T00:00:00.000Z' }), 'utf8');

    const result = await runManualRecordController({
      runDir,
      displayMode: 'borderless-maximized',
      deps: {
        launchChromium: async () => ({ sourceId: 'original', bindingTitle: 'VG-CAPTURE-test' }),
        waitForStart: async () => undefined,
        capture: async (input) => {
          await writeFile(input.rawVideoPath, 'partial raw', 'utf8');
          await writeFile(input.eventsPath, '{"type":"recording-start"}\n', 'utf8');
          throw new Error('capture failed');
        },
      },
    });

    assert.equal(result.ok, false);
    const manifest = JSON.parse(await readFile(bundle.recordingManifestPath, 'utf8')) as { captureComplete: boolean; video: { status: string; reason: string } };
    assert.equal(manifest.captureComplete, false);
    assert.equal(manifest.video.status, 'unavailable');
    assert.match(manifest.video.reason, /capture failed/);
    assert.equal(await readFile(bundle.rawVideoPath, 'utf8'), 'partial raw');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
