# 脚本驱动浏览器教程视频生成器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个“自然语言教程脚本 → 浏览器分段录制 → 阿里云 TTS → 字幕 → 本地 MP4”的 CLI 核心，并为后续 Skill/UI 包装预留接口。

**Architecture:** 先实现独立 CLI 核心，内部拆成脚本解析、timeline 校验、TTS、Playwright 分段录制、SRT 生成、ffmpeg 合成和运行报告七个边界清晰的模块。Skill 入口不直接控制浏览器或视频工具，只负责把小白用户的自然语言脚本转换成 CLI 可读取的文件并调用 CLI。

**Tech Stack:** TypeScript、Node.js 22+、Playwright、阿里云 TTS SDK 或 HTTP API、ffmpeg、node:test、tsx。

---

> 创建时间：2026-05-21  
> 最后更新：2026-05-21  
> 规格文档：`docs/research/scripted-browser-video-generator.md`

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 最小项目骨架 + Playwright/ffmpeg/TTS POC | ✅ 已完成 | 已建立最小 TS/test 骨架，Playwright recordVideo POC 通过；ffmpeg/ffprobe 已安装可用 |
| Phase 1 | Timeline 类型、解析和校验 | ✅ 已完成 | 已实现类型、配置、时长、validator、MVP parser；支持内置 `demo:basic` 示例页 |
| Phase 2 | 阿里云 TTS 适配和音频时长读取 | ✅ 已完成 | 已实现 TTS Provider 接口、ffprobe 音频时长读取、DashScope CosyVoice 非实时 HTTP Provider 与配置校验 |
| Phase 3 | Playwright 分段录制器 | ✅ 已完成 | 先准备页面并等待稳定，再录制分段 clip；保留动态 DOM、表单值、滚动和跨段 storageState |
| Phase 4 | 字幕生成、ffmpeg 合成和运行报告 | ✅ 已完成 | 已实现 SRT、分段音频合并、clip 拼接、字幕烧录、run-report |
| Phase 5 | CLI 集成和小白脚本入口 | ✅ 已完成 | 已实现 pipeline、CLI 参数、`video:generate`/`video:tts-smoke` 和内置 demo 示例 |
| Phase 6 | 文档、验收和后续包装层评估 | ✅ 已完成 | 已新增 handover/insights 互链文档并更新索引 |

## 决策日志

- 2026-05-21：采用“CLI 核心 + Skill 包装”方案。原因：CLI 易测试、易复用，Skill 负责小白体验。
- 2026-05-21：MVP 使用 Playwright 录制浏览器页面，不引入 OBS 或系统录屏软件。原因：Playwright 支持 `recordVideo`，足够录制受控 Chromium 页面。
- 2026-05-21：MVP 使用分段录制。原因：先等待页面加载稳定，再录制展示片段，可避免网络等待进入正片。
- 2026-05-21：MVP 使用阿里云 TTS，保留 Provider 接口。原因：用户指定阿里云，同时降低未来切换 TTS 的改造成本。
- 2026-05-21：MVP 使用本地 `ffmpeg` 合成，暂不接剪映 MCP 或 HyperFrames。原因：`ffmpeg` 可控稳定；HyperFrames 更适合后续包装动画、标题卡和动态字幕。
- 2026-05-21：Phase 0 环境检查发现当前机器缺少 `ffmpeg`（`ffmpeg -version` 返回 command not found）。用户选择系统安装策略，已通过 `winget install --id Gyan.FFmpeg` 安装；`ffmpeg -version` 与 `ffprobe -version` 均返回 8.1.1。
- 2026-05-21：录制器采用“准备 context + 录制 context”两阶段实现。原因：先执行动作并等待稳定，再通过 prepared HTML snapshot 录制，避免加载等待进入正片，同时保留动态 DOM、表单值、相对资源 base 和滚动位置。
- 2026-05-21：示例脚本使用内置 `demo:basic` data URL，而非要求用户启动本地服务。原因：让 README 中的 exact command 可直接试跑到 TTS/ffmpeg 阶段，降低小白首次验证成本。
- 2026-05-21：阿里云 TTS Provider 改为官方 CosyVoice 非实时 HTTP API，使用 `DASHSCOPE_API_KEY` 调用 DashScope `SpeechSynthesizer`，再下载返回的音频 URL。原因：用户提供的官方教程指向 CosyVoice/DashScope，而不是 NLS `CreateToken` + `/stream/v1/tts`；完成定义要求真实凭据可 smoke，不能用 stub 或假音频冒充成功。

