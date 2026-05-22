import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadVideoGeneratorConfig } from '../lib/video-generator/config.js';
import { runVideoGenerator, type RunVideoGeneratorInput } from '../lib/video-generator/pipeline.js';
import { createAliyunTtsProvider } from '../lib/video-generator/tts/aliyun.js';
import type { TtsProvider } from '../lib/video-generator/tts/types.js';
import type { RunReport } from '../lib/video-generator/types.js';

export interface VideoGeneratorCliIo {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  runVideoGenerator?: (input: RunVideoGeneratorInput) => Promise<RunReport>;
  createTtsProvider?: (env: NodeJS.ProcessEnv) => TtsProvider;
}

interface ParsedArgs {
  scriptPath?: string;
  outputDir?: string;
  ttsSmokeText?: string;
  error?: string;
}

export async function runVideoGeneratorCli(argv: string[], io: VideoGeneratorCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const env = io.env ?? process.env;
  const parsed = parseArgs(argv);

  if (parsed.error !== undefined) {
    stderr(`${parsed.error}\n${usage()}`);
    return 1;
  }

  if (parsed.ttsSmokeText !== undefined) {
    return runTtsSmoke(parsed, { stdout, stderr, env, createTtsProvider: io.createTtsProvider ?? createAliyunTtsProvider });
  }

  if (parsed.scriptPath === undefined) {
    stderr(usage());
    return 1;
  }

  let report: RunReport;
  try {
    report = await (io.runVideoGenerator ?? runVideoGenerator)({
      scriptPath: parsed.scriptPath,
      configOverrides: parsed.outputDir === undefined ? undefined : { outputDir: parsed.outputDir },
    });
  } catch (error) {
    stderr(`Video generation failed.\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (!report.ok) {
    stderr(formatFailure(report));
    return 1;
  }

  stdout(`Video generated: ${report.finalVideoPath ?? report.outputDir}`);
  return 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--script') {
      const value = readFlagValue(argv, index, '--script');
      if (value.error !== undefined) {
        return { error: value.error };
      }
      parsed.scriptPath = value.value;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const value = readFlagValue(argv, index, '--output');
      if (value.error !== undefined) {
        return { error: value.error };
      }
      parsed.outputDir = value.value;
      index += 1;
      continue;
    }
    if (arg === '--tts-smoke') {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        parsed.ttsSmokeText = next;
        index += 1;
      } else {
        parsed.ttsSmokeText = '你好，这是一次语音合成测试。';
      }
      continue;
    }

    return { error: `Unknown argument: ${arg}` };
  }

  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): { value: string; error?: undefined } | { value?: undefined; error: string } {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return { error: `${flag} requires a value` };
  }

  return { value };
}

async function runTtsSmoke(parsed: ParsedArgs, input: {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  env: NodeJS.ProcessEnv;
  createTtsProvider: (env: NodeJS.ProcessEnv) => TtsProvider;
}): Promise<number> {
  const config = loadVideoGeneratorConfig(parsed.outputDir === undefined ? undefined : { outputDir: parsed.outputDir });
  const outputPath = path.join(config.outputDir, 'tts-smoke.wav');

  try {
    await mkdir(config.outputDir, { recursive: true });
    const provider = input.createTtsProvider(input.env);
    const result = await provider.synthesize({
      segmentId: 'tts-smoke',
      text: parsed.ttsSmokeText ?? '你好，这是一次语音合成测试。',
      outputPath,
    });
    input.stdout(`TTS smoke audio: ${result.audioPath}`);
    return 0;
  } catch (error) {
    input.stderr(`TTS smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function formatFailure(report: RunReport): string {
  return [
    'Video generation failed.',
    report.failedSegmentId === undefined ? undefined : `Segment: ${report.failedSegmentId}`,
    report.errorMessage,
    report.screenshotPath === undefined ? undefined : `Screenshot: ${report.screenshotPath}`,
  ].filter((part): part is string => part !== undefined && part.length > 0).join('\n');
}

function usage(): string {
  return [
    'Usage:',
    '  npm run video:generate -- --script <script.md> [--output <output-dir>]',
    '  npm run video:tts-smoke -- [text] [--output <output-dir>]',
  ].join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const exitCode = await runVideoGeneratorCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
