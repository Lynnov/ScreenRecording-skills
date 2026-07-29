import type { Locator, Page } from 'playwright';

import { redactBrowserActionInMessage } from '../action-redaction.js';
import { VideoGeneratorError, type ActionCandidateReport, type BrowserAction, type WaitTarget } from '../types.js';
import { matchSemanticAction } from './candidate-matcher.js';
import { createNoopCursorOverlayController, type CursorOverlayController } from './cursor-overlay.js';
import { clickCandidate, fillFieldByName, remoteSelect, resolveActionTarget, selectFirst, selectOptionByFieldName, uploadFile, waitAfterSemanticAction } from './interaction-rules.js';
import { capturePageSnapshot, type PageSnapshot } from './page-snapshot.js';

export async function executeBrowserAction(
  page: Page,
  action: BrowserAction,
  timeoutMs: number,
  cursor: CursorOverlayController = createNoopCursorOverlayController(),
): Promise<Page> {
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

        const target = await resolveClickLocator(locator, timeoutMs);
        const samePageHref = await targetBlankHref(target);
        await cursor.moveToLocator(target, timeoutMs);
        await cursor.click(page);
        if (samePageHref !== undefined) {
          await page.goto(samePageHref, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        } else {
          await clickLocator(target, timeoutMs);
        }

        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      }
      case 'hover': {
        const locator = await resolveActionTarget(page, action, timeoutMs);
        await cursor.moveToLocator(locator, timeoutMs);
        await locator.hover({ timeout: timeoutMs });
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      }
      case 'fill':
        if (action.selector !== undefined) {
          await fillLocator(page.locator(action.selector), action.value, timeoutMs, cursor);
        } else if (action.text !== undefined) {
          await fillByText(page, action.text, action.value, timeoutMs, cursor);
        } else {
          throw new VideoGeneratorError('INVALID_FILL_TARGET', 'fill action requires text or selector.');
        }
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'remoteSelect':
        await remoteSelect(page, action, timeoutMs);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'selectFirst':
        await selectFirst(page, action, timeoutMs);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      case 'waitFor':
        await waitForTarget(page, action.target, timeoutMs);
        return page;
      case 'scroll': {
        const center = { x: (page.viewportSize()?.width ?? 0) / 2, y: (page.viewportSize()?.height ?? 0) / 2 };
        await cursor.moveToPoint(page, center);
        await page.mouse.wheel(0, action.y);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      }
      case 'scrollTo': {
        const target = page.locator(action.target.value);
        await target.scrollIntoViewIfNeeded({ timeout: timeoutMs });
        await cursor.moveToLocator(target, timeoutMs);
        await waitForTarget(page, action.target, timeoutMs);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      }
      case 'semanticClick': {
        const snapshot = await capturePageSnapshot(page);
        const match = matchSemanticAction(action, snapshot);
        if (!match.ok) {
          throw new VideoGeneratorError('INVALID_CLICK_TARGET', semanticMatchFailureMessage(action, match), {
            failedAction: action,
            failureReason: match.reason,
            candidates: match.candidates,
          });
        }

        await clickCandidate(page, match.candidate, timeoutMs, cursor);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        await waitAfterSemanticAction(page, timeoutMs);
        return page;
      }
      case 'semanticFill': {
        const snapshot = await capturePageSnapshot(page);
        const match = matchSemanticAction(action, snapshot);
        if (!match.ok) {
          throw new VideoGeneratorError('INVALID_FILL_TARGET', match.message, {
            failedAction: action,
            failureReason: match.reason,
            candidates: match.candidates,
          });
        }

        await fillFieldByName(page, match.candidate, action.value, timeoutMs, cursor);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        await waitAfterSemanticAction(page, timeoutMs);
        return page;
      }
      case 'semanticSelect': {
        const snapshot = await capturePageSnapshot(page);
        const match = matchSemanticAction(action, snapshot);
        if (!match.ok) {
          throw new VideoGeneratorError('INVALID_CLICK_TARGET', match.message, {
            failedAction: action,
            failureReason: match.reason,
            candidates: match.candidates,
          });
        }

        await selectOptionByFieldName(page, match.candidate, action.option, timeoutMs, cursor);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        await waitAfterSemanticAction(page, timeoutMs);
        return page;
      }
      case 'semanticWaitFor': {
        try {
          await page.getByText(action.target.name, { exact: true }).waitFor({ state: 'visible', timeout: timeoutMs });
          return page;
        } catch (error) {
          const snapshot = await capturePageSnapshot(page).catch(() => undefined);
          const match = snapshot !== undefined ? matchSemanticAction(action, snapshot) : undefined;
          throw new VideoGeneratorError('INVALID_WAIT_TARGET', semanticWaitFailureMessage(action, error), {
            failedAction: action,
            failureReason: match?.ok ? 'TARGET_OCCLUDED' : match?.reason,
            candidates: waitFailureCandidates(snapshot, action),
          });
        }
      }
      case 'uploadFile':
        await uploadFile(page, action, timeoutMs);
        await waitForOptionalTarget(page, action.waitFor, timeoutMs);
        return page;
      default:
        throw new VideoGeneratorError(
          'UNSUPPORTED_SCRIPT_ACTION',
          `Unsupported action type: ${(action as { type?: string }).type ?? 'unknown'}`,
        );
    }
  } catch (error) {
    if (error instanceof VideoGeneratorError) {
      throw error;
    }

    throw new VideoGeneratorError(
      actionErrorCode(action),
      redactBrowserActionInMessage(`Browser action failed (${describeAction(action)}): ${errorMessage(error)}`),
    );
  }
}

