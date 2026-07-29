import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runManualPickupCli } from '../../src/cli/manual-pickup.js';
import {
  comparePickupContinuityFrames,
  evaluatePickupContinuityGate,
  type ManualPickupControllerResult,
} from '../../src/lib/video-generator/manual/pickup-controller.js';
import {
  createManualOverlayState,
  manualOverlayReducer,
} from '../../src/lib/video-generator/manual/state-machine.js';

test('pickup continuity gate keeps discontinuous and unknown boundaries pickup-required', () => {
  const discontinuous = evaluatePickupContinuityGate({
    segmentId: 'segment-003',
    previous: {
      neighborSegmentId: 'segment-002',
      result: 'discontinuous',
      reason: '表单页与成功页明显不同。',
    },
    next: {
      neighborSegmentId: 'segment-004',
      result: 'continuous',
      reason: '结束状态一致。',
    },
  });

  assert.equal(discontinuous.status, 'pickup-required');
  assert.equal(discontinuous.reviewRequired, true);
  assert.match(discontinuous.reviewReasons.join('\n'), /明显不连续|表单页与成功页/);

  const unknown = evaluatePickupContinuityGate({
    segmentId: 'segment-003',
    previous: {
      neighborSegmentId: 'segment-002',
      result: 'unknown',
      reason: '尚未比较首帧。',
    },
    next: null,
  });
  assert.equal(unknown.status, 'pickup-required');
  assert.equal(unknown.reviewRequired, true);
  assert.match(unknown.reviewReasons.join('\n'), /无法确认|尚未比较/);
});

test('pickup continuity gate records successful comparisons without auto-approval', () => {
  const gate = evaluatePickupContinuityGate({
    segmentId: 'segment-003',
    previous: {
      neighborSegmentId: 'segment-002',
      result: 'continuous',
      reason: '补录首帧延续上一段结束状态。',
    },
    next: {
      neighborSegmentId: 'segment-004',
      result: 'continuous',
      reason: '补录末帧衔接下一段开始状态。',
    },
  });

  assert.equal(gate.status, 'pickup-required');
  assert.equal(gate.reviewRequired, true);
  assert.match(gate.reviewReasons.join('\n'), /重新 analyze\/preview\/review|人工审核/i);
});

