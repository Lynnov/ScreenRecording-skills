import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateTimeline } from '../../src/lib/video-generator/timeline-validator.js';
import { VideoGeneratorError, type BrowserAction, type RunReport, type Timeline, type WaitTarget } from '../../src/lib/video-generator/types.js';

const validTimeline = (): Timeline => ({
  version: 1,
  title: 'Demo',
  segments: [
    {
      id: 'seg-001',
      sourceText: '旁白：打开首页\n打开 https://example.com',
      narration: '打开首页',
      subtitle: '打开首页',
      estimatedDurationMs: 3000,
      bufferMs: 500,
      actions: [{ type: 'goto', url: 'https://example.com' }],
      assets: {},
    },
  ],
});

test('core timeline types support planned wait targets action waitFor fields assets and run report fields', () => {
  const networkIdleTarget: WaitTarget = { type: 'networkIdle' };
  const actions: BrowserAction[] = [
    { type: 'goto', url: 'https://example.com', waitFor: networkIdleTarget },
    { type: 'click', text: '登录', waitFor: { type: 'text', value: '欢迎' } },
    { type: 'fill', selector: '#name', value: 'alice', waitFor: { type: 'selector', value: '#ok' } },
    { type: 'waitFor', target: networkIdleTarget },
    { type: 'scroll', y: 300, waitFor: networkIdleTarget },
  ];
  const timeline = validTimeline();
  timeline.segments[0].actualAudioDurationMs = 2800;
  timeline.segments[0].startsAtMs = 0;
  timeline.segments[0].endsAtMs = 3500;
  timeline.segments[0].assets = {
    audioPath: 'audio.wav',
    clipPath: 'clip.webm',
    screenshotPath: 'screen.png',
  };
  timeline.segments[0].actions = actions;
  const report: RunReport = {
    ok: false,
    outputDir: './video-runs',
    finalVideoPath: 'final.mp4',
    timelinePath: 'timeline.json',
    subtitlesPath: 'subtitles.srt',
    failedSegmentId: 'seg-001',
    failedAction: actions[1],
    errorMessage: 'failed',
    screenshotPath: 'error.png',
  };

  assert.equal(report.ok, false);
  assert.doesNotThrow(() => validateTimeline(timeline));
});

test('validateTimeline accepts a valid v1 timeline', () => {
  assert.doesNotThrow(() => validateTimeline(validTimeline()));
});

test('validateTimeline accepts data URL goto actions for built-in demo pages', () => {
  const timeline = validTimeline();
  timeline.segments[0].actions = [{ type: 'goto', url: 'data:text/html;charset=utf-8,%3Cbutton%3E%E5%BC%80%E5%A7%8B%3C%2Fbutton%3E' }];

  assert.doesNotThrow(() => validateTimeline(timeline));
});

test('validateTimeline rejects malformed JSON-like timeline and segment shapes with VideoGeneratorError', () => {
  const cases: Timeline[] = [
    undefined as unknown as Timeline,
    {} as unknown as Timeline,
    { ...validTimeline(), segments: [{ ...validTimeline().segments[0], narration: undefined } as unknown as Timeline['segments'][number]] },
    { ...validTimeline(), segments: [{ ...validTimeline().segments[0], actions: undefined } as unknown as Timeline['segments'][number]] },
    { ...validTimeline(), segments: [{ ...validTimeline().segments[0], estimatedDurationMs: undefined } as unknown as Timeline['segments'][number]] },
    { ...validTimeline(), segments: [{ ...validTimeline().segments[0], bufferMs: undefined } as unknown as Timeline['segments'][number]] },
    { ...validTimeline(), segments: [{ ...validTimeline().segments[0], actions: [undefined as unknown as BrowserAction] }] },
    { ...validTimeline(), segments: [{ ...validTimeline().segments[0], actions: [{ url: 'https://example.com' } as unknown as BrowserAction] }] },
  ];

  for (const timeline of cases) {
    assert.throws(() => validateTimeline(timeline), (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      return true;
    });
  }
});

test('validateTimeline rejects unsupported versions and empty segments', () => {
  const timeline = { ...validTimeline(), version: 2 } as unknown as Timeline;

  assert.throws(() => validateTimeline(timeline), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'INVALID_TIMELINE_VERSION');
    return true;
  });

  assert.throws(() => validateTimeline({ ...validTimeline(), segments: [] }), /at least one segment/);
});

