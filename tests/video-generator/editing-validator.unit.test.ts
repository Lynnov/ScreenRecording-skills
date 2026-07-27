import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditPlan, EditSource } from '../../src/lib/video-generator/editing/types.js';
import { validateEditPlan } from '../../src/lib/video-generator/editing/validator.js';

const sources: EditSource[] = [
  {
    id: 'original',
    path: 'capture/original.mp4',
    durationMs: 2000,
    width: 1920,
    height: 1080,
    fps: 30,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
    hasAudio: false,
  },
  {
    id: 'pickup-001',
    path: 'capture/pickup.mp4',
    durationMs: 1000,
    width: 1920,
    height: 1080,
    fps: 30,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
    hasAudio: true,
  },
];

function validPlan(): EditPlan {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    segments: [
      {
        segmentId: 'segment-1',
        title: 'one',
        clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 1000, playbackRate: 1 }],
        transition: 'short-fade',
        confidence: 'high',
        reason: 'fixture',
      },
      {
        segmentId: 'segment-2',
        title: 'two',
        clips: [{ sourceId: 'pickup-001', sourceStartMs: 0, sourceEndMs: 500, playbackRate: 1 }],
        holdLastFrameMs: 100,
        confidence: 'medium',
        reason: 'fixture',
      },
    ],
  };
}

function rejects(path: RegExp, mutate: (plan: EditPlan) => void, customSources = sources): void {
  const plan = validPlan();
  mutate(plan);
  assert.throws(() => validateEditPlan(plan, customSources), path);
}

test('accepts a valid edit plan and narrows unknown', () => {
  const input: unknown = validPlan();
  validateEditPlan(input, sources);
  assert.equal(input.version, 1);
});

test('rejects unknown sources, inverted/non-positive ranges, and source overflow with JSON paths', () => {
  rejects(/segments\[0\]\.clips\[0\]\.sourceId/, (plan) => {
    plan.segments[0]!.clips[0]!.sourceId = 'missing';
  });
  rejects(/segments\[0\]\.clips\[0\]\.sourceEndMs/, (plan) => {
    plan.segments[0]!.clips[0]!.sourceEndMs = 0;
  });
  rejects(/segments\[0\]\.clips\[0\]\.sourceEndMs/, (plan) => {
    plan.segments[0]!.clips[0]!.sourceStartMs = 500;
    plan.segments[0]!.clips[0]!.sourceEndMs = 400;
  });
  rejects(/segments\[1\]\.clips\[0\]\.sourceEndMs exceeds source "pickup-001" duration 1000ms/, (plan) => {
    plan.segments[1]!.clips[0]!.sourceEndMs = 1001;
  });
});

test('rejects playback rates outside 1 through 2 and invalid holds', () => {
  for (const rate of [0.99, 2.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    rejects(/segments\[0\]\.clips\[0\]\.playbackRate/, (plan) => {
      plan.segments[0]!.clips[0]!.playbackRate = rate;
    });
  }
  for (const hold of [-1, 5001, Number.NaN, Number.POSITIVE_INFINITY]) {
    rejects(/segments\[0\]\.holdLastFrameMs/, (plan) => {
      plan.segments[0]!.holdLastFrameMs = hold;
    });
  }
});

test('rejects invalid short-fade placement and segments no longer than 120ms', () => {
  rejects(/segments\[1\]\.transition/, (plan) => {
    plan.segments[1]!.transition = 'short-fade';
  });
  rejects(/segments\[0\]\.transition/, (plan) => {
    plan.segments[0]!.clips[0]!.sourceEndMs = 120;
  });
  rejects(/segments\[0\]\.transition/, (plan) => {
    plan.segments[1]!.clips[0]!.sourceEndMs = 20;
    plan.segments[1]!.holdLastFrameMs = 100;
  });
});

test('rejects duplicate segment and source ids and empty clips', () => {
  rejects(/segments\[1\]\.segmentId/, (plan) => {
    plan.segments[1]!.segmentId = 'segment-1';
  });
  rejects(/segments\[0\]\.clips/, (plan) => {
    plan.segments[0]!.clips = [];
  });
  rejects(/sources\[1\]\.id/, () => {}, [sources[0]!, { ...sources[1]!, id: 'original' }]);
});

test('rejects a canvas other than exactly 1920 by 1080 at 30fps', () => {
  for (const [field, value] of [
    ['width', 1280],
    ['height', 720],
    ['fps', 29.97],
  ] as const) {
    rejects(new RegExp(`canvas\\.${field}`), (plan) => {
      (plan.canvas as unknown as Record<string, number>)[field] = value;
    });
  }
});

test('rejects non-finite number fields and malformed unknown input with JSON paths', () => {
  rejects(/segments\[0\]\.clips\[0\]\.sourceStartMs/, (plan) => {
    plan.segments[0]!.clips[0]!.sourceStartMs = Number.NaN;
  });
  rejects(/sources\[0\]\.durationMs/, () => {}, [{ ...sources[0]!, durationMs: Number.POSITIVE_INFINITY }]);
  assert.throws(() => validateEditPlan(null, sources), /plan/);
  assert.throws(() => validateEditPlan({ version: 2 }, sources), /version/);
});
