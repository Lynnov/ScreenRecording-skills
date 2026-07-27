import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunCommand } from '../../src/lib/video-generator/audio.js';
import type { EditPlan, EditSource } from '../../src/lib/video-generator/editing/types.js';
import { renderEditPreview } from '../../src/lib/video-generator/editing/preview.js';

const plan: EditPlan = {
  version: 1,
  canvas: { width: 1920, height: 1080, fps: 30 },
  segments: [
    {
      segmentId: 'segment-original',
      title: 'original',
      clips: [{ sourceId: '原始 source', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }],
      transition: 'cut',
      confidence: 'high',
      reason: 'fixture',
    },
    {
      segmentId: 'segment-pickup',
      title: 'pickup',
      clips: [{ sourceId: 'pickup', sourceStartMs: 0, sourceEndMs: 500, playbackRate: 1 }],
      confidence: 'high',
      reason: 'fixture',
    },
  ],
};

function sources(root: string): EditSource[] {
  return [
    {
      id: '原始 source', path: path.join(root, '素材 目录', '原始 视频.mp4'), durationMs: 2000,
      width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false,
    },
    {
      id: 'pickup', path: path.join(root, 'pickup 文件.mp4'), durationMs: 1000,
      width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false,
    },
  ];
}

test('renders to temporary paths with discrete unicode input args then atomically publishes preview and timeline', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'editing-preview-unit-'));
  try {
    const outputPath = path.join(root, '输出 目录', 'preview.mp4');
    const timelinePath = path.join(root, '输出 目录', 'preview-timeline.json');
    const calls: Array<{ command: string; args: string[] }> = [];
    const runCommand: RunCommand = async (command, args) => {
      calls.push({ command, args });
      if (command === 'ffmpeg') {
        await writeFile(args.at(-1)!, 'rendered');
        return { stdout: '', stderr: '' };
      }
      return {
        stdout: JSON.stringify({
          streams: [{
            codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
            r_frame_rate: '30/1', pix_fmt: 'yuv420p',
          }],
          format: { duration: '1.500' },
        }),
        stderr: '',
      };
    };

    const result = await renderEditPreview({
      plan, sources: sources(root), outputPath, timelinePath, runCommand,
    });

    assert.deepEqual(result, { previewPath: outputPath, timelinePath, durationMs: 1500 });
    assert.equal(await readFile(outputPath, 'utf8'), 'rendered');
    assert.equal(JSON.parse(await readFile(timelinePath, 'utf8')).durationMs, 1500);
    assert.deepEqual(calls.map((call) => call.command), ['ffmpeg', 'ffprobe']);
    const args = calls[0]!.args;
    assert.deepEqual(args.slice(0, 4), ['-hide_banner', '-loglevel', 'error', '-i']);
    assert.equal(args[4], sources(root)[0]!.path);
    assert.equal(args[5], '-i');
    assert.equal(args[6], sources(root)[1]!.path);
    assert.deepEqual(args.slice(-13), [
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
      '-movflags', '+faststart', '-an', '-y', `${outputPath}.tmp.mp4`,
    ]);
    assert.equal(calls[1]!.args.at(-1), `${outputPath}.tmp.mp4`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports render context, truncates stderr, and removes temporary output without publishing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'editing-preview-failure-'));
  try {
    const outputPath = path.join(root, 'preview.mp4');
    const timelinePath = path.join(root, 'timeline.json');
    const stderr = `ffmpeg exploded ${'x'.repeat(10_000)}`;
    const runCommand: RunCommand = async (_command, args) => {
      await writeFile(args.at(-1)!, 'partial');
      throw Object.assign(new Error('render failed'), { stderr });
    };

    await assert.rejects(
      renderEditPreview({ plan, sources: sources(root), outputPath, timelinePath, runCommand }),
      (error: Error) => {
        assert.match(error.message, /原始 source, pickup/);
        assert.match(error.message, /segment-original, segment-pickup/);
        assert.ok(error.message.includes(outputPath));
        assert.match(error.message, /ffmpeg exploded/);
        assert.ok(error.message.length < stderr.length);
        return true;
      },
    );
    await assert.rejects(readFile(outputPath));
    await assert.rejects(readFile(`${outputPath}.tmp.mp4`));
    await assert.rejects(readFile(timelinePath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rolls back the preview when publishing the timeline fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'editing-preview-publish-failure-'));
  try {
    const outputPath = path.join(root, 'preview.mp4');
    const timelinePath = path.join(root, 'timeline.json');
    const runCommand: RunCommand = async (command, args) => {
      if (command === 'ffmpeg') {
        await writeFile(args.at(-1)!, 'rendered');
        return { stdout: '', stderr: '' };
      }
      return {
        stdout: JSON.stringify({
          streams: [{
            codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
            r_frame_rate: '30/1', pix_fmt: 'yuv420p',
          }],
          format: { duration: '1.500' },
        }),
        stderr: '',
      };
    };

    await assert.rejects(
      renderEditPreview({
        plan,
        sources: sources(root),
        outputPath,
        timelinePath,
        runCommand,
        fileOperations: {
          access,
          unlink,
          writeFile,
          rename: async (from, to) => {
            if (to === timelinePath) throw new Error('injected timeline rename failure');
            await rename(from, to);
          },
        },
      }),
      /injected timeline rename failure/,
    );
    await assert.rejects(access(outputPath));
    await assert.rejects(access(timelinePath));
    await assert.rejects(access(`${outputPath}.tmp.mp4`));
    await assert.rejects(access(`${timelinePath}.tmp`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects existing formal outputs before rendering and preserves them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'editing-preview-existing-'));
  try {
    const outputPath = path.join(root, 'preview.mp4');
    const timelinePath = path.join(root, 'timeline.json');
    await writeFile(outputPath, 'existing preview');
    await writeFile(timelinePath, 'existing timeline');
    let commandCalled = false;

    await assert.rejects(
      renderEditPreview({
        plan,
        sources: sources(root),
        outputPath,
        timelinePath,
        runCommand: async () => {
          commandCalled = true;
          return { stdout: '', stderr: '' };
        },
      }),
      /already exists/,
    );
    assert.equal(commandCalled, false);
    assert.equal(await readFile(outputPath, 'utf8'), 'existing preview');
    assert.equal(await readFile(timelinePath, 'utf8'), 'existing timeline');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
