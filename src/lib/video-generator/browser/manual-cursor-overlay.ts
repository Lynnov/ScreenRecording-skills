import type { BrowserContext } from 'playwright';

const MANUAL_CURSOR_OVERLAY_SCRIPT = `
(() => {
  const globalScope = globalThis;
  if (globalScope.__videoGeneratorManualCursorOverlay !== undefined) {
    return;
  }

  const overlayId = '__video-generator-manual-cursor';
  const hideNativeCursorClass = '__video-generator-hide-native-cursor';

  let x = 32;
  let y = 32;
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
    '  transform: translate3d(calc(var(--video-manual-cursor-x, 32px) - 6px), calc(var(--video-manual-cursor-y, 32px) - 3px), 0);',
    '  transition: transform 120ms ease-out, opacity 120ms ease-out;',
    '  filter: drop-shadow(0 2px 4px rgb(15 23 42 / 35%));',
    '}',
    '#' + overlayId + ' svg {',
    '  position: absolute;',
    '  left: 0;',
    '  top: 0;',
    '  width: 34px;',
    '  height: 34px;',
    '}',
    '#' + overlayId + ' .__video-generator-manual-cursor-ring {',
    '  position: absolute;',
    '  left: -7px;',
    '  top: -7px;',
    '  width: 30px;',
    '  height: 30px;',
    '  border: 3px solid rgb(147 51 234 / 85%);',
    '  border-radius: 999px;',
    '  opacity: 0;',
    '  transform: scale(0.35);',
    '}',
    '#' + overlayId + '.is-clicking .__video-generator-manual-cursor-ring {',
    '  animation: __videoGeneratorManualCursorPulse 260ms ease-out;',
    '}',
    '#' + overlayId + '.is-clicking svg {',
    '  transform: translate(1px, 1px) scale(0.96);',
    '}',
    '@keyframes __videoGeneratorManualCursorPulse {',
    '  0% { opacity: 0.9; transform: scale(0.35); }',
    '  100% { opacity: 0; transform: scale(1.7); }',
    '}',
    'html.' + hideNativeCursorClass + ',',
    'html.' + hideNativeCursorClass + ' body,',
    'html.' + hideNativeCursorClass + ' body * { cursor: none !important; }',
  ].join('\\n');

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  overlay.innerHTML = [
    '<div class="__video-generator-manual-cursor-ring"></div>',
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
    if (document.documentElement === null) {
      return;
    }
    overlay.style.setProperty('--video-manual-cursor-x', x + 'px');
    overlay.style.setProperty('--video-manual-cursor-y', y + 'px');
  }

  function moveTo(nextX, nextY) {
    x = nextX;
    y = nextY;
    attach();
    overlay.hidden = false;
    overlay.dataset.visible = 'true';
    overlay.dataset.x = String(x);
    overlay.dataset.y = String(y);
    overlay.style.setProperty('--video-manual-cursor-x', x + 'px');
    overlay.style.setProperty('--video-manual-cursor-y', y + 'px');
    document.documentElement.classList.add(hideNativeCursorClass);
  }

  function hide() {
    overlay.hidden = true;
    overlay.dataset.visible = 'false';
    document.documentElement.classList.remove(hideNativeCursorClass);
  }

  function click() {
    attach();
    overlay.classList.remove('is-clicking');
    void overlay.offsetWidth;
    overlay.classList.add('is-clicking');
    overlay.dataset.pointerState = 'down';
    if (clickTimer !== undefined) {
      clearTimeout(clickTimer);
    }
    clickTimer = setTimeout(() => {
      overlay.classList.remove('is-clicking');
      overlay.dataset.pointerState = 'idle';
    }, 260);
  }

  const api = {
    moveTo,
    click,
    hide,
  };

  globalScope.__videoGeneratorManualCursorOverlay = api;
  overlay.dataset.visible = 'false';
  overlay.dataset.pointerState = 'idle';

  addEventListener('pointermove', (event) => {
    moveTo(event.clientX, event.clientY);
  }, { capture: true, passive: true });
  addEventListener('pointerdown', click, { capture: true, passive: true });
  addEventListener('pointerout', (event) => {
    if (event.relatedTarget === null) {
      hide();
    }
  }, { capture: true, passive: true });
  addEventListener('blur', hide, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hide();
    }
  });

  attach();
  if (document.body === null) {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
})();
`;

export async function installManualCursorOverlay(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: MANUAL_CURSOR_OVERLAY_SCRIPT });
  await Promise.all(context.pages().map(async (page) => {
    await page.addScriptTag({ content: MANUAL_CURSOR_OVERLAY_SCRIPT });
  }));
}
