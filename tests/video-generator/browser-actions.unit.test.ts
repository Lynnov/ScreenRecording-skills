import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { executeBrowserAction, waitForTarget } from '../../src/lib/video-generator/browser/actions.js';
import { basicDemoDataUrl } from '../../src/lib/video-generator/browser/demo-page.js';
import { VideoGeneratorError } from '../../src/lib/video-generator/types.js';

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

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url === '/detail') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<main><h1>Detail Page</h1></main>');
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected HTTP server to listen on a TCP port.');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test('executeBrowserAction clicks exact text and waits for text', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button>Reveal</button>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          document.body.insertAdjacentHTML('beforeend', '<p>Revealed message</p>');
        });
      </script>
    `);

    await executeBrowserAction(page, {
      type: 'click',
      text: 'Reveal',
      waitFor: { type: 'text', value: 'Revealed message' },
    }, 1000);

    assert.equal(await page.getByText('Revealed message').count(), 1);
  });
});

test('executeBrowserAction fills selector and text targets', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>Name <input id="name" /></label>
      <input id="email" placeholder="Email address" />
    `);

    await executeBrowserAction(page, { type: 'fill', selector: '#name', value: 'Ada' }, 1000);
    await executeBrowserAction(page, { type: 'fill', text: 'Email address', value: 'ada@example.com' }, 1000);

    assert.equal(await page.locator('#name').inputValue(), 'Ada');
    assert.equal(await page.locator('#email').inputValue(), 'ada@example.com');
  });
});

test('executeBrowserAction performs semantic fill, select, click, and waitFor actions', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <form>
        <label for="email">邮箱</label>
        <input id="email" />

        <label for="role">角色</label>
        <select id="role">
          <option value="viewer">访客</option>
          <option value="admin">管理员</option>
        </select>

        <button type="button">登录</button>
      </form>
      <p id="status"></p>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          const email = document.querySelector('#email').value;
          const role = document.querySelector('#role').value;
          if (email === 'demo@example.com' && role === 'admin') {
            document.querySelector('#status').textContent = '登录成功';
          }
        });
      </script>
    `);

    await executeBrowserAction(page, {
      type: 'semanticFill',
      target: { kind: 'field', name: '邮箱' },
      value: 'demo@example.com',
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticSelect',
      target: { kind: 'field', name: '角色' },
      option: '管理员',
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticClick',
      target: { kind: 'button', name: '登录' },
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticWaitFor',
      target: { kind: 'visibleText', name: '登录成功' },
    }, 1000);

    assert.equal(await page.locator('#email').inputValue(), 'demo@example.com');
    assert.equal(await page.locator('#role').inputValue(), 'admin');
    assert.equal(await page.locator('#status').innerText(), '登录成功');
  });
});

test('semantic actions complete the built-in demo page form flow', async () => {
  await withPage(async (page) => {
    await page.goto(basicDemoDataUrl());

    await executeBrowserAction(page, {
      type: 'semanticFill',
      target: { kind: 'field', name: '邮箱' },
      value: 'demo@example.com',
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticFill',
      target: { kind: 'field', name: '姓名' },
      value: 'Ada',
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticSelect',
      target: { kind: 'field', name: '销售类型' },
      option: '平台团购',
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticClick',
      target: { kind: 'button', name: '确认' },
    }, 1000);
    await executeBrowserAction(page, {
      type: 'semanticWaitFor',
      target: { kind: 'visibleText', name: '保存成功' },
    }, 1000);

    assert.equal(await page.getByText('保存成功').count(), 1);
  });
});

test('executeBrowserAction reports ambiguous semantic click targets', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <button>登录</button>
        <button>登录</button>
      </main>
    `);

    await assert.rejects(
      () => executeBrowserAction(page, {
        type: 'semanticClick',
        target: { kind: 'button', name: '登录' },
      }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_CLICK_TARGET'
        && error.message.includes('找到 2 个可能的“登录”目标')
        && error.failureReason === 'AMBIGUOUS_TARGET',
    );
  });
});

test('executeBrowserAction reports ambiguous semantic fill targets before filling', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <label for="primary-email">邮箱</label>
        <input id="primary-email" />
        <label for="backup-email">邮箱</label>
        <input id="backup-email" />
      </main>
    `);

    await assert.rejects(
      () => executeBrowserAction(page, {
        type: 'semanticFill',
        target: { kind: 'field', name: '邮箱' },
        value: 'demo@example.com',
      }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_FILL_TARGET'
        && error.failureReason === 'AMBIGUOUS_TARGET'
        && error.candidates?.length === 2,
    );

    assert.equal(await page.locator('#primary-email').inputValue(), '');
    assert.equal(await page.locator('#backup-email').inputValue(), '');
  });
});

test('executeBrowserAction reports ambiguous semantic select targets before selecting', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <label for="primary-sales-type">销售类型</label>
        <select id="primary-sales-type">
          <option value="retail">零售</option>
          <option value="group">平台团购</option>
        </select>
        <label for="backup-sales-type">销售类型</label>
        <select id="backup-sales-type">
          <option value="retail">零售</option>
          <option value="group">平台团购</option>
        </select>
      </main>
    `);

    await assert.rejects(
      () => executeBrowserAction(page, {
        type: 'semanticSelect',
        target: { kind: 'field', name: '销售类型' },
        option: '平台团购',
      }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_CLICK_TARGET'
        && error.failureReason === 'AMBIGUOUS_TARGET'
        && error.candidates?.length === 2,
    );

    assert.equal(await page.locator('#primary-sales-type').inputValue(), 'retail');
    assert.equal(await page.locator('#backup-sales-type').inputValue(), 'retail');
  });
});

