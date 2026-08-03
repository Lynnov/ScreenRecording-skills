import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runManualReviewCli } from '../../src/cli/manual-review.js';
import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';

test('review UI contains three-pane layout and review controls', async () => {
  const html = await readFile(path.resolve('src/lib/video-generator/review-ui/review.html'), 'utf8');
  const css = await readFile(path.resolve('src/lib/video-generator/review-ui/review.css'), 'utf8');
  const renderer = await readFile(path.resolve('src/lib/video-generator/review-ui/renderer.ts'), 'utf8');

  for (const id of ['segment-list', 'preview-pane', 'decision-pane', 'agent-reason', 'boundary-start', 'boundary-end', 'source-select', 'wait-strategy', 'preview-error', 'save-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const status of ['approved', 'pickup-required', 'rejected']) {
    assert.match(html, new RegExp(`value="${status}"`));
    assert.match(renderer, new RegExp(status));
  }
  assert.match(css, /grid-template-columns/);
  assert.match(renderer, /reviewUi\.saveReview/);
  assert.match(renderer, /reviewUi\.loadBundle/);
  assert.match(renderer, /await window\.reviewUi\.saveReview/);
  assert.match(renderer, /saveButton\.disabled = true/);
  assert.match(renderer, /保存中/);
  assert.match(renderer, /已保存/);
  assert.match(renderer, /保存失败/);
  assert.match(html, /<title>人工录制审核<\/title>/);
  assert.match(html, />已通过<\/option>/);
  assert.match(html, />需要补录<\/option>/);
  assert.match(html, />已拒绝<\/option>/);
  assert.match(html, />保留<\/option>/);
  assert.match(html, />压缩等待<\/option>/);
});

test('review UI preload exposes typed API only and main uses context isolation custom file guard', async () => {
  const preload = await readFile(path.resolve('src/lib/video-generator/review-ui/preload.cts'), 'utf8');
  const main = await readFile(path.resolve('src/lib/video-generator/review-ui/main.ts'), 'utf8');
  const ipc = await readFile(path.resolve('src/lib/video-generator/review-ui/ipc.ts'), 'utf8');

  assert.match(preload, /contextBridge\.exposeInMainWorld\('reviewUi'/);
  assert.doesNotMatch(preload, /node:fs|child_process/);
  assert.doesNotMatch(preload, /require\(['"]\.\/ipc\.js['"]\)/);
  assert.match(preload, /const channels =/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /assertPathInsideRun/);
  assert.match(ipc, /review-ui:load-bundle/);
  assert.match(ipc, /review-ui:save-review/);
});

test('review UI resolves worktree-relative artifact pointers against an absolute run directory', async () => {
  const main = await readFile(path.resolve('src/lib/video-generator/review-ui/main.ts'), 'utf8');

  assert.match(main, /resolvePathInsideRun/);
  assert.match(main, /const reviewPath = assertPathInsideRun\(pointer\.path, rootDir\)/);
  assert.match(main, /readFile\(reviewPath, 'utf8'\)/);
  assert.match(main, /const agentPlanPath = assertPathInsideRun\(pointer\.path, rootDir\)/);
  assert.match(main, /readFile\(agentPlanPath, 'utf8'\)/);
});

test('review UI exposes the local preview as a browser-safe file URL', async () => {
  const main = await readFile(path.resolve('src/lib/video-generator/review-ui/main.ts'), 'utf8');

  assert.match(main, /pathToFileURL/);
  assert.match(main, /previewPath: pathToFileURL\(previewVideoPath\)\.href/);
});

test('manual build includes review UI assets and package script exposes video:review', async () => {
  const config = JSON.parse(await readFile(path.resolve('tsconfig.manual-recording.json'), 'utf8')) as { include: string[] };
  const copyScript = await readFile(path.resolve('scripts/copy-manual-recording-assets.mjs'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as { scripts: Record<string, string> };

  assert.ok(config.include.includes('src/lib/video-generator/review-ui/**/*.ts'));
  assert.ok(config.include.includes('src/lib/video-generator/review-ui/**/*.cts'));
  assert.match(copyScript, /review-ui/);
  assert.equal(packageJson.scripts['video:review'], 'npm run build:manual && tsx src/cli/manual-review.ts');
});

test('manual review CLI rejects runs without agent plan or preview before launching UI', async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), 'manual-review-cli-'));
  const launched: string[] = [];
  const stderr: string[] = [];
  try {
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.editDir, { recursive: true });

    assert.equal(await runManualReviewCli(['--run', runDir], {
      stderr: (message) => stderr.push(message),
      launch: async (dir) => { launched.push(dir); },
    }), 1);
    assert.equal(launched.length, 0);
    assert.match(stderr.join('\n'), /agent plan/i);

    await writeFile(bundle.agentCurrentPlanPath, JSON.stringify({ version: 1, path: bundle.versionedEditPath('edit-plan.agent', 1) }), 'utf8');
    stderr.length = 0;
    assert.equal(await runManualReviewCli(['--run', runDir], {
      stderr: (message) => stderr.push(message),
      launch: async (dir) => { launched.push(dir); },
    }), 1);
    assert.equal(launched.length, 0);
    assert.match(stderr.join('\n'), /preview/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('review UI renderer edits the selected segment and exposes preview/local-preview failure path', async () => {
  const renderer = await readFile(path.resolve('src/lib/video-generator/review-ui/renderer.ts'), 'utf8');
  const preload = await readFile(path.resolve('src/lib/video-generator/review-ui/preload.cts'), 'utf8');
  const main = await readFile(path.resolve('src/lib/video-generator/review-ui/main.ts'), 'utf8');

  assert.match(renderer, /selectedSegmentId/);
  assert.match(renderer, /addEventListener\('click'/);
  assert.match(renderer, /boundary-start/);
  assert.match(renderer, /boundary-end/);
  assert.match(renderer, /source-select/);
  assert.match(renderer, /wait-strategy/);
  assert.match(renderer, /segment-preview/);
  assert.match(renderer, /timeline-strip/);
  assert.match(renderer, /localPreview/);
  assert.match(renderer, /getSegmentPlaybackRange/);
  assert.match(renderer, /preview\.currentTime = range\.startSeconds/);
  assert.match(renderer, /preview\.play\(\)/);
  assert.match(renderer, /addEventListener\('timeupdate'/);
  assert.match(renderer, /formatSegmentLabel/);
  assert.match(renderer, /formatSourceLabel/);
  assert.match(preload, /localPreview/);
  assert.match(main, /saveReviewedEffectivePlan/);
  assert.match(main, /REVIEW_UI_CHANNELS\.localPreview/);
  assert.match(main, /mkdtemp|tmpdir/);
});
