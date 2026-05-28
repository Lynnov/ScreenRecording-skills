import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadProjectEnv } from '../../src/lib/video-generator/env.js';

test('loadProjectEnv reads simple key values from a project .env file', async () => {
  const projectDir = path.join(tmpdir(), `video-env-${process.pid}-${Date.now()}`);
  await mkdir(projectDir, { recursive: true });

  try {
    await writeFile(path.join(projectDir, '.env'), [
      'DASHSCOPE_API_KEY=test-key',
      'ALIYUN_TTS_VOICE=longwan',
      '',
      '# ignored comment',
    ].join('\n'));

    assert.deepEqual(await loadProjectEnv(projectDir, {}), {
      DASHSCOPE_API_KEY: 'test-key',
      ALIYUN_TTS_VOICE: 'longwan',
    });
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('loadProjectEnv does not override existing process environment values', async () => {
  const projectDir = path.join(tmpdir(), `video-env-existing-${process.pid}-${Date.now()}`);
  await mkdir(projectDir, { recursive: true });

  try {
    await writeFile(path.join(projectDir, '.env'), 'DASHSCOPE_API_KEY=file-key\nALIYUN_TTS_VOICE=file-voice\n');

    assert.deepEqual(await loadProjectEnv(projectDir, { DASHSCOPE_API_KEY: 'existing-key' }), {
      DASHSCOPE_API_KEY: 'existing-key',
      ALIYUN_TTS_VOICE: 'file-voice',
    });
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