test('semanticClick uses the foreground candidate selected by the matcher', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button type="button" onclick="document.querySelector('#result').textContent = 'page'">确认</button>
      <div role="dialog" aria-label="确认弹窗">
        <button type="button" onclick="document.querySelector('#result').textContent = 'dialog'">确认</button>
      </div>
      <p id="result">waiting</p>
    `);

    await executeBrowserAction(page, {
      type: 'semanticClick',
      target: { kind: 'button', name: '确认' },
    }, 1000);

    assert.equal(await page.locator('#result').innerText(), 'dialog');
  });
});

test('semanticFill uses the foreground field candidate selected by the matcher', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>邮箱 <input id="page-email" /></label>
      <div role="dialog" aria-label="登录弹窗">
        <label>邮箱 <input id="dialog-email" /></label>
      </div>
    `);

    await executeBrowserAction(page, {
      type: 'semanticFill',
      target: { kind: 'field', name: '邮箱' },
      value: 'dialog@example.com',
    }, 1000);

    assert.equal(await page.locator('#page-email').inputValue(), '');
    assert.equal(await page.locator('#dialog-email').inputValue(), 'dialog@example.com');
  });
});

test('executeBrowserAction preserves ambiguous same-layer dialog button targets', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div role="dialog" aria-label="删除确认">
        <button type="button" onclick="document.querySelector('#result').textContent = 'delete-dialog'">确认</button>
      </div>
      <div role="dialog" aria-label="保存确认">
        <button type="button" onclick="document.querySelector('#result').textContent = 'save-dialog'">确认</button>
      </div>
      <p id="result">waiting</p>
    `);

    await assert.rejects(
      () => executeBrowserAction(page, {
        type: 'semanticClick',
        target: { kind: 'button', name: '确认' },
      }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_CLICK_TARGET'
        && error.failureReason === 'AMBIGUOUS_TARGET',
    );

    assert.equal(await page.locator('#result').innerText(), 'waiting');
  });
});

test('semanticSelect uses the matched dropdown option instead of another visible dropdown', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div class="field-shell">
        <button id="page-plan" role="combobox" aria-label="计划" aria-expanded="false">选择计划</button>
        <div id="page-options" role="listbox" hidden>
          <div role="option" data-value="starter">Starter</div>
          <div role="option" data-value="pro">Pro</div>
        </div>
      </div>
      <div class="field-shell" role="dialog" aria-label="会员设置">
        <button id="dialog-plan" role="combobox" aria-label="计划" aria-expanded="false">选择计划</button>
        <div id="dialog-options" role="listbox" hidden>
          <div role="option" data-value="starter">Starter</div>
          <div role="option" data-value="pro">Pro</div>
        </div>
      </div>
      <script>
        for (const root of document.querySelectorAll('.field-shell')) {
          const button = root.querySelector('[role="combobox"]');
          const options = root.querySelector('[role="listbox"]');
          button.addEventListener('click', () => {
            options.hidden = false;
            button.setAttribute('aria-expanded', 'true');
          });
          options.addEventListener('click', (event) => {
            const option = event.target.closest('[role="option"]');
            if (!option) return;
            button.dataset.value = option.dataset.value;
            button.textContent = option.textContent;
            options.hidden = true;
          });
        }
      </script>
    `);

    await executeBrowserAction(page, {
      type: 'semanticSelect',
      target: { kind: 'field', name: '计划' },
      option: 'Pro',
    }, 1000);

    assert.equal(await page.locator('#page-plan').getAttribute('data-value'), null);
    assert.equal(await page.locator('#dialog-plan').getAttribute('data-value'), 'pro');
  });
});

test('semanticSelect uses the foreground select candidate selected by the matcher', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label for="page-role">角色</label>
      <select id="page-role"><option>访客</option><option>管理员</option></select>
      <div role="dialog" aria-label="角色弹窗">
        <label for="dialog-role">角色</label>
        <select id="dialog-role"><option>访客</option><option>管理员</option></select>
      </div>
    `);

    await executeBrowserAction(page, {
      type: 'semanticSelect',
      target: { kind: 'field', name: '角色' },
      option: '管理员',
    }, 1000);

    assert.equal(await page.locator('#page-role').inputValue(), '访客');
    assert.equal(await page.locator('#dialog-role').inputValue(), '管理员');
  });
});

test('semanticWaitFor reports structured diagnostics when visible text times out', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <button>保存</button>
        <p>仍在处理</p>
        <div role="dialog" aria-label="保存状态">
          <span>处理中</span>
        </div>
      </main>
    `);

    await assert.rejects(
      () => executeBrowserAction(page, {
        type: 'semanticWaitFor',
        target: { kind: 'visibleText', name: '保存成功' },
      }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_WAIT_TARGET'
        && error.message.includes('semanticWaitFor 保存成功 timed out')
        && error.failureReason === 'NO_TARGET_FOUND'
        && Array.isArray(error.candidates)
        && error.candidates?.length > 0,
    );
  });
});

