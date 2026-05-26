# 半自动网页演示录制器 Implementation Plan

> 创建时间：2026-05-25  
> 最后更新：2026-05-25  
> 状态：实现完成，待归档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有脚本驱动网页录制器升级为保守半自动模式，让用户不写 selector 也能稳定完成常见点击、填写、下拉选择和等待，并在歧义时输出候选报告。

**Architecture:** 保留现有 timeline、recorder、ffmpeg、TTS 和精确动作链路，在 `executeBrowserAction` 内扩展 semantic action 分支。新增 PageSnapshot、CandidateMatcher、InteractionRules 三个小模块：先抽取当前页面可见候选，再把语义动作匹配为唯一可信目标，最后按常见 Web 交互规则执行。

**Tech Stack:** TypeScript、Node.js test runner、Playwright、tsx、现有 video-generator pipeline。

---

## 文件结构

- Modify: `src/lib/video-generator/types.ts` — 增加语义动作、候选元素、匹配结果、候选报告和失败原因类型。
- Create: `src/lib/video-generator/browser/page-snapshot.ts` — 从 Playwright page 中抽取可见交互候选。
- Create: `src/lib/video-generator/browser/candidate-matcher.ts` — 将语义动作匹配到候选元素，返回唯一目标或结构化失败。
- Create: `src/lib/video-generator/browser/interaction-rules.ts` — 执行可点击祖先、字段定位、下拉选择、动作后等待等规则。
- Modify: `src/lib/video-generator/browser/actions.ts` — 保留现有精确动作，新增 semantic action 执行分支，并复用 interaction rules。
- Modify: `src/lib/video-generator/script-parser.ts` — 解析语义脚本语法。
- Modify: `src/lib/video-generator/report.ts` — 写入 `candidate-report.json`。
- Modify: `src/lib/video-generator/pipeline.ts` — 失败报告透传候选报告路径、候选列表和失败 reason。
- Test: `tests/video-generator/types.unit.test.ts` — 覆盖新增类型形状。
- Test: `tests/video-generator/page-snapshot.unit.test.ts` — 覆盖快照候选抽取。
- Test: `tests/video-generator/candidate-matcher.unit.test.ts` — 覆盖匹配强度和歧义判断。
- Test: `tests/video-generator/interaction-rules.unit.test.ts` — 覆盖 Web 交互规则。
- Test: `tests/video-generator/script-parser.unit.test.ts` — 覆盖语义脚本解析。
- Test: `tests/video-generator/browser-actions.unit.test.ts` — 覆盖 semantic action 在 Playwright 页面内执行。
- Test: `tests/video-generator/pipeline.unit.test.ts` — 覆盖失败报告候选透传。

---

### Task 1: 扩展类型模型

**Files:**
- Modify: `src/lib/video-generator/types.ts`
- Test: `tests/video-generator/types.unit.test.ts`

- [ ] **Step 1: 写失败测试，覆盖语义动作和候选报告类型**

在 `tests/video-generator/types.unit.test.ts` 中新增：

```ts
test('semantic browser actions preserve user intent and report candidates', () => {
  const clickAction: BrowserAction = {
    type: 'semanticClick',
    target: { kind: 'button', name: '登录' },
  };
  const fillAction: BrowserAction = {
    type: 'semanticFill',
    target: { kind: 'field', name: '邮箱' },
    value: 'demo@example.com',
  };
  const selectAction: BrowserAction = {
    type: 'semanticSelect',
    target: { kind: 'field', name: '销售类型' },
    option: '平台团购',
  };

  const report: RunReport = {
    ok: false,
    outputDir: '/tmp/video-run',
    failedSegmentId: 'seg-001',
    failedAction: clickAction,
    failureReason: 'AMBIGUOUS_TARGET',
    candidateReportPath: '/tmp/video-run/candidate-report.json',
    candidates: [
      {
        label: '弹窗 / 登录',
        role: 'button',
        name: '登录',
        layer: 'dialog',
        confidence: 'strong',
      },
    ],
  };

  assert.equal(clickAction.target.kind, 'button');
  assert.equal(fillAction.value, 'demo@example.com');
  assert.equal(selectAction.option, '平台团购');
  assert.equal(report.failureReason, 'AMBIGUOUS_TARGET');
  assert.equal(report.candidates?.[0]?.layer, 'dialog');
});
```

确保该测试文件已导入 `BrowserAction` 和 `RunReport`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts`

Expected: FAIL，TypeScript 报 `semanticClick`、`failureReason` 或 `candidates` 不存在。

- [ ] **Step 3: 实现最小类型扩展**

在 `src/lib/video-generator/types.ts` 中新增语义目标、候选和失败原因类型，并把它们接入 `BrowserAction` 与 `RunReport`：

```ts
export type SemanticActionTarget =
  | { kind: 'button'; name: string }
  | { kind: 'link'; name: string }
  | { kind: 'field'; name: string }
  | { kind: 'visibleText'; name: string };

export type CandidateLayer = 'page' | 'dialog' | 'drawer' | 'popover' | 'dropdown' | 'toast' | 'overlay';
export type CandidateConfidence = 'strong' | 'medium' | 'weak';

export interface ActionCandidateReport {
  label: string;
  role?: string;
  name: string;
  text?: string;
  layer: CandidateLayer;
  confidence: CandidateConfidence;
  selectorHint?: string;
}

export type SemanticFailureReason =
  | 'NO_TARGET_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'LOW_CONFIDENCE_TARGET'
  | 'TARGET_OCCLUDED'
  | 'UNSUPPORTED_INTERACTION_PATTERN'
  | 'RISKY_ACTION_REQUIRES_EXPLICIT_CONFIRMATION';
```

把 `BrowserAction` 扩展为：

```ts
export type BrowserAction =
  | { type: 'goto'; url: string; waitFor?: WaitTarget }
  | { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget }
  | { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget }
  | { type: 'semanticClick'; target: Extract<SemanticActionTarget, { kind: 'button' | 'link' }>; waitFor?: WaitTarget }
  | { type: 'semanticFill'; target: Extract<SemanticActionTarget, { kind: 'field' }>; value: string; waitFor?: WaitTarget }
  | { type: 'semanticSelect'; target: Extract<SemanticActionTarget, { kind: 'field' }>; option: string; waitFor?: WaitTarget }
  | { type: 'semanticWaitFor'; target: Extract<SemanticActionTarget, { kind: 'visibleText' }> };