test('default pickup continuity comparison classifies identical and different image content', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-pickup-continuity-'));
  try {
    const redA = path.join(tempDir, 'red-a.ppm');
    const redB = path.join(tempDir, 'red-b.ppm');
    const blue = path.join(tempDir, 'blue.ppm');
    const ppm = (red: number, green: number, blueValue: number): Buffer => {
      const header = Buffer.from('P6\n16 16\n255\n', 'ascii');
      const pixels = Buffer.alloc(16 * 16 * 3);
      for (let offset = 0; offset < pixels.length; offset += 3) {
        pixels[offset] = red;
        pixels[offset + 1] = green;
        pixels[offset + 2] = blueValue;
      }
      return Buffer.concat([header, pixels]);
    };
    await Promise.all([
      writeFile(redA, ppm(255, 0, 0)),
      writeFile(redB, ppm(255, 0, 0)),
      writeFile(blue, ppm(0, 0, 255)),
    ]);

    const comparisons = await comparePickupContinuityFrames({
      pickup: {
        segmentId: 'segment-003',
        sourceId: 'segment-003-attempt-001',
        firstFramePath: redA,
        lastFramePath: redA,
      },
      previous: {
        segmentId: 'segment-002',
        sourceId: 'original',
        atMs: 1000,
        framePath: redB,
      },
      next: {
        segmentId: 'segment-004',
        sourceId: 'original',
        atMs: 3000,
        framePath: blue,
      },
    });

    assert.equal(comparisons.previous?.result, 'continuous');
    assert.match(comparisons.previous?.reason ?? '', /SSIM.*1(?:\.0+)?/i);
    assert.equal(comparisons.next?.result, 'discontinuous');
    assert.match(comparisons.next?.reason ?? '', /SSIM/i);

    const unavailable = await comparePickupContinuityFrames({
      ...comparisonsRequest(redA, redB),
      previous: {
        segmentId: 'segment-002',
        sourceId: 'original',
        atMs: 1000,
        framePath: path.join(tempDir, 'missing.ppm'),
      },
    });
    assert.equal(unavailable.previous?.result, 'unknown');
    assert.match(unavailable.previous?.reason ?? '', /SSIM comparison failed/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function comparisonsRequest(
  pickupFramePath: string,
  neighborFramePath: string,
): Parameters<typeof comparePickupContinuityFrames>[0] {
  return {
    pickup: {
      segmentId: 'segment-003',
      sourceId: 'segment-003-attempt-001',
      firstFramePath: pickupFramePath,
      lastFramePath: pickupFramePath,
    },
    previous: {
      segmentId: 'segment-002',
      sourceId: 'original',
      atMs: 1000,
      framePath: neighborFramePath,
    },
    next: null,
  };
}

test('pickup overlay advances and reverses current Action within the target Segment', () => {
  let state = createManualOverlayState({
    mode: 'pickup',
    segmentId: 'segment-003',
    actionId: 'action-003',
    actionIds: ['action-003', 'action-003b'],
    attempt: 1,
  });
  state = manualOverlayReducer(state, { type: 'start-pickup' });
  state = manualOverlayReducer(state, { type: 'confirm-action' });
  assert.equal(state.segmentId, 'segment-003');
  assert.equal(state.actionId, 'action-003b');
  state = manualOverlayReducer(state, { type: 'previous-action' });
  assert.equal(state.actionId, 'action-003');
});

test('manual pickup CLI validates required arguments and forwards display mode', async () => {
  const errors: string[] = [];
  assert.equal(await runManualPickupCli(['--run', 'out'], {
    stderr: (message) => errors.push(message),
  }), 1);
  assert.match(errors.join('\n'), /--segment|--display-mode/);

  const calls: unknown[] = [];
  const output: string[] = [];
  const result: ManualPickupControllerResult = {
    ok: true,
    sourceId: 'segment-003-attempt-002',
    sourceCatalogPath: path.join('out', 'capture', 'source-catalog.json'),
    attempts: [{
      actionId: 'action-003',
      segmentId: 'segment-003',
      sourceId: 'segment-003-attempt-002',
      attempt: 2,
      startMs: 100,
      endMs: 900,
      confirmedAtMs: 900,
      status: 'confirmed',
    }],
    lifecycle: [
      'pickup-preparing',
      'pickup-recording',
      'pickup-finishing',
      'segment-analyzing',
      'review-ready',
    ],
    continuityGate: evaluatePickupContinuityGate({
      segmentId: 'segment-003',
      previous: null,
      next: null,
    }),
  };

  const exitCode = await runManualPickupCli([
    '--run', 'out',
    '--segment', 'segment-003',
    '--display-mode', 'borderless-maximized',
  ], {
    stdout: (message) => output.push(message),
    pickup: async (input) => {
      calls.push(input);
      return result;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    runDir: 'out',
    segmentId: 'segment-003',
    displayMode: 'borderless-maximized',
  }]);
  assert.match(output.join('\n'), /segment-003-attempt-002/);
  assert.match(output.join('\n'), /video:analyze[\s\S]*--segment segment-003/);
  assert.match(output.join('\n'), /video:preview/);
  assert.match(output.join('\n'), /video:review/);
  assert.doesNotMatch(output.join('\n'), /approved/i);
});

test('manual pickup CLI defaults to Electron child scoped to the target segment', async () => {
  const calls: unknown[] = [];
  const errors: string[] = [];
  const exitCode = await runManualPickupCli([
    '--run', 'out',
    '--segment', 'segment-003',
    '--display-mode', 'borderless-maximized',
  ], {
    stderr: (message) => errors.push(message),
    launchChild: async (input) => {
      calls.push(input);
      return { exitCode: 4, signal: null };
    },
  });

  assert.equal(exitCode, 4);
  assert.deepEqual(calls, [{
    mode: 'pickup',
    runDir: path.resolve('out'),
    segmentId: 'segment-003',
    displayMode: 'borderless-maximized',
  }]);
  assert.match(errors.join('\n'), /manual-run-report\.json/);
  assert.doesNotMatch(errors.join('\n'), /runtime adapter.*unavailable/i);
});
