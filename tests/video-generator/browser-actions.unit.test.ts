import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { executeBrowserAction, waitForTarget } from '../../src/lib/video-generator/browser/actions.js';
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

test('executeBrowserAction waits for delayed text targets before link probing', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <script>
        setTimeout(() => {
          document.body.insertAdjacentHTML('beforeend', '<button>开启工作</button>');
          document.querySelector('button').addEventListener('click', () => {
            document.body.insertAdjacentHTML('beforeend', '<p>Started</p>');
          });
        }, 200);
      </script>
    `);

    await executeBrowserAction(page, {
      type: 'click',
      text: '开启工作',
      waitFor: { type: 'text', value: 'Started' },
    }, 1000);

    assert.equal(await page.getByText('Started').count(), 1);
  });
});

test('executeBrowserAction clicks field control for matching text inside active dialog first', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <span>销售类型</span>
      </main>
      <div role="dialog" aria-modal="true">
        <div class="form-row">
          <label>销售类型</label>
          <button aria-label="请选择销售类型">请选择</button>
        </div>
      </div>
      <p id="result">pending</p>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'clicked';
        });
      </script>
    `);

    await executeBrowserAction(page, { type: 'click', text: '销售类型' }, 1000);

    assert.equal(await page.locator('#result').innerText(), 'clicked');
  });
});

test('executeBrowserAction clicks matching text inside active overlay first', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <span>平台团购</span>
        <span>平台团购</span>
      </main>
      <div class="el-select-dropdown" style="position: fixed; left: 20px; top: 20px; z-index: 3000;">
        <div id="option">平台团购</div>
      </div>
      <p id="result">pending</p>
      <script>
        document.querySelector('#option').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'selected';
        });
      </script>
    `);

    await executeBrowserAction(page, { type: 'click', text: '平台团购' }, 1000);

    assert.equal(await page.locator('#result').innerText(), 'selected');
  });
});

test('executeBrowserAction clicks visible select option when text span is hidden', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main><span>全部</span></main>
      <div class="el-select-dropdown" style="position: fixed; left: 20px; top: 20px; z-index: 3000;">
        <li class="el-select-dropdown__item" id="hidden-option"><span style="display: none;">全部</span></li>
        <li class="el-select-dropdown__item" id="visible-option"><span>全部</span></li>
      </div>
      <p id="result">pending</p>
      <script>
        document.querySelector('#visible-option').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'selected';
        });
      </script>
    `);

    await executeBrowserAction(page, { type: 'click', text: '全部' }, 1000);

    assert.equal(await page.locator('#result').innerText(), 'selected');
  });
});

test('executeBrowserAction prefers select overlay over dialog selected value', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div role="dialog" aria-modal="true">
        <span>全部</span>
      </div>
      <div class="el-select-dropdown" style="position: fixed; left: 20px; top: 20px; z-index: 3000;">
        <li class="el-select-dropdown__item" id="option"><span>全部</span></li>
      </div>
      <p id="result">pending</p>
      <script>
        document.querySelector('#option').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'selected';
        });
      </script>
    `);

    await executeBrowserAction(page, { type: 'click', text: '全部' }, 1000);

    assert.equal(await page.locator('#result').innerText(), 'selected');
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

test('executeBrowserAction fills matching placeholder inside active dialog first', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <input id="background" placeholder="调价名称" />
      </main>
      <div role="dialog" aria-modal="true">
        <input id="modal" placeholder="调价名称" />
      </div>
    `);

    await executeBrowserAction(page, { type: 'fill', text: '调价名称', value: '默认调价名称' }, 1000);

    assert.equal(await page.locator('#modal').inputValue(), '默认调价名称');
    assert.equal(await page.locator('#background').inputValue(), '');
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
