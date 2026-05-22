# 连续操作视频录制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把脚本录制从“每段静态快照拼接”改为“整条脚本在一个 1920×1080 页面里连续录制”，并修正字幕和 Pacdora 示例脚本。

**Architecture:** `recordTimelineSegments` 改为创建一个带 `recordVideo` 的 Playwright context/page，顺序执行所有 segment actions，并把同一个连续 clip 写入 timeline 顶层资产和各 segment assets。脚本解析新增 selector 等待和滚动到 selector；字幕渲染只规范化字幕文本，不改变 TTS 旁白。

**Tech Stack:** TypeScript、Node.js test runner、Playwright、ffmpeg、tsx。

---

## 文件结构

- Modify: `src/lib/video-generator/types.ts` — 为 `Timeline` 增加顶层 `assets.continuousClipPath`，并增加 selector wait/scroll action 类型。
- Modify: `src/lib/video-generator/config.ts` — 把默认 viewport 改为 `1920 × 1080`。
- Modify: `src/lib/video-generator/script-parser.ts` — 解析 `等待选择器` 和 `向下滚动到选择器`。
- Modify: `src/lib/video-generator/browser/actions.ts` — 执行 selector wait 和 scroll-to-selector。
- Modify: `src/lib/video-generator/browser/recorder.ts` — 改为一个 context/page 连续录制整条 timeline。
- Modify: `src/lib/video-generator/ffmpeg.ts` — 渲染时优先使用顶层 continuous clip，避免重复 concat 同一个 clip。
- Modify: `src/lib/video-generator/subtitles.ts` — 字幕输出规范化。
- Modify: `src/cli/video-generator.ts` — 解析 `--storage-state <file>` 并传入 pipeline。
- Modify: `src/lib/video-generator/config.ts` — 增加可选 `storageStatePath` 配置。
- Modify: `src/lib/video-generator/browser/recorder.ts` — 创建 context 时加载 Playwright storage state。
- Modify: `examples/video-generator/pacdora-dieline.md` — 用真实滚动展示卡片后点击，不直接打开详情 URL。
- Modify tests under `tests/video-generator/` — 覆盖类型、解析、动作、录制、渲染、字幕、登录态和示例脚本行为。

---

### Task 1: 扩展 Timeline 类型和默认视口

**Files:**
- Modify: `src/lib/video-generator/types.ts:1-64`
- Modify: `src/lib/video-generator/config.ts:1-40`
- Test: `tests/video-generator/types.unit.test.ts`
- Test: `tests/video-generator/config.unit.test.ts`

- [x] **Step 1: 写失败测试，覆盖顶层连续录制资产和 1920×1080 默认视口**

在 `tests/video-generator/types.unit.test.ts` 中新增：

```ts
test('timeline supports top-level continuous recording assets', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Continuous recording',
    assets: { continuousClipPath: '/clips/full.webm' },
    segments: [
      {
        id: 'seg-001',
        sourceText: 'source',
        narration: 'narration',
        subtitle: 'subtitle',
        actions: [
          { type: 'waitFor', target: { type: 'selector', value: '.ready' } },
          { type: 'scrollTo', target: { type: 'selector', value: '.card' } },
        ],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: {},
      },
    ],
  };

  assert.equal(timeline.assets?.continuousClipPath, '/clips/full.webm');
  assert.equal(timeline.segments[0]?.actions[1]?.type, 'scrollTo');
});
```

在 `tests/video-generator/config.unit.test.ts` 中把默认 viewport 断言改为：

```ts
assert.deepEqual(config.viewport, { width: 1920, height: 1080 });
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts tests/video-generator/config.unit.test.ts`

Expected: FAIL，原因包括 `Timeline` 没有 `assets` 字段、`BrowserAction` 没有 `scrollTo`，或默认 viewport 仍是旧尺寸。

- [x] **Step 3: 修改类型和默认配置**

在 `src/lib/video-generator/types.ts` 中新增：

```ts
export type BrowserAction =
  | { type: 'goto'; url: string; waitFor?: WaitTarget }
  | { type: 'click'; text?: string; selector?: string; waitFor?: WaitTarget }
  | { type: 'fill'; text?: string; selector?: string; value: string; waitFor?: WaitTarget }
  | { type: 'waitFor'; target: WaitTarget }
  | { type: 'scroll'; y: number; waitFor?: WaitTarget }
  | { type: 'scrollTo'; target: Extract<WaitTarget, { type: 'selector' }>; waitFor?: WaitTarget };

export interface TimelineAssets {
  continuousClipPath?: string;
  [key: string]: unknown;
}

export interface Timeline {
  version: 1;
  title: string;
  assets?: TimelineAssets;
  segments: TimelineSegment[];
}
```