test('executeBrowserAction commits filled selector values with keyboard events and blur', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <input id="width" value="200" />
      <p id="committed">200</p>
      <script>
        const input = document.querySelector('#width');
        input.addEventListener('keydown', () => input.dataset.typed = 'true');
        input.addEventListener('change', () => {
          if (input.dataset.typed === 'true') {
            document.querySelector('#committed').textContent = input.value;
          }
        });
      </script>
    `);

    await executeBrowserAction(page, { type: 'fill', selector: '#width', value: '300' }, 1000);

    assert.equal(await page.locator('#width').inputValue(), '300');
    assert.equal(await page.locator('#committed').innerText(), '300');
  });
});

test('waitForTarget supports selector, url, and networkIdle', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <button>Next</button>
        <div class="ready">Ready</div>
      </main>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          history.pushState({}, '', '#next');
        });
      </script>
    `);

    await waitForTarget(page, { type: 'selector', value: '.ready' }, 1000);
    await executeBrowserAction(page, { type: 'click', selector: 'button', waitFor: { type: 'url', value: '#next' } }, 1000);
    await waitForTarget(page, { type: 'networkIdle' }, 1000);

    assert.ok(page.url().endsWith('#next'));
  });
});

test('waitForTarget waits until all matching hidden selector targets disappear', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <p>构建模型</p>
        <span>构建模型</span>
        <script>
          setTimeout(() => document.querySelectorAll('p, span').forEach((element) => element.remove()), 100);
        </script>
      </main>
    `);

    await waitForTarget(page, { type: 'hiddenSelector', value: 'text=构建模型' }, 1000);

    assert.equal(await page.locator('text=构建模型').count(), 0);
  });
});

test('executeBrowserAction scrolls by wheel delta', async () => {
  await withPage(async (page) => {
    await page.setContent('<main style="height: 3000px"><h1>Scrollable</h1></main>');

    await executeBrowserAction(page, { type: 'scroll', y: 500 }, 1000);

    await page.waitForFunction('window.scrollY > 0', undefined, { timeout: 1000 });
    assert.ok(await page.evaluate('window.scrollY > 0'));
  });
});

test('executeBrowserAction scrolls until selector is visible', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main style="height: 2400px">
        <div style="height: 1800px">Top</div>
        <a class="target-card" href="/details">抽屉式礼盒</a>
      </main>
    `);

    await executeBrowserAction(page, {
      type: 'scrollTo',
      target: { type: 'selector', value: '.target-card' },
    }, 1000);

    assert.ok(await page.locator('.target-card').isVisible());
    assert.ok(await page.evaluate('window.scrollY > 0'));
  });
});

test('executeBrowserAction opens target blank links in the same active page', async () => {
  await withServer(async (origin) => {
    await withPage(async (page) => {
      await page.setContent(`
        <a href="${origin}/detail" target="_blank">Open detail</a>
      `);

      const activePage = await executeBrowserAction(page, {
        type: 'click',
        text: 'Open detail',
        waitFor: { type: 'text', value: 'Detail Page' },
      }, 1000);

      assert.equal(activePage, page);
      assert.equal(await activePage.getByText('Detail Page').count(), 1);
    });
  });
});

test('executeBrowserAction uses specific error codes for action failures', async () => {
  await withPage(async (page) => {
    await page.setContent('<button>Exists</button>');

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'goto', url: 'http://127.0.0.1:1/missing' }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_GOTO_URL'
        && error.message.includes('goto'),
    );

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'click', text: 'Missing' }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_CLICK_TARGET'
        && error.message.includes('click')
        && error.message.includes('Missing'),
    );

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'fill', value: 'Ada' }, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_FILL_TARGET'
        && error.message.includes('fill'),
    );
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unsupportedAction = { type: 'hover', selector: 'button' } as any;

test('executeBrowserAction reports unsupported action separately from missing action', async () => {
  await withPage(async (page) => {
    await page.setContent('<button>Exists</button>');

    await assert.rejects(
      () => executeBrowserAction(page, unsupportedAction, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'UNSUPPORTED_SCRIPT_ACTION'
        && error.message.includes('Unsupported action type: hover'),
    );
  });
});

test('executeBrowserAction preserves label fill failure when placeholder fallback exists', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>Locked <button aria-label="Locked">Not an input</button></label>
      <input id="fallback" placeholder="Locked" />
    `);

    await assert.rejects(
      () => executeBrowserAction(page, { type: 'fill', text: 'Locked', value: 'Ada' }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'INVALID_FILL_TARGET'
        && error.message.includes('label')
        && error.message.includes('Locked'),
    );

    assert.equal(await page.locator('#fallback').inputValue(), '');
  });
});
