import type { Locator, Page } from 'playwright';
import { VideoGeneratorError } from '../types.js';
import type { CursorOverlayController } from './cursor-overlay.js';
import type { PageSnapshotCandidate } from './page-snapshot.js';

type TargetCandidate = string | PageSnapshotCandidate;

type SearchRoot = Page | Locator;

const FIELD_SELECTOR = [
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
  'textarea',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
].join(',');

export async function clickCandidate(page: Page, candidate: PageSnapshotCandidate, timeoutMs: number, cursor?: CursorOverlayController): Promise<void> {
  try {
    const locator = await resolveCandidateLocator(page, candidate, timeoutMs);
    await cursor?.moveToLocator(locator, timeoutMs);
    await cursor?.click(page);
    await clickClickableTarget(locator, timeoutMs);
  } catch (error) {
    if (error instanceof VideoGeneratorError) {
      throw error;
    }

    throw new VideoGeneratorError(
      'INVALID_CLICK_TARGET',
      `Failed to click candidate "${candidate.name}": ${errorMessage(error)}`,
    );
  }
}

export async function fillFieldByName(page: Page, target: TargetCandidate, value: string, timeoutMs: number, cursor?: CursorOverlayController): Promise<void> {
  const fieldName = typeof target === 'string' ? target : target.name;

  try {
    const locator = await resolveFieldLocator(page, target, timeoutMs);
    await cursor?.moveToLocator(locator, timeoutMs);
    await cursor?.click(page);
    await fillLocator(locator, value, timeoutMs);
  } catch (error) {
    if (error instanceof VideoGeneratorError) {
      throw error;
    }

    throw new VideoGeneratorError(
      'INVALID_FILL_TARGET',
      `Failed to fill field "${fieldName}": ${errorMessage(error)}`,
    );
  }
}

export async function selectOptionByFieldName(page: Page, target: TargetCandidate, optionName: string, timeoutMs: number, cursor?: CursorOverlayController): Promise<void> {
  const fieldName = typeof target === 'string' ? target : target.name;

  try {
    const entry = await resolveSelectEntryLocator(page, target, timeoutMs);
    await cursor?.moveToLocator(entry, timeoutMs);
    await cursor?.click(page);
    if (await isNativeSelect(entry, timeoutMs)) {
      await entry.selectOption({ label: optionName }, { timeout: timeoutMs });
      return;
    }

    await entry.click({ timeout: timeoutMs });
    await waitAfterSemanticAction(page, timeoutMs);

    const optionScope = await resolveOpenedOptionScope(page, entry, target, timeoutMs);
    const option = scopedOptionLocator(optionScope)
      .filter({ hasText: optionName });
    await cursor?.moveToLocator(option, timeoutMs);
    await cursor?.click(page);
    await clickClickableTarget(option, timeoutMs);
  } catch (error) {
    if (error instanceof VideoGeneratorError) {
      throw error;
    }

    throw new VideoGeneratorError(
      'INVALID_CLICK_TARGET',
      `Failed to select option "${optionName}" for field "${fieldName}": ${errorMessage(error)}`,
    );
  }
}

export async function waitAfterSemanticAction(page: Page, timeoutMs: number): Promise<void> {
  const shortTimeout = Math.max(100, Math.min(timeoutMs, 500));
  await page.waitForLoadState('domcontentloaded', { timeout: shortTimeout }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: shortTimeout }).catch(() => undefined);
}

async function resolveCandidateLocator(page: Page, candidate: PageSnapshotCandidate, timeoutMs: number): Promise<Locator> {
  const scopedRoot = await resolveScopeRoot(page, candidate, timeoutMs);

  if (candidate.selectorHint !== undefined) {
    const bySelector = scopedRoot.locator(candidate.selectorHint);
    if (await hasUniqueMatch(bySelector, timeoutMs)) {
      return bySelector.first();
    }
  }

  if (candidate.role !== undefined) {
    const byRole = scopedRoot.getByRole(candidate.role as Parameters<Page['getByRole']>[0], {
      name: candidate.name,
      exact: true,
    }).first();
    if (await hasMatch(byRole, timeoutMs)) {
      return byRole;
    }
  }

  const byText = scopedRoot.getByText(candidate.text ?? candidate.name, { exact: true }).first();
  if (await hasMatch(byText, timeoutMs)) {
    return byText;
  }

  throw new Error('No matching candidate locator found.');
}