在 `src/lib/video-generator/config.ts` 中把默认 viewport 改为：

```ts
viewport: {
  width: 1920,
  height: 1080,
},
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts tests/video-generator/config.unit.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/lib/video-generator/types.ts src/lib/video-generator/config.ts tests/video-generator/types.unit.test.ts tests/video-generator/config.unit.test.ts
git commit -m "feat: add continuous recording timeline assets"
```

---

### Task 2: 增加 selector 等待和滚动脚本语法

**Files:**
- Modify: `src/lib/video-generator/script-parser.ts:62-99`
- Modify: `tests/video-generator/script-parser.unit.test.ts`

- [x] **Step 1: 写失败测试**

在 `tests/video-generator/script-parser.unit.test.ts` 中新增：

```ts
test('parseVideoScript parses selector wait and scroll-to-selector actions', () => {
  const config = loadVideoGeneratorConfig();
  const timeline = parseVideoScript(`旁白：找到目标卡片
等待选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]
向下滚动到选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]`, config);

  assert.deepEqual(timeline.segments[0]?.actions, [
    {
      type: 'waitFor',
      target: { type: 'selector', value: 'a[href*="custom-dimensions-tray-boxes-dieline-128020"]' },
    },
    {
      type: 'scrollTo',
      target: { type: 'selector', value: 'a[href*="custom-dimensions-tray-boxes-dieline-128020"]' },
    },
  ]);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`

Expected: FAIL，报 `Unsupported script action: 等待选择器 ...`。

- [x] **Step 3: 实现解析**

在 `parseAction` 中，放在普通 `等待` 和普通 `向下滚动` 之前：

```ts
const waitForSelectorMatch = line.match(/^等待选择器\s+(.+)$/u);
if (waitForSelectorMatch) {
  return { type: 'waitFor', target: { type: 'selector', value: stripWrappingQuotes(waitForSelectorMatch[1]) } };
}

const scrollToSelectorMatch = line.match(/^向下滚动到选择器\s+(.+)$/u);
if (scrollToSelectorMatch) {
  return { type: 'scrollTo', target: { type: 'selector', value: stripWrappingQuotes(scrollToSelectorMatch[1]) } };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/lib/video-generator/script-parser.ts tests/video-generator/script-parser.unit.test.ts
git commit -m "feat: parse selector wait and scroll actions"
```

---

### Task 3: 执行 scroll-to-selector 动作

**Files:**
- Modify: `src/lib/video-generator/browser/actions.ts:4-173`
- Modify: `tests/video-generator/browser-actions.unit.test.ts`

- [x] **Step 1: 写失败测试**

在 `tests/video-generator/browser-actions.unit.test.ts` 中新增：

```ts
test('executeBrowserAction scrolls until selector is visible', async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <main style="height: 2400px">
        <div style="height: 1800px">Top</div>
        <a class="target-card" href="/details">抽屉式礼盒</a>
      </main>
    `);

    await executeBrowserAction(page, {
      type: 'scrollTo',
      target: { type: 'selector', value: '.target-card' },
    }, 1000);

    assert.ok(await page.locator('.target-card').isVisible());
    assert.ok(await page.evaluate('window.scrollY > 0'));
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts`

Expected: FAIL，原因是 `Unsupported action type: scrollTo`。

- [x] **Step 3: 实现动作执行**

在 `executeBrowserAction` 的 switch 中新增：

```ts
case 'scrollTo':
  await page.locator(action.target.value).scrollIntoViewIfNeeded({ timeout: timeoutMs });
  await waitForTarget(page, action.target, timeoutMs);
  await waitForOptionalTarget(page, action.waitFor, timeoutMs);
  return;
```

在 `actionErrorCode` 中新增：

```ts
case 'scrollTo':
  return 'INVALID_SCROLL_Y';
