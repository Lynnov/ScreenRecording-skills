import type { Locator, Page } from 'playwright';
import {
  VideoGeneratorError,
  type ActionCandidateDiagnostic,
  type ActionFailureDiagnostics,
  type BrowserAction,
  type ElementOverlayDiagnostic,
  type WaitTarget,
} from '../types.js';
import { collectDropdownDiagnostic, selectRemoteOption } from './interaction-rules.js';

type BrowserElement = {
  tagName: string;
  id: string;
  className: unknown;
  textContent?: string | null;
  isContentEditable?: boolean;
  contains(element: BrowserElement): boolean;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
};

type BrowserDocument = {
  elementFromPoint(x: number, y: number): BrowserElement | null;
};

type BrowserGlobal = {
  document: BrowserDocument;
};

export async function executeBrowserAction(page: Page, action: BrowserAction, timeoutMs: number): Promise<Page> {
  try {
    switch (action.type) {
      case 'goto':
        try {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        } catch (error) {
          throw new VideoGeneratorError('INVALID_GOTO_URL', `Goto action failed url=${action.url}: ${errorMessage(error)}`);
        }
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'click': {
        let locator: Locator;
        if (action.text !== undefined) {
          locator = page.getByText(action.text, { exact: true });
        } else if (action.selector !== undefined) {
          locator = page.locator(action.selector);
        } else {
          throw new VideoGeneratorError('INVALID_CLICK_TARGET', 'click action requires text or selector.');
        }

        const samePageHref = await targetBlankHref(locator, timeoutMs);
        if (samePageHref !== undefined) {
          await page.goto(samePageHref, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        } else {
          await locator.click({ timeout: timeoutMs });
        }

        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      }
      case 'fill':
        if (action.selector !== undefined) {
          await fillLocator(page.locator(action.selector), action.value, timeoutMs);
        } else if (action.text !== undefined) {
          await fillByText(page, action.text, action.value, timeoutMs);
        } else {
          throw new VideoGeneratorError('INVALID_FILL_TARGET', 'fill action requires text or selector.');
        }
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'waitFor':
        await waitForTarget(page, action.target, timeoutMs);
        return page;
      case 'remoteSelect':
        await selectRemoteOption({
          page,
          selector: action.selector,
          keyword: action.keyword,
          optionText: action.optionText,
          timeoutMs,
        });
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'uploadFile':
        await page.locator(action.selector).setInputFiles(action.filePath, { timeout: timeoutMs });
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'scroll':
        await page.mouse.move((page.viewportSize()?.width ?? 0) / 2, (page.viewportSize()?.height ?? 0) / 2);
        await page.mouse.wheel(0, action.y);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'scrollTo':
        await page.locator(action.target.value).scrollIntoViewIfNeeded({ timeout: timeoutMs });
        await waitForTarget(page, action.target, timeoutMs);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      default:
        throw new VideoGeneratorError(
          'UNSUPPORTED_SCRIPT_ACTION',
          `Unsupported action type: ${(action as { type?: string }).type ?? 'unknown'}`,
        );
    }
  } catch (error) {
    if (error instanceof VideoGeneratorError && error.diagnostics !== undefined) {
      throw error;
    }

    if (error instanceof VideoGeneratorError && error.code === 'UNSUPPORTED_SCRIPT_ACTION') {
      throw error;
    }

    throw new VideoGeneratorError(
      actionErrorCode(action),
      `Browser action failed (${describeAction(action)}): ${errorMessage(error)}`,
      undefined,
      action,
      await collectActionDiagnostics(page, action, failureReason(action, error)),
    );
  }
}

export async function waitForTarget(page: Page, target: WaitTarget, timeoutMs: number): Promise<void> {
  try {
    switch (target.type) {
      case 'text':
        await page.getByText(target.value, { exact: true }).waitFor({ state: 'visible', timeout: timeoutMs });
        return;
      case 'selector':
        await page.locator(target.value).waitFor({ state: 'visible', timeout: timeoutMs });
        return;
      case 'hiddenSelector':
        await waitForAllLocatorsHidden(page.locator(target.value), timeoutMs);
        return;
      case 'url':
        if (!page.url().includes(target.value)) {
          await page.waitForURL((url) => url.toString().includes(target.value), { timeout: timeoutMs });
        }
        return;
      case 'networkIdle':
        await page.waitForLoadState('networkidle', { timeout: timeoutMs });
        return;
      default:
        throw new Error(`Unsupported wait target type: ${(target as { type?: string }).type ?? 'unknown'}`);
    }
  } catch (error) {
    if (error instanceof VideoGeneratorError) {
      throw error;
    }

    throw new VideoGeneratorError(
      'INVALID_WAIT_TARGET',
      `Wait target failed (${describeWaitTarget(target)}): ${errorMessage(error)}`,
    );
  }
}

async function targetBlankHref(locator: Locator, timeoutMs: number): Promise<string | undefined> {
  return locator.evaluate((element) => {
    const anchor = element.closest('a');
    return anchor?.target === '_blank' && anchor.href ? anchor.href : undefined;
  }, undefined, { timeout: timeoutMs });
}

async function waitForAllLocatorsHidden(locator: Locator, timeoutMs: number): Promise<void> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const count = await locator.count();
    const visibility = await Promise.all(
      Array.from({ length: count }, (_value, index) => locator.nth(index).isVisible({ timeout: Math.min(100, timeoutMs) })),
    );

    if (visibility.every((isVisible) => !isVisible)) {
      return;
    }

    await locator.page().waitForTimeout(100);
  }

  throw new Error(`Timed out waiting for all matching locators to be hidden.`);
}