## 执行前置条件

- 当前工作区可作为该工具的最小项目骨架继续实现；允许新建缺失的 `src/`、`tests/`、`examples/` 和 TypeScript 配置文件。
- `package.json` 可借鉴 CodePilot 脚本结构，但依赖必须按本工具实际需要最小添加，禁止整包搬运其他项目依赖。
- 如果用户要求在 Worktree 中实现，先使用 worktree 流程，并遵守端口隔离规则。
- 任何 UI 改动必须启动应用并用 chrome-devtools MCP 验证；本计划 MVP 优先 CLI，不要求新增 UI。
- 不提交、不推送，除非用户明确要求。

## 文件结构

执行时按实际源码树创建或修改以下文件。如果完整源码不存在，先不要创建 `src/`。

### CLI 入口

- Create: `src/cli/video-generator.ts`  
  负责解析 CLI 参数、加载配置、串联 pipeline、设置退出码。

### 类型与配置

- Create: `src/lib/video-generator/types.ts`  
  定义 `VideoScriptInput`、`Timeline`、`TimelineSegment`、`BrowserAction`、`RunReport`、`VideoGeneratorConfig`。
- Create: `src/lib/video-generator/config.ts`  
  负责默认配置、环境变量读取、配置文件合并、敏感字段脱敏。

### 脚本解析与校验

- Create: `src/lib/video-generator/script-parser.ts`  
  将自然语言脚本解析为 timeline 草案；MVP 用规则解析，Agent/Skill 可预先生成半结构化脚本。
- Create: `src/lib/video-generator/timeline-validator.ts`  
  校验旁白、操作类型、URL、等待目标、时长配置。
- Create: `src/lib/video-generator/duration.ts`  
  计算预估旁白时长、缓冲时长和字幕 CPS。

### TTS 与音频

- Create: `src/lib/video-generator/tts/types.ts`  
  定义 TTS Provider 接口。
- Create: `src/lib/video-generator/tts/aliyun.ts`  
  调用阿里云 TTS 生成音频文件。
- Create: `src/lib/video-generator/audio.ts`  
  读取音频真实时长，合并分段音频。

### 浏览器录制

- Create: `src/lib/video-generator/browser/actions.ts`  
  把 timeline action 执行为 Playwright 操作。
- Create: `src/lib/video-generator/browser/recorder.ts`  
  负责分段录制、页面稳定等待、失败截图、clip 路径回填。
- Create: `src/lib/video-generator/browser/demo-page.ts`  
  测试用本地 demo 页面生成器，仅用于自动化测试。

### 字幕、合成和报告

- Create: `src/lib/video-generator/subtitles.ts`  
  根据最终 timeline 生成 `.srt`。
- Create: `src/lib/video-generator/ffmpeg.ts`  
  检查 ffmpeg、拼接 clips、混音、烧录字幕。
- Create: `src/lib/video-generator/report.ts`  
  生成 `run-report.json` 和面向用户的错误摘要。
- Create: `src/lib/video-generator/pipeline.ts`  
  串联 parser、validator、tts、recorder、subtitles、ffmpeg、report。

### 测试

- Create: `tests/video-generator/duration.test.ts`
- Create: `tests/video-generator/timeline-validator.test.ts`
- Create: `tests/video-generator/subtitles.test.ts`
- Create: `tests/video-generator/report.test.ts`
- Create: `tests/video-generator/pipeline-smoke.test.ts`

### 文档

- Modify: `docs/research/scripted-browser-video-generator.md`  
  如 POC 发现技术限制，更新规格。
- Modify: `docs/exec-plans/README.md`  
  已新增本计划索引。
- Create after implementation: `docs/handover/scripted-browser-video-generator.md`
- Create after implementation: `docs/insights/scripted-browser-video-generator.md`

