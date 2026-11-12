import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { finalizeManualRecording, type FinalizeManualDeps } from '../../src/lib/video-generator/manual/final-report.js';
import { createReadyRun } from './manual-finalize-fixture.js';

test('finalize without DASHSCOPE_API_KEY writes failure report and no fake final', async () => {
  const runDir = await createReadyRun();
  const bundle = createManualBundle(runDir);
  const report = await finalizeManualRecording({ runDir, env: {} });
  assert.equal(report.ok, false);
  assert.match(report.errorMessage ?? '', /DASHSCOPE_API_KEY/);
  await assert.rejects(access(bundle.finalVideoPath));
  const written = JSON.parse(await readFile(bundle.reportPath('final-verification'), 'utf8')) as Record<string, unknown>;
  assert.equal(written.ok, false);
  assert.equal(JSON.stringify(written).includes('test-key'), false);
});

function successfulDeps(): FinalizeManualDeps {
  return {
    ttsProvider: { synthesize: async ({ segmentId, outputPath }) => {
      await writeFile(outputPath, 'audio');
      return { segmentId, audioPath: outputPath, durationMs: 1000 };
    } },
    mergeAudioSegments: async ({ outputPath }) => {
      await writeFile(outputPath, 'merged audio');
      return outputPath;
    },
    renderManualFinalVideo: async ({ outputPath }) => {
      await writeFile(outputPath, 'new video');
      return outputPath;
    },
    probeFinalVideo: async () => ({ durationMs: 2000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
  };
}

test('missing TTS configuration preserves an existing final video byte for byte', async (t) => {
  const runDir = await createReadyRun();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const bundle = createManualBundle(runDir);
  const previous = Buffer.from([0, 1, 2, 255, 128]);
  await writeFile(bundle.finalVideoPath, previous);
  const report = await finalizeManualRecording({ runDir, env: {} });
  assert.equal(report.ok, false);
  assert.match(report.errorMessage ?? '', /DASHSCOPE_API_KEY/);
  assert.deepEqual(await readFile(bundle.finalVideoPath), previous);
});

for (const failure of ['tts', 'render', 'probe', 'format', 'duration'] as const) {
  test(`finalize preserves existing video and cleans partial output after ${failure} failure`, async (t) => {
    const runDir = await createReadyRun();
    t.after(() => rm(runDir, { recursive: true, force: true }));
    const bundle = createManualBundle(runDir);
    await writeFile(bundle.finalVideoPath, 'previous good video');
    const deps = successfulDeps();
    if (failure === 'tts') deps.ttsProvider = { synthesize: async () => { throw new Error('TTS failed'); } };
    if (failure === 'render') deps.renderManualFinalVideo = async ({ outputPath }) => {
      await writeFile(outputPath, 'incomplete video');
      throw new Error('render failed');
    };
    if (failure === 'probe') deps.probeFinalVideo = async () => { throw new Error('probe failed'); };
    if (failure === 'format') deps.probeFinalVideo = async () => ({ durationMs: 2000, width: 640, height: 360, fps: 30, codecName: 'h264' });
    if (failure === 'duration') deps.probeFinalVideo = async () => ({ durationMs: 9000, width: 1920, height: 1080, fps: 30, codecName: 'h264' });
    const report = await finalizeManualRecording({ runDir, env: { DASHSCOPE_API_KEY: 'fixture-key' }, deps });
    assert.equal(report.ok, false);
    assert.deepEqual(report.cleanupErrors, []);
    assert.equal(await readFile(bundle.finalVideoPath, 'utf8'), 'previous good video');
    assert.deepEqual((await readdir(runDir)).filter((name) => name.endsWith('.mp4')), ['final.mp4']);
    const written = JSON.parse(await readFile(bundle.reportPath('final-verification'), 'utf8'));
    assert.equal(written.ok, false);
  });
}

test('successful finalize replaces the previous video only after probing the new video', async (t) => {
  const runDir = await createReadyRun();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const bundle = createManualBundle(runDir);
  await writeFile(bundle.finalVideoPath, 'previous good video');
  const deps = successfulDeps();
  let renderedPath: string | undefined;
  deps.renderManualFinalVideo = async ({ outputPath }) => {
    assert.notEqual(outputPath, bundle.finalVideoPath);
    assert.equal(path.dirname(outputPath), path.dirname(bundle.finalVideoPath));
    assert.equal(await readFile(bundle.finalVideoPath, 'utf8'), 'previous good video');
    renderedPath = outputPath;
    await writeFile(outputPath, 'verified replacement');
    return outputPath;
  };
  deps.probeFinalVideo = async (filePath) => {
    assert.equal(filePath, renderedPath);
    assert.equal(await readFile(bundle.finalVideoPath, 'utf8'), 'previous good video');
    assert.equal(await readFile(filePath, 'utf8'), 'verified replacement');
    return { durationMs: 2000, width: 1920, height: 1080, fps: 30, codecName: 'h264' };
  };
  const report = await finalizeManualRecording({ runDir, env: { DASHSCOPE_API_KEY: 'fixture-key' }, deps });
  assert.equal(report.ok, true, report.errorMessage);
  assert.equal(report.finalVideoPath, bundle.finalVideoPath);
  assert.equal(await readFile(bundle.finalVideoPath, 'utf8'), 'verified replacement');
  assert.deepEqual((await readdir(runDir)).filter((name) => name.endsWith('.mp4')), ['final.mp4']);
});

test('a first render failure removes its partial video without publishing a final', async (t) => {
  const runDir = await createReadyRun();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const bundle = createManualBundle(runDir);
  const deps = successfulDeps();
  deps.renderManualFinalVideo = async ({ outputPath }) => {
    await writeFile(outputPath, 'partial video');
    throw new Error('render failed');
  };
  const report = await finalizeManualRecording({ runDir, env: { DASHSCOPE_API_KEY: 'fixture-key' }, deps });
  assert.equal(report.ok, false);
  await assert.rejects(access(bundle.finalVideoPath));
  assert.deepEqual((await readdir(runDir)).filter((name) => name.endsWith('.mp4')), []);
});

test('a final report write failure preserves the previous video and removes the new temporary video', async (t) => {
  const runDir = await createReadyRun();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const bundle = createManualBundle(runDir);
  await writeFile(bundle.finalVideoPath, 'previous good video');
  await mkdir(bundle.reportPath('final-verification'), { recursive: true });
  await assert.rejects(finalizeManualRecording({ runDir, env: { DASHSCOPE_API_KEY: 'fixture-key' }, deps: successfulDeps() }));
  assert.equal(await readFile(bundle.finalVideoPath, 'utf8'), 'previous good video');
  assert.deepEqual((await readdir(runDir)).filter((name) => name.endsWith('.mp4')), ['final.mp4']);
});
