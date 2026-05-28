import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { remoteSelect, selectFirst } from '../../src/lib/video-generator/browser/interaction-rules.js';

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

test('remoteSelect types query into readonly Element UI style select and chooses first option', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div class="el-form-item"><label>客户名称</label><div class="el-select"><input id="customer" readonly /></div></div>
      <div class="el-select-dropdown" style="display:none"><ul></ul></div>
      <p id="selected"></p>
      <script>
        const input = document.querySelector('#customer');
        const dropdown = document.querySelector('.el-select-dropdown');
        const list = dropdown.querySelector('ul');
        input.addEventListener('click', () => dropdown.style.display = 'block');
        input.addEventListener('input', () => {
          dropdown.style.display = 'block';
          list.innerHTML = input.value.includes('测试')
            ? '<li class="el-select-dropdown__item">测试客户一</li><li class="el-select-dropdown__item">测试客户二</li>'
            : '';
          list.querySelectorAll('li').forEach((item) => item.addEventListener('click', () => {
            input.value = item.textContent;
            document.querySelector('#selected').textContent = item.textContent;
          }));
        });
      </script>
    `);

    await remoteSelect(page, { text: '客户名称', query: '测试', selectFirst: true }, 1000);

    assert.equal(await page.locator('#selected').innerText(), '测试客户一');
  });
});

test('remoteSelect ignores unrelated visible list items outside dropdown containers', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <ul><li id="unrelated">张三公司</li></ul>
      <div class="el-form-item"><label>客户名称</label><div class="el-select"><input id="customer" readonly /></div></div>
      <div class="el-select-dropdown" style="display:none"><ul></ul></div>
      <p id="selected"></p>
      <script>
        document.querySelector('#unrelated').addEventListener('click', () => document.querySelector('#selected').textContent = 'wrong');
        const input = document.querySelector('#customer');
        const dropdown = document.querySelector('.el-select-dropdown');
        const list = dropdown.querySelector('ul');
        input.addEventListener('input', () => {
          dropdown.style.display = 'block';
          list.innerHTML = '<li class="el-select-dropdown__item">张三公司</li>';
          list.querySelector('li').addEventListener('click', () => document.querySelector('#selected').textContent = 'right');
        });
      </script>
    `);

    await remoteSelect(page, { text: '客户名称', query: '测试', option: '张三公司' }, 1000);

    assert.equal(await page.locator('#selected').innerText(), 'right');
  });
});

test('remoteSelect can choose a specified visible option by text', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div class="el-form-item"><label>客户名称</label><div class="el-select"><input id="customer" readonly /></div></div>
      <ul class="el-select-dropdown">
        <li class="el-select-dropdown__item">测试客户一</li>
        <li class="el-select-dropdown__item">张三公司</li>
      </ul>
      <p id="selected"></p>
      <script>
        document.querySelectorAll('li').forEach((item) => item.addEventListener('click', () => {
          document.querySelector('#selected').textContent = item.textContent;
        }));
      </script>
    `);

    await remoteSelect(page, { text: '客户名称', query: '测试', option: '张三公司' }, 1000);

    assert.equal(await page.locator('#selected').innerText(), '张三公司');
  });
});

test('selectFirst ignores unrelated visible list items before opening target dropdown', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <ul><li id="unrelated">错误地址</li></ul>
      <button id="address">收货地址</button>
      <ul class="el-select-dropdown" style="display:none">
        <li class="el-select-dropdown__item">地址一</li>
      </ul>
      <p id="selected"></p>
      <script>
        document.querySelector('#unrelated').addEventListener('click', () => document.querySelector('#selected').textContent = 'wrong');
        document.querySelector('#address').addEventListener('click', () => document.querySelector('.el-select-dropdown').style.display = 'block');
        document.querySelector('.el-select-dropdown__item').addEventListener('click', () => document.querySelector('#selected').textContent = 'right');
      </script>
    `);

    await selectFirst(page, { selector: '#address' }, 1000);

    assert.equal(await page.locator('#selected').innerText(), 'right');
  });
});

test('selectFirst supports an already expanded Element UI dropdown', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="address">收货地址</button>
      <ul class="el-select-dropdown">
        <li class="el-select-dropdown__item">地址一</li>
        <li class="el-select-dropdown__item">地址二</li>
      </ul>
      <p id="selected"></p>
      <script>
        document.querySelectorAll('li').forEach((item) => item.addEventListener('click', () => {
          document.querySelector('#selected').textContent = item.textContent;
        }));
      </script>
    `);

    await selectFirst(page, { selector: '#address' }, 1000);

    assert.equal(await page.locator('#selected').innerText(), '地址一');
  });
});
