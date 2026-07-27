import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { probeEditSource } from '../../src/lib/video-generator/editing/media-probe.js';
import { renderEditPreview } from '../../src/lib/video-generator/editing/preview.js';
import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';

const execFileAsync = promisify(execFile);

async function command(commandName: string, args: string[]) {
  return execFileAsync(commandName, args, { maxBuffer: 20 * 1024 * 1024 });
}

async function binaryCommand(commandName: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(commandName, args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout as Buffer);
    });
  });
}

async function generateFixtures(originalPath: string, pickupPath: string): Promise<void> {
  const videoArgs = ['-hide_banner', '-loglevel', 'error', '-y'];
  await command('ffmpeg', [
    ...videoArgs,
    '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=30:d=2',
    '-f', 'lavfi', '-i', 'color=c=green:s=1920x1080:r=30:d=2',
    '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=30:d=2',
    '-filter_complex',
    '[1:v]drawbox=x=20:y=20:w=100:h=100:color=white:t=fill:enable=lt(t\\,1),'
    + 'drawbox=x=20:y=20:w=100:h=100:color=black:t=fill:enable=gte(t\\,1)[green];'
    + '[0:v][green][2:v]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an', originalPath,
  ]);
  await command('ffmpeg', [
    ...videoArgs,
    '-f', 'lavfi', '-i',
    'color=c=yellow:s=1920x1080:r=30:d=2,'
    + 'drawbox=x=1800:y=20:w=100:h=100:color=white:t=fill:enable=lt(t\\,0.9),'
    + 'drawbox=x=1800:y=20:w=100:h=100:color=black:t=fill:enable=between(t\\,0.9\\,1.4),'
    + 'drawbox=x=1800:y=20:w=100:h=100:color=magenta:t=fill:enable=gte(t\\,1.4)',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an', pickupPath,
  ]);
}

async function sampleRgb(
  videoPath: string,
  seconds: number,
  x = 960,
  y = 540,
): Promise<[number, number, number]> {
  const frame = await binaryCommand('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-ss', seconds.toFixed(3), '-i', videoPath,
    '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
  ]);
  assert.equal(frame.length, 3, `expected one RGB pixel at ${seconds}s`);
  return [frame[0]!, frame[1]!, frame[2]!];
}

function brightness([red, green, blue]: [number, number, number]): number {
  return red + green + blue;
}

async function frameMd5(videoPath: string, seconds: number): Promise<string> {
  const result = await command('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-ss', seconds.toFixed(3), '-i', videoPath,
    '-frames:v', '1', '-f', 'framemd5', '-',
  ]);
  return result.stdout.split(/\r?\n/).find((line) => /^\d/.test(line))!.split(',').at(-1)!.trim();
}