## 核心类型草案

`src/lib/video-generator/types.ts` 初始内容应围绕以下接口实现，后续任务保持字段名一致：

```ts
export type BrowserAction =
  | { type: 'goto'; url: string; waitFor?: WaitTarget }
  | { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget };

export type WaitTarget =
  | { type: 'text'; value: string }
  | { type: 'selector'; value: string }
  | { type: 'url'; value: string }
  | { type: 'networkIdle' };

export interface TimelineSegment {
  id: string;
  sourceText: string;
  narration: string;
  subtitle: string;
  actions: BrowserAction[];
  estimatedDurationMs: number;
  actualAudioDurationMs?: number;
  bufferMs: number;
  startsAtMs?: number;
  endsAtMs?: number;
  assets: {
    audioPath?: string;
    clipPath?: string;
    screenshotPath?: string;
  };
}

export interface Timeline {
  version: 1;
  title: string;
  segments: TimelineSegment[];
}

export interface VideoGeneratorConfig {
  viewport: { width: number; height: number };
  speechRateCharsPerMinute: number;
  segmentBufferMs: number;
  actionTimeoutMs: number;
  ttsProvider: 'aliyun';
  subtitleMode: 'burn-in';
  outputDir: string;
}

export interface RunReport {
  ok: boolean;
  outputDir: string;
  finalVideoPath?: string;
  timelinePath?: string;
  subtitlesPath?: string;
  failedSegmentId?: string;
  failedAction?: BrowserAction;
  errorMessage?: string;
  screenshotPath?: string;
}
```

## Phase 0：源码与依赖核查 + POC

### Task 0.1：确认最小项目骨架和测试命令

**Files:**
- Read/Modify: `package.json`
- Create if missing: `tsconfig.json`
- Create if missing: `src/`
- Create if missing: `tests/`

- [ ] **Step 1: 检查当前项目文件**

Run: `ls package.json tsconfig.json src tests 2>/dev/null || true`

Expected: `package.json` exists. Missing `tsconfig.json`、`src/`、`tests/` can be created in this task.

- [ ] **Step 2: 读取测试脚本**

Run: `node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts||{},null,2))"`

Expected: prints current scripts. If `typecheck` or `test` is missing, add minimal scripts for this tool.

- [ ] **Step 3: 确认 Playwright 依赖状态**

Run: `node -e "const p=require('./package.json'); console.log(Boolean((p.dependencies&&p.dependencies.playwright)||(p.devDependencies&&p.devDependencies.playwright)||((p.dependencies||{})['@playwright/test'])||((p.devDependencies||{})['@playwright/test'])))"`

Expected: `true` if already installed, `false` if dependency must be added in Task 0.2.

- [ ] **Step 4: 创建最小 TS 测试骨架**

If missing, create `tsconfig.json` with NodeNext module resolution, `src/`, and `tests/video-generator/`.


### Task 0.2：添加最小依赖

**Files:**
- Modify: `package.json`
- Modify: package lock file used by this repo

- [ ] **Step 1: Install dependencies**

Run: `npm install playwright`

Expected: `package.json` and lock file include `playwright`.

- [ ] **Step 2: Check ffmpeg availability**

Run: `ffmpeg -version`

Expected: exit 0 and version output.

If missing, do not vendor ffmpeg yet. Record blocker in this plan's decision log and ask user whether to install system ffmpeg or bundle a binary later.

### Task 0.3：Playwright 分段录制 POC

**Files:**
- Create: `tests/video-generator/playwright-video-poc.test.ts`

- [ ] **Step 1: Write POC test**

Create test that launches Chromium, creates a context with `recordVideo.dir`, opens a data URL, waits 500ms, closes context, and asserts a video path exists.

```ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('Playwright records a page video after context closes', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'video-poc-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.goto('data:text/html,<main style="font-size:48px">Video POC</main>');
  await page.waitForTimeout(500);
  const video = page.video();
  await context.close();
  await browser.close();
  assert.ok(video);
  const videoPath = await video.path();
  assert.equal(existsSync(videoPath), true);
});
```

- [ ] **Step 2: Run POC**

Run: `npx tsx --test tests/video-generator/playwright-video-poc.test.ts`

