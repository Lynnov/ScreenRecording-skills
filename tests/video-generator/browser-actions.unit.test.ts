import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { executeBrowserAction, waitForTarget } from '../../src/lib/video-generator/browser/actions.js';
import type { CursorOverlayController } from '../../src/lib/video-generator/browser/cursor-overlay.js';
import { VideoGeneratorError } from '../../src/lib/video-generator/types.js';

function recordingCursor(events: string[]): CursorOverlayController {
  return {
    async ensure() {
      events.push('ensure');
    },
    async moveToLocator(locator: Locator) {
      const text = await locator.textContent().catch(() => undefined);
      events.push(`move:${text?.trim() || 'locator'}`);
    },
    async moveToPoint(_page: Page, point: { x: number; y: number }) {
      events.push(`move-point:${point.x},${point.y}`);
    },
    async click() {
      events.push('click');
    },
  };
}

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

test('executeBrowserAction opens hover menu before clicking submenu item', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button>开启工作</button>
      <nav hidden>
        <div class="menu">原纸贸易</div>
        <button class="submenu" hidden>订单录入</button>
      </nav>
      <p id="result"></p>
      <script>
        document.querySelector('button').addEventListener('click', () => document.querySelector('nav').hidden = false);
        document.querySelector('.menu').addEventListener('mouseenter', () => document.querySelector('.submenu').hidden = false);
        document.querySelector('.submenu').addEventListener('click', () => document.querySelector('#result').textContent = '订单页已打开');
      </script>
    `);

    const events: string[] = [];

    await executeBrowserAction(page, { type: 'click', text: '开启工作', waitFor: { type: 'text', value: '原纸贸易' } }, 1000);
    await executeBrowserAction(page, { type: 'hover', text: '原纸贸易', waitFor: { type: 'text', value: '订单录入' } }, 1000, recordingCursor(events));
    await executeBrowserAction(page, { type: 'click', text: '订单录入', waitFor: { type: 'text', value: '订单页已打开' } }, 1000);

    assert.deepEqual(events, ['move:原纸贸易']);
    assert.equal(await page.locator('#result').innerText(), '订单页已打开');
  });
});

test('executeBrowserAction supports readonly remote select first option', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label class="el-form-item">客户名称 <input id="customer" readonly /></label>
      <ul class="el-select-dropdown" hidden></ul>
      <p id="selected"></p>
      <script>
        const input = document.querySelector('#customer');
        const dropdown = document.querySelector('.el-select-dropdown');
        input.addEventListener('click', () => dropdown.hidden = false);
        input.addEventListener('keydown', () => dropdown.hidden = false);
        input.addEventListener('input', () => {
          dropdown.hidden = false;
          dropdown.innerHTML = input.value.includes('测试')
            ? '<li class="el-select-dropdown__item">测试客户一</li><li class="el-select-dropdown__item">测试客户二</li>'
            : '';
          dropdown.querySelectorAll('li').forEach((item) => item.addEventListener('click', () => {
            input.value = item.textContent;
            document.querySelector('#selected').textContent = item.textContent;
            dropdown.hidden = true;
          }));
        });
      </script>
    `);

    await executeBrowserAction(page, {
      type: 'remoteSelect',
      text: '客户名称',
      query: '测试',
      selectFirst: true,
    }, 1000);

    assert.equal(await page.locator('#selected').innerText(), '测试客户一');
  });
});

test('executeBrowserAction uploads from text button adjacent file input', async () => {
  const outputDir = path.join(tmpdir(), `browser-actions-button-upload-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const uploadPath = path.join(outputDir, 'button contract.pdf');
  await writeFile(uploadPath, 'demo');

  try {
    await withPage(async (page) => {
      await page.setContent(`
        <button type="button">合同附件</button><input id="contract" type="file" />
        <p id="uploaded"></p>
        <script>
          document.querySelector('#contract').addEventListener('change', (event) => {
            document.querySelector('#uploaded').textContent = event.target.files[0].name;
          });
        </script>
      `);

      await executeBrowserAction(page, { type: 'uploadFile', text: '合同附件', path: uploadPath, waitFor: { type: 'text', value: 'button contract.pdf' } }, 1000);

      assert.equal(await page.locator('#uploaded').innerText(), 'button contract.pdf');
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('executeBrowserAction rejects ambiguous nearby file inputs instead of picking first', async () => {
  const outputDir = path.join(tmpdir(), `browser-actions-ambiguous-upload-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const uploadPath = path.join(outputDir, 'ambiguous.pdf');
  await writeFile(uploadPath, 'demo');

  try {
    await withPage(async (page) => {
      await page.setContent(`
        <div class="upload"><button type="button">合同附件</button><span></span><input id="wrong" type="file" /><input id="right" type="file" /></div>
      `);

      await assert.rejects(
        () => executeBrowserAction(page, { type: 'uploadFile', text: '合同附件', path: uploadPath }, 1000),
        (error) => error instanceof VideoGeneratorError
          && error.code === 'NO_TARGET_FOUND'
          && error.message.includes('Multiple file inputs'),
      );
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('executeBrowserAction selects first address and uploads a file', async () => {
  const outputDir = path.join(tmpdir(), `browser-actions-upload-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const uploadPath = path.join(outputDir, 'demo contract.pdf');
  await writeFile(uploadPath, 'demo');

  try {
    await withPage(async (page) => {
      await page.setContent(`
        <label>收货地址
          <select id="address"><option value="addr-1">地址一</option><option value="addr-2">地址二</option></select>
        </label>
        <div class="upload-row">
          <button type="button">合同附件</button>
          <input id="contract" type="file" />
        </div>
        <p id="uploaded"></p>
        <script>
          document.querySelector('#contract').addEventListener('change', (event) => {
            document.querySelector('#uploaded').textContent = event.target.files[0].name;
          });
        </script>
      `);

      await executeBrowserAction(page, { type: 'selectFirst', text: '收货地址' }, 1000);
      await executeBrowserAction(page, { type: 'uploadFile', text: '合同附件', path: uploadPath, waitFor: { type: 'text', value: 'demo contract.pdf' } }, 1000);

      assert.equal(await page.locator('#address').inputValue(), 'addr-1');
      assert.equal(await page.locator('#uploaded').innerText(), 'demo contract.pdf');
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
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
const unsupportedAction = { type: 'doubleClick', selector: 'button' } as any;

test('executeBrowserAction reports unsupported action separately from missing action', async () => {
  await withPage(async (page) => {
    await page.setContent('<button>Exists</button>');

    await assert.rejects(
      () => executeBrowserAction(page, unsupportedAction, 100),
      (error) => error instanceof VideoGeneratorError
        && error.code === 'UNSUPPORTED_SCRIPT_ACTION'
        && error.message.includes('Unsupported action type: doubleClick'),
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
