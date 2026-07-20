import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { normalizeCapturedVideo, parseNormalizedVideoProbe } from '../../src/lib/video-generator/capture/normalize-video.js';

test('normalizes raw capture to 1920x1080 30fps H.264 without audio', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'normalize-capture-'));
  const rawPath = path.join(dir, 'raw-window.webm');
  const finalPath = path.join(dir, 'original-window.mp4');
  const calls: Array<{ command: string; args: string[] }> = [];
  try {
    await writeFile(rawPath, 'raw');
    await normalizeCapturedVideo({
      inputPath: rawPath,
      outputPath: finalPath,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (command === 'ffmpeg' && !args.includes('-version')) {
          await writeFile(`${finalPath}.tmp.mp4`, 'encoded');
        }
        return {
          stdout: command === 'ffprobe'
            ? '{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"r_frame_rate":"30/1","pix_fmt":"yuv420p"}],"format":{"duration":"1"}}'
            : '',
          stderr: '',
        };
      },
    });
    const encodeArgs = calls.find((call) => call.command === 'ffmpeg' && !call.args.includes('-version'))!.args;
    assert.ok(encodeArgs.includes('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p'));
    assert.equal(await readFile(finalPath, 'utf8'), 'encoded');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('removes temporary mp4 and preserves the raw WebM when normalization fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'normalize-failure-'));
  const rawPath = path.join(dir, 'raw-window.webm');
  const finalPath = path.join(dir, 'original-window.mp4');
  try {
    await writeFile(rawPath, 'raw');
    await assert.rejects(() => normalizeCapturedVideo({
      inputPath: rawPath,
      outputPath: finalPath,
      runCommand: async (_command, args) => {
        if (args.includes('-version')) {
          return { stdout: '', stderr: '' };
        }
        throw Object.assign(new Error('ffmpeg failed'), { stderr: 'encoder failure' });
      },
    }), /encoder failure/);
    await assert.rejects(() => access(`${finalPath}.tmp.mp4`));
    await assert.rejects(() => access(finalPath));
    assert.equal(await readFile(rawPath, 'utf8'), 'raw');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects unexpected normalized video probe structures', () => {
  assert.throws(() => parseNormalizedVideoProbe('{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"r_frame_rate":"30/1","pix_fmt":"yuv420p"}],"format":{"duration":"1"}}'), /unexpected/i);
  assert.throws(() => parseNormalizedVideoProbe('{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"r_frame_rate":"30/1","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}],"format":{"duration":"1"}}'), /unexpected/i);
  assert.throws(() => parseNormalizedVideoProbe('{"streams":[{"codec_type":"video","codec_name":"vp9","width":1920,"height":1080,"r_frame_rate":"30/1","pix_fmt":"yuv420p"}],"format":{"duration":"1"}}'), /unexpected/i);
  assert.throws(() => parseNormalizedVideoProbe('{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"r_frame_rate":"30/1","pix_fmt":"yuv444p"}],"format":{"duration":"1"}}'), /unexpected/i);
});