async function fillByText(page: Page, text: string, value: string, timeoutMs: number): Promise<void> {
  const label = page.getByLabel(text);
  const labelCount = await label.count();

  if (labelCount > 0) {
    try {
      await fillLocator(label, value, timeoutMs);
      return;
    } catch (error) {
      throw new Error(`Failed to fill label ${text}: ${errorMessage(error)}`);
    }
  }

  await fillLocator(page.getByPlaceholder(text), value, timeoutMs);
}

async function fillLocator(locator: Locator, value: string, timeoutMs: number): Promise<void> {
  const isEditable = await locator.evaluate((element) => ['INPUT', 'TEXTAREA'].includes(element.tagName)
    || element.isContentEditable, undefined, { timeout: timeoutMs });
  if (!isEditable) {
    throw new Error('Target is not editable.');
  }

  await locator.click({ timeout: timeoutMs });
  await locator.page().keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.page().keyboard.type(value);
  await locator.page().keyboard.press('Tab');
}

async function waitForOptionalTarget(page: Page, target: WaitTarget | undefined, timeoutMs: number): Promise<void> {
  if (target !== undefined) {
    await waitForTarget(page, target, timeoutMs);
  }
}

async function collectActionDiagnostics(
  page: Page,
  action: BrowserAction,
  reason: string,
): Promise<ActionFailureDiagnostics> {
  const selector = actionSelector(action);
  const locator = actionDiagnosticLocator(page, action);
  const candidateDiagnostics = locator === undefined ? { count: 0, candidates: [] } : await collectCandidateDiagnostics(locator);
  const dropdowns = action.type === 'remoteSelect' ? await collectDropdownDiagnostic(page, reason) : undefined;

  return {
    url: page.url(),
    stageName: action.stageName,
    actionType: action.type,
    selector,
    candidateCount: candidateDiagnostics.count,
    candidates: candidateDiagnostics.candidates,
    overlayElement: candidateDiagnostics.candidates.find((candidate) => candidate.overlayElement !== undefined)?.overlayElement,
    dropdowns,
    missingText: missingText(action),
    failureReason: reason,
  };
}

async function collectCandidateDiagnostics(locator: Locator): Promise<{ count: number; candidates: ActionCandidateDiagnostic[] }> {
  const count = await locator.count().catch(() => 0);
  const candidates: ActionCandidateDiagnostic[] = [];

  for (let index = 0; index < Math.min(count, 5); index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = await candidate.isEnabled().catch(() => undefined);
    const editable = await candidate.evaluate((element) => ['INPUT', 'TEXTAREA'].includes(element.tagName)
      || element.isContentEditable).catch(() => undefined);
    const boundingBox = await candidate.boundingBox().catch(() => null);
    const overlayElement = await candidate.evaluate((element: unknown) => {
      const target = element as BrowserElement;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return undefined;
      }

      const pageDocument = (globalThis as unknown as BrowserGlobal).document;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topElement = pageDocument.elementFromPoint(centerX, centerY);
      if (topElement === null || topElement === target || target.contains(topElement)) {
        return undefined;
      }

      return {
        tagName: topElement.tagName.toLowerCase(),
        id: topElement.id || undefined,
        className: typeof topElement.className === 'string' && topElement.className.length > 0 ? topElement.className : undefined,
        text: topElement.textContent?.trim().slice(0, 80) || undefined,
      };
    }).catch(() => undefined) as ElementOverlayDiagnostic | undefined;

    candidates.push({
      index,
      visible,
      editable,
      enabled,
      ...(boundingBox === null ? {} : { boundingBox }),
      ...(overlayElement === undefined ? {} : { overlayElement }),
    });
  }

  return { count, candidates };
}

