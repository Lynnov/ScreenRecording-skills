import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadVideoGeneratorConfig } from '../../src/lib/video-generator/config.js';
import { parseVideoScript } from '../../src/lib/video-generator/script-parser.js';
import { VideoGeneratorError } from '../../src/lib/video-generator/types.js';

test('parseVideoScript parses a three segment MVP script with source text ids narrations action types and durations', () => {
  const config = loadVideoGeneratorConfig({ speechRateCharsPerMinute: 120, segmentBufferMs: 700 });
  const source = `旁白：打开我们的首页。
打开 https://example.com
等待 “登录”

旁白：输入账号并继续
点击 "登录"
在 用户名 输入 alice

旁白：查看页面下方内容
向下滚动 480`;
  const timeline = parseVideoScript(source, config);

  assert.equal(timeline.version, 1);
  assert.equal(timeline.title, '未命名教程视频');
  assert.equal(timeline.segments.length, 3);
  assert.deepEqual(
    timeline.segments.map((segment) => segment.id),
    ['seg-001', 'seg-002', 'seg-003'],
  );
  assert.equal(timeline.segments[0].sourceText, '旁白：打开我们的首页。\n打开 https://example.com\n等待 “登录”');
  assert.equal(timeline.segments[1].sourceText, '旁白：输入账号并继续\n点击 "登录"\n在 用户名 输入 alice');
  assert.equal(timeline.segments[2].sourceText, '旁白：查看页面下方内容\n向下滚动 480');
  assert.deepEqual(
    timeline.segments.map((segment) => segment.narration),
    ['打开我们的首页。', '输入账号并继续', '查看页面下方内容'],
  );
  assert.deepEqual(
    timeline.segments.map((segment) => segment.actions.map((action) => action.type)),
    [
      ['goto', 'waitFor'],
      ['click', 'fill'],
      ['scroll'],
    ],
  );
  assert.deepEqual(
    timeline.segments.map((segment) => segment.estimatedDurationMs),
    [3500, 3500, 4000],
  );
  assert.equal(timeline.segments[0].bufferMs, 700);
  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'goto', url: 'https://example.com' },
    { type: 'waitFor', target: { type: 'text', value: '登录' } },
  ]);
  assert.deepEqual(timeline.segments[1].actions, [
    { type: 'click', text: '登录' },
    { type: 'fill', text: '用户名', value: 'alice' },
  ]);
});

test('parseVideoScript parses quoted fill values that contain the separator word', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript('旁白：填写备注\n在 "备注" 输入 "请 输入 名称"', config);

  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'fill', text: '备注', value: '请 输入 名称' },
  ]);
});

test('parseVideoScript maps built-in demo actions to a playable data URL', () => {
  const config = loadVideoGeneratorConfig();

  for (const openAction of ['打开 demo:basic', '打开内置演示页']) {
    const timeline = parseVideoScript(`旁白：打开内置演示页\n${openAction}`, config);
    const action = timeline.segments[0].actions[0];

    assert.equal(action.type, 'goto');
    assert.match(action.url, /^data:text\/html;charset=utf-8,/u);
    assert.match(decodeURIComponent(action.url), /<button[^>]*>开始<\/button>/u);
    assert.match(decodeURIComponent(action.url), /placeholder="姓名"/u);
  }
});

test('parseVideoScript rejects blocks without narration before returning a timeline', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('打开 https://example.com', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'MISSING_NARRATION');
    return true;
  });
});

test('parseVideoScript rejects narration-only blocks because Phase 1 requires at least one action', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('旁白：这里只讲解没有操作', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'MISSING_ACTION');
    return true;
  });
});

test('parseVideoScript validation rejects unsupported action details', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('旁白：打开页面\n打开 ftp://example.com', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'INVALID_GOTO_URL');
    assert.equal(error.segmentId, 'seg-001');
    return true;
  });
});

test('parseVideoScript rejects unsupported action patterns with explicit code', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('旁白：执行未知操作\n双击 登录', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'UNSUPPORTED_SCRIPT_ACTION');
    return true;
  });
});
