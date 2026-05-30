import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runVideoGenerator } from '../../src/lib/video-generator/pipeline.js';
import type { Timeline } from '../../src/lib/video-generator/types.js';
import type { TtsProvider } from '../../src/lib/video-generator/tts/types.js';

async function makeScriptFile(outputDir: string): Promise<string> {
  const scriptPath = path.join(outputDir, 'script.md');
  await writeFile(scriptPath, [
    '打开 http://127.0.0.1:4321/demo',
    '旁白：打开页面',
    '',
    '点击 开始',
    '旁白：点击按钮',
  ].join('\n'));
  return scriptPath;
}

test('runVideoGenerator writes artifacts and success report with injected dependencies', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-success-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const synthesized: string[] = [];
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      synthesized.push(request.outputPath);
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 1200 };
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir, segmentBufferMs: 300 },
      deps: {
        ttsProvider,
        recordTimelineSegments: async ({ timeline }) => ({
          ...timeline,
          segments: timeline.segments.map((segment) => ({
            ...segment,
            assets: { ...segment.assets, clipPath: path.join(outputDir, 'clips', `${segment.id}.webm`) },
          })),
        }),
        mergeAudioSegments: async (mergeInput) => mergeInput.outputPath,
        renderFinalVideo: async () => path.join(outputDir, 'final.mp4'),
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.outputDir, outputDir);
    assert.equal(report.timelinePath, path.join(outputDir, 'timeline.json'));
    assert.equal(report.subtitlesPath, path.join(outputDir, 'subtitles.srt'));
    assert.equal(report.finalVideoPath, path.join(outputDir, 'final.mp4'));
    assert.deepEqual(synthesized, [
      path.join(outputDir, 'audio', 'seg-001.wav'),
      path.join(outputDir, 'audio', 'seg-002.wav'),
    ]);
    assert.equal(existsSync(path.join(outputDir, 'run-report.json')), true);

    const timeline = JSON.parse(await readFile(path.join(outputDir, 'timeline.json'), 'utf8')) as Timeline;
    assert.equal(timeline.segments[0]?.actualAudioDurationMs, 1200);
    assert.equal(timeline.segments[0]?.startsAtMs, 0);
    assert.equal(timeline.segments[0]?.endsAtMs, 1500);
    assert.equal(timeline.segments[1]?.startsAtMs, 1500);
    assert.equal(timeline.segments[1]?.endsAtMs, 3000);
    assert.equal(timeline.segments[0]?.assets.audioPath, path.join(outputDir, 'audio', 'seg-001.wav'));

    const subtitles = await readFile(path.join(outputDir, 'subtitles.srt'), 'utf8');
    assert.match(subtitles, /00:00:00,000 --> 00:00:01,500/);
    assert.match(subtitles, /打开页面/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGenerator writes preflight report when stages and preflight page are provided', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-preflight-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  await writeFile(scriptPath, [
    '@stage demo.form scope="main" anchor="button"',
    '打开 http://127.0.0.1:4321/demo',
    '旁白：打开页面',
    '',
    '@stage demo.form',
    '点击 开始',
    '旁白：点击按钮',
  ].join('\n'));
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 1000 };
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        ttsProvider,
        preflightPage: {
          locator: (selector: string) => ({
            count: async () => selector === 'main' || selector === 'main >> button' ? 1 : 0,
          }),
        },
        recordTimelineSegments: async ({ timeline }) => timeline,
        mergeAudioSegments: async (input) => input.outputPath,
        renderFinalVideo: async () => path.join(outputDir, 'final.mp4'),
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.preflightReportPath, path.join(outputDir, 'preflight-report.json'));
    const preflightReport = JSON.parse(await readFile(path.join(outputDir, 'preflight-report.json'), 'utf8')) as { stageDiagnostics: unknown[] };
    assert.equal(preflightReport.stageDiagnostics.length, 1);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGenerator merges synthesized narration and passes it to renderer', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-audio-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const renderInputs: string[] = [];
  const mergeCommands: Array<{ command: string; args: string[] }> = [];
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 1000 };
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        ttsProvider,
        mergeAudioSegments: async (input) => {
          mergeCommands.push({ command: 'ffmpeg', args: input.audioPaths });
          await writeFile(input.outputPath, input.audioPaths.join('\n'));
          return input.outputPath;
        },
        recordTimelineSegments: async ({ timeline }) => ({
          ...timeline,
          segments: timeline.segments.map((segment) => ({
            ...segment,
            assets: { ...segment.assets, clipPath: path.join(outputDir, 'clips', `${segment.id}.webm`) },
          })),
        }),
        renderFinalVideo: async (input) => {
          renderInputs.push(input.audioPath ?? '');
          return path.join(outputDir, 'final.mp4');
        },
      },
    });

    assert.equal(report.ok, true);
    assert.deepEqual(renderInputs, [path.join(outputDir, 'audio', 'narration.wav')]);
    assert.equal(existsSync(path.join(outputDir, 'audio', 'narration.wav')), true);
    assert.deepEqual(mergeCommands, [{
      command: 'ffmpeg',
      args: [
        path.join(outputDir, 'audio', 'seg-001.wav'),
        path.join(outputDir, 'audio', 'seg-002.wav'),
      ],
    }]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGenerator passes timeline segment durations to audio merge', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-audio-padding-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  let mergeInputSegments: unknown;
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: request.segmentId === 'seg-001' ? 1000 : 1200 };
    },
  };

  try {
    await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir, segmentBufferMs: 500 },
      deps: {
        ttsProvider,
        recordTimelineSegments: async ({ timeline }) => timeline,
        mergeAudioSegments: async (input) => {
          mergeInputSegments = input.segments;
          return input.outputPath;
        },
        renderFinalVideo: async () => path.join(outputDir, 'final.mp4'),
      },
    });

    assert.deepEqual(mergeInputSegments, [
      { id: 'seg-001', startsAtMs: 0, endsAtMs: 1591, actualAudioDurationMs: 1000 },
      { id: 'seg-002', startsAtMs: 1591, endsAtMs: 3291, actualAudioDurationMs: 1200 },
    ]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGenerator writes failed action diagnostics into failure report', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-failed-action-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const failedAction = { type: 'fill' as const, selector: '#token', value: 'secret-token' };
  const diagnostics = {
    url: 'http://127.0.0.1/form',
    stageName: 'token.stage',
    actionType: 'fill' as const,
    selector: '#token',
    candidateCount: 1,
    candidates: [{ index: 0, visible: true, editable: false }],
    screenshotPath: path.join(outputDir, 'screenshots', 'seg-002.png'),
    failureReason: 'fill failed',
  };
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 1000 };
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        ttsProvider,
        recordTimelineSegments: async () => {
          const error = new Error('fill target not editable');
          Object.assign(error, { segmentId: 'seg-002', failedAction, diagnostics });
          throw error;
        },
        renderFinalVideo: async () => path.join(outputDir, 'final.mp4'),
      },
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.failedAction, { type: 'fill', selector: '#token', value: '[REDACTED]' });
    assert.deepEqual(report.diagnostics, diagnostics);

    const written = JSON.parse(await readFile(path.join(outputDir, 'run-report.json'), 'utf8')) as typeof report;
    assert.deepEqual(written.failedAction, { type: 'fill', selector: '#token', value: '[REDACTED]' });
    assert.deepEqual(written.diagnostics, diagnostics);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGenerator returns failure report and skips recording when TTS fails', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-tts-failure-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  let recordCalls = 0;
  let renderCalls = 0;
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      throw new Error(`TTS failed for ${request.segmentId}: quota exceeded`);
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        ttsProvider,
        recordTimelineSegments: async ({ timeline }) => {
          recordCalls += 1;
          return timeline;
        },
        renderFinalVideo: async () => {
          renderCalls += 1;
          return path.join(outputDir, 'final.mp4');
        },
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.failedSegmentId, 'seg-001');
    assert.match(report.errorMessage ?? '', /TTS failed for seg-001: quota exceeded/);
    assert.equal(recordCalls, 0);
    assert.equal(renderCalls, 0);

    const written = JSON.parse(await readFile(path.join(outputDir, 'run-report.json'), 'utf8')) as typeof report;
    assert.equal(written.ok, false);
    assert.equal(written.failedSegmentId, 'seg-001');
    assert.match(written.errorMessage ?? '', /TTS failed for seg-001: quota exceeded/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('runVideoGenerator writes failure report with failed segment and screenshot details', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-failure-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const screenshotPath = path.join(outputDir, 'screenshots', 'seg-002.png');
  const diagnostics = {
    url: 'http://127.0.0.1/form',
    actionType: 'click' as const,
    selector: 'text=继续',
    candidateCount: 2,
    candidates: [
      { index: 0, visible: true, overlayElement: { tagName: 'div', id: 'overlay' } },
      { index: 1, visible: true },
    ],
    overlayElement: { tagName: 'div', id: 'overlay' },
    screenshotPath,
    failureReason: 'click failed',
  };
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 1000 };
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        ttsProvider,
        recordTimelineSegments: async () => {
          const error = new Error(`Failed to record segment seg-002; screenshot saved to ${screenshotPath}: missing button`);
          Object.assign(error, { segmentId: 'seg-002', screenshotPath, diagnostics });
          throw error;
        },
        renderFinalVideo: async () => path.join(outputDir, 'final.mp4'),
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.failedSegmentId, 'seg-002');
    assert.equal(report.screenshotPath, screenshotPath);
    assert.deepEqual(report.diagnostics, diagnostics);
    assert.match(report.errorMessage ?? '', /missing button/);

    const written = JSON.parse(await readFile(path.join(outputDir, 'run-report.json'), 'utf8')) as typeof report;
    assert.equal(written.ok, false);
    assert.equal(written.failedSegmentId, 'seg-002');
    assert.equal(written.screenshotPath, screenshotPath);
    assert.deepEqual(written.diagnostics, diagnostics);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