test('validateTimeline rejects invalid segment narration and browser actions with segment id', () => {
  const cases: Array<[string, Partial<Timeline['segments'][number]>]> = [
    ['EMPTY_NARRATION', { narration: '   ' }],
    ['EMPTY_ACTIONS', { actions: [] }],
    ['INVALID_GOTO_URL', { actions: [{ type: 'goto', url: 'ftp://example.com' }] }],
    ['INVALID_CLICK_TARGET', { actions: [{ type: 'click' }] }],
    ['INVALID_FILL_TARGET', { actions: [{ type: 'fill', value: 'abc' }] }],
    ['INVALID_FILL_VALUE', { actions: [{ type: 'fill', text: '搜索', value: '' }] }],
    ['INVALID_WAIT_TARGET', { actions: [{ type: 'waitFor' } as BrowserAction] }],
    ['INVALID_SCROLL_Y', { actions: [{ type: 'scroll', y: Number.POSITIVE_INFINITY }] }],
    ['UNSUPPORTED_SCRIPT_ACTION', { actions: [{ type: 'hover' } as unknown as BrowserAction] }],
  ];

  for (const [code, segmentPatch] of cases) {
    const timeline = validTimeline();
    timeline.segments[0] = { ...timeline.segments[0], ...segmentPatch };

    assert.throws(() => validateTimeline(timeline), (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, code);
      assert.equal(error.segmentId, 'seg-001');
      return true;
    });
  }
});

test('validateTimeline rejects non-finite or negative segment timing fields with segment id', () => {
  const cases: Array<[string, Partial<Timeline['segments'][number]>]> = [
    ['INVALID_ESTIMATED_DURATION', { estimatedDurationMs: Number.NaN }],
    ['INVALID_BUFFER_MS', { bufferMs: -1 }],
    ['INVALID_ACTUAL_AUDIO_DURATION', { actualAudioDurationMs: Number.POSITIVE_INFINITY }],
    ['INVALID_STARTS_AT', { startsAtMs: -1 }],
    ['INVALID_ENDS_AT', { endsAtMs: Number.NaN }],
  ];

  for (const [code, segmentPatch] of cases) {
    const timeline = validTimeline();
    timeline.segments[0] = { ...timeline.segments[0], ...segmentPatch };

    assert.throws(() => validateTimeline(timeline), (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, code);
      assert.equal(error.segmentId, 'seg-001');
      return true;
    });
  }
});

test('validateTimeline accepts valid wait target shapes on waitFor and optional action waitFor fields', () => {
  const timeline = validTimeline();
  timeline.segments[0].actions = [
    { type: 'goto', url: 'https://example.com', waitFor: { type: 'networkIdle' } },
    { type: 'click', text: '继续', waitFor: { type: 'text', value: '完成' } },
    { type: 'fill', selector: '#email', value: 'a@example.com', waitFor: { type: 'selector', value: '#ok' } },
    { type: 'scroll', y: 120, waitFor: { type: 'url', value: 'https://example.com/done' } },
    { type: 'waitFor', target: { type: 'networkIdle' } },
  ];

  assert.doesNotThrow(() => validateTimeline(timeline));
});

test('validateTimeline rejects invalid wait target shape or value on waitFor action and optional action waitFor', () => {
  const cases: BrowserAction[] = [
    { type: 'waitFor', target: { type: 'text', value: '' } },
    { type: 'waitFor', target: { type: 'selector', value: '   ' } },
    { type: 'waitFor', target: { type: 'url', value: '' } },
    { type: 'waitFor', target: { type: 'text' } as unknown as WaitTarget },
    { type: 'waitFor', target: { type: 'selector', value: 123 } as unknown as WaitTarget },
    { type: 'waitFor', target: { type: 'url', value: null } as unknown as WaitTarget },
    { type: 'waitFor', target: { type: 'visible', value: '按钮' } as unknown as WaitTarget },
    { type: 'goto', url: 'https://example.com', waitFor: { type: 'text', value: '' } },
    { type: 'click', text: '继续', waitFor: { type: 'selector', value: '' } },
    { type: 'fill', text: '邮箱', value: 'a@example.com', waitFor: { type: 'url', value: '' } },
    { type: 'scroll', y: 120, waitFor: { type: 'visible', value: '完成' } as unknown as WaitTarget },
  ];

  for (const action of cases) {
    const timeline = validTimeline();
    timeline.segments[0].actions = [action];

    assert.throws(() => validateTimeline(timeline), (error) => {
      assert.ok(error instanceof VideoGeneratorError);
      assert.equal(error.code, 'INVALID_WAIT_TARGET');
      assert.equal(error.segmentId, 'seg-001');
      return true;
    });
  }
});
