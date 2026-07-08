import type { Locator, Page } from 'playwright';

import { VideoGeneratorError } from '../types.js';
import type { CursorOverlayController } from './cursor-overlay.js';
import type { PageSnapshotCandidate } from './page-snapshot.js';

type TargetCandidate = string | PageSnapshotCandidate;

type SearchRoot = Page | Locator;

export interface FieldTarget {
  text?: string;
  selector?: string;
}

export interface RemoteSelectInput extends FieldTarget {
  query: string;
  option?: string;
  selectFirst?: boolean;
}

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

export async function resolveActionTarget(page: Page, target: FieldTarget, timeoutMs: number): Promise<Locator> {
  if (target.selector !== undefined) {
    return page.locator(target.selector).first();
  }

  if (target.text !== undefined) {
    const locator = page.getByText(target.text, { exact: true }).first();
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    return locator;
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', 'Action target requires text or selector.');
}

export async function remoteSelect(page: Page, input: RemoteSelectInput, timeoutMs: number, cursor?: CursorOverlayController): Promise<void> {
  const control = await resolveFieldControl(page, input, timeoutMs);
  await cursor?.moveToLocator(control, timeoutMs);
  await cursor?.click(page);
  await control.click({ timeout: timeoutMs });
  await waitForEditableControl(control, timeoutMs);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(input.query);
  if (!(await hasVisibleOption(page, Math.min(timeoutMs, 300)))) {
    await dispatchReadonlyInput(control, input.query, timeoutMs);
  }

  const option = input.selectFirst === true
    ? await firstVisibleOption(page, timeoutMs)
    : await visibleOptionByText(page, input.option ?? '', timeoutMs);
  const container = option.locator('xpath=ancestor::*[contains(@class, "el-select-dropdown") or contains(@class, "el-popper") or @role="listbox" or @role="menu"][1]');
  await cursor?.moveToLocator(option, timeoutMs);
  await cursor?.click(page);
  await option.click({ timeout: timeoutMs });
  await container.waitFor({ state: 'hidden', timeout: Math.min(timeoutMs, 1000) }).catch(() => undefined);
}

export async function selectFirst(page: Page, target: FieldTarget, timeoutMs: number, cursor?: CursorOverlayController): Promise<void> {
  const control = await resolveFieldControl(page, target, timeoutMs);
  const tagName = await control.evaluate((element) => element.tagName.toLowerCase(), undefined, { timeout: timeoutMs });

  if (tagName === 'select') {
    const firstValue = await control.evaluate((element) => {
      const select = element as { options?: ArrayLike<{ disabled?: boolean; value?: string }> };
      const options = select.options === undefined ? [] : Array.from(select.options);
      const option = options.find((item) => item.disabled !== true);
      return option?.value;
    }, undefined, { timeout: timeoutMs });
    if (typeof firstValue !== 'string') {
      throw new VideoGeneratorError('NO_TARGET_FOUND', 'No selectable option found in native select.');
    }
    await cursor?.moveToLocator(control, timeoutMs);
    await cursor?.click(page);
    await control.selectOption(firstValue, { timeout: timeoutMs });
    return;
  }

  await cursor?.moveToLocator(control, timeoutMs);
  await cursor?.click(page);
  const option = await openControlAndFindFirstOption(control, timeoutMs);
  await cursor?.moveToLocator(option, timeoutMs);
  await cursor?.click(page);
  await option.click({ timeout: timeoutMs });
}

export async function uploadFile(page: Page, target: FieldTarget & { path: string }, timeoutMs: number): Promise<void> {
  const input = target.selector !== undefined
    ? page.locator(target.selector).first()
    : await resolveFileInputByText(page, target.text ?? '', timeoutMs);

  const tagName = await input.evaluate((element) => element.tagName.toLowerCase(), undefined, { timeout: timeoutMs });
  const type = await input.evaluate((element) => element.getAttribute('type') ?? '', undefined, { timeout: timeoutMs });
  if (tagName !== 'input' || type.toLowerCase() !== 'file') {
    throw new VideoGeneratorError('INVALID_UPLOAD_FILE_TARGET', 'Upload target must resolve to input[type=file].');
  }

  await input.setInputFiles(target.path, { timeout: timeoutMs });
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

async function resolveFieldControl(page: Page, target: FieldTarget, timeoutMs: number): Promise<Locator> {
  if (target.selector !== undefined) {
    return normalizeFieldControl(page.locator(target.selector).first());
  }

  if (target.text === undefined || !target.text.trim()) {
    throw new VideoGeneratorError('NO_TARGET_FOUND', 'Field target requires text or selector.');
  }

  const labelControl = page.getByLabel(target.text).first();
  if (await hasAny(labelControl)) {
    return normalizeFieldControl(labelControl);
  }

  const exactText = cssString(target.text);
  const field = page.locator(`label:has-text(${exactText}), .form-item:has-text(${exactText}), .el-form-item:has-text(${exactText}), [data-field-label]:has-text(${exactText})`).first();
  if (await hasAny(field)) {
    const nestedControl = field.locator('select, input, textarea, .el-select, [role="combobox"], button').first();
    if (await hasAny(nestedControl)) {
      return normalizeFieldControl(nestedControl);
    }
  }

  const textNode = page.getByText(target.text, { exact: true }).first();
  if (await hasAny(textNode)) {
    const nearbyControl = textNode.locator('xpath=ancestor-or-self::*[self::label or contains(@class, "form-item") or contains(@class, "el-form-item") or contains(@class, "field")][1]').locator('select, input, textarea, .el-select, [role="combobox"], button').first();
    if (await hasAny(nearbyControl)) {
      return normalizeFieldControl(nearbyControl);
    }
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', `No field control found for text=${target.text}.`);
}

async function normalizeFieldControl(locator: Locator): Promise<Locator> {
  const nested = locator.locator('input, textarea, select').first();
  return (await hasAny(nested)) ? nested : locator;
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

async function resolveFileInputByText(page: Page, text: string, timeoutMs: number): Promise<Locator> {
  if (!text.trim()) {
    throw new VideoGeneratorError('NO_TARGET_FOUND', 'Upload file text target must not be empty.');
  }

  const exactText = cssString(text);
  const labelInput = page.locator(`label:has-text(${exactText}) input[type="file"]`).first();
  if (await hasAny(labelInput)) {
    return labelInput;
  }

  const forAttribute = await page.locator(`label:has-text(${exactText})`).first().getAttribute('for', { timeout: Math.min(timeoutMs, 300) }).catch(() => null);
  if (forAttribute !== null && forAttribute.trim()) {
    const byId = page.locator(`#${cssIdentifier(forAttribute)}`).first();
    if (await hasAny(byId)) {
      return byId;
    }
  }

  const textNode = page.getByText(text, { exact: true }).first();
  const siblingInput = textNode.locator('xpath=following-sibling::*[1][self::input[@type="file"]]').first();
  if (await hasAny(siblingInput)) {
    return siblingInput;
  }

  const adjacentSiblingInput = textNode.locator('xpath=following-sibling::*[1][self::input[@type="file"] or .//input[@type="file"]]').locator('xpath=self::input[@type="file"] | .//input[@type="file"]').first();
  if (await hasAny(adjacentSiblingInput)) {
    return adjacentSiblingInput;
  }

  const nearbyInput = await uniqueFileInputFromContainer(textNode.locator('xpath=ancestor-or-self::*[self::label or contains(@class, "form-item") or contains(@class, "el-form-item") or contains(@class, "upload") or @data-upload][1]'));
  if (nearbyInput !== undefined) {
    return nearbyInput;
  }

  const parentInput = await uniqueFileInputFromContainer(textNode.locator('xpath=parent::*'));
  if (parentInput !== undefined) {
    return parentInput;
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', `No file input found for text=${text}.`);
}

async function uniqueFileInputFromContainer(container: Locator): Promise<Locator | undefined> {
  if (!(await hasAny(container))) {
    return undefined;
  }

  const inputs = container.locator('input[type="file"]');
  const count = await inputs.count();
  if (count === 0) {
    return undefined;
  }
  if (count > 1) {
    throw new VideoGeneratorError('NO_TARGET_FOUND', 'Multiple file inputs found near upload text; use 上传文件选择器 to disambiguate.');
  }

  return inputs.first();
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

async function waitForEditableControl(locator: Locator, timeoutMs: number): Promise<void> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    if (await locator.evaluate((element) => !element.hasAttribute('readonly') && !element.hasAttribute('disabled'), undefined, { timeout: Math.min(timeoutMs, 100) }).catch(() => false)) {
      return;
    }

    await locator.page().waitForTimeout(50);
  }
}

async function dispatchReadonlyInput(locator: Locator, value: string, timeoutMs: number): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    if ('value' in element) {
      (element as { value: string }).value = nextValue;
    }
    const inputEvent = new Event('input', { bubbles: true }) as Event & { data?: string };
    inputEvent.data = nextValue;
    element.dispatchEvent(inputEvent);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value, { timeout: timeoutMs });
}

async function hasVisibleOption(page: Page, timeoutMs: number): Promise<boolean> {
  return firstVisibleOption(page, timeoutMs).then(() => true).catch(() => false);
}

async function openControlAndFindFirstOption(control: Locator, timeoutMs: number): Promise<Locator> {
  const page = control.page();
  const startedAtMs = Date.now();
  let lastError: unknown;
  let opened = false;
  while (Date.now() - startedAtMs < timeoutMs) {
    try {
      return await firstVisibleOption(page, Math.min(timeoutMs, 250));
    } catch (error) {
      lastError = error;
    }

    if (!opened || !await hasAttachedDropdownOption(page)) {
      await control.click({ timeout: Math.min(timeoutMs, 500) }).catch((error: unknown) => {
        lastError = error;
      });
      opened = true;
    }

    await page.waitForTimeout(100);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new VideoGeneratorError('NO_TARGET_FOUND', 'No visible dropdown option found.');
}

async function hasAttachedDropdownOption(page: Page): Promise<boolean> {
  return await page.locator(`${dropdownContainerSelector()} ${optionSelector()}`).count().catch(() => 0) > 0;
}

async function firstVisibleOption(page: Page, timeoutMs: number): Promise<Locator> {
  const container = await visibleDropdownContainer(page, timeoutMs);
  const options = container.locator(optionSelector());
  await options.first().waitFor({ state: 'visible', timeout: timeoutMs });
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (await option.isVisible({ timeout: Math.min(timeoutMs, 300) })) {
      return option;
    }
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', 'No visible dropdown option found.');
}

async function visibleOptionByText(page: Page, text: string, timeoutMs: number): Promise<Locator> {
  if (!text.trim()) {
    throw new VideoGeneratorError('INVALID_REMOTE_SELECT_TARGET', 'Remote select option must not be empty.');
  }

  const container = await visibleDropdownContainer(page, timeoutMs);
  const option = container.locator(optionSelector()).filter({ hasText: text }).first();
  await option.waitFor({ state: 'visible', timeout: timeoutMs });
  return option;
}

async function visibleDropdownContainer(page: Page, timeoutMs: number): Promise<Locator> {
  const containers = page.locator(dropdownContainerSelector());
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const count = await containers.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const container = containers.nth(index);
      if (await container.isVisible({ timeout: Math.min(timeoutMs, 100) }) && await hasVisibleOptionInContainer(container, timeoutMs)) {
        return container;
      }
    }

    await page.waitForTimeout(100);
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', 'No visible dropdown container found.');
}

async function hasVisibleOptionInContainer(container: Locator, timeoutMs: number): Promise<boolean> {
  const options = container.locator(optionSelector());
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    if (await options.nth(index).isVisible({ timeout: Math.min(timeoutMs, 100) })) {
      return true;
    }
  }

  return false;
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

async function hasAny(locator: Locator): Promise<boolean> {
  return (await locator.count().catch(() => 0)) > 0;
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

function dropdownContainerSelector(): string {
  return [
    '.el-select-dropdown',
    '.el-popper',
    '[role="listbox"]',
    '[role="menu"]',
    '.dropdown-menu',
    '.select-dropdown',
    '.select-options',
  ].join(', ');
}

function optionSelector(): string {
  return [
    '.el-select-dropdown__item:not(.is-disabled)',
    '.el-select-dropdown__item:not(.disabled)',
    '[role="option"]',
    '.dropdown-item',
    '.select-option',
  ].join(', ');
}

function cssString(value: string): string {
  return JSON.stringify(value);
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