Expected: PASS and a recorded video file exists.

- [ ] **Step 3: Remove or keep POC as smoke test**

If the test is stable in CI, keep it as `pipeline-smoke.test.ts`. If it is flaky due to browser binaries, move it to smoke-only command and document why in the test file name, not in code comments.

## Phase 1：Timeline 类型、解析和校验

### Task 1.1：实现时长计算

**Files:**
- Create: `src/lib/video-generator/duration.ts`
- Test: `tests/video-generator/duration.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateNarrationDurationMs, calculateSegmentDurationMs } from '../../src/lib/video-generator/duration';

test('estimates Chinese narration duration from configurable speaking rate', () => {
  assert.equal(estimateNarrationDurationMs('一二三四五六七八九十', 600), 1000);
});

test('uses actual audio duration when it is longer than estimate', () => {
  assert.equal(calculateSegmentDurationMs({ estimatedMs: 1000, actualAudioMs: 1500, bufferMs: 500 }), 2000);
});

test('uses estimate when actual audio duration is shorter', () => {
  assert.equal(calculateSegmentDurationMs({ estimatedMs: 2000, actualAudioMs: 1200, bufferMs: 500 }), 2500);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx tsx --test tests/video-generator/duration.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement duration functions**

```ts
export function countChineseVisibleChars(text: string): number {
  return Array.from(text).filter((char) => /[\p{Script=Han}A-Za-z0-9]/u.test(char)).length;
}

export function estimateNarrationDurationMs(text: string, charsPerMinute: number): number {
  const chars = countChineseVisibleChars(text);
  return Math.ceil((chars / charsPerMinute) * 60_000);
}