```

把 `RunReport` 扩展为：

```ts
export interface RunReport {
  ok: boolean;
  outputDir: string;
  finalVideoPath?: string;
  timelinePath?: string;
  subtitlesPath?: string;
  failedSegmentId?: string;
  failedAction?: BrowserAction;
  failureReason?: SemanticFailureReason;
  candidates?: ActionCandidateReport[];
  candidateReportPath?: string;
  errorMessage?: string;
  screenshotPath?: string;
}
```

在 `TimelineSegmentAssets` 中增加 resolved action 调试信息：

```ts
resolvedActions?: Array<{
  actionIndex: number;
  strategy: string;
  confidence: CandidateConfidence;
  role?: string;
  name: string;
  layer: CandidateLayer;
  selectorHint?: string;
}>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/types.ts tests/video-generator/types.unit.test.ts
git commit -m "feat: add semantic video action types"
```

---

### Task 2: 实现 PageSnapshot 候选抽取

**Files:**
- Create: `src/lib/video-generator/browser/page-snapshot.ts`
- Test: `tests/video-generator/page-snapshot.unit.test.ts`

- [ ] **Step 1: 写失败测试，覆盖常见可交互元素**

创建 `tests/video-generator/page-snapshot.unit.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { capturePageSnapshot } from '../../src/lib/video-generator/browser/page-snapshot.js';

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await run(page);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

