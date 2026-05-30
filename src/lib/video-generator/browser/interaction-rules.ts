import type { Page } from 'playwright';
import type { DropdownDiagnostic } from '../types.js';

export async function selectRemoteOption(input: {
  page: Page;
  selector: string;
  keyword: string;
  optionText: string;
  timeoutMs: number;
}): Promise<void> {
  const target = input.page.locator(input.selector);
  await target.click({ timeout: input.timeoutMs });
  await input.page.keyboard.type(input.keyword);
  const option = input.page.getByText(input.optionText, { exact: true });
  await option.click({ timeout: input.timeoutMs });
}

export async function collectDropdownDiagnostic(page: Page, failureReason?: string): Promise<DropdownDiagnostic> {
  return page.evaluate((reason) => {
    const pageDocument = (globalThis as any).document;
    const pageWindow = globalThis as any;
    const containers = Array.from(pageDocument.querySelectorAll('.el-popper, .el-select-dropdown, [role="listbox"], [data-popper-placement]')) as any[];
    const optionSelectors = '.el-select-dropdown__item, [role="option"], li, [data-option]';
    const visibleContainers = containers.filter((element) => isVisible(element));
    const visibleItems = visibleContainers.flatMap((element) => Array.from(element.querySelectorAll(optionSelectors)) as any[]).filter((element) => isVisible(element));

    return {
      popperCount: containers.length,
      visibleItemCount: visibleItems.length,
      hiddenContainerCount: containers.length - visibleContainers.length,
      failureReason: reason,
    };

    function isVisible(element: any): boolean {
      const style = pageWindow.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    }
  }, failureReason);
}