async function resolveScopeRoot(page: Page, candidate: PageSnapshotCandidate, timeoutMs: number): Promise<SearchRoot> {
  if (candidate.scopeHint !== undefined) {
    const scopedByHint = page.locator(candidate.scopeHint).first();
    if (await hasMatch(scopedByHint, timeoutMs)) {
      return scopedByHint;
    }
  }

  const scopedByLayer = layerScopeLocator(page, candidate.layer);
  if (scopedByLayer !== undefined && await hasMatch(scopedByLayer, timeoutMs)) {
    return scopedByLayer;
  }

  return page;
}

function layerScopeLocator(page: Page, layer: PageSnapshotCandidate['layer']): Locator | undefined {
  switch (layer) {
    case 'dialog':
      return page.locator('dialog, [role="dialog"], [aria-modal="true"]').first();
    case 'drawer':
      return page.locator('.drawer, [class*="drawer"], [data-layer="drawer"]').first();
    case 'popover':
      return page.locator('[popover], [role="tooltip"], .popover, [class*="popover"], [class*="tooltip"]').first();
    case 'dropdown':
      return page.locator('[role="listbox"], [role="menu"], .el-select-dropdown, [class*="select-dropdown"], .el-dropdown, [class*="dropdown"]').first();
    case 'toast':
      return page.locator('[role="status"], [role="alert"], .toast, .notification, [class*="toast"], [class*="notification"]').first();
    case 'overlay':
      return page.locator('.modal-backdrop, .overlay, [class*="overlay"], [class*="backdrop"], [data-layer="overlay"]').first();
    case 'page':
    default:
      return undefined;
  }
}

async function resolveFieldLocator(page: Page, target: TargetCandidate, timeoutMs: number): Promise<Locator> {
  if (typeof target !== 'string') {
    const byCandidate = await resolveCandidateLocator(page, target, timeoutMs);
    if (await hasEditableMatch(byCandidate, timeoutMs)) {
      return byCandidate;
    }
  }

  const name = typeof target === 'string' ? target : target.name;

  const byLabel = page.getByLabel(name, { exact: true }).first();
  if (await hasEditableMatch(byLabel, timeoutMs)) {
    return byLabel;
  }

  const byPlaceholder = page.getByPlaceholder(name, { exact: true }).first();
  if (await hasEditableMatch(byPlaceholder, timeoutMs)) {
    return byPlaceholder;
  }

  const byAriaLabel = page.locator(`${FIELD_SELECTOR}[aria-label="${cssAttributeValue(name)}"]`).first();
  if (await hasEditableMatch(byAriaLabel, timeoutMs)) {
    return byAriaLabel;
  }

  throw new Error('No editable field found.');
}

async function resolveSelectEntryLocator(page: Page, target: TargetCandidate, timeoutMs: number): Promise<Locator> {
  if (typeof target !== 'string') {
    const byCandidate = await resolveCandidateLocator(page, target, timeoutMs);
    if (await hasMatch(byCandidate, timeoutMs)) {
      return byCandidate;
    }
  }

  const fieldName = typeof target === 'string' ? target : target.name;

  const byRole = page.getByRole('combobox', { name: fieldName, exact: true }).first();
  if (await hasMatch(byRole, timeoutMs)) {
    return byRole;
  }

  const select = page.locator(`select[aria-label="${cssAttributeValue(fieldName)}"]`).first();
  if (await hasMatch(select, timeoutMs)) {
    return select;
  }

  const byLabel = page.getByLabel(fieldName, { exact: true }).first();
  if (await hasMatch(byLabel, timeoutMs)) {
    return byLabel;
  }

  const byPlaceholder = page.getByPlaceholder(fieldName, { exact: true }).first();
  if (await hasMatch(byPlaceholder, timeoutMs)) {
    return byPlaceholder;
  }

  throw new Error('No combobox or select entry found.');
}

