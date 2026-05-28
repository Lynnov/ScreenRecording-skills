import type { BrowserContext, Locator, Page } from 'playwright';

export interface CursorOverlayController {
  ensure(page: Page): Promise<void>;
  moveToLocator(locator: Locator, timeoutMs: number): Promise<void>;
  moveToPoint(page: Page, point: { x: number; y: number }): Promise<void>;
  click(page: Page): Promise<void>;
}

const CURSOR_OVERLAY_INSTALL_SCRIPT = `
(() => {
  const overlayId = '__video-generator-cursor-overlay';
  const clickingClass = '__video-generator-cursor-clicking';

  function install() {
    const existing = globalThis.__videoGeneratorCursorOverlay;
    if (existing !== undefined) {
      existing.ensure();
      return existing;
    }

    let x = 32;
    let y = 32;
    let clicking = false;
    let clickTimer;

    const style = document.createElement('style');
    style.id = overlayId + '-style';
    style.textContent = [
      '#' + overlayId + ' {',
      '  position: fixed;',
      '  left: 0;',
      '  top: 0;',
      '  width: 42px;',
      '  height: 42px;',
      '  pointer-events: none;',
      '  z-index: 2147483647;',
      '  transform: translate3d(calc(var(--video-cursor-x, 32px) - 6px), calc(var(--video-cursor-y, 32px) - 3px), 0);',
      '  transition: transform 160ms ease-out;',
      '  filter: drop-shadow(0 2px 4px rgb(15 23 42 / 35%));',
      '}',
      '#' + overlayId + ' svg {',
      '  position: absolute;',
      '  left: 0;',
      '  top: 0;',
      '  width: 34px;',
      '  height: 34px;',
      '}',
      '#' + overlayId + ' .__video-generator-cursor-ring {',
      '  position: absolute;',
      '  left: -7px;',
      '  top: -7px;',
      '  width: 30px;',
      '  height: 30px;',
      '  border: 3px solid rgb(37 99 235 / 85%);',
      '  border-radius: 999px;',
      '  opacity: 0;',
      '  transform: scale(0.35);',
      '}',
      '#' + overlayId + '.' + clickingClass + ' .__video-generator-cursor-ring {',
      '  animation: __videoGeneratorCursorPulse 280ms ease-out;',
      '}',
      '#' + overlayId + '.' + clickingClass + ' svg {',
      '  transform: translate(1px, 1px) scale(0.96);',
      '}',
      '@keyframes __videoGeneratorCursorPulse {',
      '  0% { opacity: 0.9; transform: scale(0.35); }',
      '  100% { opacity: 0; transform: scale(1.7); }',
      '}',
    ].join('\\n');

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = [
      '<div class="__video-generator-cursor-ring"></div>',
      '<svg viewBox="0 0 32 32" role="img" aria-label="cursor pointer">',
      '<path d="M8 3.8c0-1.2.9-2.1 2.1-2.1s2.1.9 2.1 2.1v9.4l1.3-1.1c.8-.7 2-.6 2.7.2.4.5.5 1.1.4 1.6l1.2-1c.8-.7 2-.6 2.7.2.4.5.5 1.1.4 1.7l.8-.7c.8-.7 2-.6 2.7.2.5.6.6 1.4.3 2.1l-3.8 9.1c-.8 1.9-2.7 3.1-4.8 3.1h-4.4c-1.6 0-3.1-.7-4.1-1.9L2.9 21c-.8-1-.7-2.4.3-3.2.9-.7 2.1-.7 3 .1l1.8 1.7V3.8Z" fill="white" stroke="#0f172a" stroke-width="1.7" stroke-linejoin="round"/>',
      '<path d="M12.2 13.2v6.1M16.5 14v5.3M20.8 14.8v4.5" fill="none" stroke="#64748b" stroke-width="1.2" stroke-linecap="round"/>',
      '</svg>',
    ].join('');

    function attach() {
      if (document.head !== null && document.getElementById(style.id) === null) {
        document.head.append(style);
      }
      if (document.body !== null && document.getElementById(overlayId) === null) {
        document.body.append(overlay);
      }
      overlay.style.setProperty('--video-cursor-x', x + 'px');
      overlay.style.setProperty('--video-cursor-y', y + 'px');
    }

    const api = {
      ensure() {
        attach();
      },
      moveTo(nextX, nextY) {
        x = nextX;
        y = nextY;
        attach();
        overlay.style.setProperty('--video-cursor-x', x + 'px');
        overlay.style.setProperty('--video-cursor-y', y + 'px');
      },
      click() {
        attach();
        clicking = true;
        overlay.classList.remove(clickingClass);
        void overlay.offsetWidth;
        overlay.classList.add(clickingClass);
        if (clickTimer !== undefined) {
          globalThis.clearTimeout(clickTimer);
        }
        clickTimer = globalThis.setTimeout(() => {
          clicking = false;
          overlay.classList.remove(clickingClass);
        }, 300);
      },
      debugState() {
        return { x, y, clicking };
      },
    };

    globalThis.__videoGeneratorCursorOverlay = api;
    attach();
    return api;
  }

  install();
})();
`;

export async function installCursorOverlay(context: BrowserContext): Promise<CursorOverlayController> {
  await context.addInitScript(CURSOR_OVERLAY_INSTALL_SCRIPT);
  return createCursorOverlayController();
}

export async function ensureCursorOverlay(page: Page): Promise<void> {
  await page.evaluate(CURSOR_OVERLAY_INSTALL_SCRIPT);
  await page.evaluate('globalThis.__videoGeneratorCursorOverlay?.ensure()');
}

export function createCursorOverlayController(): CursorOverlayController {
  return {
    async ensure(page) {
      await ensureCursorOverlay(page);
    },
    async moveToLocator(locator, timeoutMs) {
      const point = await locatorCenter(locator, timeoutMs);
      const page = locator.page();
      await moveMouseAndOverlay(page, point);
    },
    async moveToPoint(page, point) {
      await moveMouseAndOverlay(page, point);
    },
    async click(page) {
      await ensureCursorOverlay(page);
      await page.evaluate('globalThis.__videoGeneratorCursorOverlay?.click()');
      await page.waitForTimeout(40);
    },
  };
}

export function createNoopCursorOverlayController(): CursorOverlayController {
  return {
    async ensure() {},
    async moveToLocator() {},
    async moveToPoint() {},
    async click() {},
  };
}

export async function locatorCenter(locator: Locator, timeoutMs: number): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  const box = await locator.boundingBox({ timeout: timeoutMs });
  if (box === null) {
    throw new Error('Cannot position cursor overlay because target has no bounding box.');
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function moveMouseAndOverlay(page: Page, point: { x: number; y: number }): Promise<void> {
  await ensureCursorOverlay(page);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(({ x, y }) => {
    const overlay = globalThis as typeof globalThis & {
      __videoGeneratorCursorOverlay?: { moveTo(x: number, y: number): void };
    };
    overlay.__videoGeneratorCursorOverlay?.moveTo(x, y);
  }, point);
  await page.waitForTimeout(120);
}