test('capturePageSnapshot extracts visible controls with names and layers', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main>
        <a href="/docs">文档</a>
        <button>登录</button>
        <label>邮箱 <input /></label>
        <input placeholder="搜索产品" />
      </main>
      <div role="dialog" aria-modal="true">
        <button aria-label="确认登录">确认</button>
      </div>
      <div class="el-select-dropdown" style="position: fixed; left: 20px; top: 20px; z-index: 3000;">
        <li class="el-select-dropdown__item">平台团购</li>
      </div>
      <button style="display:none">隐藏按钮</button>
    `);

    const snapshot = await capturePageSnapshot(page);

    assert.ok(snapshot.candidates.some((candidate) => candidate.role === 'link' && candidate.name === '文档'));
    assert.ok(snapshot.candidates.some((candidate) => candidate.role === 'button' && candidate.name === '登录'));
    assert.ok(snapshot.candidates.some((candidate) => candidate.role === 'textbox' && candidate.name === '邮箱'));
    assert.ok(snapshot.candidates.some((candidate) => candidate.role === 'textbox' && candidate.name === '搜索产品'));
    assert.ok(snapshot.candidates.some((candidate) => candidate.name === '确认登录' && candidate.layer === 'dialog'));
    assert.ok(snapshot.candidates.some((candidate) => candidate.name === '平台团购' && candidate.layer === 'dropdown'));
    assert.equal(snapshot.candidates.some((candidate) => candidate.name === '隐藏按钮'), false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/page-snapshot.unit.test.ts`

Expected: FAIL，模块 `page-snapshot.js` 不存在。

- [ ] **Step 3: 实现 PageSnapshot**

创建 `src/lib/video-generator/browser/page-snapshot.ts`：

```ts
import type { ElementHandle, Page } from 'playwright';
import type { CandidateLayer } from '../types.js';

export interface PageSnapshotCandidate {
  role?: string;
  name: string;
  text?: string;
  selectorHint?: string;
  bounds?: { x: number; y: number; width: number; height: number };
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
  candidates: PageSnapshotCandidate[];
}

const CONTROL_SELECTOR = [
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
  '.el-select-dropdown__item',
  '[class*="select-option"]',
].join(',');

export async function capturePageSnapshot(page: Page): Promise<PageSnapshot> {
  const handles = await page.locator(CONTROL_SELECTOR).elementHandles();
  const candidates: PageSnapshotCandidate[] = [];

  for (const handle of handles) {
    const candidate = await readCandidate(handle);
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }

  return {
    url: page.url(),
    title: await page.title(),
    candidates,
  };
}

async function readCandidate(handle: ElementHandle<Element>): Promise<PageSnapshotCandidate | undefined> {
  return handle.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);
    const rect = htmlElement.getBoundingClientRect();
    const visible = style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity) !== 0
      && rect.width > 0
      && rect.height > 0;

    if (!visible) {
      return undefined;
    }

    const role = inferRole(htmlElement);
    const name = inferName(htmlElement);
    if (name.length === 0) {
      return undefined;
    }

    const input = htmlElement instanceof HTMLInputElement ? htmlElement : undefined;
    const option = htmlElement instanceof HTMLOptionElement ? htmlElement : undefined;

    return {
      role,
      name,
      text: truncateText(htmlElement.innerText || htmlElement.textContent || ''),
      selectorHint: selectorHint(htmlElement),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      context: nearestContext(htmlElement),
      state: {
        visible: true,
        enabled: !('disabled' in htmlElement && Boolean((htmlElement as HTMLButtonElement).disabled)),
        editable: isEditable(htmlElement),
        checked: input?.checked,
        selected: option?.selected,
      },
      layer: layerFor(htmlElement),
    };
  });
}

function inferRole(element: HTMLElement): string | undefined {
  const explicitRole = element.getAttribute('role');
  if (explicitRole) return explicitRole;
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return 'textbox';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element.matches('.el-select-dropdown__item, [class*="select-option"]')) return 'option';
  if (element.isContentEditable) return 'textbox';
  return undefined;
}

function inferName(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const title = element.getAttribute('title')?.trim();
  if (title) return title;
  const placeholder = element.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;
  const labelled = labelText(element);
  if (labelled) return labelled;
  return truncateText(element.innerText || element.textContent || '');
}

function labelText(element: HTMLElement): string | undefined {
  const id = element.getAttribute('id');
  if (id) {
    const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    const text = label?.textContent?.trim();
    if (text) return truncateText(text);
  }

  const parentLabel = element.closest('label');
  const text = parentLabel?.textContent?.trim();
  return text ? truncateText(text) : undefined;
}

function isEditable(element: HTMLElement): boolean {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element.isContentEditable;
}

function layerFor(element: HTMLElement): CandidateLayer {
  if (element.closest('.el-select-dropdown, .ant-select-dropdown, .arco-select-popup, .semi-select-option-list, [class*="dropdown"], [class*="popover"]')) {
    return 'dropdown';
  }
  if (element.closest('[role="dialog"], [aria-modal="true"], .ant-modal, .el-dialog, .arco-modal, .semi-modal')) {
    return 'dialog';
  }
  if (element.closest('[class*="drawer"]')) {
    return 'drawer';
  }
  if (element.closest('[class*="toast"], [role="status"]')) {
    return 'toast';
  }
  return 'page';
}

function nearestContext(element: HTMLElement): string | undefined {
  const container = element.closest('form, [role="dialog"], [aria-modal="true"], section, main');
  const heading = container?.querySelector('h1,h2,h3,[role="heading"]')?.textContent?.trim();
  return heading ? truncateText(heading) : undefined;
}

function selectorHint(element: HTMLElement): string | undefined {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const role = element.getAttribute('role');
  if (role) return `[role="${role}"]`;
  return element.tagName.toLowerCase();
}

function truncateText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 120);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/page-snapshot.unit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/browser/page-snapshot.ts tests/video-generator/page-snapshot.unit.test.ts
git commit -m "feat: capture video page interaction snapshots"
```

---

### Task 3: 实现 CandidateMatcher

**Files:**
- Create: `src/lib/video-generator/browser/candidate-matcher.ts`
- Test: `tests/video-generator/candidate-matcher.unit.test.ts`

- [ ] **Step 1: 写失败测试，覆盖唯一匹配、歧义和弱匹配**

创建 `tests/video-generator/candidate-matcher.unit.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSemanticAction } from '../../src/lib/video-generator/browser/candidate-matcher.js';
import type { PageSnapshot } from '../../src/lib/video-generator/browser/page-snapshot.js';

const baseState = { visible: true, enabled: true, editable: false };

function snapshot(candidates: PageSnapshot['candidates']): PageSnapshot {
  return { url: 'https://example.test', title: 'Demo', candidates };
}

test('matchSemanticAction returns one strong foreground candidate', () => {
  const result = matchSemanticAction({
    action: { type: 'semanticClick', target: { kind: 'button', name: '登录' } },
    snapshot: snapshot([
      { role: 'button', name: '登录', layer: 'page', state: baseState },
      { role: 'button', name: '登录', layer: 'dialog', state: baseState },
    ]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.candidate.layer, 'dialog');
  assert.equal(result.confidence, 'strong');
});

test('matchSemanticAction reports ambiguity among same layer strong candidates', () => {
  const result = matchSemanticAction({
    action: { type: 'semanticClick', target: { kind: 'button', name: '登录' } },
    snapshot: snapshot([
      { role: 'button', name: '登录', layer: 'page', context: '顶部导航', state: baseState },
      { role: 'button', name: '登录', layer: 'page', context: '页脚', state: baseState },
    ]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'AMBIGUOUS_TARGET');
  assert.equal(result.candidates.length, 2);
});

test('matchSemanticAction rejects weak contains-only matches', () => {
  const result = matchSemanticAction({
    action: { type: 'semanticClick', target: { kind: 'button', name: '登录' } },
    snapshot: snapshot([
      { role: 'button', name: '立即登录账号', layer: 'page', state: baseState },
    ]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LOW_CONFIDENCE_TARGET');
  assert.equal(result.candidates[0]?.confidence, 'weak');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/candidate-matcher.unit.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 CandidateMatcher**

创建 `src/lib/video-generator/browser/candidate-matcher.ts`：

```ts
import type {
  ActionCandidateReport,
  BrowserAction,
  CandidateConfidence,
  CandidateLayer,
  SemanticFailureReason,
} from '../types.js';
import type { PageSnapshot, PageSnapshotCandidate } from './page-snapshot.js';

export type MatchSemanticActionResult =
  | {
    ok: true;
    candidate: PageSnapshotCandidate;
    confidence: CandidateConfidence;
    strategy: string;
    candidates: ActionCandidateReport[];
  }
  | {
    ok: false;
    reason: SemanticFailureReason;
    message: string;
    candidates: ActionCandidateReport[];
  };

export function matchSemanticAction(input: {
  action: Extract<BrowserAction, { type: 'semanticClick' | 'semanticFill' | 'semanticSelect' | 'semanticWaitFor' }>;
  snapshot: PageSnapshot;
}): MatchSemanticActionResult {
  const scored = input.snapshot.candidates
    .map((candidate) => scoreCandidate(input.action, candidate))
    .filter((candidate): candidate is ScoredCandidate => candidate !== undefined)
    .sort(compareScoredCandidates);

  if (scored.length === 0) {
    return {
      ok: false,
      reason: 'NO_TARGET_FOUND',
      message: `页面上没有找到“${targetName(input.action)}”的可信候选。`,
      candidates: [],
    };
  }

  const best = scored[0];
  if (best.confidence === 'weak') {
    return {
      ok: false,
      reason: 'LOW_CONFIDENCE_TARGET',
      message: `只找到“${targetName(input.action)}”的弱匹配，请把脚本写得更具体。`,
      candidates: scored.map(toReport),
    };
  }

  const sameBest = scored.filter((candidate) => candidate.rank === best.rank && candidate.layerRank === best.layerRank);
  if (sameBest.length > 1) {
    return {
      ok: false,
      reason: 'AMBIGUOUS_TARGET',
      message: `找到 ${sameBest.length} 个可能的“${targetName(input.action)}”目标，请把脚本写得更具体。`,
      candidates: sameBest.map(toReport),
    };
  }

  return {
    ok: true,
    candidate: best.candidate,
    confidence: best.confidence,
    strategy: best.strategy,
    candidates: [toReport(best)],
  };
}

interface ScoredCandidate {
  candidate: PageSnapshotCandidate;
  confidence: CandidateConfidence;
  rank: number;
  layerRank: number;
  strategy: string;
}

function scoreCandidate(action: BrowserAction, candidate: PageSnapshotCandidate): ScoredCandidate | undefined {
  if (!candidate.state.visible || !candidate.state.enabled) {
    return undefined;
  }

  const expected = targetName(action);
  const actual = candidate.name;
  const roleOk = roleMatches(action, candidate.role);
  const exact = normalize(actual) === normalize(expected);
  const contains = normalize(actual).includes(normalize(expected)) || normalize(candidate.text ?? '').includes(normalize(expected));

  if (roleOk && exact) {
    return scored(candidate, 'strong', 0, 'role-name');
  }
  if (exact && action.type !== 'semanticSelect') {
    return scored(candidate, 'medium', 1, 'text-name');
  }
  if (roleOk && contains) {
    return scored(candidate, 'weak', 2, 'role-contains');
  }
  if (contains) {
    return scored(candidate, 'weak', 3, 'text-contains');
  }
  return undefined;
}

function roleMatches(action: BrowserAction, role: string | undefined): boolean {
  if (action.type === 'semanticClick') {
    if (action.target.kind === 'button') return role === 'button' || role === 'menuitem' || role === 'option';
    if (action.target.kind === 'link') return role === 'link';
  }
  if (action.type === 'semanticFill') {
    return role === 'textbox';
  }
  if (action.type === 'semanticSelect') {
    return role === 'combobox' || role === 'button' || role === 'textbox';
  }
  if (action.type === 'semanticWaitFor') {
    return true;
  }
  return false;
}

function scored(candidate: PageSnapshotCandidate, confidence: CandidateConfidence, rank: number, strategy: string): ScoredCandidate {
  return { candidate, confidence, rank, layerRank: layerRank(candidate.layer), strategy };
}

function compareScoredCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  return a.layerRank - b.layerRank || a.rank - b.rank;
}

