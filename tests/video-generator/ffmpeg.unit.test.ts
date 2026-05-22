import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertFfmpegAvailable, renderFinalVideo, type RenderFinalVideoInput } from '../../src/lib/video-generator/ffmpeg.js';
import type { RunCommand } from '../../src/lib/video-generator/audio.js';
import { VideoGeneratorError, type Timeline } from '../../src/lib/video-generator/types.js';

function makeTimeline(): Timeline {
  return {
    version: 1,
    title: 'Final video',
    segments: [
      {
        id: 'intro',
        sourceText: 'intro',
        narration: 'intro',
        subtitle: 'intro',
        actions: [],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: { clipPath: '/clips/intro.webm' },
      },
      {
        id: 'details',
        sourceText: 'details',
        narration: 'details',
        subtitle: 'details',
        actions: [],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: { clipPath: '/clips/details.webm' },
      },
    ],
  };
}

test('assertFfmpegAvailable throws clear VideoGeneratorError when ffmpeg fails', async () => {
  await assert.rejects(
    () => assertFfmpegAvailable(async () => {
      throw Object.assign(new Error('spawn ffmpeg ENOENT'), { stderr: 'command not found' });
    }),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'FFMPEG_FAILED');
      assert.match(error.message, /ffmpeg/i);
      assert.match(error.message, /install/i);
      assert.match(error.message, /command not found|ENOENT/i);
      return true;
    },
  );
});

test('renderFinalVideo writes concat list and renders final mp4 with audio and subtitles', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-render-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand: RunCommand = async (command, args) => {
    calls.push({ command, args });
    return { stdout: 'ok', stderr: '' };
  };

  try {
    const input: RenderFinalVideoInput = {
      timeline: makeTimeline(),
      outputDir,
      audioPath: '/audio/narration.wav',
      subtitlesPath: '/subs/subtitles.srt',
      runCommand,
    };

    const finalPath = await renderFinalVideo(input);

    assert.equal(finalPath, path.join(outputDir, 'final.mp4'));
    assert.deepEqual(calls.map((call) => call.command), ['ffmpeg', 'ffmpeg']);
    assert.deepEqual(calls[0]?.args, ['-version']);

    const renderArgs = calls[1]?.args ?? [];
    assert.ok(renderArgs.includes('-f'));
    assert.ok(renderArgs.includes('concat'));
    assert.ok(renderArgs.includes('/audio/narration.wav'));
    assert.ok(renderArgs.includes('-vf'));
    assert.ok(renderArgs.some((arg) => arg.includes('subtitles=')));
    assert.equal(renderArgs.at(-1), path.join(outputDir, 'final.mp4'));

    const concatList = await readFile(path.join(outputDir, 'concat-list.txt'), 'utf8');
    assert.equal(concatList, "file '/clips/intro.webm'\nfile '/clips/details.webm'\n");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('renderFinalVideo uses top-level continuous clip when available', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-continuous-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const timeline = makeTimeline();
  timeline.assets = { continuousClipPath: '/clips/full.webm' };
  const runCommand: RunCommand = async () => ({ stdout: '', stderr: '' });

  try {
    await renderFinalVideo({ timeline, outputDir, runCommand });

    const concatList = await readFile(path.join(outputDir, 'concat-list.txt'), 'utf8');
    assert.equal(concatList, "file '/clips/full.webm'\n");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('renderFinalVideo normalizes Windows clip paths in concat list', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-concat-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const timeline = makeTimeline();
  timeline.segments[0]!.assets.clipPath = String.raw`E:\clips\intro.webm`;
  timeline.segments[1]!.assets.clipPath = String.raw`E:\clips\details's.webm`;

  try {
    await renderFinalVideo({ timeline, outputDir, runCommand: async () => ({ stdout: '', stderr: '' }) });

    const concatList = await readFile(path.join(outputDir, 'concat-list.txt'), 'utf8');
    assert.equal(concatList, "file 'E:/clips/intro.webm'\nfile 'E:/clips/details'\\''s.webm'\n");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('renderFinalVideo escapes complex subtitle paths for ffmpeg filtergraph', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-subtitles-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand: RunCommand = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  try {
    await renderFinalVideo({
      timeline: makeTimeline(),
      outputDir,
      subtitlesPath: String.raw`E:\subtitle dir\scene,one;[draft]'s.srt`,
      runCommand,
    });

    const renderArgs = calls[1]?.args ?? [];
    assert.ok(renderArgs.includes('-vf'));
    assert.ok(renderArgs.includes(String.raw`subtitles=E\:/subtitle\ dir/scene\,one\;\[draft\]\'s.srt`));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('renderFinalVideo disables audio and omits video filter without audio or subtitles', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-no-audio-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand: RunCommand = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  try {
    await renderFinalVideo({ timeline: makeTimeline(), outputDir, runCommand });

    const renderArgs = calls[1]?.args ?? [];
    assert.ok(renderArgs.includes('-an'));
    assert.ok(!renderArgs.includes('-vf'));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('renderFinalVideo includes ffmpeg stderr details when render fails', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-failure-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const runCommand: RunCommand = async (_command, args) => {
    if (args.includes('-version')) {
      return { stdout: 'ok', stderr: '' };
    }

    throw Object.assign(new Error('ffmpeg exited with code 1'), { stderr: 'No such file or directory: missing clip.webm' });
  };

  try {
    await assert.rejects(
      () => renderFinalVideo({ timeline: makeTimeline(), outputDir, runCommand }),
      (error) => {
        assert.ok(error instanceof VideoGeneratorError);
        assert.equal(error.code, 'FFMPEG_FAILED');
        assert.match(error.message, /Failed to render final video/);
        assert.match(error.message, /No such file or directory: missing clip\.webm/);
        return true;
      },
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('renderFinalVideo reports missing clip paths clearly', async () => {
  const timeline = makeTimeline();
  delete timeline.segments[1]?.assets.clipPath;

  await assert.rejects(
    () => renderFinalVideo({ timeline, outputDir: tmpdir(), runCommand: async () => ({ stdout: '', stderr: '' }) }),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'FFMPEG_FAILED');
      assert.match(error.message, /details/);
      assert.match(error.message, /clip/i);
      return true;
    },
  );
});