async function resolveOpenedOptionScope(page: Page, entry: Locator, target: TargetCandidate, timeoutMs: number): Promise<SearchRoot> {
  const candidateScope = typeof target === 'string' ? undefined : await candidateScopeRoot(page, target, timeoutMs);
  if (candidateScope !== undefined) {
    const listbox = visibleDropdownLocator(candidateScope);
    if (await hasMatch(listbox, timeoutMs)) {
      return listbox.first();
    }
  }

  const controlledScope = await controlledDropdownLocator(page, entry, timeoutMs);
  if (controlledScope !== undefined) {
    return controlledScope;
  }

  const attachedDropdown = visibleDropdownLocator(page);
  if (await hasMatch(attachedDropdown, timeoutMs)) {
    return attachedDropdown.first();
  }

  return page;
}

async function candidateScopeRoot(page: Page, candidate: PageSnapshotCandidate, timeoutMs: number): Promise<Locator | undefined> {
  if (candidate.scopeHint === undefined) {
    return undefined;
  }

  const scope = page.locator(candidate.scopeHint).first();
  return await hasMatch(scope, timeoutMs) ? scope : undefined;
}

async function controlledDropdownLocator(page: Page, entry: Locator, timeoutMs: number): Promise<Locator | undefined> {
  const controls = await entry.first().getAttribute('aria-controls', { timeout: Math.min(timeoutMs, 250) }).catch(() => undefined);
  if (controls != null && controls.length > 0) {
    const controlled = page.locator(`#${cssIdentifier(controls)}`).first();
    if (await hasMatch(controlled, timeoutMs)) {
      return controlled;
    }
  }

  return undefined;
}

function visibleDropdownLocator(root: SearchRoot): Locator {
  return root.locator('[role="listbox"]:visible, [role="menu"]:visible, .el-select-dropdown:visible, [class*="select-dropdown"]:visible, .el-dropdown:visible, [class*="dropdown"]:visible');
}

function scopedOptionLocator(root: SearchRoot): Locator {
  return root.getByRole('option').or(root.locator('.el-select-dropdown__item, [class*="select-option"]'));
}

async function isNativeSelect(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator.first().evaluate((element) => element.tagName.toLowerCase() === 'select', undefined, {
    timeout: Math.min(timeoutMs, 250),
  }).catch(() => false);
}

async function clickClickableTarget(locator: Locator, timeoutMs: number): Promise<void> {
  const clickable = locator.locator(`xpath=ancestor-or-self::*[${xpathClickablePredicate()}][1]`).first();
  if (await hasMatch(clickable, timeoutMs)) {
    await clickable.click({ timeout: timeoutMs });
    return;
  }

  await locator.first().click({ timeout: timeoutMs });
}

async function fillLocator(locator: Locator, value: string, timeoutMs: number): Promise<void> {
  const field = locator.first();
  const isEditable = await field.evaluate((element) => {
    const tag = element.tagName.toLowerCase();
    return tag === 'input'
      || tag === 'textarea'
      || 'isContentEditable' in element && Boolean(element.isContentEditable)
      || element.getAttribute('role') === 'textbox';
  }, undefined, { timeout: timeoutMs });

  if (!isEditable) {
    throw new Error('Target is not editable.');
  }

  await field.click({ timeout: timeoutMs });
  await field.page().keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await field.page().keyboard.type(value);
  await field.page().keyboard.press('Tab');
}

async function hasMatch(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 250) });
    return await locator.count() > 0;
  } catch {
    return false;
  }
}

async function hasUniqueMatch(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 250) });
    return await locator.count() === 1;
  } catch {
    return false;
  }
}

async function hasEditableMatch(locator: Locator, timeoutMs: number): Promise<boolean> {
  if (!await hasMatch(locator, timeoutMs)) {
    return false;
  }

  return locator.evaluate((element) => {
    const tag = element.tagName.toLowerCase();
    return tag === 'input'
      || tag === 'textarea'
      || 'isContentEditable' in element && Boolean(element.isContentEditable)
      || element.getAttribute('role') === 'textbox';
  }, undefined, { timeout: Math.min(timeoutMs, 250) }).catch(() => false);
}

function xpathClickablePredicate(): string {
  return [
    'self::button',
    'self::a[@href]',
    '@role="button"',
    '@role="combobox"',
    '@role="option"',
    '@role="menuitem"',
    'self::option',
    'contains(concat(" ", normalize-space(@class), " "), " el-select-dropdown__item ")',
    'contains(@class, "select-option")',
  ].join(' or ');
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '\\$&');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