function layerRank(layer: CandidateLayer): number {
  switch (layer) {
    case 'dropdown':
    case 'popover':
      return 0;
    case 'dialog':
    case 'drawer':
      return 1;
    case 'overlay':
      return 2;
    case 'page':
      return 3;
    case 'toast':
      return 4;
  }
}

function toReport(scoredCandidate: ScoredCandidate): ActionCandidateReport {
  const candidate = scoredCandidate.candidate;
  return {
    label: [candidate.context, candidate.name].filter(Boolean).join(' / ') || candidate.name,
    role: candidate.role,
    name: candidate.name,
    text: candidate.text,
    layer: candidate.layer,
    confidence: scoredCandidate.confidence,
    selectorHint: candidate.selectorHint,
  };
}

function targetName(action: BrowserAction): string {
  if ('target' in action && 'name' in action.target) {
    return action.target.name;
  }
  return '';
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, '').trim().toLocaleLowerCase();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/candidate-matcher.unit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/browser/candidate-matcher.ts tests/video-generator/candidate-matcher.unit.test.ts
git commit -m "feat: match semantic video actions to candidates"
```

---

### Task 4: 实现 InteractionRules

**Files:**
- Create: `src/lib/video-generator/browser/interaction-rules.ts`
- Test: `tests/video-generator/interaction-rules.unit.test.ts`

- [ ] **Step 1: 写失败测试，覆盖点击祖先、字段填写、下拉选择**

创建 `tests/video-generator/interaction-rules.unit.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { clickCandidate, fillFieldByName, selectOptionByFieldName } from '../../src/lib/video-generator/browser/interaction-rules.js';

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await run(page);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

test('clickCandidate clicks clickable ancestor for text-only child', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button id="target"><span>销售类型</span></button>
      <p id="result">pending</p>
      <script>document.querySelector('#target').addEventListener('click', () => document.querySelector('#result').textContent = 'clicked')</script>
    `);

    await clickCandidate(page, { name: '销售类型', selectorHint: 'span', layer: 'page', state: { visible: true, enabled: true, editable: false } }, 1000);

    assert.equal(await page.locator('#result').innerText(), 'clicked');
  });
});

test('fillFieldByName fills label and placeholder fields', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>邮箱 <input id="email" /></label>
      <input id="name" placeholder="姓名" />
    `);

    await fillFieldByName(page, '邮箱', 'demo@example.com', 1000);
    await fillFieldByName(page, '姓名', 'Ada', 1000);

    assert.equal(await page.locator('#email').inputValue(), 'demo@example.com');
    assert.equal(await page.locator('#name').inputValue(), 'Ada');
  });
});

test('selectOptionByFieldName opens combobox and chooses dropdown option', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button role="combobox" aria-label="销售类型" id="select">请选择</button>
      <p id="result">pending</p>
      <script>
        document.querySelector('#select').addEventListener('click', () => {
          document.body.insertAdjacentHTML('beforeend', '<div class="el-select-dropdown"><li class="el-select-dropdown__item">平台团购</li></div>');
          document.querySelector('.el-select-dropdown__item').addEventListener('click', () => document.querySelector('#result').textContent = '平台团购');
        });
      </script>
    `);

    await selectOptionByFieldName(page, '销售类型', '平台团购', 1000);

    assert.equal(await page.locator('#result').innerText(), '平台团购');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/interaction-rules.unit.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 InteractionRules**

创建 `src/lib/video-generator/browser/interaction-rules.ts`：

```ts
import type { Locator, Page } from 'playwright';
import { VideoGeneratorError } from '../types.js';
import type { PageSnapshotCandidate } from './page-snapshot.js';

export async function clickCandidate(page: Page, candidate: PageSnapshotCandidate, timeoutMs: number): Promise<void> {
  const locator = locateCandidate(page, candidate);
  const target = await resolveClickableLocator(locator, timeoutMs);
  await target.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  await target.click({ timeout: timeoutMs });
}

export async function fillFieldByName(page: Page, name: string, value: string, timeoutMs: number): Promise<void> {
  const locator = await resolveFieldLocator(page, name, timeoutMs);
  await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  await locator.click({ timeout: timeoutMs });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(value);
  await page.keyboard.press('Tab');
}

export async function selectOptionByFieldName(page: Page, fieldName: string, optionName: string, timeoutMs: number): Promise<void> {
  const field = page.getByRole('combobox', { name: fieldName }).or(page.getByLabel(fieldName)).or(page.getByText(fieldName, { exact: true }));
  const target = await resolveClickableLocator(field, timeoutMs);
  await target.click({ timeout: timeoutMs });

  const option = page.getByRole('option', { name: optionName }).or(page.getByText(optionName, { exact: true }));
  const optionTarget = await resolveClickableLocator(option, timeoutMs);
  await optionTarget.click({ timeout: timeoutMs });
}

export async function waitAfterSemanticAction(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 1500) }).catch(() => undefined);
}

