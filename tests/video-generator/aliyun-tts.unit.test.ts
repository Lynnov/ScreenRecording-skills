import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createAliyunTtsProvider } from '../../src/lib/video-generator/tts/aliyun.js';
import { VideoGeneratorError } from '../../src/lib/video-generator/types.js';

const validEnv: NodeJS.ProcessEnv = {
  DASHSCOPE_API_KEY: 'test-dashscope-api-key',
};

test('createAliyunTtsProvider rejects missing DashScope API key before synthesis', () => {
  assert.throws(
    () => createAliyunTtsProvider({}),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'MISSING_TTS_CONFIG');
      assert.match(error.message, /DASHSCOPE_API_KEY/);
      return true;
    },
  );
});

test('createAliyunTtsProvider synthesizes CosyVoice speech, downloads audio, writes file, and returns duration', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'cosyvoice-tts-'));
  const outputPath = join(tempDir, 'segment-1.wav');
  const audioBytes = new Uint8Array([82, 73, 70, 70]);
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });

    if (String(input) === 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer') {
      return new Response(JSON.stringify({
        request_id: 'request-1',
        output: {
          finish_reason: 'stop',
          audio: {
            data: '',
            url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav',
            id: 'audio_request-1',
            expires_at: 1772697707,
          },
        },
        usage: { characters: 2 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(audioBytes, {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    });
  };

  try {
    const provider = createAliyunTtsProvider(validEnv, {
      fetch: fakeFetch,
      getAudioDurationMs: async (audioPath) => {
        assert.equal(audioPath, outputPath);
        return 1234;
      },
    });

    const result = await provider.synthesize({
      segmentId: 'segment-1',
      text: '你好',
      outputPath,
    });

    assert.equal(result.segmentId, 'segment-1');
    assert.equal(result.audioPath, outputPath);
    assert.equal(result.durationMs, 1234);
    assert.deepEqual(await readFile(outputPath), Buffer.from(audioBytes));

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    assert.equal(requests[0]?.init?.method, 'POST');
    assert.deepEqual(requests[0]?.init?.headers, {
      Authorization: 'Bearer test-dashscope-api-key',
      'Content-Type': 'application/json',
    });
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      model: 'cosyvoice-v3-flash',
      input: {
        text: '你好',
        voice: 'longanyang',
        format: 'wav',
        sample_rate: 24000,
      },
    });
    assert.equal(requests[1]?.url, 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('createAliyunTtsProvider maps optional CosyVoice environment variables into request input', async () => {
  let requestBody: unknown;
  const provider = createAliyunTtsProvider({
    DASHSCOPE_API_KEY: 'test-dashscope-api-key',
    ALIYUN_TTS_MODEL: 'cosyvoice-v3.5-flash',
    ALIYUN_TTS_VOICE: 'longxiaochun',
    ALIYUN_TTS_FORMAT: 'mp3',
    ALIYUN_TTS_SAMPLE_RATE: '48000',
    ALIYUN_TTS_VOLUME: '80',
    ALIYUN_TTS_RATE: '1.2',
    ALIYUN_TTS_PITCH: '0.8',
    ALIYUN_TTS_LANGUAGE_HINT: 'zh',
    ALIYUN_TTS_ENABLE_SSML: 'true',
  }, {
    fetch: async (input, init) => {
      if (String(input).includes('SpeechSynthesizer')) {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: { audio: { url: 'https://example.com/audio.mp3' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    },
    getAudioDurationMs: async () => 1,
  });

  const tempDir = await mkdtemp(join(tmpdir(), 'cosyvoice-tts-options-'));
  try {
    await provider.synthesize({ segmentId: 'segment-options', text: '<speak>你好</speak>', outputPath: join(tempDir, 'out.mp3') });

    assert.deepEqual(requestBody, {
      model: 'cosyvoice-v3.5-flash',
      input: {
        text: '<speak>你好</speak>',
        voice: 'longxiaochun',
        format: 'mp3',
        sample_rate: 48000,
        volume: 80,
        rate: 1.2,
        pitch: 0.8,
        enable_ssml: true,
        language_hints: ['zh'],
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('createAliyunTtsProvider rejects invalid CosyVoice numeric environment variables', () => {
  for (const key of [
    'ALIYUN_TTS_SAMPLE_RATE',
    'ALIYUN_TTS_VOLUME',
    'ALIYUN_TTS_RATE',
    'ALIYUN_TTS_PITCH',
  ] as const) {
    assert.throws(
      () => createAliyunTtsProvider({ ...validEnv, [key]: 'not-a-number' }),
      (error) => {
        assert.ok(error instanceof VideoGeneratorError);
        assert.equal(error.code, 'MISSING_TTS_CONFIG');
        assert.match(error.message, new RegExp(key));
        return true;
      },
    );
  }
});

test('createAliyunTtsProvider rejects out-of-range CosyVoice environment variables', () => {
  const invalidValues = {
    ALIYUN_TTS_SAMPLE_RATE: '12345',
    ALIYUN_TTS_VOLUME: '101',
    ALIYUN_TTS_RATE: '0.49',
    ALIYUN_TTS_PITCH: '2.01',
  } as const;

  for (const [key, value] of Object.entries(invalidValues)) {
    assert.throws(
      () => createAliyunTtsProvider({ ...validEnv, [key]: value }),
      (error) => {
        assert.ok(error instanceof VideoGeneratorError);
        assert.equal(error.code, 'MISSING_TTS_CONFIG');
        assert.match(error.message, new RegExp(key));
        return true;
      },
    );
  }
});

test('createAliyunTtsProvider reports CosyVoice synthesis HTTP errors with response body', async () => {
  const provider = createAliyunTtsProvider(validEnv, {
    fetch: async () => new Response(JSON.stringify({ code: 'InvalidApiKey', message: 'invalid api key' }), { status: 401 }),
    getAudioDurationMs: async () => 0,
  });

  await assert.rejects(
    () => provider.synthesize({ segmentId: 'segment-1', text: '你好', outputPath: 'segment-1.wav' }),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'TTS_SYNTHESIS_FAILED');
      assert.match(error.message, /CosyVoice synthesis request failed/);
      assert.match(error.message, /401/);
      assert.match(error.message, /InvalidApiKey/);
      assert.equal(error.segmentId, 'segment-1');
      return true;
    },
  );
});

test('createAliyunTtsProvider reports missing CosyVoice audio URL clearly', async () => {
  const provider = createAliyunTtsProvider(validEnv, {
    fetch: async () => new Response(JSON.stringify({ output: { audio: {} } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    getAudioDurationMs: async () => 0,
  });

  await assert.rejects(
    () => provider.synthesize({ segmentId: 'segment-1', text: '你好', outputPath: 'segment-1.wav' }),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'TTS_SYNTHESIS_FAILED');
      assert.match(error.message, /audio URL/);
      assert.equal(error.segmentId, 'segment-1');
      return true;
    },
  );
});

test('createAliyunTtsProvider wraps audio download failures with segment id', async () => {
  const provider = createAliyunTtsProvider(validEnv, {
    fetch: async (input) => {
      if (String(input).includes('SpeechSynthesizer')) {
        return new Response(JSON.stringify({ output: { audio: { url: 'https://example.com/missing.wav' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error('download timed out');
    },
    getAudioDurationMs: async () => 0,
  });

  await assert.rejects(
    () => provider.synthesize({ segmentId: 'segment-download', text: '你好', outputPath: 'segment-download.wav' }),
    (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'TTS_SYNTHESIS_FAILED');
      assert.match(error.message, /CosyVoice audio download failed/);
      assert.match(error.message, /download timed out/);
      assert.equal(error.segmentId, 'segment-download');
      return true;
    },
  );
});
