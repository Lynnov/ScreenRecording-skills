import { writeFile } from 'node:fs/promises';

import { getAudioDurationMs } from '../audio.js';
import { VideoGeneratorError } from '../types.js';
import type { TtsProvider, TtsRequest } from './types.js';

const cosyVoiceEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const supportedSampleRates = new Set([8000, 16000, 22050, 24000, 44100, 48000]);

interface AliyunTtsDeps {
  fetch?: typeof fetch;
  getAudioDurationMs?: typeof getAudioDurationMs;
}

interface CosyVoiceResponse {
  output?: {
    audio?: {
      url?: string;
    };
  };
}

type CosyVoiceInput = Record<string, string | number | boolean | string[]>;

export function createAliyunTtsProvider(env: NodeJS.ProcessEnv, deps: AliyunTtsDeps = {}): TtsProvider {
  if (!env.DASHSCOPE_API_KEY) {
    throw new VideoGeneratorError('MISSING_TTS_CONFIG', 'Missing required Aliyun TTS environment variable: DASHSCOPE_API_KEY');
  }

  validateCosyVoiceEnv(env);

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const getDuration = deps.getAudioDurationMs ?? getAudioDurationMs;

  return {
    async synthesize(request) {
      const audioUrl = await synthesizeCosyVoice({ env, fetchImpl, request });
      const audioBytes = await downloadCosyVoiceAudio({ fetchImpl, audioUrl, segmentId: request.segmentId });

      await writeFile(request.outputPath, Buffer.from(audioBytes));

      return {
        segmentId: request.segmentId,
        audioPath: request.outputPath,
        durationMs: await getDuration(request.outputPath),
      };
    },
  };
}

async function synthesizeCosyVoice(input: {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  request: TtsRequest;
}): Promise<string> {
  const response = await wrapNetworkFailure(
    () => input.fetchImpl(cosyVoiceEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.env.DASHSCOPE_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildCosyVoiceBody(input.env, input.request.text)),
    }),
    'CosyVoice synthesis request failed',
    input.request.segmentId,
  );
  const body = await response.text();

  if (!response.ok) {
    throw new VideoGeneratorError(
      'TTS_SYNTHESIS_FAILED',
      `CosyVoice synthesis request failed (${response.status} ${response.statusText}): ${body}`,
      input.request.segmentId,
    );
  }

  let payload: CosyVoiceResponse;
  try {
    payload = JSON.parse(body) as CosyVoiceResponse;
  } catch {
    throw new VideoGeneratorError(
      'TTS_SYNTHESIS_FAILED',
      `CosyVoice synthesis response was not valid JSON: ${body}`,
      input.request.segmentId,
    );
  }

  const audioUrl = payload.output?.audio?.url;
  if (!audioUrl) {
    throw new VideoGeneratorError(
      'TTS_SYNTHESIS_FAILED',
      `CosyVoice synthesis response did not include an audio URL: ${body}`,
      input.request.segmentId,
    );
  }

  return audioUrl;
}

async function downloadCosyVoiceAudio(input: {
  fetchImpl: typeof fetch;
  audioUrl: string;
  segmentId: string;
}): Promise<ArrayBuffer> {
  const response = await wrapNetworkFailure(
    () => input.fetchImpl(input.audioUrl),
    'CosyVoice audio download failed',
    input.segmentId,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new VideoGeneratorError(
      'TTS_SYNTHESIS_FAILED',
      `CosyVoice audio download failed (${response.status} ${response.statusText}): ${body}`,
      input.segmentId,
    );
  }

  return response.arrayBuffer();
}

function buildCosyVoiceBody(env: NodeJS.ProcessEnv, text: string): { model: string; input: CosyVoiceInput } {
  const input: CosyVoiceInput = {
    text,
    voice: env.ALIYUN_TTS_VOICE || 'longanyang',
    format: env.ALIYUN_TTS_FORMAT || 'wav',
    sample_rate: parseOptionalNumber(env.ALIYUN_TTS_SAMPLE_RATE) ?? 24000,
  };

  addOptionalNumber(input, 'volume', env.ALIYUN_TTS_VOLUME);
  addOptionalNumber(input, 'rate', env.ALIYUN_TTS_RATE);
  addOptionalNumber(input, 'pitch', env.ALIYUN_TTS_PITCH);
  addOptionalBoolean(input, 'enable_ssml', env.ALIYUN_TTS_ENABLE_SSML);

  if (env.ALIYUN_TTS_LANGUAGE_HINT) {
    input.language_hints = [env.ALIYUN_TTS_LANGUAGE_HINT];
  }

  return {
    model: env.ALIYUN_TTS_MODEL || 'cosyvoice-v3-flash',
    input,
  };
}

function addOptionalNumber(input: CosyVoiceInput, key: string, value: string | undefined): void {
  const parsed = parseOptionalNumber(value);
  if (parsed !== undefined) {
    input[key] = parsed;
  }
}

function addOptionalBoolean(input: CosyVoiceInput, key: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }

  input[key] = value === 'true';
}

function validateCosyVoiceEnv(env: NodeJS.ProcessEnv): void {
  validateOptionalNumber(env, 'ALIYUN_TTS_SAMPLE_RATE', (value) => Number.isInteger(value) && supportedSampleRates.has(value), 'one of 8000, 16000, 22050, 24000, 44100, 48000');
  validateOptionalNumber(env, 'ALIYUN_TTS_VOLUME', (value) => Number.isInteger(value) && value >= 0 && value <= 100, 'an integer between 0 and 100');
  validateOptionalNumber(env, 'ALIYUN_TTS_RATE', (value) => value >= 0.5 && value <= 2, 'between 0.5 and 2.0');
  validateOptionalNumber(env, 'ALIYUN_TTS_PITCH', (value) => value >= 0.5 && value <= 2, 'between 0.5 and 2.0');

  if (env.ALIYUN_TTS_ENABLE_SSML !== undefined && env.ALIYUN_TTS_ENABLE_SSML !== 'true' && env.ALIYUN_TTS_ENABLE_SSML !== 'false') {
    throw new VideoGeneratorError(
      'MISSING_TTS_CONFIG',
      `Invalid Aliyun TTS environment variable ALIYUN_TTS_ENABLE_SSML: expected true or false, got ${env.ALIYUN_TTS_ENABLE_SSML}`,
    );
  }
}

function validateOptionalNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  isValid: (value: number) => boolean,
  expected: string,
): void {
  const rawValue = env[key];
  if (!rawValue) {
    return;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !isValid(parsed)) {
    throw new VideoGeneratorError(
      'MISSING_TTS_CONFIG',
      `Invalid Aliyun TTS environment variable ${key}: expected ${expected}, got ${rawValue}`,
    );
  }
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function wrapNetworkFailure<T>(operation: () => Promise<T>, messagePrefix: string, segmentId: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VideoGeneratorError) {
      throw error;
    }

    throw new VideoGeneratorError('TTS_SYNTHESIS_FAILED', `${messagePrefix}: ${formatUnknownError(error)}`, segmentId);
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
