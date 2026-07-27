import type { BrowserContext, Page } from 'playwright';

export interface ManualObservedEvent {
  type: 'pointer-click' | 'input' | 'change' | 'scroll' | 'navigation';
  url: string;
  frameUrl: string;
  isMainFrame: boolean;
  target?: {
    tagName?: string;
    id?: string;
    name?: string;
    role?: string;
    text?: string;
    inputType?: string;
    valueLength?: number;
  };
  scrollX?: number;
  scrollY?: number;
  payload?: Record<string, string | number | boolean | null>;
}

export async function installManualObserver(
  context: BrowserContext,
  onEvent: (page: Page, event: ManualObservedEvent) => Promise<void> | void,
): Promise<void> {
  await context.exposeBinding('__videoGeneratorRecordEvent', async ({ page, frame }, event: unknown) => {
    const normalized = normalizeManualObservedEvent(event);
    if (normalized === null) {
      return;
    }
    await onEvent(page, {
      ...normalized,
      frameUrl: frame.url(),
      isMainFrame: frame === page.mainFrame(),
    });
  });
  await context.addInitScript({ content: MANUAL_OBSERVER_SCRIPT });
}

function normalizeManualObservedEvent(value: unknown): Omit<ManualObservedEvent, 'frameUrl' | 'isMainFrame'> | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const type = typeof value.type === 'string' ? value.type : null;
  if (type !== 'pointer-click' && type !== 'input' && type !== 'change' && type !== 'scroll' && type !== 'navigation') {
    return null;
  }
  const event: Omit<ManualObservedEvent, 'frameUrl' | 'isMainFrame'> = {
    type,
    url: typeof value.url === 'string' ? value.url : '',
  };
  if (isPlainObject(value.target)) {
    event.target = whitelistTarget(value.target);
  }
  if (typeof value.scrollX === 'number') event.scrollX = value.scrollX;
  if (typeof value.scrollY === 'number') event.scrollY = value.scrollY;
  if (isPlainObject(value.payload)) {
    event.payload = whitelistPayload(value.payload);
  }
  return event;
}

function whitelistTarget(value: Record<string, unknown>): ManualObservedEvent['target'] {
  const target: NonNullable<ManualObservedEvent['target']> = {};
  for (const key of ['tagName', 'id', 'name', 'role', 'text', 'inputType'] as const) {
    if (typeof value[key] === 'string') {
      target[key] = value[key];
    }
  }
  if (typeof value.valueLength === 'number') {
    target.valueLength = value.valueLength;
  }
  return target;
}

function whitelistPayload(value: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null) {
      payload[key] = entry;
    }
  }
  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

const MANUAL_OBSERVER_SCRIPT = `
(() => {
  if (globalThis.__videoGeneratorManualObserverInstalled) return;
  globalThis.__videoGeneratorManualObserverInstalled = true;

  const emit = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    globalThis.__videoGeneratorRecordEvent?.({
      type: event.type === 'click' ? 'pointer-click' : event.type,
      url: location.href,
      target: describeTarget(target),
      payload: event.type === 'input' || event.type === 'change' ? { valueLength: readValueLength(target) } : undefined,
    });
  };

  const emitScroll = () => {
    globalThis.__videoGeneratorRecordEvent?.({
      type: 'scroll',
      url: location.href,
      scrollX: scrollX,
      scrollY: scrollY,
    });
  };

  const emitNavigation = (kind) => {
    globalThis.__videoGeneratorRecordEvent?.({
      type: 'navigation',
      url: location.href,
      payload: { kind },
    });
  };

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    emitNavigation('pushState');
    return result;
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    emitNavigation('replaceState');
    return result;
  };

  addEventListener('click', emit, { capture: true, passive: true });
  addEventListener('input', emit, { capture: true, passive: true });
  addEventListener('change', emit, { capture: true, passive: true });
  addEventListener('scroll', emitScroll, { capture: true, passive: true });
  addEventListener('popstate', () => emitNavigation('popstate'), { passive: true });
  addEventListener('hashchange', () => emitNavigation('hashchange'), { passive: true });

  function describeTarget(target) {
    if (target === null) return undefined;
    return {
      tagName: target.tagName.toLowerCase(),
      id: target.id || undefined,
      name: target.getAttribute('name') || undefined,
      role: target.getAttribute('role') || undefined,
      text: (target.textContent || '').trim().slice(0, 80),
      inputType: target instanceof HTMLInputElement ? target.type : undefined,
      valueLength: readValueLength(target),
    };
  }

  function readValueLength(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return String(target.value).length;
    }
    return undefined;
  }
})();
`;
