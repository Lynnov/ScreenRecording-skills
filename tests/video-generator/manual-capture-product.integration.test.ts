import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('prepare smoke creates an approved record run and pickup-required target inside worktree video-runs', async () => {
  const output = path.join('video-runs', `manual-product-smoke-test-${process.pid}-${Date.now()}`);
  const absoluteOutput = path.resolve(output);
  try {
    const result = await execFileAsync(process.execPath, [
      'scripts/prepare-manual-capture-smoke.mjs',
      '--output', output,
    ]);
    assert.match(result.stdout, /segment-003/);

    const guide = JSON.parse(await readFile(
      path.join(absoluteOutput, 'scripts', 'recording-guide.v01.json'),
      'utf8',
    )) as {
      startUrl: string;
      actions: Array<{ id: string; segmentId: string }>;
    };
    assert.equal(guide.startUrl, 'http://127.0.0.1:4173/product-capture-smoke.html');
    assert.deepEqual(
      guide.actions.filter((action) => action.segmentId === 'segment-003').map((action) => action.id),
      ['action-003', 'action-003b'],
    );

    const approved = JSON.parse(await readFile(
      path.join(absoluteOutput, 'scripts', 'recording-guide.approved.json'),
      'utf8',
    )) as { guidePath: string };
    assert.equal(approved.guidePath, path.join(absoluteOutput, 'scripts', 'recording-guide.v01.json'));

    const reviewPointer = JSON.parse(await readFile(
      path.join(absoluteOutput, 'edit', 'edit-review.current.json'),
      'utf8',
    )) as { path: string };
    const review = JSON.parse(await readFile(reviewPointer.path, 'utf8')) as {
      reviewComplete: boolean;
      segments: Array<{ segmentId: string; status: string }>;
    };
    assert.equal(review.reviewComplete, false);
    assert.equal(
      review.segments.find((segment) => segment.segmentId === 'segment-003')?.status,
      'pickup-required',
    );

    const agentPlanPointer = JSON.parse(await readFile(
      path.join(absoluteOutput, 'edit', 'edit-plan.agent.current.json'),
      'utf8',
    )) as { path: string };
    const agentPlan = JSON.parse(await readFile(agentPlanPointer.path, 'utf8')) as {
      canvas: { width: number; height: number; fps: number };
      segments: Array<{ segmentId: string; confidence: string }>;
    };
    assert.deepEqual(agentPlan.canvas, { width: 1920, height: 1080, fps: 30 });
    assert.equal(
      agentPlan.segments.find((segment) => segment.segmentId === 'segment-003')?.confidence,
      'low',
    );
    await access(path.resolve('examples/manual-recording/product-capture-smoke.html'));
  } finally {
    await rm(absoluteOutput, { recursive: true, force: true });
  }
});

test('prepare smoke rejects outputs outside this worktree video-runs', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      'scripts/prepare-manual-capture-smoke.mjs',
      '--output', path.resolve('outside-smoke-run'),
    ]),
    /video-runs/,
  );
});