```

在 `describeAction` 中新增：

```ts
case 'scrollTo':
  return `scrollTo ${describeWaitTarget(action.target)}`;
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/lib/video-generator/browser/actions.ts tests/video-generator/browser-actions.unit.test.ts
git commit -m "feat: execute scroll-to-selector actions"
```

---

### Task 4: 改为整条 timeline 连续录制

**Files:**
- Modify: `src/lib/video-generator/browser/recorder.ts:14-208`
- Modify: `tests/video-generator/browser-recorder.unit.test.ts`

- [x] **Step 1: 写失败测试，证明多段只生成一个连续 clip**

在 `tests/video-generator/browser-recorder.unit.test.ts` 中新增：

```ts
test('recordTimelineSegments records multiple segments into one continuous clip', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'browser-recorder-continuous-'));

  try {
    const timeline: Timeline = {
      version: 1,
      title: 'Continuous recorder',
      segments: [
        {
          id: 'open',
          sourceText: 'open',
          narration: 'open',
          subtitle: 'open',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'goto', url: demoDataUrl('<main><h1>Open</h1><button>Next</button></main>'), waitFor: { type: 'text', value: 'Open' } },
          ],
          assets: {},
        },
        {
          id: 'click',
          sourceText: 'click',
          narration: 'click',
          subtitle: 'click',
          estimatedDurationMs: 250,
          bufferMs: 0,
          actions: [
            { type: 'click', text: 'Next' },
          ],
          assets: {},
        },
      ],
    };

    const updated = await recordTimelineSegments({ timeline, config: makeConfig(outputDir), outputDir });

    assert.equal(typeof updated.assets?.continuousClipPath, 'string');
    assert.ok(existsSync(updated.assets?.continuousClipPath as string));
    assert.equal(updated.segments[0]?.assets.clipPath, updated.assets?.continuousClipPath);
    assert.equal(updated.segments[1]?.assets.clipPath, updated.assets?.continuousClipPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/browser-recorder.unit.test.ts`

Expected: FAIL，原因是 `updated.assets` 不存在，且不同 segment 仍各自生成 clip。

- [x] **Step 3: 重写 recorder 主流程**

在 `src/lib/video-generator/browser/recorder.ts` 中保留目录创建和错误截图逻辑，但把主流程改为：

```ts
export async function recordTimelineSegments({ timeline, config, outputDir }: RecordTimelineSegmentsInput): Promise<Timeline> {
  const videoDir = join(outputDir, 'clips');
  const screenshotDir = join(outputDir, 'screenshots');
  await mkdir(videoDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let currentSegment: TimelineSegment | undefined;
  let currentAction: TimelineSegment['actions'][number] | undefined;

  try {
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: config.viewport, recordVideo: { dir: videoDir, size: config.viewport } });
    page = await context.newPage();
    const recordedSegments: TimelineSegment[] = [];

    for (const segment of timeline.segments) {
      currentSegment = segment;
      const segmentStartMs = Date.now();

      for (const action of segment.actions) {
        currentAction = action;
        await executeBrowserAction(page, action, config.actionTimeoutMs);
        await waitForPageStable(page, config.actionTimeoutMs);
      }

      await page.waitForTimeout(calculateSegmentDurationMs({
        estimatedMs: segment.estimatedDurationMs,
        actualAudioMs: segment.actualAudioDurationMs,
        bufferMs: segment.bufferMs,
      }));

      recordedSegments.push({
        ...segment,
        assets: { ...segment.assets },
        startsAtMs: segment.startsAtMs ?? segmentStartMs,
        endsAtMs: segment.endsAtMs ?? Date.now(),
      });
    }

    const video = page.video();
    await context.close();
    context = undefined;

    if (video === null) {
      throw new VideoGeneratorError('UNSUPPORTED_SCRIPT_ACTION', 'Playwright did not attach a video recorder to the page.');
    }

    const continuousClipPath = await video.path();
    return {
      ...timeline,
      assets: { ...timeline.assets, continuousClipPath },
      segments: recordedSegments.map((segment) => ({
        ...segment,
        assets: { ...segment.assets, clipPath: continuousClipPath },
      })),
    };
  } catch (error) {
    const screenshotPath = join(screenshotDir, `${currentSegment?.id ?? 'unknown'}.png`);
    const screenshotCaptured = page === undefined ? false : await captureFailureScreenshot(page, screenshotPath);
    await context?.close().catch(() => undefined);

    const screenshotMessage = screenshotCaptured
      ? `screenshot saved to ${screenshotPath}`
      : `screenshot capture failed for ${screenshotPath}`;

    throw new VideoGeneratorError(
      error instanceof VideoGeneratorError ? error.code : 'UNSUPPORTED_SCRIPT_ACTION',
      `Failed to record segment ${currentSegment?.id ?? 'unknown'}; ${screenshotMessage}: ${errorMessage(error)}`,
      currentSegment?.id,
      error instanceof VideoGeneratorError ? error.failedAction ?? currentAction : currentAction,
    );
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
```

删除不再使用的 `preparedHtmlDir`、`statePath`、`recordSegment`、`showPreparedPage`、`snapshotPreparedHtml` 相关逻辑。

- [x] **Step 4: 调整受影响旧测试**

在 `tests/video-generator/browser-recorder.unit.test.ts` 中：

- 保留“records one clip per segment”的语义，但断言所有 segment clipPath 都存在即可。
- 删除或改写 prepared-html 相关断言，因为连续录制不再写 prepared DOM。
- 保留失败截图测试，确认截图来自 live page。

- [x] **Step 5: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/browser-recorder.unit.test.ts`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add src/lib/video-generator/browser/recorder.ts tests/video-generator/browser-recorder.unit.test.ts
git commit -m "refactor: record video scripts continuously"
```

---

### Task 5: 渲染器优先使用连续 clip

**Files:**
- Modify: `src/lib/video-generator/ffmpeg.ts:28-80`
- Modify: `tests/video-generator/ffmpeg.unit.test.ts`

- [x] **Step 1: 写失败测试**

在 `tests/video-generator/ffmpeg.unit.test.ts` 中新增：

```ts
test('renderFinalVideo uses top-level continuous clip when available', async () => {
  const outputDir = path.join(tmpdir(), `ffmpeg-continuous-${process.pid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const timeline = makeTimeline();
  timeline.assets = { continuousClipPath: '/clips/full.webm' };
  const runCommand: RunCommand = async () => ({ stdout: '', stderr: '' });

  try {
    await renderFinalVideo({ timeline, outputDir, runCommand });

    const concatList = await readFile(path.join(outputDir, 'concat-list.txt'), 'utf8');
    assert.equal(concatList, "file '/clips/full.webm'\n");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/ffmpeg.unit.test.ts`

Expected: FAIL，concat list 仍包含两个 segment clip。

- [x] **Step 3: 实现 continuous clip 优先**

在 `renderFinalVideo` 中把 `clipPaths` 生成逻辑改为：

```ts
const clipPaths = input.timeline.assets?.continuousClipPath !== undefined
  ? [input.timeline.assets.continuousClipPath]
  : input.timeline.segments.map((segment) => {
      if (segment.assets.clipPath === undefined) {
        throw new VideoGeneratorError('FFMPEG_FAILED', `Cannot render final video because segment ${segment.id} is missing a clip path.`);
      }

      return segment.assets.clipPath;
    });
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/ffmpeg.unit.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/lib/video-generator/ffmpeg.ts tests/video-generator/ffmpeg.unit.test.ts
git commit -m "feat: render continuous recording clips"
```

---

### Task 6: 规范化字幕文本

**Files:**
- Modify: `src/lib/video-generator/subtitles.ts:1-39`
- Modify: `tests/video-generator/subtitles.unit.test.ts`

- [x] **Step 1: 写失败测试**

在 `tests/video-generator/subtitles.unit.test.ts` 中新增：

```ts
test('renderSrt normalizes subtitle punctuation without changing timing', () => {
  const timeline: Timeline = {
    version: 1,
    title: 'Subtitles',
    segments: [
      {
        id: 'intro',
        sourceText: 'intro',
        narration: '首先打开页面，确认状态。',
        subtitle: '首先打开页面，确认状态。',
        actions: [],
        estimatedDurationMs: 1000,
        bufferMs: 0,
        assets: {},
      },
    ],
  };

  assert.equal(renderSrt(timeline), [
    '1',
    '00:00:00,000 --> 00:00:01,000',
    '首先打开页面 确认状态',
    '',
  ].join('\n'));
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/subtitles.unit.test.ts`

Expected: FAIL，字幕仍包含 `，` 和 `。`。

- [x] **Step 3: 实现字幕规范化**

在 `src/lib/video-generator/subtitles.ts` 中新增：

```ts
function normalizeSubtitleText(text: string): string {
  return text
    .replaceAll('。', '')
    .replace(/[，,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

把输出行从：

```ts
segment.subtitle,
```

改为：

```ts
normalizeSubtitleText(segment.subtitle),
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/subtitles.unit.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/lib/video-generator/subtitles.ts tests/video-generator/subtitles.unit.test.ts
git commit -m "feat: normalize generated subtitles"
```

---

### Task 7: 更新 Pacdora 示例脚本为真实可见路径

**Files:**
- Modify: `examples/video-generator/pacdora-dieline.md:1-24`
- Modify: `tests/video-generator/script-parser.unit.test.ts`

- [x] **Step 1: 写失败测试，防止示例直接跳详情 URL**

在 `tests/video-generator/script-parser.unit.test.ts` 中新增：

```ts
test('Pacdora example scrolls to drawer gift box card before opening detail page', async () => {
  const source = await readFile('examples/video-generator/pacdora-dieline.md', 'utf8');

  assert.match(source, /向下滚动到选择器\s+a\[href\*="custom-dimensions-tray-boxes-dieline-128020"\]/u);
  assert.match(source, /点击选择器\s+a\[href\*="custom-dimensions-tray-boxes-dieline-128020"\]/u);
  assert.doesNotMatch(source, /^打开\s+https:\/\/www\.pacdora\.cn\/dielines-detail\/custom-dimensions-tray-boxes-dieline-128020$/mu);
});
```

同时在文件顶部补充 import：

```ts
import { readFile } from 'node:fs/promises';
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`

Expected: FAIL，因为示例仍直接打开详情 URL。

- [x] **Step 3: 更新示例脚本**

把 `examples/video-generator/pacdora-dieline.md` 改为：

```md
打开 https://www.pacdora.cn/mockups/mailing-and-shipping-box-mockups
旁白：首先打开 Pacdora 运输箱样机页面。

打开 https://www.pacdora.cn/dielines
旁白：进入刀版模板页面。

向下滚动到选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]
旁白：向下浏览刀版列表，找到抽屉式礼盒卡片。

点击选择器 a[href*="custom-dimensions-tray-boxes-dieline-128020"]
旁白：点击抽屉式礼盒卡片并打开详情页。

点击选择器 .size-mode-item[gtm="ga-dieline_dieline_basic_inner"]
旁白：将尺寸类型切换为内尺寸。

在选择器 input.number-input-box.paInput >> nth=0 输入 300
旁白：输入长度三百毫米。

在选择器 input.number-input-box.paInput >> nth=1 输入 300
旁白：输入宽度三百毫米。

在选择器 input.number-input-box.paInput >> nth=2 输入 100
旁白：输入高度一百毫米。

等待 300 × 300 × 100 mm
旁白：确认页面已经生成三百乘三百乘一百毫米的内尺寸刀版。
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add examples/video-generator/pacdora-dieline.md tests/video-generator/script-parser.unit.test.ts
git commit -m "test: enforce visible Pacdora card navigation"
```

---

### Task 8: 支持加载 Playwright storage state 登录态

**Files:**
- Modify: `src/lib/video-generator/types.ts`
- Modify: `src/lib/video-generator/config.ts`
- Modify: `src/cli/video-generator.ts`
- Modify: `src/lib/video-generator/browser/recorder.ts`
- Modify: `tests/video-generator/config.unit.test.ts`
- Modify: `tests/video-generator/cli.unit.test.ts`
- Modify: `tests/video-generator/browser-recorder.unit.test.ts`

- [x] **Step 1: 写失败测试，覆盖配置和 CLI 参数**

在 `tests/video-generator/config.unit.test.ts` 增加断言：`loadVideoGeneratorConfig({ storageStatePath: 'auth/state.json' }).storageStatePath` 等于该路径。

在 `tests/video-generator/cli.unit.test.ts` 增加测试：调用 `runVideoGeneratorCli(['--script', 'demo.md', '--output', 'out', '--storage-state', 'auth/state.json'], { runVideoGenerator })`，断言 `runVideoGenerator` 收到 `configOverrides: { outputDir: 'out', storageStatePath: 'auth/state.json' }`。

- [x] **Step 2: 写失败测试，覆盖 recorder 使用 storage state**

在 `tests/video-generator/browser-recorder.unit.test.ts` 增加测试：创建本地 HTTP server，写入一个 Playwright storage state JSON，包含目标 origin 的 cookie 或 localStorage；timeline 打开该 server 页面，页面显示 cookie/localStorage 内容；调用 `recordTimelineSegments` 时传入 `config.storageStatePath`，断言录制成功且页面能看到登录态标记。

- [x] **Step 3: 运行测试确认失败**

Run: `npm run test:unit -- tests/video-generator/config.unit.test.ts tests/video-generator/cli.unit.test.ts tests/video-generator/browser-recorder.unit.test.ts`

Expected: FAIL，原因是类型/config/CLI/recorder 尚未支持 `storageStatePath`。

- [x] **Step 4: 实现配置和 CLI**

在 `VideoGeneratorConfig` 增加可选字段：

```ts
storageStatePath?: string;
```

`loadVideoGeneratorConfig` 保持浅合并即可。

在 `src/cli/video-generator.ts`：
- `ParsedArgs` 增加 `storageStatePath?: string`。
- `parseArgs` 支持 `--storage-state <file>`。
- `runVideoGeneratorCli` 调用 pipeline 时传入 `{ outputDir, storageStatePath }`，未提供的字段不要写入。
- `usage()` 增加 `--storage-state <file>`。

- [x] **Step 5: 实现 recorder 加载 storage state**

在 `recordTimelineSegments` 创建 context 时：

```ts
context = await browser.newContext({
  viewport: config.viewport,
  storageState: config.storageStatePath,
  recordVideo: { dir: videoDir, size: config.viewport },
});
```

如果 Playwright 因文件不存在或格式错误抛错，沿用现有失败报告路径即可，但错误信息应包含原始错误摘要。

- [x] **Step 6: 运行测试确认通过**

Run: `npm run test:unit -- tests/video-generator/config.unit.test.ts tests/video-generator/cli.unit.test.ts tests/video-generator/browser-recorder.unit.test.ts`

Expected: PASS。

- [x] **Step 7: 运行全量基础测试**

Run: `npm run test`

Expected: PASS。

- [x] **Step 8: 提交**

```bash
git add src/lib/video-generator/types.ts src/lib/video-generator/config.ts src/cli/video-generator.ts src/lib/video-generator/browser/recorder.ts tests/video-generator/config.unit.test.ts tests/video-generator/cli.unit.test.ts tests/video-generator/browser-recorder.unit.test.ts
git commit -m "feat: load storage state for recordings"
```

---

### Task 9: 真实录制验证和基础测试

**Files:**
- No code files unless validation exposes a bug.
- Runtime output: `video-runs/pacdora-dieline/`

- [x] **Step 1: 运行基础测试**

Run: `npm run test`

Expected: `# fail 0`，所有测试通过。

- [x] **Step 2: 运行 Pacdora 真实录制**

Run: `npm run video:generate -- --script examples/video-generator/pacdora-dieline.md --output video-runs/pacdora-dieline`

Expected: 输出 `Video generated: video-runs\pacdora-dieline\final.mp4`。

- [x] **Step 3: 检查生成报告**

Run: `node -e "const r=require('./video-runs/pacdora-dieline/run-report.json'); if(!r.ok) throw new Error(JSON.stringify(r)); console.log(r.finalVideoPath)"`

Expected: 输出 `video-runs\pacdora-dieline\final.mp4`。

- [x] **Step 4: 检查视频文件存在**

Run: `ls -lh "video-runs/pacdora-dieline/final.mp4"`

Expected: 文件存在且大小大于 0。

- [x] **Step 5: 检查字幕规范化结果**

Run: `node -e "const fs=require('fs'); const s=fs.readFileSync('video-runs/pacdora-dieline/subtitles.srt','utf8'); if(/[。，,]/.test(s)) throw new Error(s); console.log('subtitles normalized')"`

Expected: 输出 `subtitles normalized`。

- [ ] **Step 6: 提交最终验证相关更新**

如果 Task 8 没有产生代码变更，不提交。如果产生修复，按具体文件提交：

```bash
git add <changed-files>
git commit -m "fix: stabilize continuous recording smoke test"
```

---

## 自检结果

- Spec 覆盖：连续录制、1920×1080、页面内不重载、真实滚动点击 Pacdora 卡片、字幕规范化、`--storage-state` 登录态加载、错误报告和测试验证均有任务覆盖。
- 占位扫描：没有 `TBD`、`TODO`、`implement later` 或未展开的“类似上一步”。
- 类型一致性：计划统一使用 `Timeline.assets.continuousClipPath`、`scrollTo` action、`WaitTarget` selector，后续任务引用与 Task 1 定义一致。
