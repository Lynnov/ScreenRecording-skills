import type { Locator, Page } from 'playwright';

import { VideoGeneratorError } from '../types.js';

export interface FieldTarget {
  text?: string;
  selector?: string;
}

export interface RemoteSelectInput extends FieldTarget {
  query: string;
  option?: string;
  selectFirst?: boolean;
}

export async function resolveActionTarget(page: Page, target: FieldTarget, timeoutMs: number): Promise<Locator> {
  if (target.selector !== undefined) {
    return page.locator(target.selector).first();
  }

  if (target.text !== undefined) {
    return page.getByText(target.text, { exact: true }).first();
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', 'Action target requires text or selector.');
}

export async function remoteSelect(page: Page, input: RemoteSelectInput, timeoutMs: number): Promise<void> {
  const control = await resolveFieldControl(page, input, timeoutMs);
  await control.click({ timeout: timeoutMs });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(input.query);
  if (!(await hasVisibleOption(page, Math.min(timeoutMs, 300)))) {
    await dispatchReadonlyInput(control, input.query, timeoutMs);
  }

  const option = input.selectFirst === true
    ? await firstVisibleOption(page, timeoutMs)
    : await visibleOptionByText(page, input.option ?? '', timeoutMs);
  await option.click({ timeout: timeoutMs });
}

export async function selectFirst(page: Page, target: FieldTarget, timeoutMs: number): Promise<void> {
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
    await control.selectOption(firstValue, { timeout: timeoutMs });
    return;
  }

  await control.click({ timeout: timeoutMs });
  const option = await firstVisibleOption(page, timeoutMs);
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
  await containers.first().waitFor({ state: 'visible', timeout: timeoutMs });
  const count = await containers.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const container = containers.nth(index);
    if (await container.isVisible({ timeout: Math.min(timeoutMs, 300) })) {
      return container;
    }
  }

  throw new VideoGeneratorError('NO_TARGET_FOUND', 'No visible dropdown container found.');
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

async function hasAny(locator: Locator): Promise<boolean> {
  return (await locator.count().catch(() => 0)) > 0;
}

function cssString(value: string): string {
  return JSON.stringify(value);
}

function cssIdentifier(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
