import type { Page } from 'playwright';
import type { CandidateLayer } from '../types.js';

export interface PageSnapshotCandidate {
  role?: string;
  name: string;
  text?: string;
  selectorHint?: string;
  scopeHint?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  context?: string;
  state: {
    visible: boolean;
    enabled: boolean;
    editable: boolean;
    checked?: boolean;
    selected?: boolean;
  };
  layer: CandidateLayer;
}

export interface PageSnapshot {
  url: string;
  title: string;
  capturedAt: string;
  candidates: PageSnapshotCandidate[];
}

export async function capturePageSnapshot(page: Page): Promise<PageSnapshot> {
  const candidates = await page.evaluate<PageSnapshotCandidate[]>(`(() => {
    const candidateSelector = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[contenteditable="true"]',
      '[contenteditable=""]',
      '.el-select-dropdown__item',
      '[class*="select-option"]'
    ].join(',');

    const seen = new Set();

    function compactText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function labelText(element) {
      if (element.id) {
        const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        if (label) {
          return compactText(label.textContent);
        }
      }

      const parentLabel = element.closest('label');
      return parentLabel ? compactText(parentLabel.textContent) : '';
    }

    function labelledByText(element) {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (!labelledBy) {
        return '';
      }

      return compactText(labelledBy.split(/\s+/).map((id) => {
        const label = document.getElementById(id);
        return label ? label.textContent : '';
      }).join(' '));
    }

    function candidateName(element) {
      const ariaLabel = compactText(element.getAttribute('aria-label'));
      if (ariaLabel) return ariaLabel;

      const labelledBy = labelledByText(element);
      if (labelledBy) return labelledBy;

      const label = labelText(element);
      if (label) return label;

      const placeholder = compactText(element.getAttribute('placeholder'));
      if (placeholder) return placeholder;

      const title = compactText(element.getAttribute('title'));
      if (title) return title;

      const text = compactText(element.textContent);
      if (text) return text;

      return compactText(element.getAttribute('value'));
    }

    function inferredRole(element) {
      const explicitRole = compactText(element.getAttribute('role'));
      if (explicitRole) return explicitRole;

      const tag = element.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        if (['checkbox', 'radio'].includes(type)) return type;
        return 'textbox';
      }
      if (element instanceof HTMLElement && element.isContentEditable) return 'textbox';
      if (element.matches('.el-select-dropdown__item, [class*="select-option"]')) return 'option';
      return undefined;
    }

    function selectorHint(element) {
      if (element.id) return '#' + CSS.escape(element.id);
      const testId = element.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId.replace(/"/g, '\\"') + '"]';
      const dataTest = element.getAttribute('data-test');
      if (dataTest) return '[data-test="' + dataTest.replace(/"/g, '\\"') + '"]';
      const dataValue = element.getAttribute('data-value');
      if (dataValue) return '[data-value="' + dataValue.replace(/"/g, '\\"') + '"]';
      const tag = element.tagName.toLowerCase();
      const className = Array.from(element.classList || [])
        .slice(0, 2)
        .map((name) => '.' + CSS.escape(name))
        .join('');
      return tag + className;
    }

    function layerFor(element) {
      if (element.closest('.el-select-dropdown__item, [class*="select-option"], [role="listbox"], [role="menu"]')) {
        return 'dropdown';
      }
      if (element.closest('[role="status"], [role="alert"], .toast, .notification, [class*="toast"], [class*="notification"]')) {
        return 'toast';
      }
      if (element.closest('[popover], [role="tooltip"], .popover, [class*="popover"], [class*="tooltip"]')) {
        return 'popover';
      }
      if (element.closest('.drawer, [class*="drawer"], [data-layer="drawer"]')) {
        return 'drawer';
      }
      if (element.closest('.modal-backdrop, .overlay, [class*="overlay"], [class*="backdrop"], [data-layer="overlay"]')) {
        return 'overlay';
      }
      if (element.closest('dialog, [role="dialog"], [aria-modal="true"]')) {
        return 'dialog';
      }
      return 'page';
    }

    function isGoodScopeCandidate(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      if (element === document.body || element === document.documentElement) {
        return false;
      }

      if (element.matches('dialog, [role="dialog"], [aria-modal="true"], [role="listbox"], [role="menu"], [popover], .drawer, [class*="drawer"], .popover, [class*="popover"], .el-select-dropdown, [class*="select-dropdown"], .el-dropdown, [class*="dropdown"]')) {
        return true;
      }

      if (element.id || element.getAttribute('data-testid') || element.getAttribute('data-test')) {
        return true;
      }

      return element.classList.length > 0
        && ['div', 'section', 'article', 'aside', 'main', 'form', 'nav'].includes(element.tagName.toLowerCase());
    }

    function scopeSelector(element) {
      if (element.id) return '#' + CSS.escape(element.id);

      const testId = compactText(element.getAttribute('data-testid'));
      if (testId) {
        return '[data-testid="' + testId.replace(/"/g, '\\"') + '"]';
      }

      const dataTest = compactText(element.getAttribute('data-test'));
      if (dataTest) {
        return '[data-test="' + dataTest.replace(/"/g, '\\"') + '"]';
      }

      const dataValue = compactText(element.getAttribute('data-value'));
      if (dataValue) {
        return '[data-value="' + dataValue.replace(/"/g, '\\"') + '"]';
      }

      const ariaLabel = compactText(element.getAttribute('aria-label'));
      if (ariaLabel) {
        const role = compactText(element.getAttribute('role'));
        const selectorRole = role ? '[role="' + role + '"]' : element.tagName.toLowerCase();
        return selectorRole + '[aria-label="' + ariaLabel.replace(/"/g, '\\"') + '"]';
      }

      const title = compactText(element.querySelector('[slot="title"], h1, h2, h3, [data-dialog-title], [data-popover-title]')?.textContent);
      if (title) {
        const role = compactText(element.getAttribute('role'));
        const selectorRole = role ? '[role="' + role + '"]' : element.tagName.toLowerCase();
        return selectorRole + ':has-text("' + title.replace(/"/g, '\\"') + '")';
      }

      const role = compactText(element.getAttribute('role'));
      if (role) {
        return '[role="' + role + '"]';
      }

      const tag = element.tagName.toLowerCase();
      const className = Array.from(element.classList || [])
        .slice(0, 2)
        .map((name) => '.' + CSS.escape(name))
        .join('');
      return tag + className;
    }

    function scopeHint(element) {
      let current = element.parentElement;
      while (current) {
        if (isGoodScopeCandidate(current)) {
          return scopeSelector(current);
        }
        current = current.parentElement;
      }

      return undefined;
    }

    function contextText(element) {
      const parent = element.closest('form, section, article, main, [role="dialog"]') || element.parentElement;
      const text = parent ? compactText(parent.textContent).slice(0, 160) : '';
      return text || undefined;
    }

    return Array.from(document.querySelectorAll(candidateSelector)).flatMap((element) => {
      if (seen.has(element) || !isVisible(element)) {
        return [];
      }
      seen.add(element);

      const name = candidateName(element);
      if (!name) {
        return [];
      }

      const rect = element.getBoundingClientRect();
      const role = inferredRole(element);
      const text = compactText(element.textContent);
      const disabled = Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true');
      const editable = Boolean(
        !disabled && (
          element.isContentEditable
          || element.matches('textarea, select')
          || (element.matches('input') && !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden'].includes((element.getAttribute('type') || 'text').toLowerCase()))
          || element.getAttribute('role') === 'textbox'
        )
      );

      return [{
        role,
        name,
        text: text || undefined,
        selectorHint: selectorHint(element),
        scopeHint: scopeHint(element),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        context: contextText(element),
        state: {
          visible: true,
          enabled: !disabled,
          editable,
          checked: element.checked === undefined ? undefined : Boolean(element.checked),
          selected: element.selected === undefined ? undefined : Boolean(element.selected)
        },
        layer: layerFor(element)
      }];
    });
  })()`);

  return {
    url: page.url(),
    title: await page.title(),
    capturedAt: new Date().toISOString(),
    candidates,
  };
}
