import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { finalizeManualRecording } from '../../src/lib/video-generator/manual/final-report.js';
import { createReadyRun } from './manual-finalize-fixture.js';

test('finalize with injected TTS render and probe creates shared timeline audio subtitles and final', async () => {
  const runDir = await createReadyRun();
  const bundle = createManualBundle(runDir);
  const report = await finalizeManualRecording({
    runDir,
    env: { DASHSCOPE_API_KEY: 'test-key' },
    deps: {
      ttsProvider: {
        synthesize: async ({ segmentId, outputPath }) => {
          await writeFile(outputPath, 'wav');
          return { segmentId, audioPath: outputPath, durationMs: 1000 };
        },
      },
      mergeAudioSegments: async ({ outputPath }) => {
        await writeFile(outputPath, 'merged');
        return outputPath;
      },
      renderManualFinalVideo: async ({ outputPath }) => {
        await writeFile(outputPath, 'mp4');
        return outputPath;
      },
      probeFinalVideo: async () => ({ durationMs: 2000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
    },
  });
  assert.equal(report.ok, true);
  await access(bundle.finalVideoPath);
  const timeline = JSON.parse(await readFile(bundle.finalTimelinePath, 'utf8')) as { segments: Array<{ subtitleEndMs: number }> };
  assert.equal(timeline.segments[0]?.subtitleEndMs, 1000);
  assert.match(await readFile(bundle.subtitlesPath, 'utf8'), /Save settings/);
  assert.equal(path.basename(report.finalVideoPath ?? ''), 'final.mp4');
});

test('finalize accepts a run directory relative to the current workspace', async () => {
  const absoluteRunDir = await createReadyRun(process.cwd());
  const runDir = path.relative(process.cwd(), absoluteRunDir);
  try {
    const report = await finalizeManualRecording({
      runDir,
      env: { DASHSCOPE_API_KEY: 'test-key' },
      deps: {
        ttsProvider: {
          synthesize: async ({ segmentId, outputPath }) => {
            await writeFile(outputPath, 'wav');
            return { segmentId, audioPath: outputPath, durationMs: 1000 };
          },
        },
        mergeAudioSegments: async ({ outputPath }) => {
          await writeFile(outputPath, 'merged');
          return outputPath;
        },
        renderManualFinalVideo: async ({ outputPath }) => {
          await writeFile(outputPath, 'mp4');
          return outputPath;
        },
        probeFinalVideo: async () => ({ durationMs: 2000, width: 1920, height: 1080, fps: 30, codecName: 'h264' }),
      },
    });
    assert.equal(report.ok, true, report.errorMessage);
  } finally {
    await rm(absoluteRunDir, { recursive: true, force: true });
  }
});
