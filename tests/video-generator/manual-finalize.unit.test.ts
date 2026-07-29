import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { finalizeManualRecording } from '../../src/lib/video-generator/manual/final-report.js';
import { createReadyRun } from './manual-finalize-fixture.js';

test('finalize without DASHSCOPE_API_KEY writes failure report and no fake final', async () => {
  const runDir = await createReadyRun();
  const bundle = createManualBundle(runDir);
  const report = await finalizeManualRecording({ runDir, env: {} });
  assert.equal(report.ok, false);
  assert.match(report.errorMessage ?? '', /DASHSCOPE_API_KEY/);
  await assert.rejects(access(bundle.finalVideoPath));
  const written = JSON.parse(await readFile(bundle.reportPath('final-verification'), 'utf8')) as Record<string, unknown>;
  assert.equal(written.ok, false);
  assert.equal(JSON.stringify(written).includes('test-key'), false);
});
