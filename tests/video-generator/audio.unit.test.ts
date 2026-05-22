import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getAudioDurationMs, mergeAudioSegments } from '../../src/lib/video-generator/audio.js';
import { VideoGeneratorError } from '../../src/lib/video-generator/types.js';

const execFileAsync = promisify(execFile);

test('getAudioDurationMs reads real audio duration with ffprobe', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'video-generator-audio-'));
  const audioPath = path.join(tempDir, 'tone.wav');

  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=1',
      '-y',
      audioPath,
    ]);

    const durationMs = await getAudioDurationMs(audioPath);

    assert.ok(durationMs >= 950, `expected duration >= 950ms, got ${durationMs}`);
    assert.ok(durationMs <= 1050, `expected duration <= 1050ms, got ${durationMs}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('mergeAudioSegments pads each segment to its timeline duration before concat', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'video-generator-audio-padding-'));
  const commands: Array<{ command: string; args: string[] }> = [];

  try {
    const firstAudioPath = path.join(tempDir, 'seg-001.wav');
    const secondAudioPath = path.join(tempDir, 'seg-002.wav');
    const outputPath = path.join(tempDir, 'narration.wav');
    await writeFile(firstAudioPath, 'audio-one');
    await writeFile(secondAudioPath, 'audio-two');

    await mergeAudioSegments({
      audioPaths: [firstAudioPath, secondAudioPath],
      outputPath,
      segments: [
        { id: 'seg-001', startsAtMs: 0, endsAtMs: 1500, actualAudioDurationMs: 1000 },
        { id: 'seg-002', startsAtMs: 1500, endsAtMs: 3500, actualAudioDurationMs: 1200 },
      ],
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return { stdout: '', stderr: '' };
      },
    });

    assert.equal(commands.length, 3);
    assert.deepEqual(commands.map((call) => call.command), ['ffmpeg', 'ffmpeg', 'ffmpeg']);
    assert.ok(commands[0]?.args.includes('anullsrc=r=48000:cl=mono'));
    assert.ok(commands[0]?.args.includes('0.5'));
    assert.ok(commands[1]?.args.includes('anullsrc=r=48000:cl=mono'));
    assert.ok(commands[1]?.args.includes('0.8'));

    const concatListPath = path.join(tempDir, 'narration-concat-list.txt');
    const concatList = await readFile(concatListPath, 'utf8');
    assert.equal(concatList, "file 'seg-001-padded.wav'\nfile 'seg-002-padded.wav'\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('getAudioDurationMs throws VideoGeneratorError when ffprobe command fails', async () => {
  await assert.rejects(
    () => getAudioDurationMs('missing.wav', async () => ({ stdout: '', stderr: 'ffprobe missing' })),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'FFPROBE_FAILED');
      assert.match(error.message, /ffmpeg\/ffprobe/i);
      assert.match(error.message, /install/i);
      return true;
    },
  );
});

test('getAudioDurationMs includes path and ffprobe diagnostics when command throws', async () => {
  const audioPath = 'broken-audio.wav';
  const ffprobeError = new Error('ffprobe exited with code 1') as Error & {
    stdout: string;
    stderr: string;
  };
  ffprobeError.stdout = 'not-a-duration';
  ffprobeError.stderr = 'Invalid data found when processing input';

  await assert.rejects(
    () => getAudioDurationMs(audioPath, async () => {
      throw ffprobeError;
    }),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'FFPROBE_FAILED');
      assert.match(error.message, /broken-audio\.wav/);
      assert.match(error.message, /Invalid data found/);
      assert.match(error.message, /ffprobe exited with code 1/);
      return true;
    },
  );
});
