import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { runManualAnalyzeCli } from '../../src/cli/manual-analyze.js';
import { runManualPreviewCli } from '../../src/cli/manual-preview.js';
import { createManualBundle } from '../../src/lib/video-generator/manual/bundle.js';
import type { EditPlan } from '../../src/lib/video-generator/editing/types.js';
import type { ManualSourceCatalog } from '../../src/lib/video-generator/manual/types.js';

async function withTempDir(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(process.cwd(), `.tmp-manual-preview-cli-${process.pid}-${Date.now()}-${name}`);
  await mkdir(dir, { recursive: true });
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
      env: {},
    },
  };
}

function plan(): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [{
      segmentId: 'segment-001',
      title: '填写名称',
      clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }],
      confidence: 'high',
      reason: 'fixture',
    }],
  };
}

function catalog(runDir: string): ManualSourceCatalog {
  return {
    version: 1,
    sources: [
      {
        id: 'original', path: path.join(runDir, 'capture', 'original-window.mp4'), durationMs: 2000,
        width: 1920, height: 1080, fps: 30, codecName: 'h264', pixelFormat: 'yuv420p', hasAudio: false,
        kind: 'original', segmentId: null, attempt: null, status: 'available', createdAt: '2026-07-28T00:00:00.000Z',
      },
      {
        id: 'failed-pickup', path: path.join(runDir, 'pickups', 'failed.mp4'),
        durationMs: null, width: null, height: null, fps: null, codecName: null, pixelFormat: null, hasAudio: null,
        kind: 'pickup', segmentId: 'segment-001', attempt: 1, status: 'failed',
        failureReason: 'capture failed before media was probeable',
        createdAt: '2026-07-28T00:01:00.000Z',
      },
    ],
  };
}

test('manual analyze CLI prepares agent request and applies response', async () => {
  const { stdout, io } = makeIo();
  const calls: string[] = [];
  const prepareExit = await runManualAnalyzeCli(['--run', 'run', '--prepare-agent'], {
    ...io,
    prepare: async (input) => {
      calls.push(`prepare:${input.runDir}`);
      return { requestVersion: 1, requestPath: path.join('run', 'agent', 'edit-request.v01.json') };
    },
  });
  assert.equal(prepareExit, 0);
  assert.deepEqual(calls, ['prepare:run']);
  assert.match(stdout.join('\n'), /edit-request\.v01\.json/);

  const apply = makeIo();
  const applyExit = await runManualAnalyzeCli(['--run', 'run', '--apply-agent-response', 'run/agent/edit-response.v01.json'], {
    ...apply.io,
    apply: async (input) => ({ version: 1, planPath: path.join(input.runDir, 'edit', 'edit-plan.agent.v01.json'), reportPath: path.join(input.runDir, 'edit', 'edit-report.agent.v01.md') }),
  });
  assert.equal(applyExit, 0);
  assert.match(apply.stdout.join('\n'), /edit-plan\.agent\.v01\.json/);
});

test('manual preview CLI renders agent or effective plan without modifying plan files', async () => {
  await withTempDir('preview', async (absoluteRunDir) => {
    const runDir = path.relative(process.cwd(), absoluteRunDir);
    const bundle = createManualBundle(runDir);
    await mkdir(bundle.editDir, { recursive: true });
    await mkdir(bundle.captureDir, { recursive: true });
    await writeFile(bundle.versionedEditPath('edit-plan.agent', 1), JSON.stringify(plan(), null, 2), 'utf8');
    await writeFile(bundle.agentCurrentPlanPath, JSON.stringify({ version: 1, path: bundle.versionedEditPath('edit-plan.agent', 1) }), 'utf8');
    await writeFile(bundle.sourceCatalogPath, JSON.stringify(catalog(runDir), null, 2), 'utf8');

    const before = await readFile(bundle.versionedEditPath('edit-plan.agent', 1), 'utf8');
    const { stdout, io } = makeIo();
    const exitCode = await runManualPreviewCli(['--run', runDir, '--plan', 'agent'], {
      ...io,
      render: async (input) => {
        assert.deepEqual(input.sources.map((source) => source.id), ['original']);
        await writeFile(input.outputPath, 'preview', 'utf8');
        await writeFile(input.timelinePath, '{"version":1,"durationMs":1000,"segments":[]}', 'utf8');
        return { previewPath: input.outputPath, timelinePath: input.timelinePath, durationMs: 1000 };
      },
    });

    assert.equal(exitCode, 0);
    assert.match(stdout.join('\n'), /preview\.mp4/);
    assert.equal(await readFile(bundle.versionedEditPath('edit-plan.agent', 1), 'utf8'), before);

    const failedPlan = plan();
    failedPlan.segments[0]!.clips[0]!.sourceId = 'failed-pickup';
    await writeFile(bundle.versionedEditPath('edit-plan.agent', 1), JSON.stringify(failedPlan, null, 2), 'utf8');
    let renderCalls = 0;
    const failed = makeIo();
    const failedExit = await runManualPreviewCli(['--run', runDir, '--plan', 'agent'], {
      ...failed.io,
      render: async () => {
        renderCalls += 1;
        throw new Error('render must not run');
      },
    });
    assert.equal(failedExit, 1);
    assert.equal(renderCalls, 0);
    assert.match(failed.stderr.join('\n'), /failed-pickup|unknown source|unavailable/i);
  });
});

test('manual preview CLI rejects missing plan pointer and invalid plan selector', async () => {
  const invalid = makeIo();
  assert.equal(await runManualPreviewCli(['--run', 'run', '--plan', 'draft'], invalid.io), 1);
  assert.match(invalid.stderr.join('\n'), /--plan/);

  await withTempDir('missing', async (runDir) => {
    const missing = makeIo();
    assert.equal(await runManualPreviewCli(['--run', runDir, '--plan', 'agent'], missing.io), 1);
    assert.match(missing.stderr.join('\n'), /plan/i);
  });
});
