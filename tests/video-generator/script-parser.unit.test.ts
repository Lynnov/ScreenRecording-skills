import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('parseVideoScript parses selector click and fill actions for ambiguous pages', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：精确操作页面
点击选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]
在选择器 input.number-input-box.paInput >> nth=1 输入 300`, config);

  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'click', selector: 'a[href*="custom-dimensions-tray-boxes-dieline-128020"]' },
    { type: 'fill', selector: 'input.number-input-box.paInput >> nth=1', value: '300' },
  ]);
});

test('parseVideoScript parses selector wait, hidden wait, and scroll-to-selector actions', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：找到目标卡片
等待选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]
等待隐藏选择器 .loading-mask
向下滚动到选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]`, config);

  assert.deepEqual(timeline.segments[0]?.actions, [
    {
      type: 'waitFor',
      target: { type: 'selector', value: 'a[href*="custom-dimensions-tray-boxes-dieline-128020"]' },
    },
    {
      type: 'waitFor',
      target: { type: 'hiddenSelector', value: '.loading-mask' },
    },
    {
      type: 'scrollTo',
      target: { type: 'selector', value: 'a[href*="custom-dimensions-tray-boxes-dieline-128020"]' },
    },
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

test('parseVideoScript attaches stageName to actions after a stage alias declaration', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`@stage orderEntry.list

旁白：进入订单列表
打开 https://example.com/orders
等待选择器 .order-list

旁白：查看订单列表
点击 "查询"`, config);

  assert.deepEqual(timeline.stages, [{ name: 'orderEntry.list', anchors: [] }]);
  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'goto', url: 'https://example.com/orders', stageName: 'orderEntry.list' },
    { type: 'waitFor', target: { type: 'selector', value: '.order-list' }, stageName: 'orderEntry.list' },
  ]);
  assert.deepEqual(timeline.segments[1].actions, [
    { type: 'click', text: '查询', stageName: 'orderEntry.list' },
  ]);
});

test('parseVideoScript parses stage scope and multiple anchors and merges repeated declarations', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`@stage orderEntry.createDialog scope=.el-dialog:visible anchor="text=新增订单" anchor="input[placeholder='请选择客户名称']"

旁白：打开新增订单弹窗
点击 "新增订单"

@stage orderEntry.createDialog anchor="text=保存"

旁白：填写订单信息
在选择器 input[placeholder='请选择客户名称'] 输入 测试客户`, config);

  assert.deepEqual(timeline.stages, [
    {
      name: 'orderEntry.createDialog',
      scope: '.el-dialog:visible',
      anchors: ['text=新增订单', "input[placeholder='请选择客户名称']", 'text=保存'],
    },
  ]);
  assert.deepEqual(timeline.segments[1].actions, [
    {
      type: 'fill',
      selector: "input[placeholder='请选择客户名称']",
      value: '测试客户',
      stageName: 'orderEntry.createDialog',
    },
  ]);
});

test('parseVideoScript parses quoted stage options containing spaces', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`@stage orderEntry.createDialog scope=".dialog title" anchor="text=保存 订单"

旁白：保存订单
点击 "保存 订单"`, config);

  assert.deepEqual(timeline.stages, [
    {
      name: 'orderEntry.createDialog',
      scope: '.dialog title',
      anchors: ['text=保存 订单'],
    },
  ]);
});

test('parseVideoScript rejects empty stage option values with a clear error', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('@stage orderEntry.createDialog anchor=', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'UNSUPPORTED_SCRIPT_ACTION');
    assert.match(error.message, /anchor.*must not be empty/u);
    return true;
  });
});

test('parseVideoScript rejects unknown stage options with a clear error', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('@stage orderEntry.createDialog foo=bar', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'UNSUPPORTED_SCRIPT_ACTION');
    assert.match(error.message, /Unsupported stage option "foo"/u);
    return true;
  });
});

test('parseVideoScript does not treat @stagefoo as a stage declaration', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('旁白：执行未知指令\n@stagefoo orderEntry.list', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'UNSUPPORTED_SCRIPT_ACTION');
    assert.match(error.message, /@stagefoo orderEntry\.list/u);
    return true;
  });
});

test('parseVideoScript rejects empty stage declarations with a clear error', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('@stage', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'UNSUPPORTED_SCRIPT_ACTION');
    assert.match(error.message, /must include a stage name/u);
    return true;
  });
});

test('parseVideoScript rejects stage options without a stage name with a clear error', () => {
  const config = loadVideoGeneratorConfig();

  assert.throws(() => parseVideoScript('@stage scope=.x', config), (error) => {
    assert.ok(error instanceof VideoGeneratorError);
    assert.equal(error.code, 'UNSUPPORTED_SCRIPT_ACTION');
    assert.match(error.message, /must put the stage name before options/u);
    return true;
  });
});

test('parseVideoScript binds actions to the nearest preceding stage inside the same block', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：同一段内切换区域
打开 https://example.com/orders
@stage orderEntry.list
点击 "查询"
@stage orderEntry.createDialog scope=.el-dialog:visible
在选择器 input[name='customer'] 输入 测试客户`, config);

  assert.deepEqual(timeline.stages, [
    { name: 'orderEntry.list', anchors: [] },
    { name: 'orderEntry.createDialog', scope: '.el-dialog:visible', anchors: [] },
  ]);
  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'goto', url: 'https://example.com/orders' },
    { type: 'click', text: '查询', stageName: 'orderEntry.list' },
    {
      type: 'fill',
      selector: "input[name='customer']",
      value: '测试客户',
      stageName: 'orderEntry.createDialog',
    },
  ]);
});

test('parseVideoScript keeps legacy scripts without stageName when no stage alias is declared', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript('旁白：打开页面\n打开 https://example.com', config);

  assert.equal(timeline.stages, undefined);
  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'goto', url: 'https://example.com' },
  ]);
});

test('Pacdora example reveals the tray box card before opening its detail page', async () => {
  const script = await readFile('examples/video-generator/pacdora-dieline.md', 'utf8');
  const detailUrl = 'https://www.pacdora.cn/dielines-detail/custom-dimensions-tray-boxes-dieline-128020';
  const targetSelector = 'a[href*="custom-dimensions-tray-boxes-dieline-128020"]';
  const actionLines = script
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const scrollLine = `向下滚动到选择器 ${targetSelector}`;
  const clickLine = `点击选择器 ${targetSelector}`;
  const scrollIndex = actionLines.indexOf(scrollLine);
  const clickIndex = actionLines.indexOf(clickLine);

  assert.notEqual(scrollIndex, -1);
  assert.notEqual(clickIndex, -1);
  assert.ok(scrollIndex < clickIndex);
  assert.ok(actionLines.includes('等待选择器 .size-mode-item[gtm="ga-dieline_dieline_basic_inner"]'));
  assert.ok(actionLines.includes('等待隐藏选择器 text=构建模型'));
  assert.ok(actionLines.includes('点击选择器 .size-mode-item[gtm="ga-dieline_dieline_basic_inner"]'));
  assert.ok(actionLines.includes('等待选择器 input.number-input-box.paInput >> nth=0'));
  assert.ok(actionLines.includes('在选择器 input.number-input-box.paInput >> nth=0 输入 300'));
  assert.ok(actionLines.includes('在选择器 input.number-input-box.paInput >> nth=1 输入 300'));
  assert.ok(actionLines.includes('在选择器 input.number-input-box.paInput >> nth=2 输入 100'));
  assert.ok(actionLines.includes('等待 300 × 300 × 100 mm'));
  assert.ok(!actionLines.includes(`打开 ${detailUrl}`));
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