export async function waitForTarget(page: Page, target: WaitTarget, timeoutMs: number): Promise<void> {
  try {
    switch (target.type) {
      case 'text':
        await page.getByText(target.value, { exact: true }).first().waitFor({ state: 'visible', timeout: timeoutMs });
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

async function targetBlankHref(locator: Locator): Promise<string | undefined> {
  try {
    const handle = await locator.elementHandle({ timeout: 500 });
    if (handle === null) {
      return undefined;
    }

    return handle.evaluate((element) => {
      const anchor = element.closest('a');
      return anchor?.target === '_blank' && anchor.href ? anchor.href : undefined;
    });
  } catch {
    return undefined;
  }
}

async function clickLocator(locator: Locator, timeoutMs: number): Promise<void> {
  try {
    await locator.click({ timeout: timeoutMs });
  } catch (error) {
    const box = await locator.first().boundingBox({ timeout: Math.min(timeoutMs, 1000) }).catch(() => null);
    if (box !== null) {
      await locator.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => undefined);
    }

    await locator.first().evaluate((element) => {
      const clickable = element as { click?: () => void };
      if (typeof clickable.click === 'function') {
        clickable.click();
        return;
      }
      throw new Error('Target cannot be clicked.');
    }, undefined, { timeout: Math.min(timeoutMs, 1000) }).catch(() => {
      throw error;
    });
  }
}

async function moveMouseToLocator(locator: Locator, timeoutMs: number): Promise<void> {
  const box = await locator.boundingBox({ timeout: timeoutMs });
  if (box === null) {
    return;
  }

  await locator.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2);
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

async function fillByText(page: Page, text: string, value: string, timeoutMs: number, cursor: CursorOverlayController): Promise<void> {
  const label = page.getByLabel(text);
  const labelCount = await label.count();

  if (labelCount > 0) {
    try {
      await fillLocator(label, value, timeoutMs, cursor);
      return;
    } catch (error) {
      throw new Error(`Failed to fill label ${text}: ${errorMessage(error)}`);
    }
  }

  await fillLocator(page.getByPlaceholder(text), value, timeoutMs, cursor);
}

async function fillLocator(locator: Locator, value: string, timeoutMs: number, cursor: CursorOverlayController): Promise<void> {
  const target = await resolveActionLocator(locator, timeoutMs);
  const isEditable = await target.evaluate((element) => ['INPUT', 'TEXTAREA'].includes(element.tagName)
    || (element instanceof HTMLElement && element.isContentEditable), undefined, { timeout: timeoutMs });
  if (!isEditable) {
    throw new Error('Target is not editable.');
  }

  await cursor.moveToLocator(target, timeoutMs);
  await cursor.click(target.page());
  await target.click({ timeout: timeoutMs });
  await target.page().keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await target.page().keyboard.type(value);
  await target.page().keyboard.press('Tab');
}

async function resolveClickLocator(locator: Locator, timeoutMs: number): Promise<Locator> {
  const target = await resolveActionLocator(locator, timeoutMs);
  const clickableAncestor = await resolveClickableAncestor(target, timeoutMs);
  if (clickableAncestor !== undefined) {
    return clickableAncestor;
  }

  const fieldControl = await resolveFieldControl(target, timeoutMs);
  return fieldControl ?? target;
}

async function resolveActionLocator(locator: Locator, timeoutMs: number): Promise<Locator> {
  const candidates = await visibleLocators(locator, timeoutMs);
  if (candidates.length <= 1) {
    return locator;
  }

  const overlayLocators: Locator[] = [];
  const dialogLocators: Locator[] = [];
  for (const candidate of candidates) {
    const foregroundLayer = await foregroundLayerType(candidate, timeoutMs);
    if (foregroundLayer === 'overlay') {
      overlayLocators.push(candidate);
    } else if (foregroundLayer === 'dialog') {
      dialogLocators.push(candidate);
    }
  }

  if (overlayLocators.length === 1) {
    return overlayLocators[0];
  }
  if (dialogLocators.length === 1) {
    return dialogLocators[0];
  }

  return locator;
}

async function resolveFieldControl(locator: Locator, timeoutMs: number): Promise<Locator | undefined> {
  const control = locator.locator('xpath=ancestor::*[.//*[self::input or self::textarea or self::button or @role="button" or @role="combobox"]][1]//*[self::input or self::textarea or self::button or @role="button" or @role="combobox"]');
  const candidates = await visibleLocators(control, timeoutMs);
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function resolveClickableAncestor(locator: Locator, timeoutMs: number): Promise<Locator | undefined> {
  const candidates = await visibleLocators(locator.locator('xpath=ancestor-or-self::*[self::button or self::a or self::li or @role="button" or @role="option" or @role="menuitem" or contains(@class, "el-select-dropdown__item") or contains(@class, "select-option")][1]'), timeoutMs);
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function visibleLocators(locator: Locator, timeoutMs: number): Promise<Locator[]> {
  const count = await locator.count();
  const candidates: Locator[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible({ timeout: Math.min(100, timeoutMs) })) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

async function foregroundLayerType(locator: Locator, timeoutMs: number): Promise<'overlay' | 'dialog' | undefined> {
  return locator.evaluate((element) => {
    const clickable = element.closest('button, a, li, [role="button"], [role="option"], [role="menuitem"], .el-select-dropdown__item, [class*="select-option"]') ?? element;
    const overlay = clickable.closest([
      '.el-select-dropdown',
      '.ant-select-dropdown',
      '.arco-select-popup',
      '.semi-select-option-list',
      '[class*="dropdown"]',
      '[class*="popover"]',
    ].join(', '));
    const dialog = clickable.closest('[role="dialog"], [aria-modal="true"], .ant-modal, .el-dialog, .arco-modal, .semi-modal');
    const layer = overlay ?? dialog;
    if (layer === null) {
      return undefined;
    }

    const style = element.ownerDocument.defaultView?.getComputedStyle(layer);
    if (style === undefined || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return undefined;
    }

    return overlay === null ? 'dialog' : 'overlay';
  }, undefined, { timeout: timeoutMs });
}

async function waitForOptionalTarget(page: Page, target: WaitTarget | undefined, timeoutMs: number): Promise<void> {
  if (target !== undefined) {
    await waitForTarget(page, target, timeoutMs);
  }
}

function actionErrorCode(action: BrowserAction): VideoGeneratorError['code'] {
  switch (action.type) {
    case 'goto':
      return 'INVALID_GOTO_URL';
    case 'click':
      return 'INVALID_CLICK_TARGET';
    case 'hover':
      return 'INVALID_HOVER_TARGET';
    case 'fill':
      return 'INVALID_FILL_TARGET';
    case 'remoteSelect':
      return 'INVALID_REMOTE_SELECT_TARGET';
    case 'selectFirst':
      return 'INVALID_SELECT_FIRST_TARGET';
    case 'waitFor':
      return 'INVALID_WAIT_TARGET';
    case 'scroll':
    case 'scrollTo':
      return 'INVALID_SCROLL_Y';
    case 'semanticClick':
      return 'INVALID_CLICK_TARGET';
    case 'semanticFill':
      return 'INVALID_FILL_TARGET';
    case 'semanticSelect':
      return 'INVALID_CLICK_TARGET';
    case 'semanticWaitFor':
      return 'INVALID_WAIT_TARGET';
    case 'uploadFile':
      return 'INVALID_UPLOAD_FILE_TARGET';
  }
}

function describeAction(action: BrowserAction): string {
  switch (action.type) {
    case 'goto':
      return `goto url=${action.url}`;
    case 'click':
      return `click ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'hover':
      return `hover ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'fill':
      return `fill ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'remoteSelect':
      return `remoteSelect ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'selectFirst':
      return `selectFirst ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`}`;
    case 'waitFor':
      return `waitFor ${describeWaitTarget(action.target)}`;
    case 'scroll':
      return `scroll y=${action.y}`;
    case 'scrollTo':
      return `scrollTo ${describeWaitTarget(action.target)}`;
    case 'semanticClick':
      return `semanticClick ${action.target.kind} ${action.target.name}`;
    case 'semanticFill':
      return `semanticFill ${action.target.name}`;
    case 'semanticSelect':
      return `semanticSelect ${action.target.name} ${action.option}`;
    case 'semanticWaitFor':
      return `semanticWaitFor ${action.target.name}`;
    case 'uploadFile':
      return `uploadFile ${action.text !== undefined ? `text=${action.text}` : `selector=${action.selector ?? ''}`} path=[redacted]`;
  }
}

function semanticMatchFailureMessage(
  action: Extract<BrowserAction, { type: 'semanticClick' }>,
  match: Extract<ReturnType<typeof matchSemanticAction>, { ok: false }>,
): string {
  if (match.reason === 'AMBIGUOUS_TARGET') {
    return `找到 ${match.candidates.length} 个可能的“${action.target.name}”目标，请提供更明确的目标。`;
  }

  return match.message;
}

function semanticWaitFailureMessage(action: Extract<BrowserAction, { type: 'semanticWaitFor' }>, error: unknown): string {
  const baseMessage = errorMessage(error);
  return `semanticWaitFor ${action.target.name} timed out: ${baseMessage}`;
}

function waitFailureCandidates(snapshot: PageSnapshot | undefined, action: Extract<BrowserAction, { type: 'semanticWaitFor' }>): ActionCandidateReport[] | undefined {
  if (snapshot === undefined) {
    return undefined;
  }

  const normalizedTarget = action.target.name.trim().toLowerCase();
  const matchingCandidates = snapshot.candidates
    .filter((candidate) => candidate.state.visible)
    .filter((candidate) => candidate.name.trim().toLowerCase().includes(normalizedTarget) || (candidate.text ?? '').trim().toLowerCase().includes(normalizedTarget))
    .map((candidate) => ({
      label: [candidate.context, candidate.name || candidate.text].filter(Boolean).join(' / ')
        || candidate.selectorHint
        || candidate.role
        || 'unknown',
      role: candidate.role,
      name: candidate.name,
      text: candidate.text,
      layer: candidate.layer,
      confidence: 'weak' as const,
      selectorHint: candidate.selectorHint,
    }));

  return matchingCandidates.length > 0 ? matchingCandidates : snapshot.candidates
    .filter((candidate) => candidate.state.visible)
    .slice(0, 5)
    .map((candidate) => ({
      label: [candidate.context, candidate.name || candidate.text].filter(Boolean).join(' / ')
        || candidate.selectorHint
        || candidate.role
        || 'unknown',
      role: candidate.role,
      name: candidate.name,
      text: candidate.text,
      layer: candidate.layer,
      confidence: 'weak' as const,
      selectorHint: candidate.selectorHint,
    }));
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