export function calculateSegmentDurationMs(input: {
  estimatedMs: number;
  actualAudioMs?: number;
  bufferMs: number;
}): number {
  return Math.ceil(Math.max(input.estimatedMs, input.actualAudioMs ?? 0) + input.bufferMs);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx tsx --test tests/video-generator/duration.test.ts`

Expected: PASS.

### Task 1.2：实现类型和配置

**Files:**
- Create: `src/lib/video-generator/types.ts`
- Create: `src/lib/video-generator/config.ts`
- Test: `tests/video-generator/config.test.ts`

- [ ] **Step 1: Write config tests**

Test default config returns 1920x1080 viewport, 220 chars/minute, 500ms buffer, 15000ms action timeout, `aliyun`, `burn-in`.

- [ ] **Step 2: Implement `types.ts` from the Core Types section**

Use the exact interface and union names from this plan.

- [ ] **Step 3: Implement `loadVideoGeneratorConfig`**

Function signature:

```ts
export function loadVideoGeneratorConfig(overrides: Partial<VideoGeneratorConfig> = {}): VideoGeneratorConfig
```

Default values:

```ts
const defaultConfig: VideoGeneratorConfig = {
  viewport: { width: 1920, height: 1080 },
  speechRateCharsPerMinute: 220,
  segmentBufferMs: 500,
  actionTimeoutMs: 15_000,
  ttsProvider: 'aliyun',
  subtitleMode: 'burn-in',
  outputDir: './video-runs',
};
```

- [ ] **Step 4: Run config tests**

Run: `npx tsx --test tests/video-generator/config.test.ts`

Expected: PASS.

### Task 1.3：实现 timeline 校验

**Files:**
- Create: `src/lib/video-generator/timeline-validator.ts`
- Test: `tests/video-generator/timeline-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Cover these cases:

- Valid timeline with `goto` passes.
- Empty narration fails with segment ID.
- `click` without `text` and `selector` fails.
- `fill` without `value` fails.
- `goto` with invalid URL fails.

- [ ] **Step 2: Implement validator**

Function signature:

```ts
export function validateTimeline(timeline: Timeline): void
```

Throw `VideoGeneratorError` with fields `{ code, message, segmentId }`.

- [ ] **Step 3: Run validator tests**

Run: `npx tsx --test tests/video-generator/timeline-validator.test.ts`

Expected: PASS.

### Task 1.4：实现 MVP 脚本解析器

**Files:**
- Create: `src/lib/video-generator/script-parser.ts`
- Test: `tests/video-generator/script-parser.test.ts`

- [ ] **Step 1: Support explicit natural-language lines**

MVP parser accepts blocks separated by blank lines. Each block must include `旁白：` and an operation sentence before it.

Supported operation patterns:

- `打开 <url>` → `goto`
- `点击 <text>` → `click` by text
- `在 <text> 输入 <value>` → `fill` by text
- `等待 <text>` → `waitFor` text
- `向下滚动 <number>` → `scroll`

- [ ] **Step 2: Write tests for the patterns**

Use one script with three blocks and assert segment IDs, narration, source text, action types and estimated duration.

- [ ] **Step 3: Implement parser**

Function signature:

```ts
export function parseVideoScript(input: string, config: VideoGeneratorConfig): Timeline
```

- [ ] **Step 4: Run parser tests**

Run: `npx tsx --test tests/video-generator/script-parser.test.ts`

Expected: PASS.

## Phase 2：阿里云 TTS 适配和音频时长

### Task 2.1：定义 TTS Provider 接口

**Files:**
- Create: `src/lib/video-generator/tts/types.ts`
- Test: `tests/video-generator/tts-provider.test.ts`

- [ ] **Step 1: Define provider interface**

```ts
export interface TtsRequest {
  segmentId: string;
  text: string;
  outputPath: string;
}

export interface TtsResult {
  segmentId: string;
  audioPath: string;
  durationMs: number;
}

export interface TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResult>;
}
```

- [ ] **Step 2: Add fake provider for tests**

Create `tests/video-generator/fakes/fake-tts-provider.ts` that writes a tiny fixture audio or returns configured durations without network.

### Task 2.2：实现音频时长读取

**Files:**
- Create: `src/lib/video-generator/audio.ts`
- Test: `tests/video-generator/audio.test.ts`

- [ ] **Step 1: Implement ffprobe-based duration reader**

Function signature:

```ts
export async function getAudioDurationMs(audioPath: string): Promise<number>
```

Use `ffprobe` when available. If `ffprobe` is missing, throw an error telling the user to install ffmpeg.

- [ ] **Step 2: Test with generated sine audio**

Use `ffmpeg -f lavfi -i sine=frequency=1000:duration=1` to create a one-second audio fixture in a temp directory, then assert duration is between 950 and 1050ms.

### Task 2.3：实现阿里云 TTS Provider

**Files:**
- Create: `src/lib/video-generator/tts/aliyun.ts`
- Test: `tests/video-generator/aliyun-tts-config.test.ts`

- [ ] **Step 1: Add config-only tests**

Verify missing required environment variables causes a clear error. Do not call the real API in unit tests.

Required env names:

- `ALIYUN_TTS_ACCESS_KEY_ID`
- `ALIYUN_TTS_ACCESS_KEY_SECRET`
- `ALIYUN_TTS_APP_KEY`

- [ ] **Step 2: Implement provider with dependency injection**

Expose:

```ts
export function createAliyunTtsProvider(env: NodeJS.ProcessEnv): TtsProvider
```

The implementation writes audio to `outputPath` and returns `durationMs` using `getAudioDurationMs`.

- [ ] **Step 3: Add manual integration command**

Document a manual command in the plan report, not as default test, because it uses credentials and quota.

Run when credentials are configured: `npm run video:tts-smoke -- "你好，这是一次语音合成测试"`

## Phase 3：Playwright 分段录制器

### Task 3.1：实现 browser action 执行器

**Files:**
- Create: `src/lib/video-generator/browser/actions.ts`
- Test: `tests/video-generator/browser-actions.test.ts`

- [ ] **Step 1: Write tests against local demo page**

Use Playwright to open a data URL with a button and input. Assert `click` changes text and `fill` fills the input.

- [ ] **Step 2: Implement action execution**

Function signature:

```ts
export async function executeBrowserAction(page: Page, action: BrowserAction, timeoutMs: number): Promise<void>
```

Rules:

- `goto`: `page.goto(url, { waitUntil: 'domcontentloaded', timeout })`
- `click` by text: `page.getByText(text, { exact: true }).click({ timeout })`
- `click` by selector: `page.locator(selector).click({ timeout })`
- `fill` by text: locate label or placeholder text first; if not found, fail with actionable message.
- `waitFor`: delegate to wait helper.
- `scroll`: `page.mouse.wheel(0, y)`.

### Task 3.2：实现等待页面稳定

**Files:**
- Modify: `src/lib/video-generator/browser/actions.ts`
- Test: `tests/video-generator/browser-wait.test.ts`

- [ ] **Step 1: Implement wait target helper**

Function signature:

```ts
export async function waitForTarget(page: Page, target: WaitTarget, timeoutMs: number): Promise<void>
```

- [ ] **Step 2: Test text, selector, URL and network idle waits**

Use local data URLs and controlled DOM changes with `setTimeout`.

### Task 3.3：实现分段录制器

**Files:**
- Create: `src/lib/video-generator/browser/recorder.ts`
- Test: `tests/video-generator/browser-recorder.test.ts`

- [ ] **Step 1: Write recorder smoke test**

Create a two-segment timeline against local demo HTML. Assert each segment receives a `clipPath` and the file exists.

- [ ] **Step 2: Implement recorder**

Function signature:

```ts
export async function recordTimelineSegments(input: {
  timeline: Timeline;
  config: VideoGeneratorConfig;
  outputDir: string;
}): Promise<Timeline>
```

Rules:

- Execute actions before recording the segment clip when possible.
- Create a Playwright context with `recordVideo` for each segment clip.
- Preserve page state between segments by reusing a `storageState` file when context boundaries require new contexts.
- On failure, capture screenshot to `screenshots/{segmentId}.png` and throw an error containing the screenshot path.

- [ ] **Step 3: Run recorder smoke test**

Run: `npx tsx --test tests/video-generator/browser-recorder.test.ts`

Expected: PASS locally.

## Phase 4：字幕、ffmpeg 合成和报告

### Task 4.1：生成 SRT 字幕

**Files:**
- Create: `src/lib/video-generator/subtitles.ts`
- Test: `tests/video-generator/subtitles.test.ts`

- [ ] **Step 1: Write SRT tests**

Assert two segments produce index lines, `00:00:00,000 --> 00:00:02,000`, and subtitle text.

- [ ] **Step 2: Implement SRT generation**

Function signature:

```ts
export function renderSrt(timeline: Timeline): string
```

### Task 4.2：实现 ffmpeg 合成器

**Files:**
- Create: `src/lib/video-generator/ffmpeg.ts`
- Test: `tests/video-generator/ffmpeg.test.ts`

- [ ] **Step 1: Implement dependency checks**

Function signatures:

```ts
export async function assertFfmpegAvailable(): Promise<void>
export async function renderFinalVideo(input: RenderFinalVideoInput): Promise<string>
```

- [ ] **Step 2: Test missing binary behavior with injected command runner**

Unit tests inject a fake command runner and assert a clear error when command exits non-zero.

- [ ] **Step 3: Add local integration test**

Use generated color clips and sine audio to verify final MP4 exists. Mark this as smoke if it is too slow for unit tests.

### Task 4.3：实现运行报告

**Files:**
- Create: `src/lib/video-generator/report.ts`
- Test: `tests/video-generator/report.test.ts`

- [ ] **Step 1: Write success and failure report tests**

Assert success report includes `finalVideoPath`, `timelinePath`, `subtitlesPath`. Assert failure report includes `failedSegmentId`, `errorMessage`, `screenshotPath`.

- [ ] **Step 2: Implement report writer**

Function signature:

```ts
export async function writeRunReport(report: RunReport): Promise<string>
```

## Phase 5：Pipeline 和 CLI

### Task 5.1：实现 pipeline 编排

**Files:**
- Create: `src/lib/video-generator/pipeline.ts`
- Test: `tests/video-generator/pipeline.test.ts`

- [ ] **Step 1: Write pipeline test with fakes**

Use fake TTS, fake recorder and fake renderer. Assert pipeline writes timeline, subtitles and report in output directory.

- [ ] **Step 2: Implement pipeline**

Function signature:

```ts
export async function runVideoGenerator(input: {
  scriptPath: string;
  configOverrides?: Partial<VideoGeneratorConfig>;
}): Promise<RunReport>
```

### Task 5.2：实现 CLI 入口

**Files:**
- Create: `src/cli/video-generator.ts`
- Modify: `package.json`
- Test: `tests/video-generator/cli.test.ts`

- [ ] **Step 1: Add package script**

Add scripts:

```json
{
  "video:generate": "tsx src/cli/video-generator.ts",
  "video:tts-smoke": "tsx src/cli/video-generator.ts --tts-smoke"
}
```

- [ ] **Step 2: Implement CLI args**

Support:

```bash
npm run video:generate -- --script ./demo-script.md --output ./video-runs/demo
```

- [ ] **Step 3: Test CLI argument validation**

Missing `--script` should exit non-zero and print usage.

### Task 5.3：添加小白示例脚本

**Files:**
- Create: `examples/video-generator/basic-demo.md`
- Create: `examples/video-generator/README.md`

- [ ] **Step 1: Write example script**

Include three segments: open local demo page, click button, fill input.

- [ ] **Step 2: Add example instructions**

Include exact command:

```bash
npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo
```

## Phase 6：文档、验收和包装层评估

### Task 6.1：更新研发文档

**Files:**
- Create: `docs/handover/scripted-browser-video-generator.md`
- Create: `docs/insights/scripted-browser-video-generator.md`
- Modify: `docs/handover/README.md`
- Modify: `docs/insights/README.md`

- [ ] **Step 1: Write handover doc**

Must start with:

```md
> 产品思考见 [docs/insights/scripted-browser-video-generator.md](../insights/scripted-browser-video-generator.md)
```

Cover modules, data flow, config, dependencies, failure modes and test commands.

- [ ] **Step 2: Write insights doc**

Must start with:

```md
> 技术实现见 [docs/handover/scripted-browser-video-generator.md](../handover/scripted-browser-video-generator.md)
```

Cover user problem, why CLI-first, why Playwright, why ffmpeg, why HyperFrames is deferred.

- [ ] **Step 3: Update README indexes**

Add both docs to their directory indexes.

### Task 6.2：验收命令

**Files:**
- No code changes

- [ ] **Step 1: Run unit tests**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 2: Run video generator smoke test**

Run: `npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo`

Expected: `video-runs/basic-demo/final.mp4`, `timeline.json`, `subtitles.srt`, `run-report.json` exist.

- [ ] **Step 3: Inspect output video**

Open `video-runs/basic-demo/final.mp4` locally. Confirm 1080p horizontal video, visible browser content, audible narration if TTS credentials are configured, and readable subtitles.

- [ ] **Step 4: Test failure behavior**

Run a script that clicks a non-existent button.

Expected: command exits non-zero, report includes failed segment ID and screenshot path.

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 当前工作区缺少源码 | Phase 0 先核查，缺源码则停止 |
| Playwright 浏览器二进制未安装 | `npx playwright install chromium` 作为明确修复步骤，不自动执行大下载 |
| ffmpeg/ffprobe 缺失 | 已通过系统安装策略安装 Gyan.FFmpeg 8.1.1；代码仍需保留依赖检查和清晰报错 |
| 阿里云 TTS 凭据缺失或额度不足 | 单元测试用 fake provider，真实 TTS 只做手动 smoke |
| 分段录制丢失页面状态 | 通过 `storageState` 和明确 action 设计规避；登录态不进入 MVP |
| 字幕中文字体跨平台不一致 | Phase 4 先用系统默认字体，验收后决定是否内置字体 |
| HyperFrames 诱导范围膨胀 | MVP 不接；仅在 insights 文档中说明作为后续包装层候选 |

## 完成定义

- CLI 能从自然语言教程脚本生成完整素材包和 `final.mp4`。
- Playwright 分段录制不会把明显加载等待录入正片。
- 阿里云 TTS Provider 可通过真实凭据完成 smoke 测试。
- 缺少 ffmpeg、TTS 失败、浏览器操作失败都有明确报告。
- 单元测试和 smoke 测试通过。
- `docs/handover/` 与 `docs/insights/` 文档完成并互链。