function locateCandidate(page: Page, candidate: PageSnapshotCandidate): Locator {
  if (candidate.selectorHint?.startsWith('#')) {
    return page.locator(candidate.selectorHint);
  }
  if (candidate.role !== undefined) {
    return page.getByRole(candidate.role as Parameters<Page['getByRole']>[0], { name: candidate.name });
  }
  return page.getByText(candidate.name, { exact: true });
}

async function resolveFieldLocator(page: Page, name: string, timeoutMs: number): Promise<Locator> {
  const locator = page.getByLabel(name).or(page.getByPlaceholder(name)).or(page.locator(`[aria-label="${cssString(name)}"]`));
  const candidates = await visibleLocators(locator, timeoutMs);
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', `Multiple editable fields matched ${name}.`);
  }
  throw new VideoGeneratorError('INVALID_FILL_TARGET', `No editable field matched ${name}.`);
}

async function resolveClickableLocator(locator: Locator, timeoutMs: number): Promise<Locator> {
  const direct = await visibleLocators(locator, timeoutMs);
  if (direct.length === 1 && await isClickable(direct[0])) {
    return direct[0];
  }

  const ancestor = locator.locator('xpath=ancestor-or-self::*[self::button or self::a or @role="button" or @role="combobox" or @role="option" or @role="menuitem" or contains(@class, "el-select-dropdown__item") or contains(@class, "select-option")][1]');
  const ancestors = await visibleLocators(ancestor, timeoutMs);
  if (ancestors.length === 1) {
    return ancestors[0];
  }

  if (direct.length === 1) {
    return direct[0];
  }

  throw new VideoGeneratorError('INVALID_CLICK_TARGET', `Expected one clickable target, found ${direct.length}.`);
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

async function isClickable(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.matches('button,a,[role="button"],[role="combobox"],[role="option"],[role="menuitem"],.el-select-dropdown__item,[class*="select-option"]'));
}