function actionDiagnosticLocator(page: Page, action: BrowserAction): Locator | undefined {
  switch (action.type) {
    case 'click':
    case 'fill':
      return action.selector !== undefined
        ? page.locator(action.selector)
        : action.text === undefined ? undefined : page.getByText(action.text, { exact: true });
    case 'waitFor':
      return waitTargetDiagnosticLocator(page, action.target);
    case 'remoteSelect':
    case 'uploadFile':
      return page.locator(action.selector);
    case 'scrollTo':
      return page.locator(action.target.value);
    case 'goto':
    case 'scroll':
      return undefined;
  }
}

function waitTargetDiagnosticLocator(page: Page, target: WaitTarget): Locator | undefined {
  switch (target.type) {
    case 'text':
      return page.getByText(target.value, { exact: true });
    case 'selector':
    case 'hiddenSelector':
      return page.locator(target.value);
    case 'url':
    case 'networkIdle':
      return undefined;
  }
}

function actionSelector(action: BrowserAction): string | undefined {
  switch (action.type) {
    case 'click':
    case 'fill':
      return action.selector ?? (action.text === undefined ? undefined : `text=${action.text}`);
    case 'waitFor':
      return waitTargetSelector(action.target);
    case 'remoteSelect':
    case 'uploadFile':
      return action.selector;
    case 'scrollTo':
      return action.target.value;
    case 'goto':
    case 'scroll':
      return undefined;
  }
}

function waitTargetSelector(target: WaitTarget): string | undefined {
  switch (target.type) {
    case 'text':
      return `text=${target.value}`;
    case 'selector':
    case 'hiddenSelector':
      return target.value;
    case 'url':
    case 'networkIdle':
      return undefined;
  }
}

function missingText(action: BrowserAction): string | undefined {
  if (action.type === 'waitFor' && action.target.type === 'text') {
    return action.target.value;
  }

  if (action.type === 'remoteSelect') {
    return action.optionText;
  }

  return undefined;
}

function failureReason(action: BrowserAction, error: unknown): string {
  if (action.type === 'remoteSelect') {
    return remoteSelectFailureReasonFromError(error);
  }

  return `${action.type} failed`;
}

function remoteSelectFailureReasonFromError(error: unknown): string {
  const message = errorMessage(error);
  if (/Timeout|waiting|locator/i.test(message)) {
    return 'option text not found';
  }

  return message;
}

function actionErrorCode(action: BrowserAction): VideoGeneratorError['code'] {
  switch (action.type) {
    case 'goto':
      return 'INVALID_GOTO_URL';
    case 'click':
      return 'INVALID_CLICK_TARGET';
    case 'fill':
      return 'INVALID_FILL_TARGET';
    case 'waitFor':
      return 'INVALID_WAIT_TARGET';
    case 'remoteSelect':
      return 'INVALID_REMOTE_SELECT_TARGET';
    case 'uploadFile':
      return 'INVALID_UPLOAD_FILE_TARGET';
    case 'scroll':
    case 'scrollTo':
      return 'INVALID_SCROLL_Y';
  }
}

function describeAction(action: BrowserAction): string {
  switch (action.type) {
    case 'goto':
      return `goto url=${action.url}`;
    case 'click':
      return `click ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'fill':
      return `fill ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'waitFor':
      return `waitFor ${describeWaitTarget(action.target)}`;
    case 'remoteSelect':
      return `remoteSelect selector=${action.selector} optionText=${action.optionText}`;
    case 'uploadFile':
      return `uploadFile selector=${action.selector}`;
    case 'scroll':
      return `scroll y=${action.y}`;
    case 'scrollTo':
      return `scrollTo ${describeWaitTarget(action.target)}`;
  }
}

function describeWaitTarget(target: WaitTarget): string {
  switch (target.type) {
    case 'text':
      return `text=${target.value}`;
    case 'selector':
      return `selector=${target.value}`;
    case 'hiddenSelector':
      return `hiddenSelector=${target.value}`;
    case 'url':
      return `url=${target.value}`;
    case 'networkIdle':
      return 'networkIdle';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
