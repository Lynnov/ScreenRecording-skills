import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runManualRecordCli } from '../../src/cli/manual-record.js';
import { buildManualRecordingSpawn } from '../../scripts/run-manual-recording.mjs';

async function withTempDir(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `manual-record-cli-${process.pid}-${Date.now()}-${name}`);
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

test('manual record CLI requires approved guide and display mode before recording', async () => {
  await withTempDir('missing-guide', async (dir) => {
    const { stderr, io } = makeIo();
    const exitCode = await runManualRecordCli(['--run', dir, '--display-mode', 'f11'], io);

    assert.equal(exitCode, 1);
    assert.match(stderr.join('\n'), /approved guide/i);
  });
});

test('manual record CLI passes run display mode and approved guide to controller', async () => {
  await withTempDir('record', async (dir) => {
    const scriptsDir = path.join(dir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, 'recording-guide.v01.json'), JSON.stringify({
      version: 1,
      startUrl: 'https://example.com',
      actions: [{
        id: 'action-001',
        segmentId: 'segment-001',
        title: '打开页面',
        instruction: '确认页面已打开。',
        expectedEvents: [{ type: 'navigation' }],
        expectedResults: [{ type: 'url-matches', pattern: 'example' }],
      }],
    }), 'utf8');
    await writeFile(path.join(scriptsDir, 'recording-guide.approved.json'), JSON.stringify({
      version: 1,
      guideVersion: 1,
      guidePath: path.join(scriptsDir, 'recording-guide.v01.json'),
      approvedAt: '2026-07-28T00:00:00.000Z',
    }), 'utf8');

    const calls: unknown[] = [];
    const { stdout, io } = makeIo();
    const exitCode = await runManualRecordCli(['--run', dir, '--display-mode', 'borderless-maximized'], {
      ...io,
      record: async (input) => {
        calls.push(input);
        return { ok: true, manifestPath: path.join(dir, 'capture', 'recording-manifest.json'), sourceCatalogPath: path.join(dir, 'capture', 'source-catalog.json') };
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [{ runDir: dir, displayMode: 'borderless-maximized', recover: false }]);
    assert.match(stdout.join('\n'), /recording-manifest\.json/);
  });
});

test('manual record CLI routes --recover to recovery flow and rejects invalid modes', async () => {
  const invalid = makeIo();
  assert.equal(await runManualRecordCli(['--run', 'out', '--display-mode', 'windowed'], invalid.io), 1);
  assert.match(invalid.stderr.join('\n'), /display-mode/);

  const recover = makeIo();
  const calls: unknown[] = [];
  assert.equal(await runManualRecordCli(['--run', 'out', '--recover'], {
    ...recover.io,
    recover: async (input) => {
      calls.push(input);
      return { ok: true, reportPath: path.join('out', 'reports', 'capture-recovery.json'), pickupRequiredSegmentId: 'segment-001' };
    },
  }), 0);
  assert.deepEqual(calls, [{ runDir: 'out' }]);
});

test('manual recording runner constructs explicit Electron composition arguments', () => {
  const runDir = path.resolve('video-runs', 'manual-record');
  assert.deepEqual(buildManualRecordingSpawn({
    electronPath: 'electron.exe',
    entryPath: 'manual-app',
    mode: 'recording',
    runDir,
    displayMode: 'f11',
  }), {
    command: 'electron.exe',
    args: ['manual-app', '--mode', 'recording', '--run', runDir, '--display-mode', 'f11'],
    options: { stdio: 'inherit', windowsHide: false },
  });
});

test('manual record CLI defaults to Electron child and reports structured failure path', async () => {
  await withTempDir('electron-child', async (dir) => {
    const scriptsDir = path.join(dir, 'scripts');
    const guidePath = path.join(scriptsDir, 'recording-guide.v01.json');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(guidePath, JSON.stringify({
      version: 1,
      startUrl: 'https://example.com',
      actions: [{
        id: 'action-001',
        segmentId: 'segment-001',
        title: 'Open',
        instruction: 'Open',
        expectedEvents: [{ type: 'navigation' }],
        expectedResults: [{ type: 'url-matches', pattern: 'example' }],
      }],
    }), 'utf8');
    await writeFile(path.join(scriptsDir, 'recording-guide.approved.json'), JSON.stringify({
      version: 1,
      guideVersion: 1,
      guidePath,
      approvedAt: '2026-07-28T00:00:00.000Z',
    }), 'utf8');
    const calls: unknown[] = [];
    const { stderr, io } = makeIo();
    const exitCode = await runManualRecordCli(['--run', dir, '--display-mode', 'f11'], {
      ...io,
      launchChild: async (input) => {
        calls.push(input);
        return { exitCode: 7, signal: null };
      },
    });

    assert.equal(exitCode, 7);
    assert.deepEqual(calls, [{
      mode: 'recording',
      runDir: path.resolve(dir),
      displayMode: 'f11',
    }]);
    assert.match(stderr.join('\n'), /manual-run-report\.json/);
    assert.doesNotMatch(stderr.join('\n'), /runtime adapter.*unavailable/i);
  });
});