function cssString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/interaction-rules.unit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/browser/interaction-rules.ts tests/video-generator/interaction-rules.unit.test.ts
git commit -m "feat: add web interaction rules for video actions"
```

---

### Task 5: 解析语义脚本语法

**Files:**
- Modify: `src/lib/video-generator/script-parser.ts`
- Test: `tests/video-generator/script-parser.unit.test.ts`

- [ ] **Step 1: 写失败测试，覆盖语义点击、填写、选择和等待**

在 `tests/video-generator/script-parser.unit.test.ts` 中新增：

```ts
test('parseVideoScript parses semantic web interaction actions', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：填写并提交表单
点击按钮 登录
在 邮箱 输入 demo@example.com
选择 销售类型 平台团购
等待出现 登录成功`, config);

  assert.deepEqual(timeline.segments[0]?.actions, [
    { type: 'semanticClick', target: { kind: 'button', name: '登录' } },
    { type: 'semanticFill', target: { kind: 'field', name: '邮箱' }, value: 'demo@example.com' },
    { type: 'semanticSelect', target: { kind: 'field', name: '销售类型' }, option: '平台团购' },
    { type: 'semanticWaitFor', target: { kind: 'visibleText', name: '登录成功' } },
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`

Expected: FAIL，当前 parser 会把 `点击按钮 登录` 解析成普通 text click，或不支持 `选择`、`等待出现`。

- [ ] **Step 3: 修改 parser**

在 `src/lib/video-generator/script-parser.ts` 的 `parseAction` 中，把语义规则放在普通 `点击` 和普通 `等待` 之前：

```ts
const semanticClickButtonMatch = line.match(/^点击按钮\s+(.+)$/u);
if (semanticClickButtonMatch) {
  return { type: 'semanticClick', target: { kind: 'button', name: stripWrappingQuotes(semanticClickButtonMatch[1]) } };
}

const semanticClickLinkMatch = line.match(/^点击链接\s+(.+)$/u);
if (semanticClickLinkMatch) {
  return { type: 'semanticClick', target: { kind: 'link', name: stripWrappingQuotes(semanticClickLinkMatch[1]) } };
}

const semanticSelectMatch = line.match(/^选择\s+(.+?)\s+(.+)$/u);
if (semanticSelectMatch) {
  return {
    type: 'semanticSelect',
    target: { kind: 'field', name: stripWrappingQuotes(semanticSelectMatch[1]) },
    option: stripWrappingQuotes(semanticSelectMatch[2]),
  };
}

const semanticWaitVisibleMatch = line.match(/^等待出现\s+(.+)$/u);
if (semanticWaitVisibleMatch) {
  return { type: 'semanticWaitFor', target: { kind: 'visibleText', name: stripWrappingQuotes(semanticWaitVisibleMatch[1]) } };
}
```

在 `parseFillAction` 的普通 `在 ... 输入 ...` 分支返回 semantic fill：

```ts
return {
  type: 'semanticFill',
  target: { kind: 'field', name: stripWrappingQuotes(afterPrefix.slice(0, separatorIndex)) },
  value: stripWrappingQuotes(afterPrefix.slice(separatorIndex + separator.length)),
};
```

保留 `在选择器 ... 输入 ...` 返回低层 `fill`。

- [ ] **Step 4: 运行 parser 测试**

Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`

Expected: PASS。

- [ ] **Step 5: 回归相关测试**

Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts tests/video-generator/timeline-validator.unit.test.ts tests/video-generator/script-parser.unit.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-generator/script-parser.ts tests/video-generator/script-parser.unit.test.ts
git commit -m "feat: parse semantic web video actions"
```

---

### Task 6: 在 browser actions 中执行 semantic action

**Files:**
- Modify: `src/lib/video-generator/browser/actions.ts`
- Test: `tests/video-generator/browser-actions.unit.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 semanticClick、semanticFill、semanticSelect、semanticWaitFor**

在 `tests/video-generator/browser-actions.unit.test.ts` 中新增：

```ts
test('executeBrowserAction executes semantic click, fill, select, and wait actions', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <label>邮箱 <input id="email" /></label>
      <button role="combobox" aria-label="销售类型" id="select">请选择</button>
      <button id="submit">登录</button>
      <p id="result">pending</p>
      <script>
        document.querySelector('#select').addEventListener('click', () => {
          document.body.insertAdjacentHTML('beforeend', '<div class="el-select-dropdown"><li class="el-select-dropdown__item">平台团购</li></div>');
          document.querySelector('.el-select-dropdown__item').addEventListener('click', () => document.querySelector('#result').dataset.option = '平台团购');
        });
        document.querySelector('#submit').addEventListener('click', () => document.querySelector('#result').textContent = '登录成功');
      </script>
    `);

    await executeBrowserAction(page, { type: 'semanticFill', target: { kind: 'field', name: '邮箱' }, value: 'demo@example.com' }, 1000);
    await executeBrowserAction(page, { type: 'semanticSelect', target: { kind: 'field', name: '销售类型' }, option: '平台团购' }, 1000);
    await executeBrowserAction(page, { type: 'semanticClick', target: { kind: 'button', name: '登录' } }, 1000);
    await executeBrowserAction(page, { type: 'semanticWaitFor', target: { kind: 'visibleText', name: '登录成功' } }, 1000);

    assert.equal(await page.locator('#email').inputValue(), 'demo@example.com');
    assert.equal(await page.locator('#result').getAttribute('data-option'), '平台团购');
    assert.equal(await page.locator('#result').innerText(), '登录成功');
  });
});

test('executeBrowserAction reports ambiguous semantic targets', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <button>登录</button>
      <button>登录</button>
    `);

    await assert.rejects(
      executeBrowserAction(page, { type: 'semanticClick', target: { kind: 'button', name: '登录' } }, 1000),
      (error) => error instanceof VideoGeneratorError
        && error.message.includes('找到 2 个可能的“登录”目标')
        && (error as VideoGeneratorError & { failureReason?: string }).failureReason === 'AMBIGUOUS_TARGET',
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts`

Expected: FAIL，`executeBrowserAction` 还不支持 semantic action。

- [ ] **Step 3: 扩展 VideoGeneratorError 承载候选信息**

在 `src/lib/video-generator/types.ts` 中给 `VideoGeneratorError` 增加可选字段和构造参数对象：

```ts
export interface VideoGeneratorErrorDetails {
  segmentId?: string;
  failedAction?: BrowserAction;
  failureReason?: SemanticFailureReason;
  candidates?: ActionCandidateReport[];
  candidateReportPath?: string;
}
```

保留旧构造调用兼容，构造函数改为：

```ts
constructor(
  code: VideoGeneratorErrorCode,
  message: string,
  segmentIdOrDetails?: string | VideoGeneratorErrorDetails,
  failedAction?: BrowserAction,
) {
  super(message);
  this.name = 'VideoGeneratorError';
  this.code = code;
  if (typeof segmentIdOrDetails === 'object' && segmentIdOrDetails !== null) {
    this.segmentId = segmentIdOrDetails.segmentId;
    this.failedAction = segmentIdOrDetails.failedAction;
    this.failureReason = segmentIdOrDetails.failureReason;
    this.candidates = segmentIdOrDetails.candidates;
    this.candidateReportPath = segmentIdOrDetails.candidateReportPath;
  } else {
    this.segmentId = segmentIdOrDetails;
    this.failedAction = failedAction;
  }
}
```

并在 class 中声明：

```ts
readonly failureReason?: SemanticFailureReason;
readonly candidates?: ActionCandidateReport[];
readonly candidateReportPath?: string;
```

- [ ] **Step 4: 在 actions 中接入 matcher 和 rules**

在 `src/lib/video-generator/browser/actions.ts` 顶部新增导入：

```ts
import { matchSemanticAction } from './candidate-matcher.js';
import { clickCandidate, fillFieldByName, selectOptionByFieldName, waitAfterSemanticAction } from './interaction-rules.js';
import { capturePageSnapshot } from './page-snapshot.js';
```

在 switch 中新增分支：

```ts
case 'semanticClick': {
  const snapshot = await capturePageSnapshot(page);
  const match = matchSemanticAction({ action, snapshot });
  if (!match.ok) {
    throw new VideoGeneratorError('INVALID_CLICK_TARGET', match.message, {
      failedAction: action,
      failureReason: match.reason,
      candidates: match.candidates,
    });
  }
  await clickCandidate(page, match.candidate, timeoutMs);
  await waitForOptionalTarget(page, action.waitFor, timeoutMs);
  await waitAfterSemanticAction(page, timeoutMs);
  return page;
}
case 'semanticFill':
  await fillFieldByName(page, action.target.name, action.value, timeoutMs);
  await waitForOptionalTarget(page, action.waitFor, timeoutMs);
  await waitAfterSemanticAction(page, timeoutMs);
  return page;
case 'semanticSelect':
  await selectOptionByFieldName(page, action.target.name, action.option, timeoutMs);
  await waitForOptionalTarget(page, action.waitFor, timeoutMs);
  await waitAfterSemanticAction(page, timeoutMs);
  return page;
case 'semanticWaitFor':
  await page.getByText(action.target.name, { exact: true }).waitFor({ state: 'visible', timeout: timeoutMs });
  return page;
```

在 `actionErrorCode` 中加入 semantic action 映射：

```ts
case 'semanticClick':
  return 'INVALID_CLICK_TARGET';
case 'semanticFill':
  return 'INVALID_FILL_TARGET';
case 'semanticSelect':
  return 'INVALID_CLICK_TARGET';
case 'semanticWaitFor':
  return 'INVALID_WAIT_TARGET';
```

在 `describeAction` 中加入：

```ts
case 'semanticClick':
  return `semanticClick ${action.target.kind} ${action.target.name}`;
case 'semanticFill':
  return `semanticFill ${action.target.name}`;
case 'semanticSelect':
  return `semanticSelect ${action.target.name} ${action.option}`;
case 'semanticWaitFor':
  return `semanticWaitFor ${action.target.name}`;
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts tests/video-generator/interaction-rules.unit.test.ts tests/video-generator/candidate-matcher.unit.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-generator/types.ts src/lib/video-generator/browser/actions.ts tests/video-generator/browser-actions.unit.test.ts
git commit -m "feat: execute semantic browser video actions"
```

---

### Task 7: 写入候选失败报告

**Files:**
- Modify: `src/lib/video-generator/report.ts`
- Modify: `src/lib/video-generator/pipeline.ts`
- Test: `tests/video-generator/report.unit.test.ts`
- Test: `tests/video-generator/pipeline.unit.test.ts`

- [ ] **Step 1: 写 report 测试**

在 `tests/video-generator/report.unit.test.ts` 中新增：

```ts
test('writeRunReport writes candidate report when candidates are present', async () => {
  const outputDir = path.join(tmpdir(), `candidate-report-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  try {
    const report = await writeRunReport({
      ok: false,
      outputDir,
      failureReason: 'AMBIGUOUS_TARGET',
      candidates: [
        { label: '弹窗 / 登录', role: 'button', name: '登录', layer: 'dialog', confidence: 'strong' },
      ],
    });

    assert.equal(report.runReportPath, path.join(outputDir, 'run-report.json'));
    assert.equal(report.candidateReportPath, path.join(outputDir, 'candidate-report.json'));
    const candidateReport = JSON.parse(await readFile(path.join(outputDir, 'candidate-report.json'), 'utf8'));
    assert.equal(candidateReport.failureReason, 'AMBIGUOUS_TARGET');
    assert.equal(candidateReport.candidates[0].label, '弹窗 / 登录');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
```

把原有 `writeRunReport` 返回值断言从字符串改为对象；如果已有测试只检查文件存在，同步更新为 `result.runReportPath`。

- [ ] **Step 2: 写 pipeline 测试**

在 `tests/video-generator/pipeline.unit.test.ts` 中新增：

```ts
test('runVideoGenerator writes semantic candidate details into failure report', async () => {
  const outputDir = path.join(tmpdir(), `pipeline-candidates-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const scriptPath = await makeScriptFile(outputDir);
  const failedAction = { type: 'semanticClick' as const, target: { kind: 'button' as const, name: '登录' } };
  const ttsProvider: TtsProvider = {
    async synthesize(request) {
      await writeFile(request.outputPath, `audio:${request.segmentId}`);
      return { segmentId: request.segmentId, audioPath: request.outputPath, durationMs: 1000 };
    },
  };

  try {
    const report = await runVideoGenerator({
      scriptPath,
      configOverrides: { outputDir },
      deps: {
        ttsProvider,
        recordTimelineSegments: async () => {
          throw new VideoGeneratorError('INVALID_CLICK_TARGET', '找到 2 个可能的“登录”目标，请把脚本写得更具体。', {
            segmentId: 'seg-002',
            failedAction,
            failureReason: 'AMBIGUOUS_TARGET',
            candidates: [
              { label: '顶部导航 / 登录', role: 'button', name: '登录', layer: 'page', confidence: 'strong' },
              { label: '弹窗 / 登录', role: 'button', name: '登录', layer: 'dialog', confidence: 'strong' },
            ],
          });
        },
        renderFinalVideo: async () => path.join(outputDir, 'final.mp4'),
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.failureReason, 'AMBIGUOUS_TARGET');
    assert.equal(report.candidates?.length, 2);
    assert.equal(report.candidateReportPath, path.join(outputDir, 'candidate-report.json'));
    assert.equal(existsSync(path.join(outputDir, 'candidate-report.json')), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/report.unit.test.ts tests/video-generator/pipeline.unit.test.ts`

Expected: FAIL，`writeRunReport` 还不写 candidate report，pipeline 还不提取 semantic details。

- [ ] **Step 4: 修改 report.ts**

把 `writeRunReport` 改为返回两个路径：

```ts
export interface WriteRunReportResult {
  runReportPath: string;
  candidateReportPath?: string;
}

export async function writeRunReport(report: RunReport): Promise<WriteRunReportResult> {
  await mkdir(report.outputDir, { recursive: true });
  const candidateReportPath = report.candidates && report.candidates.length > 0
    ? path.join(report.outputDir, 'candidate-report.json')
    : undefined;
  const reportPath = path.join(report.outputDir, 'run-report.json');
  const reportWithCandidatePath = candidateReportPath === undefined
    ? report
    : { ...report, candidateReportPath };

  if (candidateReportPath !== undefined) {
    await writeFile(candidateReportPath, `${JSON.stringify({
      failureReason: report.failureReason,
      failedSegmentId: report.failedSegmentId,
      failedAction: report.failedAction,
      candidates: report.candidates,
      screenshotPath: report.screenshotPath,
    }, null, 2)}\n`);
  }

  await writeFile(reportPath, `${JSON.stringify(reportWithCandidatePath, null, 2)}\n`);
  return { runReportPath: reportPath, candidateReportPath };
}
```

- [ ] **Step 5: 修改 pipeline.ts**

在 `makeFailureReport` 中补字段：

```ts
const failureReason = extractFailureReason(error);
const candidates = extractCandidates(error);
return {
  ok: false,
  outputDir,
  failedSegmentId: extractSegmentId(error),
  errorMessage: error instanceof Error ? error.message : String(error),
  screenshotPath: extractScreenshotPath(error),
  failedAction: extractFailedAction(error),
  failureReason,
  candidates,
};
```

新增 helper：

```ts
function extractFailureReason(error: unknown): RunReport['failureReason'] {
  if (error instanceof VideoGeneratorError) {
    return error.failureReason;
  }
  const value = readStringProperty(error, 'failureReason');
  return value as RunReport['failureReason'];
}

function extractCandidates(error: unknown): RunReport['candidates'] {
  if (error instanceof VideoGeneratorError) {
    return error.candidates;
  }
  if (typeof error !== 'object' || error === null || !('candidates' in error)) {
    return undefined;
  }
  const value = (error as { candidates?: unknown }).candidates;
  return Array.isArray(value) ? value as RunReport['candidates'] : undefined;
}
```

在 catch 分支中接收写报告结果并回填路径：

```ts
const report = makeFailureReport(outputDir, error);
const written = await writeRunReport(report);
return { ...report, candidateReportPath: written.candidateReportPath };
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/report.unit.test.ts tests/video-generator/pipeline.unit.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/lib/video-generator/report.ts src/lib/video-generator/pipeline.ts tests/video-generator/report.unit.test.ts tests/video-generator/pipeline.unit.test.ts
git commit -m "feat: report semantic video action candidates"
```

---

### Task 8: 增加本地 demo smoke 脚本

**Files:**
- Modify: `src/lib/video-generator/browser/demo-page.ts`
- Test: `tests/video-generator/browser-actions.unit.test.ts`
- Test: `tests/video-generator/pipeline.unit.test.ts`

- [ ] **Step 1: 写 smoke 测试，覆盖本地 demo 页面完整语义动作**

在 `tests/video-generator/browser-actions.unit.test.ts` 中新增：

```ts
test('semantic actions complete the built-in demo page form flow', async () => {
  await withPage(async (page) => {
    await page.goto(basicDemoDataUrl());

    await executeBrowserAction(page, { type: 'semanticFill', target: { kind: 'field', name: '邮箱' }, value: 'demo@example.com' }, 1000);
    await executeBrowserAction(page, { type: 'semanticFill', target: { kind: 'field', name: '姓名' }, value: 'Ada' }, 1000);
    await executeBrowserAction(page, { type: 'semanticSelect', target: { kind: 'field', name: '销售类型' }, option: '平台团购' }, 1000);
    await executeBrowserAction(page, { type: 'semanticClick', target: { kind: 'button', name: '确认' } }, 1000);
    await executeBrowserAction(page, { type: 'semanticWaitFor', target: { kind: 'visibleText', name: '保存成功' } }, 1000);

    assert.equal(await page.getByText('保存成功').count(), 1);
  });
});
```

确保测试文件导入：

```ts
import { basicDemoDataUrl } from '../../src/lib/video-generator/browser/demo-page.js';
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts`

Expected: FAIL，当前 demo 页面还没有邮箱、姓名、销售类型和确认流程。

- [ ] **Step 3: 扩展 demo-page.ts**

在 `basicDemoDataUrl()` 的 HTML 中增加表单区域：

```html
<form aria-label="演示表单">
  <label>邮箱 <input id="email" /></label>
  <label>姓名 <input id="name" /></label>
  <button type="button" role="combobox" aria-label="销售类型" id="sales-type">请选择</button>
  <button type="button" id="confirm">确认</button>
  <p id="status"></p>
</form>
<script>
  document.querySelector('#sales-type').addEventListener('click', () => {
    if (document.querySelector('.el-select-dropdown')) return;
    document.body.insertAdjacentHTML('beforeend', '<div class="el-select-dropdown"><li class="el-select-dropdown__item">平台团购</li></div>');
    document.querySelector('.el-select-dropdown__item').addEventListener('click', () => {
      document.querySelector('#sales-type').textContent = '平台团购';
      document.querySelector('.el-select-dropdown').remove();
    });
  });
  document.querySelector('#confirm').addEventListener('click', () => {
    document.querySelector('#status').textContent = '保存成功';
  });
</script>
```

保持原有 demo 内容不删除，让旧测试继续可用。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/browser/demo-page.ts tests/video-generator/browser-actions.unit.test.ts
git commit -m "test: add semantic video action smoke flow"
```

---

### Task 9: 全量验证和文档索引收尾

**Files:**
- Modify: `docs/exec-plans/active/semi-automatic-web-demo-recorder.md`
- Modify: `docs/exec-plans/README.md`

- [ ] **Step 1: 运行完整自检**

Run: `npm run test`

Expected: PASS，包括 typecheck 和所有 unit tests。

- [ ] **Step 2: 如涉及真实录制验证，运行一条本地 demo 生成流程**

准备脚本文件 `examples/video-generator/semantic-demo.md`，内容：

```markdown
打开内置演示页
旁白：打开演示页面。

在 邮箱 输入 demo@example.com
旁白：填写邮箱。

在 姓名 输入 Ada
旁白：填写姓名。

选择 销售类型 平台团购
旁白：选择销售类型。

点击按钮 确认
旁白：提交表单。

等待出现 保存成功
旁白：确认页面显示保存成功。
```

Run: `npm run video:generate -- examples/video-generator/semantic-demo.md --out video-runs/semantic-demo`

Expected: 如果本机 TTS 环境变量和 ffmpeg 可用，生成 `video-runs/semantic-demo/final.mp4`；如果缺少 TTS 或 ffmpeg，保留失败报告并记录缺失依赖，不能把该步骤标为通过。

- [ ] **Step 3: 更新本计划状态**

在本文件顶部补充：

```markdown
> 创建时间：2026-05-25
> 最后更新：2026-05-25
> 状态：实现完成，待归档
```

- [ ] **Step 4: 更新 exec-plans README 索引状态**

把 `docs/exec-plans/README.md` 中本计划的状态改为：

```markdown
| active/semi-automatic-web-demo-recorder.md | 半自动网页演示录制器：页面快照 + 候选匹配 + 常见 Web 交互规则 + 语义脚本动作 | 实现完成，待归档 |
```

- [ ] **Step 5: 提交**

```bash
git add docs/exec-plans/active/semi-automatic-web-demo-recorder.md docs/exec-plans/README.md examples/video-generator/semantic-demo.md
git commit -m "docs: add semantic video recorder execution plan"
```

---

## 自审记录

- 设计规格覆盖：PageSnapshot、CandidateMatcher、InteractionRules、语义动作、候选失败报告、测试与验收均有对应任务。
- 范围控制：第一版不做跨页面自动规划、不自动关闭阻挡层、不做危险动作自动确认。
- 类型一致性：计划统一使用 `semanticClick`、`semanticFill`、`semanticSelect`、`semanticWaitFor`、`failureReason`、`candidateReportPath`、`ActionCandidateReport`。
- 验证策略：每个模块先写失败测试，再实现，再运行局部测试；最后执行 `npm run test`。

## 完成记录

- 2026-05-25: `npm run test` 通过，122 个单元测试全部通过。
- 2026-05-25: `npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo` 通过，生成 `video-runs/semantic-demo/final.mp4`。
- 2026-05-25: 计划草案中的 `--out` 参数已按实际 CLI 修正为 `--output`。
