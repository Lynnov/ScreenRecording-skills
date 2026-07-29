import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { applyEditAgentResponse, prepareEditAgentRequest } from '../../src/lib/video-generator/manual/edit-request.js';
import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { finalizeManualRecording } from '../../src/lib/video-generator/manual/final-report.js';
import { applyGuideAgentResponse, approveRecordingGuideVersion, prepareGuideAgentRequest } from '../../src/lib/video-generator/manual/guide-writer.js';
import { applyNarrationAgentResponse, approveNarrationVersion, prepareNarrationAgentRequest } from '../../src/lib/video-generator/manual/narration-response.js';
import { runManualRecordController } from '../../src/lib/video-generator/manual/record-controller.js';
import { createEditReviewDraft, saveReviewedEffectivePlan } from '../../src/lib/video-generator/manual/review.js';
import { verifyManualStage } from '../../src/lib/video-generator/manual/verifiers.js';
import { runManualPreviewCli } from '../../src/cli/manual-preview.js';

const run = promisify(execFile);

test('manual product runs guide through real ffmpeg final without desktop interaction', { timeout: 120_000 }, async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-e2e-'));
  const bundle = createManualBundle(runDir);
  const scriptPath = path.join(runDir, 'source.md');
  await writeFile(scriptPath, '# Save settings\n');

  const guidePrepared = await prepareGuideAgentRequest({ sourceScriptPath: scriptPath, outputDir: runDir });
  const guideResponsePath = bundle.versionedAgentPath('guide-response', guidePrepared.requestVersion);
  const guide = {
    version: 1 as const,
    startUrl: 'https://example.test',
    actions: [{ id: 'action-001', segmentId: 'segment-001', title: 'Save', instruction: 'Save settings', expectedEvents: [], expectedResults: [] }],
  };
  await writeFile(guideResponsePath, JSON.stringify({
    version: 1, kind: 'manual-guide-response', requestVersion: 1,
    producer: { agentId: 'stub', generatedAt: '2026-07-29T00:00:00.000Z' },
    polishedMarkdown: '# Save settings\n', executableMarkdown: '# Save settings\n', guide, warnings: [],
  }));
  await applyGuideAgentResponse({ runDir, responsePath: guideResponsePath });
  await approveRecordingGuideVersion({ runDir, version: 1 });
  assert.equal((await verifyManualStage({ runDir, stage: 'guide' })).ok, true);

  const recorded = await runManualRecordController({
    runDir,
    displayMode: 'borderless-maximized',
    deps: {
      launchChromium: async () => ({ sourceId: 'window:fixture', bindingTitle: 'Fixture' }),
      waitForStart: async () => undefined,
      capture: async ({ originalVideoPath, eventsPath, tabsPath }) => {
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-y', originalVideoPath]);
        await writeFile(eventsPath, `${JSON.stringify({ type: 'recording-start', sessionTimeMs: 0, videoTimeMs: 0 })}\n`);
        await writeFile(tabsPath, '[]\n');
        return {
          video: { status: 'available', path: originalVideoPath, width: 1920, height: 1080, fps: 30, durationMs: 2000, hasAudio: false },
          attempts: [], recordingStartMs: 0, recordingEndMs: 2000, firstVideoFrameSessionTimeMs: 0,
        };
      },
    },
  });
  assert.equal(recorded.ok, true);
  assert.equal((await verifyManualStage({ runDir, stage: 'capture' })).ok, true);

  const editPrepared = await prepareEditAgentRequest({ runDir });
  const editResponsePath = bundle.versionedAgentPath('edit-response', editPrepared.requestVersion);
  const plan = {
    version: 1 as const,
    canvas: { width: 1920 as const, height: 1080 as const, fps: 30 as const },
    segments: [{ segmentId: 'segment-001', title: 'Save', clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 1 }], confidence: 'high' as const, reason: 'fixture' }],
  };
  await writeFile(editResponsePath, JSON.stringify({
    version: 1, kind: 'manual-edit-response', requestVersion: editPrepared.requestVersion,
    producer: { agentId: 'stub', generatedAt: '2026-07-29T00:00:00.000Z' },
    plan, decisions: [{ segmentId: 'segment-001', confidence: 'high', reason: 'fixture', reviewReasons: [] }],
  }));
  await applyEditAgentResponse({ runDir, responsePath: editResponsePath });
  assert.equal(await runManualPreviewCli(['--run', runDir, '--plan', 'agent']), 0);
  assert.equal((await verifyManualStage({ runDir, stage: 'preview' })).ok, true);

  await saveReviewedEffectivePlan({ runDir, review: createEditReviewDraft({ agentPlan: plan }) });
  assert.equal((await verifyManualStage({ runDir, stage: 'review' })).ok, true);

  const narrationPrepared = await prepareNarrationAgentRequest({ runDir });
  const narrationResponsePath = bundle.versionedAgentPath('narration-response', narrationPrepared.requestVersion);
  await writeFile(narrationResponsePath, JSON.stringify({
    version: 1, kind: 'manual-narration-response', requestVersion: 1,
    producer: { agentId: 'stub', generatedAt: '2026-07-29T00:00:00.000Z' },
    segments: [{ segmentId: 'segment-001', text: 'Save settings.', estimatedDurationMs: 1000 }], warnings: [],
  }));
  await applyNarrationAgentResponse({ runDir, responsePath: narrationResponsePath });
  await approveNarrationVersion({ runDir, version: 1 });
  const finalReport = await finalizeManualRecording({
    runDir,
    env: { DASHSCOPE_API_KEY: 'fixture-key' },
    deps: {
      ttsProvider: {
        synthesize: async ({ segmentId, outputPath }) => {
          await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-ac', '1', '-y', outputPath]);
          return { segmentId, audioPath: outputPath, durationMs: 1000 };
        },
      },
    },
  });
  assert.equal(finalReport.ok, true, finalReport.errorMessage);
  assert.equal((await verifyManualStage({ runDir, stage: 'final' })).ok, true);
  await access(bundle.finalVideoPath);
  assert.match(await readFile(bundle.subtitlesPath, 'utf8'), /Save settings/);
});
