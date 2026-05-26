import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { capturePageSnapshot, type PageSnapshotCandidate } from '../../src/lib/video-generator/browser/page-snapshot.js';

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const page = await context.newPage();
    await run(page);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function findCandidate(candidates: PageSnapshotCandidate[], name: string): PageSnapshotCandidate | undefined {
  return candidates.find((candidate) => candidate.name === name);
}

test('capturePageSnapshot extracts link candidates with role and name', async () => {
  await withPage(async (page) => {
    await page.setContent('<a href="/docs">文档</a>');

    const snapshot = await capturePageSnapshot(page);
    const candidate = findCandidate(snapshot.candidates, '文档');

    assert.equal(candidate?.role, 'link');
    assert.equal(candidate?.name, '文档');
    assert.equal(candidate?.state.visible, true);
    assert.equal(candidate?.state.enabled, true);
    assert.equal(candidate?.state.editable, false);
  });
});

test('capturePageSnapshot extracts button candidates with role and name', async () => {
  await withPage(async (page) => {
    await page.setContent('<button>登录</button>');

    const snapshot = await capturePageSnapshot(page);
    const candidate = findCandidate(snapshot.candidates, '登录');

    assert.equal(candidate?.role, 'button');
    assert.equal(candidate?.name, '登录');
    assert.equal(candidate?.state.visible, true);
    assert.equal(candidate?.state.enabled, true);
    assert.equal(candidate?.state.editable, false);
  });
});

test('capturePageSnapshot uses label text as textbox name', async () => {
  await withPage(async (page) => {
    await page.setContent('<label>邮箱 <input id="email" /></label>');

    const snapshot = await capturePageSnapshot(page);
    const candidate = findCandidate(snapshot.candidates, '邮箱');

    assert.equal(candidate?.role, 'textbox');
    assert.equal(candidate?.name, '邮箱');
    assert.equal(candidate?.state.visible, true);
    assert.equal(candidate?.state.enabled, true);
    assert.equal(candidate?.state.editable, true);
  });
});

test('capturePageSnapshot uses placeholder text as textbox name', async () => {
  await withPage(async (page) => {
    await page.setContent('<input placeholder="搜索产品" />');

    const snapshot = await capturePageSnapshot(page);
    const candidate = findCandidate(snapshot.candidates, '搜索产品');

    assert.equal(candidate?.role, 'textbox');
    assert.equal(candidate?.name, '搜索产品');
  });
});

test('capturePageSnapshot marks aria-labelled controls inside dialogs as dialog layer', async () => {
  await withPage(async (page) => {
    await page.setContent('<div role="dialog" aria-label="登录弹窗"><button aria-label="确认登录"></button></div>');

    const snapshot = await capturePageSnapshot(page);
    const candidate = findCandidate(snapshot.candidates, '确认登录');

    assert.equal(candidate?.role, 'button');
    assert.equal(candidate?.name, '确认登录');
    assert.equal(candidate?.layer, 'dialog');
    assert.equal(candidate?.scopeHint, '[role="dialog"][aria-label="登录弹窗"]');
  });
});

test('capturePageSnapshot marks element-plus dropdown items as dropdown layer', async () => {
  await withPage(async (page) => {
    await page.setContent('<div class="el-select-dropdown__item">平台团购</div>');

    const snapshot = await capturePageSnapshot(page);
    const candidate = findCandidate(snapshot.candidates, '平台团购');

    assert.equal(candidate?.name, '平台团购');
    assert.equal(candidate?.layer, 'dropdown');
  });
});

test('capturePageSnapshot marks drawer popover toast and overlay layers', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <aside role="dialog" class="drawer"><button>抽屉操作</button></aside>
      <div class="popover"><button>气泡操作</button></div>
      <div role="status"><button>提示操作</button></div>
      <div class="modal-backdrop"><button>遮罩操作</button></div>
    `);

    const snapshot = await capturePageSnapshot(page);

    assert.equal(findCandidate(snapshot.candidates, '抽屉操作')?.layer, 'drawer');
    assert.equal(findCandidate(snapshot.candidates, '气泡操作')?.layer, 'popover');
    assert.equal(findCandidate(snapshot.candidates, '提示操作')?.layer, 'toast');
    assert.equal(findCandidate(snapshot.candidates, '遮罩操作')?.layer, 'overlay');
  });
});

test('capturePageSnapshot preserves test selector hints context and bounds', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <section aria-label="Account panel">
        <button data-testid="login-action">测试 ID 按钮</button>
        <button data-test="signup-action" style="width: 120px; height: 32px">测试属性按钮</button>
      </section>
    `);

    const snapshot = await capturePageSnapshot(page);
    const testIdCandidate = findCandidate(snapshot.candidates, '测试 ID 按钮');
    const dataTestCandidate = findCandidate(snapshot.candidates, '测试属性按钮');

    assert.equal(testIdCandidate?.selectorHint, '[data-testid="login-action"]');
    assert.equal(dataTestCandidate?.selectorHint, '[data-test="signup-action"]');
    assert.ok(dataTestCandidate?.context?.includes('测试属性按钮'));
    assert.equal(typeof dataTestCandidate?.bounds?.x, 'number');
    assert.equal(typeof dataTestCandidate?.bounds?.y, 'number');
    assert.ok((dataTestCandidate?.bounds?.width ?? 0) > 0);
    assert.ok((dataTestCandidate?.bounds?.height ?? 0) > 0);
  });
});

test('capturePageSnapshot excludes display none buttons', async () => {
  await withPage(async (page) => {
    await page.setContent('<button style="display:none">隐藏按钮</button><button>可见按钮</button>');

    const snapshot = await capturePageSnapshot(page);
    const visibleButton = findCandidate(snapshot.candidates, '可见按钮');

    assert.equal(findCandidate(snapshot.candidates, '隐藏按钮'), undefined);
    assert.equal(visibleButton?.state.visible, true);
    assert.equal(visibleButton?.state.enabled, true);
    assert.equal(visibleButton?.state.editable, false);
  });
});
