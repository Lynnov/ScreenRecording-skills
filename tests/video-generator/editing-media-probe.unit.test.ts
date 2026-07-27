import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunCommand } from '../../src/lib/video-generator/audio.js';
import { probeEditSource } from '../../src/lib/video-generator/editing/media-probe.js';

test('probes an edit source with the exact ffprobe JSON command and parses video metadata', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand: RunCommand = async (command, args) => {
    calls.push({ command, args });
    return {
      stdout: JSON.stringify({
        streams: [{
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30000/1001',
          pix_fmt: 'yuv420p',
        }],
        format: { duration: '6.000000' },
      }),
      stderr: '',
    };
  };

  const source = await probeEditSource('original', 'C:\\录制 文件\\source.mp4', runCommand);

  assert.deepEqual(calls, [{
    command: 'ffprobe',
    args: [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration',
      '-of',
      'json',
      'C:\\录制 文件\\source.mp4',
    ],
  }]);
  assert.equal(source.id, 'original');
  assert.equal(source.path, 'C:\\录制 文件\\source.mp4');
  assert.equal(source.durationMs, 6000);
  assert.ok(Math.abs(source.fps - 29.97) < 0.001);
  assert.equal(source.hasAudio, false);
  assert.equal(source.codecName, 'h264');
  assert.equal(source.pixelFormat, 'yuv420p');
});

test('reports source path when ffprobe output has no video or invalid duration', async () => {
  const sourcePath = 'C:\\录制 文件\\broken.mp4';
  await assert.rejects(
    probeEditSource('broken', sourcePath, async () => ({
      stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac' }], format: { duration: '1' } }),
      stderr: '',
    })),
    new RegExp(`video.*${sourcePath.replaceAll('\\', '\\\\')}`, 'i'),
  );
  await assert.rejects(
    probeEditSource('broken', sourcePath, async () => ({
      stdout: JSON.stringify({
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 1, height: 1, r_frame_rate: '30/1', pix_fmt: 'yuv420p' }],
        format: { duration: 'not-a-number' },
      }),
      stderr: '',
    })),
    new RegExp(`duration.*${sourcePath.replaceAll('\\', '\\\\')}`, 'i'),
  );
});

test('rejects coercible non-numeric metadata and invalid dimensions', async () => {
  const sourcePath = 'C:\\录制 文件\\coercion.mp4';
  const values: unknown[] = [null, '', '   ', true];
  for (const duration of values) {
    await assert.rejects(
      probeEditSource('broken', sourcePath, async () => ({
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', pix_fmt: 'yuv420p' }],
          format: { duration },
        }),
        stderr: '',
      })),
      /duration.*coercion\.mp4/i,
    );
  }
  for (const field of ['width', 'height'] as const) {
    for (const value of values) {
      await assert.rejects(
        probeEditSource('broken', sourcePath, async () => ({
          stdout: JSON.stringify({
            streams: [{
              codec_type: 'video',
              codec_name: 'h264',
              width: field === 'width' ? value : 1920,
              height: field === 'height' ? value : 1080,
              r_frame_rate: '30/1',
              pix_fmt: 'yuv420p',
            }],
            format: { duration: '1' },
          }),
          stderr: '',
        })),
        /metadata.*coercion\.mp4/i,
      );
    }
  }
});

test('includes source path and command diagnostics when ffprobe throws', async () => {
  const sourcePath = 'C:\\录制 文件\\missing.mp4';
  await assert.rejects(
    probeEditSource('missing', sourcePath, async () => {
      throw Object.assign(new Error('spawn ENOENT'), { stderr: 'ffprobe missing' });
    }),
    (error: unknown) => {
      assert.match(String(error), /C:\\录制 文件\\missing\.mp4/);
      assert.match(String(error), /spawn ENOENT/);
      assert.match(String(error), /ffprobe missing/);
      return true;
    },
  );
});
