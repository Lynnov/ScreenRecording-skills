import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  clickCandidate,
  fillFieldByName,
  selectOptionByFieldName,
} from '../../src/lib/video-generator/browser/interaction-rules.js';
import type { PageSnapshotCandidate } from '../../src/lib/video-generator/browser/page-snapshot.js';

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

function candidate(overrides: Partial<PageSnapshotCandidate>): PageSnapshotCandidate {
  return {
    role: 'button',
    name: 'Save',
    text: 'Save',
    state: {
      visible: true,
      enabled: true,
      editable: false,
    },
    layer: 'page',
    ...overrides,
  };
}

test('clickCandidate clicks the clickable ancestor of a text child candidate', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="save" type="button">
        <span id="save-label">Save changes</span>
      </button>
      <p id="result">Waiting</p>
      <script>
        document.querySelector('#save').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'Saved';
        });
      </script>
    `);

    await clickCandidate(page, candidate({
      name: 'Save changes',
      text: 'Save changes',
      selectorHint: '#save-label',
    }), 1000);

    assert.equal(await page.locator('#result').innerText(), 'Saved');
  });
});

test('clickCandidate ignores broad selector hints and clicks by candidate name', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="first" type="button">Cancel</button>
      <button id="second" type="button">Save changes</button>
      <p id="result">Waiting</p>
      <script>
        document.querySelector('#first').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'Canceled';
        });
        document.querySelector('#second').addEventListener('click', () => {
          document.querySelector('#result').textContent = 'Saved';
        });
      </script>
    `);

    await clickCandidate(page, candidate({
      name: 'Save changes',
      text: 'Save changes',
      selectorHint: 'button',
    }), 1000);

    assert.equal(await page.locator('#result').innerText(), 'Saved');
  });
});

test('fillFieldByName fills fields by label placeholder and aria-label', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label for="full-name">Full name</label>
      <input id="full-name" />
      <textarea placeholder="Short bio"></textarea>
      <input id="search" aria-label="Search query" />
    `);

    await fillFieldByName(page, 'Full name', 'Ada Lovelace', 1000);
    await fillFieldByName(page, 'Short bio', 'First programmer', 1000);
    await fillFieldByName(page, 'Search query', 'analytical engine', 1000);

    assert.equal(await page.locator('#full-name').inputValue(), 'Ada Lovelace');
    assert.equal(await page.locator('textarea').inputValue(), 'First programmer');
    assert.equal(await page.locator('#search').inputValue(), 'analytical engine');
  });
});

test('clickCandidate uses the matched dialog scope instead of the first same-layer dialog', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div role="dialog" aria-label="First dialog">
        <button type="button" onclick="document.querySelector('#result').textContent = 'first'">Confirm</button>
      </div>
      <div role="dialog" aria-label="Second dialog">
        <button type="button" onclick="document.querySelector('#result').textContent = 'second'">Confirm</button>
      </div>
      <p id="result">Waiting</p>
    `);

    await clickCandidate(page, candidate({
      name: 'Confirm',
      text: 'Confirm',
      selectorHint: 'button',
      scopeHint: '[role="dialog"][aria-label="Second dialog"]',
      layer: 'dialog',
    }), 1000);

    assert.equal(await page.locator('#result').innerText(), 'second');
  });
});

test('fillFieldByName uses the matched dialog scope instead of the first same-layer field', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div role="dialog" aria-label="First dialog">
        <label>Email <input id="first-email" /></label>
      </div>
      <div role="dialog" aria-label="Second dialog">
        <label>Email <input id="second-email" /></label>
      </div>
    `);

    await fillFieldByName(page, candidate({
      role: 'textbox',
      name: 'Email',
      text: undefined,
      selectorHint: 'input',
      scopeHint: '[role="dialog"][aria-label="Second dialog"]',
      layer: 'dialog',
      state: { visible: true, enabled: true, editable: true },
    }), 'second@example.test', 1000);

    assert.equal(await page.locator('#first-email').inputValue(), '');
    assert.equal(await page.locator('#second-email').inputValue(), 'second@example.test');
  });
});

test('selectOptionByFieldName opens a combobox and selects a dropdown option', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="plan" role="combobox" aria-label="Plan" aria-expanded="false">Choose plan</button>
      <div id="options" role="listbox" hidden>
        <div role="option" data-value="starter">Starter</div>
        <div role="option" data-value="pro">Pro</div>
      </div>
      <input id="selected-plan" />
      <script>
        const button = document.querySelector('#plan');
        const options = document.querySelector('#options');
        button.addEventListener('click', () => {
          options.hidden = false;
          button.setAttribute('aria-expanded', 'true');
        });
        options.addEventListener('click', (event) => {
          const option = event.target.closest('[role="option"]');
          if (!option) return;
          document.querySelector('#selected-plan').value = option.dataset.value;
          button.textContent = option.textContent;
          options.hidden = true;
        });
      </script>
    `);

    await selectOptionByFieldName(page, 'Plan', 'Pro', 1000);

    assert.equal(await page.locator('#selected-plan').inputValue(), 'pro');
    assert.equal(await page.locator('#plan').innerText(), 'Pro');
  });
});

test('selectOptionByFieldName waits for an asynchronously rendered dropdown option', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="plan" role="combobox" aria-label="Plan" aria-expanded="false">Choose plan</button>
      <div id="options" role="listbox"></div>
      <input id="selected-plan" />
      <script>
        const button = document.querySelector('#plan');
        const options = document.querySelector('#options');
        button.addEventListener('click', () => {
          button.setAttribute('aria-expanded', 'true');
          setTimeout(() => {
            options.innerHTML = '<div role="option" data-value="team">Team</div>';
          }, 100);
        });
        options.addEventListener('click', (event) => {
          const option = event.target.closest('[role="option"]');
          if (!option) return;
          document.querySelector('#selected-plan').value = option.dataset.value;
          button.textContent = option.textContent;
        });
      </script>
    `);

    await selectOptionByFieldName(page, 'Plan', 'Team', 1000);

    assert.equal(await page.locator('#selected-plan').inputValue(), 'team');
    assert.equal(await page.locator('#plan').innerText(), 'Team');
  });
});

test('selectOptionByFieldName selects the option related to the matched entry scope', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <div class="select-shell" id="first-shell">
        <button id="first-plan" role="combobox" aria-label="Plan">Choose plan</button>
        <div id="first-options" role="listbox">
          <div role="option" data-value="starter">Starter</div>
          <div role="option" data-value="pro">Pro</div>
        </div>
      </div>
      <div class="select-shell" id="second-shell">
        <button id="second-plan" role="combobox" aria-label="Plan">Choose plan</button>
        <div id="second-options" role="listbox" hidden>
          <div role="option" data-value="starter">Starter</div>
          <div role="option" data-value="pro">Pro</div>
        </div>
      </div>
      <script>
        for (const root of document.querySelectorAll('.select-shell')) {
          const button = root.querySelector('[role="combobox"]');
          const options = root.querySelector('[role="listbox"]');
          button.addEventListener('click', () => {
            options.hidden = false;
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

    await selectOptionByFieldName(page, candidate({
      role: 'combobox',
      name: 'Plan',
      text: 'Choose plan',
      selectorHint: '#second-plan',
      scopeHint: '#second-shell',
      layer: 'page',
    }), 'Pro', 1000);

    assert.equal(await page.locator('#first-plan').getAttribute('data-value'), null);
    assert.equal(await page.locator('#second-plan').getAttribute('data-value'), 'pro');
  });
});
