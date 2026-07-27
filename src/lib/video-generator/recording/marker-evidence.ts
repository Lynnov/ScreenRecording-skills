import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ClockMarkerType = 'recording-start' | 'retry-start' | 'recording-stop';

export interface ClockMarkerInput {
  type: ClockMarkerType;
  videoTimeMs: number | null;
}

export interface MarkerFrameSample {
  frameOffset: -1 | 0 | 1;
  atMs: number;
  framePath: string;
  rgb: [number, number, number] | null;
  matched: boolean;
  error: string | null;
}

export interface MarkerEvidence {
  type: ClockMarkerType;
  videoTimeMs: number | null;
  passed: boolean;
  matchedFrameOffset: -1 | 0 | 1 | null;
  samples: MarkerFrameSample[];
  errors: string[];
}

export type RunMarkerCommand = (
  command: string,
  args: string[],
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

const EXPECTED_CHANNEL: Record<ClockMarkerType, 0 | 1 | 2> = {
  'recording-start': 0,
  'retry-start': 1,
  'recording-stop': 2,
};

export async function collectMarkerEvidence(input: {
  videoPath: string;
  outputDir: string;
  fps: number;
  markers: ClockMarkerInput[];
  runCommand: RunMarkerCommand;
  markerCenter?: { x: number; y: number };
}): Promise<MarkerEvidence[]> {
  await mkdir(input.outputDir, { recursive: true });
  const center = input.markerCenter ?? { x: 120, y: 120 };
  const frameDurationMs = 1000 / input.fps;
  const evidence: MarkerEvidence[] = [];

  for (const marker of input.markers) {
    if (marker.videoTimeMs === null || !Number.isFinite(marker.videoTimeMs)) {
      evidence.push({
        type: marker.type,
        videoTimeMs: marker.videoTimeMs,
        passed: false,
        matchedFrameOffset: null,
        samples: [],
        errors: [`${marker.type} marker timestamp is missing.`],
      });
      continue;
    }

    const samples: MarkerFrameSample[] = [];
    const errors: string[] = [];
    for (const frameOffset of [-1, 0, 1] as const) {
      const atMs = Math.max(0, marker.videoTimeMs + frameOffset * frameDurationMs);
      const timestamp = (atMs / 1000).toFixed(3);
      const suffix = frameOffset === -1 ? 'minus-1' : frameOffset === 0 ? 'exact' : 'plus-1';
      const framePath = path.join(input.outputDir, `${marker.type}-${suffix}.png`);
      try {
        await input.runCommand('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-ss', timestamp, '-i', input.videoPath,
          '-frames:v', '1', framePath,
        ]);
        const pixel = await input.runCommand('ffmpeg', [
          '-hide_banner', '-loglevel', 'error',
          '-ss', timestamp, '-i', input.videoPath,
          '-frames:v', '1',
          '-vf', `crop=1:1:${center.x}:${center.y}`,
          '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
        ]);
        if (pixel.stdout.length !== 3) {
          throw new Error(`Expected 3 RGB bytes, received ${pixel.stdout.length}.`);
        }
        const rgb: [number, number, number] = [
          pixel.stdout[0]!,
          pixel.stdout[1]!,
          pixel.stdout[2]!,
        ];
        samples.push({
          frameOffset,
          atMs,
          framePath,
          rgb,
          matched: matchesMarkerColor(marker.type, rgb),
          error: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${marker.type} ${suffix}: ${message}`);
        samples.push({
          frameOffset,
          atMs,
          framePath,
          rgb: null,
          matched: false,
          error: message,
        });
      }
    }

    const matched = samples.find((sample) => sample.matched);
    if (matched === undefined && errors.length === 0) {
      errors.push(`${marker.type} marker color was not found within one frame.`);
    }
    const item: MarkerEvidence = {
      type: marker.type,
      videoTimeMs: marker.videoTimeMs,
      passed: matched !== undefined,
      matchedFrameOffset: matched?.frameOffset ?? null,
      samples,
      errors,
    };
    await writeFile(
      path.join(input.outputDir, `${marker.type}.json`),
      `${JSON.stringify(item, null, 2)}\n`,
      'utf8',
    );
    evidence.push(item);
  }

  return evidence;
}

function matchesMarkerColor(type: ClockMarkerType, rgb: [number, number, number]): boolean {
  const dominant = EXPECTED_CHANNEL[type];
  return rgb[dominant] >= 180
    && rgb.every((channel, index) => index === dominant || channel <= 80);
}
