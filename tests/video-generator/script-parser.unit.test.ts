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
      ['click', 'semanticFill'],
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
    { type: 'semanticFill', target: { kind: 'field', name: '用户名' }, value: 'alice' },
  ]);
});

test('parseVideoScript parses quoted fill values that contain the separator word', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript('旁白：填写备注\n在 "备注" 输入 "请 输入 名称"', config);

  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'semanticFill', target: { kind: 'field', name: '备注' }, value: '请 输入 名称' },
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

test('parseVideoScript parses Phase 3 actions and preserves business query text', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：操作复杂表单
悬停 原纸贸易
悬停选择器 .menu-item
远程选择 客户名称 测试 第一个
远程选择 客户名称 测试 选择 张三公司
选择 收货地址 第一个`, config);

  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'hover', text: '原纸贸易' },
    { type: 'hover', selector: '.menu-item' },
    { type: 'remoteSelect', text: '客户名称', query: '测试', selectFirst: true },
    { type: 'remoteSelect', text: '客户名称', query: '测试', option: '张三公司' },
    { type: 'selectFirst', text: '收货地址' },
  ]);
});

test('parseVideoScript parses quoted Phase 3 action targets', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：操作带空格字段
远程选择 “客户 名称” “测试 公司” 选择 “张三 公司”
选择 “收货 地址” 第一个
上传文件选择器 "input[type=file]" "fixtures/contracts/demo contract.pdf"`, config);

  assert.deepEqual(timeline.segments[0].actions, [
    { type: 'remoteSelect', text: '客户 名称', query: '测试 公司', option: '张三 公司' },
    { type: 'selectFirst', text: '收货 地址' },
    { type: 'uploadFile', selector: 'input[type=file]', path: 'fixtures/contracts/demo contract.pdf' },
  ]);
});

test('parseVideoScript parses upload file actions with quoted targets and paths', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：上传合同
上传文件 合同附件 fixtures/contracts/demo.pdf

旁白：上传带空格文件
上传文件 “合同 附件” "fixtures/contracts/demo contract.pdf"`, config);

  assert.deepEqual(timeline.segments[0]?.actions, [
    { type: 'uploadFile', text: '合同附件', path: 'fixtures/contracts/demo.pdf' },
  ]);
  assert.deepEqual(timeline.segments[1]?.actions, [
    { type: 'uploadFile', text: '合同 附件', path: 'fixtures/contracts/demo contract.pdf' },
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

test('parseVideoScript parses semantic web interaction actions', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：填写并提交表单
点击按钮 登录
在 邮箱 输入 demo@example.com
选择 销售类型 平台团购
等待出现 登录成功`, config);

  assert.deepEqual(timeline.segments[0]?.actions, [
    { type: 'semanticClick', target: { kind: 'button', name: '登录' } },
    { type: 'semanticFill', target: { kind: 'field', name: '邮箱' }, value: 'demo@example.com' },
    { type: 'semanticSelect', target: { kind: 'field', name: '销售类型' }, option: '平台团购' },
    { type: 'semanticWaitFor', target: { kind: 'visibleText', name: '登录成功' } },
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
