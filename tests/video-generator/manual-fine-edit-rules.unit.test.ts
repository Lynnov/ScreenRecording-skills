import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadFineEditRules,
  validateFineEditRules,
} from '../../src/lib/video-generator/manual/fine-edit-rules.js';

test('loads fixed fine-edit product rules and bounded soft defaults', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fine-edit-rules-'));
  const loaded = await loadFineEditRules({ runDir: path.join(root, 'run') });

  assert.equal(loaded.rules.hard.shortWaitMaxMs, 1000);
  assert.equal(loaded.rules.hard.mistakeWaitMaxMs, 3000);
  assert.equal(loaded.rules.hard.mistakeWaitPlaybackRate, 5);
  assert.equal(loaded.rules.hard.normalIdleMaxPlaybackRate, 2);
  assert.equal(loaded.rules.soft.narrationTailMs, 1000);
  assert.equal(loaded.rules.soft.resultReactionMs, 1000);
  assert.equal(loaded.rules.soft.maxSilentTailMs, 2000);
  assert.equal(loaded.source, 'default');
});
test('rejects learned rules that change hard product rules', () => {
  const invalid = {
    version: 1,
    hard: {
      keepRequiredEvents: true,
      shortWaitMaxMs: 1000,
      mistakeWaitMaxMs: 3000,
      mistakeWaitPlaybackRate: 4,
      normalIdleMaxPlaybackRate: 2,
    },
    soft: {
      actionPreRollMs: 500,
      actionPostRollMs: 500,
      narrationTailMs: 1000,
      resultReactionMs: 1000,
      maxSilentTailMs: 2000,
      fadeMs: 120,
      whiteFrameRatio: 0.92,
    },
    evolution: { enabled: true, maxAdjustmentRatio: 0.1, promoteOnlyPassed: true },
  };

  assert.throws(() => validateFineEditRules(invalid), /mistakeWaitPlaybackRate/);
});

test('falls back to defaults when learned profile is malformed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fine-edit-rules-fallback-'));
  const runDir = path.join(root, 'run');
  const learningDir = path.join(root, '.manual-fine-edit-learning');
  await mkdir(learningDir, { recursive: true });
  await writeFile(path.join(learningDir, 'profile.v01.json'), '{"version":1,"soft":{"resultReactionMs":99999}}\n');
  await writeFile(path.join(learningDir, 'current.json'), `${JSON.stringify({ version: 1, path: path.join(learningDir, 'profile.v01.json') })}\n`);

  const loaded = await loadFineEditRules({ runDir });

  assert.equal(loaded.source, 'default');
  assert.equal(loaded.rules.soft.resultReactionMs, 1000);
  assert.match(loaded.diagnostics.join('\n'), /learned profile/i);
});