test('renders deterministic multi-source preview with trim, speed, hold and non-overlap fades', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'editing-preview-poc-'));
  let succeeded = false;
  try {
    const originalPath = path.join(root, 'original.mp4');
    const pickupPath = path.join(root, 'pickup.mp4');
    const previewPath = path.join(root, 'edit', 'preview.mp4');
    const timelinePath = path.join(root, 'edit', 'preview-timeline.json');
    const plan: EditPlan = {
      version: 1,
      canvas: { width: 1920, height: 1080, fps: 30 },
      segments: [
        {
          segmentId: 'segment-red', title: 'red',
          clips: [{ sourceId: 'original', sourceStartMs: 500, sourceEndMs: 1500, playbackRate: 1 }],
          transition: 'short-fade', confidence: 'high', reason: 'fixture',
        },
        {
          segmentId: 'segment-green-pickup', title: 'green and pickup',
          clips: [
            { sourceId: 'original', sourceStartMs: 2000, sourceEndMs: 4000, playbackRate: 2 },
            { sourceId: 'pickup-001', sourceStartMs: 500, sourceEndMs: 1500, playbackRate: 1 },
          ],
          holdLastFrameMs: 500, transition: 'short-fade', confidence: 'high', reason: 'fixture',
        },
        {
          segmentId: 'segment-blue', title: 'blue',
          clips: [{ sourceId: 'original', sourceStartMs: 4000, sourceEndMs: 5000, playbackRate: 1 }],
          confidence: 'high', reason: 'fixture',
        },
      ],
    };
    const planPath = path.join(root, 'edit-plan.json');
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    assert.deepEqual(JSON.parse(await readFile(planPath, 'utf8')), plan);

    await generateFixtures(originalPath, pickupPath);
    const sources = await Promise.all([
      probeEditSource('original', originalPath),
      probeEditSource('pickup-001', pickupPath),
    ]);

    const rendered = await renderEditPreview({
      plan, sources, outputPath: previewPath, timelinePath,
    });
    assert.equal(rendered.durationMs, 4500);
    assert.equal(JSON.parse(await readFile(timelinePath, 'utf8')).durationMs, 4500);

    const probe = JSON.parse((await command('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration',
      '-of', 'json', previewPath,
    ])).stdout);
    const videos = probe.streams.filter((stream: { codec_type: string }) => stream.codec_type === 'video');
    assert.equal(videos.length, 1);
    assert.equal(probe.streams.filter((stream: { codec_type: string }) => stream.codec_type === 'audio').length, 0);
    assert.deepEqual(
      { codec: videos[0].codec_name, width: videos[0].width, height: videos[0].height, rate: videos[0].r_frame_rate, pixel: videos[0].pix_fmt },
      { codec: 'h264', width: 1920, height: 1080, rate: '30/1', pixel: 'yuv420p' },
    );
    assert.ok(Math.abs(Number(probe.format.duration) - 4.5) <= 1 / 30);

    const decoded = await command('ffmpeg', ['-v', 'error', '-i', previewPath, '-f', 'null', '-']);
    assert.doesNotMatch(decoded.stderr, /non-monotonous DTS|invalid timestamp|decode error/i);

    const interiors = await Promise.all([0.5, 1.5, 2.5, 4].map((time) => sampleRgb(previewPath, time)));
    assert.ok(interiors[0]![0] > interiors[0]![1] * 2 && interiors[0]![0] > interiors[0]![2] * 2);
    assert.ok(interiors[1]![1] > interiors[1]![0] * 2 && interiors[1]![1] > interiors[1]![2] * 2);
    assert.ok(interiors[2]![0] > 150 && interiors[2]![1] > 150 && interiors[2]![2] < 50);
    assert.ok(interiors[3]![2] > interiors[3]![0] * 2 && interiors[3]![2] > interiors[3]![1] * 2);

    const greenSourceEarly = await sampleRgb(originalPath, 2.5, 50, 50);
    const greenSourceLate = await sampleRgb(originalPath, 3.5, 50, 50);
    const greenPreviewEarly = await sampleRgb(previewPath, 1.25, 50, 50);
    const greenPreviewLate = await sampleRgb(previewPath, 1.75, 50, 50);
    assert.ok(brightness(greenSourceEarly) > brightness(greenSourceLate) + 300);
    assert.ok(brightness(greenPreviewEarly) > brightness(greenPreviewLate) + 300);
    assert.ok(Math.abs(brightness(greenPreviewEarly) - brightness(greenSourceEarly)) < 60);
    assert.ok(Math.abs(brightness(greenPreviewLate) - brightness(greenSourceLate)) < 60);

    const pickupPlayingEarly = await sampleRgb(previewPath, 2.1, 1850, 50);
    const pickupPlayingLate = await sampleRgb(previewPath, 2.7, 1850, 50);
    assert.notDeepEqual(pickupPlayingEarly, pickupPlayingLate);
    assert.equal(await frameMd5(previewPath, 3.05), await frameMd5(previewPath, 3.30));
    const pickupSelectedLastFrame = await sampleRgb(pickupPath, 1.49, 1850, 50);
    const heldEarly = await sampleRgb(previewPath, 3.05, 1850, 50);
    const heldLate = await sampleRgb(previewPath, 3.30, 1850, 50);
    for (const held of [heldEarly, heldLate]) {
      held.forEach((channel, index) => {
        assert.ok(Math.abs(channel - pickupSelectedLastFrame[index]!) <= 20);
      });
    }

    const boundaries = await Promise.all([0.95, 1.05, 3.45, 3.55].map((time) => sampleRgb(previewPath, time)));
    assert.ok(brightness(boundaries[0]!) < brightness(interiors[0]!) * 0.75);
    assert.ok(brightness(boundaries[1]!) < brightness(interiors[1]!) * 0.75);
    assert.ok(brightness(boundaries[2]!) < brightness(interiors[2]!) * 0.75);
    assert.ok(brightness(boundaries[3]!) < brightness(interiors[3]!) * 0.75);
    succeeded = true;
  } catch (error) {
    const diagnostics = error instanceof Error
      ? `${error.stack ?? error.message}\nCAUSE: ${String(error.cause ?? '')}\n`
      : String(error);
    const diagnosticsPath = path.join(root, 'edit', 'error.stderr.txt');
    await mkdir(path.dirname(diagnosticsPath), { recursive: true });
    await writeFile(diagnosticsPath, diagnostics, 'utf8');
    console.error(`Editing preview POC failed; fixtures and diagnostics retained at ${root}`);
    throw error;
  } finally {
    if (succeeded) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
