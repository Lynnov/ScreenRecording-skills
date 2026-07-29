import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import { runManualVerifierCli } from '../../src/lib/video-generator/manual/verifiers.js';

test('manual verifier CLI validates guide stage and writes its report', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-product-'));
  const bundle = createManualBundle(runDir);
  await mkdir(bundle.scriptsDir, { recursive: true });
  await writeFile(bundle.originalScriptPath, '# Demo\n');
  const guidePath = bundle.versionedScriptPath('recording-guide', 1);
  await writeFile(guidePath, JSON.stringify({ version: 1, startUrl: 'https://example.test', actions: [{ id: 'a', segmentId: 'segment-001', title: 'Save', instruction: 'Save', expectedEvents: [], expectedResults: [] }] }));
  await writeFile(bundle.approvedGuidePath, JSON.stringify({ version: 1, guideVersion: 1, guidePath, approvedAt: '2026-07-29T00:00:00.000Z' }));
  const stdout: string[] = [];
  assert.equal(await runManualVerifierCli(['--run', runDir, '--stage', 'guide'], { stdout: (line) => stdout.push(line) }), 0);
  assert.match(stdout.join('\n'), /guide verification: OK/);
});
