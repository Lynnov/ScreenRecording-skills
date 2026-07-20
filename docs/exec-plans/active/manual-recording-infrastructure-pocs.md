# 人工录制基础设施 POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 创建时间：2026-07-17  
> 最后更新：2026-07-17  
> 设计基线：`6d46994 docs: design manual recording and agent editing`

**Goal:** 在不修改现有 Playwright 自动录制流程的前提下，独立验证 Windows 指定 Chromium 窗口捕获、统一录制时钟、页面事件与虚拟鼠标、多源 Segment 预览渲染四项确定性基础设施。

**Architecture:** 新能力放在独立的 `capture/`、`recording/`、`browser/manual-*`、`editing/` 和 `pocs/manual-recording/` 边界中；现有 `browser/recorder.ts`、`browser/actions.ts`、`pipeline.ts` 和 `video:generate` 保持不变。Electron 只负责窗口捕获和 POC 控制，Playwright 只启动 Chromium、观察 Page 与注入非业务观察脚本，ffmpeg 只执行通过校验的多源剪辑计划。

**Tech Stack:** TypeScript ESM、Node.js >=22.12.0、Playwright（`package-lock.json` 当前解析为 1.60.0）、Electron 43.1.1、Chromium、MediaRecorder、ffmpeg/ffprobe、`node:test` + `tsx`、Windows 10/11。

---

## 状态

| Phase | 内容 | 状态 | 独立验收产物 |
|---|---|---|---|
| Phase 0 | POC 公共依赖、构建边界和素材目录 | 待开始 | Electron 可构建；manual POC 目录可创建 |
| POC 1 | Windows 指定 Chromium 窗口捕获 | 待开始 | `capture/original-window.mp4` + `reports/capture-poc-report.json` |
| POC 2 | 视频、页面事件和用户标记统一时钟 | 待开始 | `capture/events.jsonl` + `capture/recording-manifest.json`（manifest 内含漂移报告字段） |
| POC 3 | 页面事件采集和虚拟鼠标 | 待开始 | `capture/events.jsonl` + `reports/manual-events-poc-report.json` |
| POC 4 | 原始录像 + Segment 补录多源预览 | 待开始 | `edit/preview-timeline.json` + `edit/preview.mp4` |
| Phase 5 | 全量回归、POC 结果文档和归档决策 | 待开始 | `docs/research/manual-recording-infrastructure-poc-results.md` |

## 第一份计划的明确范围

本计划只覆盖设计文档第 20 节的四个基础设施 POC：

1. **POC 1：Windows Electron 指定 Chromium 窗口捕获**——同一 Chromium 窗口中的多标签页连续录像、悬浮窗不入镜、固定 1920×1080、F11/无边框最大化、Windows 125%/150% 缩放。
2. **POC 2：统一录制时钟**——`sessionTimeMs`、`videoTimeMs`、F7/F9/F10 标记、长录制漂移检测。
3. **POC 3：页面事件与虚拟鼠标**——采集 click/input/change/scroll/navigation/tab，JSONL 追加写，新 Page/导航重新注入，虚拟指针不拦截网页。
4. **POC 4：多源 Segment 预览渲染**——original + pickup source、trim、concat、局部加速、末帧定格、短淡化、preview 输出。

本计划明确不包含：完整人工录制产品流程、正式悬浮窗 UI、Agent 生成 recording guide、Agent 生成 edit plan、TTS/final 流程改造、macOS/Linux、独立 popup、其他桌面应用、整屏录制、隐私治理、自动业务 click/fill、自动标签页切换。

## 已确认技术决策

### 1. 保留自动录制流程

以下文件不在四个 POC 中增加人工模式分支：

- `src/lib/video-generator/browser/recorder.ts`
- `src/lib/video-generator/browser/actions.ts`
- `src/lib/video-generator/browser/interaction-rules.ts`
- `src/lib/video-generator/pipeline.ts`
- `src/cli/video-generator.ts`
- `src/lib/video-generator/ffmpeg.ts`

POC 使用新模块和独立 npm scripts；四个 POC 通过后，再决定哪些稳定接口进入正式 `video:record` / `video:preview`。

### 2. Electron 版本和捕获 API

- 固定开发依赖 `electron@43.1.1`，其 npm metadata 要求安装端 Node.js `>=22.12.0`；当前仓库实测 Node `22.14.0` 满足要求，实施时仍执行版本门禁。
- Electron main process 使用 `desktopCapturer.getSources({ types: ['window'] })` 枚举窗口。
- `session.defaultSession.setDisplayMediaRequestHandler()` 将唯一匹配的 `DesktopCapturerSource` 交给 renderer 的 `navigator.mediaDevices.getDisplayMedia()`。
- `getDisplayMedia()` 不支持用 `deviceId` 直接选择窗口；不得把 `sources[0]` 当作目标窗口。
- Chromium 首次打开一个带唯一 session token 的绑定页；Electron 精确匹配该窗口标题并缓存 source id，绑定后才导航到测试页。
- 悬浮窗是独立 Electron `BrowserWindow`；选择 Chromium `window` source 而不是 `screen` source，理论上不会录入悬浮窗，但仍必须经过 Windows 本机录像验收。
- renderer 保持 `contextIsolation: true`、`nodeIntegration: false`，通过 `.cts` preload 暴露最小 IPC API。

官方依据：

- <https://www.electronjs.org/docs/latest/api/desktop-capturer/>
- <https://www.electronjs.org/docs/latest/api/session#setdisplaymediarequesthandlerhandler-opts>
- <https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source>
- <https://www.electronjs.org/docs/latest/tutorial/security>
- <https://releases.electronjs.org/release/v43.1.1>

### 3. 捕获格式和固定画布

- Electron `MediaRecorder` 先追加写入 `capture/raw-window.webm`；这是中断恢复素材，不覆盖已有文件。
- 正常停止后，ffmpeg 生成 `capture/original-window.mp4`：1920×1080、30fps、SAR 1、`yuv420p`、H.264、无音频。
- 统一尺寸采用等比缩放与补边，而不是拉伸：

```text
scale=1920:1080:force_original_aspect_ratio=decrease,
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,
setsar=1,
fps=30,
format=yuv420p
```

- ffmpeg 失败时保留 `raw-window.webm`，报告 `normalizedVideoStatus: "failed"`，不得写一个看似成功的空 MP4。

### 4. F11、无边框最大化和缩放验证

- `f11` 模式由操作员在 POC 提示后对 Chromium 按 F11；报告记录确认时刻。
- `borderless-maximized` 模式由 Windows 专用 helper 根据 `DesktopCapturerSource.id` 中的 window handle 调用 PowerShell/User32，去除标题栏和可调整边框后铺满当前 monitor work area；退出时恢复原 window style 和 bounds。
- Windows 125% / 150% 缩放不由程序自动修改，避免改变用户系统设置；POC 读取 Electron `screen.getPrimaryDisplay().scaleFactor` 写入报告，并在两种人工设置下分别运行。
- 每次运行都以 ffprobe 实际结果判断输出是否为 1920×1080，不能用请求参数代替验收。

### 5. 统一时钟

- Node/Electron main process 的 `process.hrtime.bigint()` 是唯一 session 单调时钟。
- `sessionTimeMs` 从 POC session 创建时起算；正式录制 F7 不重置它。
- renderer 先创建并 `recorder.start(250)`；MediaRecorder 收到第一个非空 `dataavailable` 时，renderer 发 `capture-first-chunk(sequence=0,timecode)`，main process 记录 `firstVideoFrameSessionTimeMs`。video element 的 `requestVideoFrameCallback` 只用于确认画面可见，不作为视频时间零点。
- `videoTimeMs = sessionTimeMs - firstVideoFrameSessionTimeMs`；第一帧前为 `null`。
- MediaRecorder 每个 `dataavailable` 的 `BlobEvent.timecode` 形成时钟采样；结束后用线性回归和 ffprobe duration 双重检测漂移。
- 判定阈值固定为：`maxAllowedDriftMs = max(250, capturedDurationMs × 0.00015)`；超过阈值则 manifest 的 `clockStatus` 为 `drift-detected`，POC 失败。

### 6. 页面观察边界

- Playwright 1.60 的 `BrowserContext.addInitScript()` 用于每个新 Page、导航和 child frame 的早期注入。
- `BrowserContext.exposeBinding()` 把浏览器事件传回 Node；Node 统一盖 session/video 时间戳。
- `BrowserContext.on('page')`、`Page.on('close')` 和页面 `visibilitychange/focus/blur` 生成 tab 生命周期事件。
- 观察器不得调用 `page.click()`、`locator.click()`、`page.fill()`、`locator.fill()`、`page.goto()` 或 `page.bringToFront()`；只有 POC fixture 驱动脚本可通过 Playwright 模拟“用户输入”来验证观察结果，生产观察模块本身不执行这些动作。

### 7. 多源 preview 语义

- `edit-plan.json` 沿用已确认设计的 `sourceId`、`sourceStartMs`、`sourceEndMs`、`playbackRate`、`holdLastFrameMs` 和 `transition`。
- `transition: "short-fade"` 在本 POC 中精确定义为：当前 Segment 末尾 120ms 淡出到黑、下一 Segment 开头 120ms 从黑淡入；两段不重叠，不缩短总时间轴。
- `playbackRate` 允许 `1..2`；POC 不实现慢放和超过 2× 的正常操作加速。
- `holdLastFrameMs` 允许 `0..5000`。
- preview 固定输出一个 H.264 video stream、0 个 audio stream；“无音频”是人工录制阶段的预期基础结构。

## 目标文件结构

```text
pocs/manual-recording/
├── capture-main.ts
├── capture-preload.cts
├── capture-renderer.ts
├── capture.html
├── capture-fixture.html
├── clock-fixture.html
└── event-fixture.html

src/lib/video-generator/
├── capture/
│   ├── types.ts
│   ├── source-matcher.ts
│   ├── windows-electron.ts
│   ├── windows-window-mode.ts
│   └── normalize-video.ts
├── recording/
│   ├── types.ts
│   ├── artifacts.ts
│   ├── clock.ts
│   ├── drift.ts
│   ├── event-log.ts
│   ├── manifest.ts
│   └── session.ts
├── browser/
│   ├── manual-observer.ts
│   ├── manual-cursor-overlay.ts
│   └── tab-observer.ts
└── editing/
    ├── types.ts
    ├── duration.ts
    ├── validator.ts
    ├── media-probe.ts
    ├── filtergraph.ts
    └── preview.ts

tests/video-generator/
├── manual-artifacts.unit.test.ts
├── capture-source-matcher.unit.test.ts
├── windows-window-mode.unit.test.ts
├── capture-normalize-video.unit.test.ts
├── recording-clock.unit.test.ts
├── recording-drift.unit.test.ts
├── recording-event-log.unit.test.ts
├── recording-manifest.unit.test.ts
├── manual-observer.unit.test.ts
├── manual-cursor-overlay.unit.test.ts
├── tab-observer.unit.test.ts
├── editing-duration.unit.test.ts
├── editing-validator.unit.test.ts
├── editing-media-probe.unit.test.ts
├── editing-filtergraph.unit.test.ts
├── editing-preview.unit.test.ts
├── manual-capture-cli.unit.test.ts
├── windows-electron.unit.test.ts
├── manual-window-capture-poc.test.ts
├── manual-clock-poc.test.ts
├── manual-events-poc.test.ts
└── editing-preview-poc.test.ts

tsconfig.electron-poc.json
```

---

### Task 1: 建立 POC 构建边界和独立命令

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tsconfig.electron-poc.json`
- Create: `scripts/copy-manual-poc-assets.mjs`
- Create: `pocs/manual-recording/build-smoke.ts`
- Create: `pocs/manual-recording/capture.html`
- Create: `pocs/manual-recording/capture-fixture.html`

- [ ] **Step 1: 写 Electron POC 构建配置**

创建 `tsconfig.electron-poc.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "noEmit": false,
    "outDir": "dist/manual-recording-poc",
    "rootDir": ".",
    "skipLibCheck": false
  },
  "include": [
    "pocs/manual-recording/**/*.ts",
    "pocs/manual-recording/**/*.cts",
    "src/lib/video-generator/capture/**/*.ts",
    "src/lib/video-generator/recording/**/*.ts",
    "src/lib/video-generator/editing/**/*.ts"
  ]
}
```

预期：根 `tsconfig.json` 继续只提供 Node 类型；DOM/Electron 类型不会污染现有 CLI。

- [ ] **Step 2: 添加固定 Electron 依赖和 POC scripts**

运行：

```bash
npm install --save-dev --save-exact electron@43.1.1
```

在 `package.json` 添加：

```json
{
  "scripts": {
    "build:manual-poc": "tsc -p tsconfig.electron-poc.json && node scripts/copy-manual-poc-assets.mjs"
  },
  "devDependencies": {
    "electron": "43.1.1"
  }
}
```

创建 `pocs/manual-recording/build-smoke.ts`，只验证 Electron 类型在独立 tsconfig 中可解析，不启动桌面：

```ts
import type { DesktopCapturerSource } from 'electron';
export function sourceId(source: Pick<DesktopCapturerSource, 'id'>): string { return source.id; }
```

真实运行和 POC 验证 scripts 在 Task 5 创建 `capture-main.ts` 与验证 wrapper 后再加入，Phase 0 不引用尚不存在的入口。

同时创建 `scripts/copy-manual-poc-assets.mjs`，只复制 HTML：

```js
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('pocs/manual-recording');
const outputDir = path.resolve('dist/manual-recording-poc/pocs/manual-recording');
await mkdir(outputDir, { recursive: true });
const htmlFiles = (await readdir(sourceDir)).filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  await copyFile(path.join(sourceDir, file), path.join(outputDir, file));
}
```

- [ ] **Step 3: 写最小 Electron HTML**

`pocs/manual-recording/capture.html` 只供 Electron control `BrowserWindow` 加载，包含状态、计时和开始/结束按钮，不构成正式 UI：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Manual Capture POC</title></head>
<body>
  <main>
    <p id="status">preparing</p>
    <p id="timer">00:00.000</p>
    <button id="start" type="button">开始</button>
    <button id="stop" type="button">结束</button>
    <fieldset id="checklist" hidden>
      <label><input id="overlay-clear" type="checkbox">悬浮窗未入镜</label>
      <label><input id="multi-tab" type="checkbox">多标签页连续可见</label>
      <textarea id="notes" aria-label="验收备注"></textarea>
      <button id="submit-checklist" type="button">提交验收结论</button>
    </fieldset>
  </main>
  <script type="module" src="./capture-renderer.js"></script>
</body>
</html>
```

`pocs/manual-recording/capture-fixture.html` 只供 Playwright Chromium 加载，不引用 Electron preload：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Chromium Capture Fixture</title></head>
<body><main><h1>窗口捕获 POC</h1><p id="tab-label">tab-1</p><a href="./capture-fixture.html?tab=2" target="_blank">打开第二标签页</a></main></body>
</html>
```

Electron `BrowserWindow.loadFile()` 只加载 `capture.html`；Playwright Page 的 `--fixture capture` 只导航到 `capture-fixture.html`。

- [ ] **Step 4: 验证依赖和构建边界**

Run:

```bash
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<12)){throw new Error('Node >=22.12.0 is required')}"
node -p "require('./node_modules/electron/package.json').version"
node -p "require('./node_modules/playwright/package.json').version"
npm run build:manual-poc
npm run typecheck
```

Expected:

```text
43.1.1
1.60.0
```

版本检查和两个 TypeScript 命令退出码均为 0；`dist/manual-recording-poc/pocs/manual-recording/build-smoke.js`、`capture.html`、`capture-fixture.html` 均存在。Electron 自带 TypeScript declarations，通过普通 `import type ... from 'electron'` 解析，不安装 `@types/electron`。

- [ ] **Step 5: 提交 Phase 0 构建边界**

```bash
git add package.json package-lock.json tsconfig.electron-poc.json scripts/copy-manual-poc-assets.mjs pocs/manual-recording/build-smoke.ts pocs/manual-recording/capture.html pocs/manual-recording/capture-fixture.html
git commit -m "chore: add manual recording poc build"
```

---

### Task 2: 定义人工录制素材目录和公共协议

**Files:**
- Create: `src/lib/video-generator/recording/types.ts`
- Create: `src/lib/video-generator/recording/artifacts.ts`
- Test: `tests/video-generator/manual-artifacts.unit.test.ts`

- [ ] **Step 1: 写失败测试，锁定目录和不可覆盖命名**

`tests/video-generator/manual-artifacts.unit.test.ts`：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createManualRunArtifacts } from '../../src/lib/video-generator/recording/artifacts.js';

test('creates deterministic manual recording artifact paths', () => {
  const artifacts = createManualRunArtifacts(String.raw`E:\video runs\manual-poc`);
  assert.equal(artifacts.rawVideoPath, path.join(artifacts.captureDir, 'raw-window.webm'));
  assert.equal(artifacts.originalVideoPath, path.join(artifacts.captureDir, 'original-window.mp4'));
  assert.equal(artifacts.eventsPath, path.join(artifacts.captureDir, 'events.jsonl'));
  assert.equal(artifacts.manifestPath, path.join(artifacts.captureDir, 'recording-manifest.json'));
  assert.equal(artifacts.previewVideoPath, path.join(artifacts.editDir, 'preview.mp4'));
  assert.equal(artifacts.pickupPath('segment-003', 1), path.join(artifacts.pickupsDir, 'segment-003-attempt-001.mp4'));
});

test('refuses to prepare a run when protected original artifacts already exist', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'manual-artifacts-'));
  try {
    const artifacts = createManualRunArtifacts(tempDir);
    await ensureManualRunArtifactDirs(artifacts);
    await writeFile(artifacts.rawVideoPath, 'existing');
    await assert.rejects(() => assertManualRunIsWritable(artifacts), /already exists/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx tsx --test tests/video-generator/manual-artifacts.unit.test.ts
```

Expected: FAIL，错误包含 `Cannot find module .../recording/artifacts.js`。

- [ ] **Step 3: 实现公共类型**

`src/lib/video-generator/recording/types.ts` 定义。注意：本 POC manifest 保留设计基线的 `tabsPath` 和 `attempts` 字段；四个基础 POC 尚无 recording guide 时，`attempts` 写空数组，不编造 Action：

```ts
export type RecordingState = 'preparing' | 'recording' | 'finishing' | 'completed' | 'failed';

export interface RecordingTimestamp {
  sessionTimeMs: number;
  videoTimeMs: number | null;
}

export interface RecordingEvent extends RecordingTimestamp {
  type: string;
  tabId?: string;
  payload?: Record<string, unknown>;
}

export interface CaptureClockSample extends RecordingTimestamp {
  mediaTimeMs: number;
}

export interface RecordingAttempt {
  actionId: string;
  attempt: number;
  startMs: number;
  endMs: number | null;
  status: 'recording' | 'discarded' | 'confirmed';
}

export interface RecordingManifest {
  version: 1;
  platform: 'win32';
  video: {
    status: 'available';
    path: string;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
    hasAudio: false;
  } | {
    status: 'unavailable';
    path: null;
    reason: string;
  };
  rawVideoPath: string;
  eventsPath: string;
  tabsPath: string;
  recordingStartMs: number;
  recordingEndMs: number;
  firstVideoFrameSessionTimeMs: number | null;
  attempts: RecordingAttempt[];
  clockStatus: 'ok' | 'drift-detected';
  maxObservedDriftMs: number;
  maxAllowedDriftMs: number;
  captureComplete: boolean;
}
```

- [ ] **Step 4: 实现人工素材目录**

`src/lib/video-generator/recording/artifacts.ts` 导出：

```ts
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function fileExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

export interface ManualRunArtifacts {
  outputDir: string;
  captureDir: string;
  pickupsDir: string;
  editDir: string;
  reportsDir: string;
  rawVideoPath: string;
  originalVideoPath: string;
  eventsPath: string;
  tabsPath: string;
  manifestPath: string;
  previewTimelinePath: string;
  previewVideoPath: string;
  capturePocReportPath: string;
  captureOperatorChecklistPath: string;
  captureFfprobeJsonPath: string;
  captureEvidenceFramesDir: string;
  manualEventsPocReportPath: string;
  pickupPath(segmentId: string, attempt: number): string;
}

export function createManualRunArtifacts(outputDir: string): ManualRunArtifacts {
  const captureDir = path.join(outputDir, 'capture');
  const pickupsDir = path.join(outputDir, 'pickups');
  const editDir = path.join(outputDir, 'edit');
  const reportsDir = path.join(outputDir, 'reports');
  return {
    outputDir,
    captureDir,
    pickupsDir,
    editDir,
    reportsDir,
    rawVideoPath: path.join(captureDir, 'raw-window.webm'),
    originalVideoPath: path.join(captureDir, 'original-window.mp4'),
    eventsPath: path.join(captureDir, 'events.jsonl'),
    tabsPath: path.join(captureDir, 'tabs.json'),
    manifestPath: path.join(captureDir, 'recording-manifest.json'),
    previewTimelinePath: path.join(editDir, 'preview-timeline.json'),
    previewVideoPath: path.join(editDir, 'preview.mp4'),
    capturePocReportPath: path.join(reportsDir, 'capture-poc-report.json'),
    captureOperatorChecklistPath: path.join(reportsDir, 'capture-poc-operator-checklist.json'),
    captureFfprobeJsonPath: path.join(reportsDir, 'capture-poc-ffprobe.json'),
    captureEvidenceFramesDir: path.join(reportsDir, 'capture-poc-frames'),
    manualEventsPocReportPath: path.join(reportsDir, 'manual-events-poc-report.json'),
    pickupPath: (segmentId, attempt) => path.join(pickupsDir, `${segmentId}-attempt-${String(attempt).padStart(3, '0')}.mp4`),
  };
}

export async function ensureManualRunArtifactDirs(artifacts: ManualRunArtifacts): Promise<void> {
  await Promise.all([
    mkdir(artifacts.captureDir, { recursive: true }),
    mkdir(artifacts.pickupsDir, { recursive: true }),
    mkdir(artifacts.editDir, { recursive: true }),
    mkdir(artifacts.reportsDir, { recursive: true }),
    mkdir(artifacts.captureEvidenceFramesDir, { recursive: true }),
  ]);
}

export async function assertManualRunIsWritable(artifacts: ManualRunArtifacts): Promise<void> {
  for (const protectedPath of [artifacts.rawVideoPath, artifacts.originalVideoPath, artifacts.eventsPath, artifacts.manifestPath]) {
    if (await fileExists(protectedPath)) throw new Error(`Protected manual recording artifact already exists: ${protectedPath}`);
  }
}
```

测试文件需额外导入 `mkdtemp`、`rm`、`writeFile`、`tmpdir`、`assertManualRunIsWritable`，并在 `finally` 删除临时目录。

- [ ] **Step 5: 运行定向测试和全量回归**

Run:

```bash
npx tsx --test tests/video-generator/manual-artifacts.unit.test.ts
npm run test
```

Expected: 定向测试 PASS；`npm run test` 退出码为 0，typecheck 和当前仓库全部 `*.unit.test.ts` PASS；不把测试数量写死。

- [ ] **Step 6: 提交公共协议**

```bash
git add src/lib/video-generator/recording/types.ts src/lib/video-generator/recording/artifacts.ts tests/video-generator/manual-artifacts.unit.test.ts
git commit -m "feat: add manual recording artifacts"
```

---

### Task 3: POC 1——目标窗口匹配与 Windows 模式控制

**Files:**
- Create: `src/lib/video-generator/capture/types.ts`
- Create: `src/lib/video-generator/capture/source-matcher.ts`
- Create: `src/lib/video-generator/capture/windows-window-mode.ts`
- Test: `tests/video-generator/capture-source-matcher.unit.test.ts`
- Test: `tests/video-generator/windows-window-mode.unit.test.ts`

- [ ] **Step 1: 写 source 匹配失败测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchUniqueWindowSource } from '../../src/lib/video-generator/capture/source-matcher.js';

test('rejects missing and ambiguous Chromium window sources', () => {
  assert.throws(() => matchUniqueWindowSource([], 'VG-CAPTURE-abc'), /not found/i);
  assert.throws(() => matchUniqueWindowSource([
    { id: 'window:101:0', name: 'VG-CAPTURE-abc' },
    { id: 'window:102:0', name: 'VG-CAPTURE-abc' },
  ], 'VG-CAPTURE-abc'), /multiple/i);
});

test('returns the only exact title match', () => {
  assert.deepEqual(matchUniqueWindowSource([
    { id: 'window:101:0', name: 'Other' },
    { id: 'window:102:0', name: 'VG-CAPTURE-abc' },
  ], 'VG-CAPTURE-abc'), { id: 'window:102:0', name: 'VG-CAPTURE-abc' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/video-generator/capture-source-matcher.unit.test.ts`  
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 capture provider 边界和精确匹配**

`capture/types.ts`：

```ts
export interface CaptureSourceDescriptor { id: string; name: string; }
export interface CaptureStartResult { rawVideoPath: string; firstFrameSessionTimeMs: number; }
export interface CaptureStopResult { rawVideoPath: string; durationMs: number; complete: boolean; }
export interface CaptureProvider {
  bindSource(title: string): Promise<CaptureSourceDescriptor>;
  start(): Promise<CaptureStartResult>;
  stop(): Promise<CaptureStopResult>;
}
```

`source-matcher.ts`：

```ts
import type { CaptureSourceDescriptor } from './types.js';

export function matchUniqueWindowSource(
  sources: readonly CaptureSourceDescriptor[],
  expectedTitle: string,
): CaptureSourceDescriptor {
  const matches = sources.filter((source) => source.name === expectedTitle);
  if (matches.length === 0) throw new Error(`Chromium capture source "${expectedTitle}" was not found.`);
  if (matches.length > 1) throw new Error(`Multiple Chromium capture sources matched "${expectedTitle}".`);
  return matches[0]!;
}

export function parseWindowsHandle(sourceId: string): bigint {
  const match = /^window:(\d+):\d+$/.exec(sourceId);
  if (match === null) throw new Error(`Unsupported Windows capture source id: ${sourceId}`);
  return BigInt(match[1]!);
}
```

- [ ] **Step 4: 写 Windows window mode 参数测试**

测试只验证 PowerShell 参数和 handle，不真实修改窗口：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEnableBorderlessCommand, buildRestoreWindowCommand } from '../../src/lib/video-generator/capture/windows-window-mode.js';

test('builds encoded PowerShell commands with a restorable snapshot', () => {
  const enable = buildEnableBorderlessCommand(102n);
  assert.equal(enable.command, 'powershell.exe');
  assert.ok(enable.args.includes('-EncodedCommand'));
  assert.match(enable.decodedScript, /GetWindowRect/);
  assert.match(enable.decodedScript, /SetWindowLongPtr/);

  const restore = buildRestoreWindowCommand(102n, {
    style: 13565952n,
    bounds: { left: 10, top: 20, right: 1290, bottom: 740 },
  });
  assert.match(restore.decodedScript, /SetWindowPos/);
  assert.match(restore.decodedScript, /SWP_FRAMECHANGED/);
  assert.match(restore.decodedScript, /13565952/);
});
```

- [ ] **Step 5: 实现 Windows helper**

`windows-window-mode.ts` 提供：

```ts
export interface WindowBounds { left: number; top: number; right: number; bottom: number; }
export interface WindowModeSnapshot { style: bigint; bounds: WindowBounds; }
export interface WindowsCommand {
  command: 'powershell.exe';
  args: string[];
  decodedScript: string;
}

export function buildEnableBorderlessCommand(handle: bigint): WindowsCommand;
export function buildRestoreWindowCommand(handle: bigint, snapshot: WindowModeSnapshot): WindowsCommand;
```

两条 builder 都使用同一段带 `SetLastError=true` 的 User32 P/Invoke 定义。enable 脚本读取并以 JSON stdout 返回原始 `style` 与 `GetWindowRect` bounds，再移除 `WS_CAPTION|WS_THICKFRAME`、`ShowWindow(SW_MAXIMIZE)`；Node 解析 stdout 得到 `WindowModeSnapshot`。restore builder 把 snapshot 的 style/bounds 编入 PowerShell，调用 `SetWindowLongPtr`、`SetWindowPos(..., SWP_FRAMECHANGED)` 和 `ShowWindow(SW_RESTORE)`。任何 User32 返回失败时读取 `Marshal.GetLastWin32Error()` 并非零退出。

`enableBorderlessWindowMode()` 在调用 PowerShell 前通过 `GetWindowLongPtr` 与 `GetWindowRect` 读取原始 style/bounds，保存为 `{ style: bigint, bounds: { left, top, right, bottom } }`；`restoreBorderlessWindowMode()` 把该 snapshot 传入恢复脚本，依次调用 `SetWindowLongPtr`、`SetWindowPos(..., SWP_FRAMECHANGED)` 和 `ShowWindow(SW_RESTORE)`。进程退出钩子若恢复调用失败，报告必须写 `windowModeRestoreRequired: true`、source handle 和原始 snapshot。

- [ ] **Step 6: 运行测试**

Run:

```bash
npx tsx --test tests/video-generator/capture-source-matcher.unit.test.ts tests/video-generator/windows-window-mode.unit.test.ts
```

Expected: 4 个测试 PASS；不改变任何桌面窗口。

- [ ] **Step 7: 提交窗口绑定基础**

```bash
git add src/lib/video-generator/capture tests/video-generator/capture-source-matcher.unit.test.ts tests/video-generator/windows-window-mode.unit.test.ts
git commit -m "feat: add Windows capture source binding"
```

---

### Task 4: POC 1——Electron 捕获、分块落盘和 MP4 规范化

**Files:**
- Create: `src/lib/video-generator/capture/windows-electron.ts`
- Create: `src/lib/video-generator/capture/normalize-video.ts`
- Create: `pocs/manual-recording/capture-preload.cts`
- Create: `pocs/manual-recording/capture-renderer.ts`
- Create: `pocs/manual-recording/capture-renderer.d.ts`
- Test: `tests/video-generator/capture-normalize-video.unit.test.ts`
- Test: `tests/video-generator/windows-electron.unit.test.ts`

- [ ] **Step 1: 写 ffmpeg 规范化参数失败测试**

测试从 `node:fs/promises` 导入 `access`、`mkdtemp`、`readFile`、`rm`、`writeFile`，从 `node:os` 导入 `tmpdir`，从 `node:path` 导入默认 `path`：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCapturedVideo } from '../../src/lib/video-generator/capture/normalize-video.js';

test('normalizes raw capture to 1920x1080 30fps H.264 without audio', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'normalize-capture-'));
  const rawPath = path.join(dir, 'raw-window.webm');
  const finalPath = path.join(dir, 'original-window.mp4');
  const calls: Array<{ command: string; args: string[] }> = [];
  try {
    await writeFile(rawPath, 'raw');
    await normalizeCapturedVideo({
      inputPath: rawPath,
      outputPath: finalPath,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (command === 'ffmpeg' && !args.includes('-version')) await writeFile(`${finalPath}.tmp.mp4`, 'encoded');
        return { stdout: command === 'ffprobe' ? '{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"r_frame_rate":"30/1","pix_fmt":"yuv420p"}],"format":{"duration":"1"}}' : '', stderr: '' };
      },
    });
    const encodeArgs = calls.find((call) => call.command === 'ffmpeg' && !call.args.includes('-version'))!.args;
    assert.ok(encodeArgs.includes('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p'));
    assert.equal(await readFile(finalPath, 'utf8'), 'encoded');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('removes temporary mp4 and preserves the raw WebM when normalization fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'normalize-failure-'));
  const rawPath = path.join(dir, 'raw-window.webm');
  const finalPath = path.join(dir, 'original-window.mp4');
  try {
    await writeFile(rawPath, 'raw');
    await assert.rejects(() => normalizeCapturedVideo({
      inputPath: rawPath,
      outputPath: finalPath,
      runCommand: async (_command, args) => {
        if (args.includes('-version')) return { stdout: '', stderr: '' };
        throw Object.assign(new Error('ffmpeg failed'), { stderr: 'encoder failure' });
      },
    }), /encoder failure/);
    await assert.rejects(() => access(`${finalPath}.tmp.mp4`));
    await assert.rejects(() => access(finalPath));
    assert.equal(await readFile(rawPath, 'utf8'), 'raw');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/video-generator/capture-normalize-video.unit.test.ts`  
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 MP4 规范化**

`normalize-video.ts` 使用现有 `RunCommand` 和 `assertFfmpegAvailable`，并从 `node:fs/promises` 导入 `rename`、`rm`：

```ts
import type { RunCommand } from '../audio.js';
import { assertFfmpegAvailable } from '../ffmpeg.js';

const VIDEO_FILTER = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';

export async function normalizeCapturedVideo(input: {
  inputPath: string;
  outputPath: string;
  runCommand: RunCommand;
}): Promise<void> {
  await assertFfmpegAvailable(input.runCommand);
  const tempPath = `${input.outputPath}.tmp.mp4`;
  try {
    await input.runCommand('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', input.inputPath,
      '-vf', VIDEO_FILTER, '-c:v', 'libx264', '-preset', 'veryfast',
      '-movflags', '+faststart', '-an', '-y', tempPath,
    ]);
    const probe = await input.runCommand('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration', '-of', 'json', tempPath]);
    const metadata = parseNormalizedVideoProbe(probe.stdout);
    if (metadata.videoStreams !== 1 || metadata.audioStreams !== 0 || metadata.codecName !== 'h264' || metadata.width !== 1920 || metadata.height !== 1080 || metadata.fps !== 30 || metadata.pixelFormat !== 'yuv420p') {
      throw new Error(`Normalized capture has unexpected media structure: ${JSON.stringify(metadata)}`);
    }
    await rename(tempPath, input.outputPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
```

同文件实现 `parseNormalizedVideoProbe(stdout)`：解析所有 streams，计算 video/audio 数量，解析 `r_frame_rate` 分数，并拒绝 JSON 无效、缺视频、duration 非有限数。单元测试再加入 1280×720、AAC audio、VP9、非 yuv420p 四个 ffprobe stdout，均断言不 rename 正式 MP4。

- [ ] **Step 4: 实现安全 preload API**

`capture-preload.cts`：

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('manualCapture', {
  appendChunk: (bytes: Uint8Array, sequence: number, timecode: number) => ipcRenderer.invoke('capture:append-chunk', bytes, sequence, timecode),
  markFirstChunk: (sequence: 0, timecode: number) => ipcRenderer.invoke('capture:first-chunk', sequence, timecode),
  flush: (lastSequence: number) => ipcRenderer.invoke('capture:flush', lastSequence),
  stop: () => ipcRenderer.invoke('capture:stop'),
  submitChecklist: (value: { overlayEnteredCapture: boolean; multiTabContinuous: boolean; notes: string }) => ipcRenderer.invoke('capture:submit-checklist', value),
});
```

只暴露上述五个受限方法，不暴露 `ipcRenderer`、`fs` 或 `child_process`。同时创建 `pocs/manual-recording/capture-renderer.d.ts`，声明 `window.manualCapture` 的五个方法（`appendChunk`、`markFirstChunk`、`flush`、`stop`、`submitChecklist`）和返回类型，确保 renderer 在 `nodeIntegration: false` 下不依赖 Node `Buffer`。

- [ ] **Step 5: 实现 renderer 捕获状态机**

`capture-renderer.ts` 的关键顺序必须固定：

```ts
// 该调用必须是 #start 的 click listener 中第一个 await；调用前不得经过 IPC。
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
const video = document.createElement('video');
video.muted = true;
video.srcObject = stream;
await video.play();
await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
let sequence = 0;
let firstChunkMarked = false;
let writeQueue = Promise.resolve();
recorder.addEventListener('dataavailable', (event) => {
  if (event.data.size === 0) return;
  const current = sequence++;
  writeQueue = writeQueue.then(async () => {
    if (!firstChunkMarked) {
      firstChunkMarked = true;
      await window.manualCapture.markFirstChunk(0, event.timecode);
    }
    const bytes = new Uint8Array(await event.data.arrayBuffer());
    await window.manualCapture.appendChunk(bytes, current, event.timecode);
  });
});
recorder.start(250);
```

停止时先为 `stop` 事件创建 Promise，再调用 `recorder.stop()`；收到最终 `dataavailable` 和 `stop` 后 `await writeQueue`，调用 `flush(sequence - 1)` 等待 main 确认所有 sequence 连续写完，最后停止 stream tracks 并调用 `capture:stop`。若 VP9 不支持，按 `video/webm;codecs=vp8`、`video/webm` 顺序降级，并把选择结果写入报告。

- [ ] **Step 6: 实现 Electron main capture provider**

`windows-electron.ts` 必须：

1. `process.platform !== 'win32'` 时直接拒绝。
2. 用 `desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false })` 获取 source。
3. 用 `matchUniqueWindowSource` 精确绑定标题。
4. 在 renderer 请求 display media 前注册 `setDisplayMediaRequestHandler`。
5. source 必须在显示/启用开始按钮之前完成绑定，display media handler 也必须预先注册；`#start` 只有收到 main 的 `capture-ready` IPC 事件后才解除 disabled。
6. `ipcMain.handle('capture:submit-checklist')` 只接受 control sender，验证两个 boolean 和 notes string 后调用 `writeCaptureOperatorChecklist()`；renderer 在 capture stop 完成后显示 checklist fieldset 并提交。
7. `capture:first-chunk` 只接受 sequence 0 对应的首次通知，并在 main clock 上设置 video time origin；重复通知拒绝。
8. display media handler 只允许 control window 的主 frame：在注册时缓存 `controlWindow.webContents.mainFrame.routingId`；handler 中 `request.frame === null`、`request.frame.isDestroyed()`、`request.frame.routingId !== cachedMainFrameRoutingId` 或 `webContents.fromFrame(request.frame)?.id !== controlWindow.webContents.id` 时执行 `callback({})`。整个来源解析包在 `try/catch` 中，detached/destroyed frame 一律拒绝；正确来源执行 `callback({ video: matchedDesktopCapturerSource })`。停止后用 `setDisplayMediaRequestHandler(null)` 清理。
9. `capture:append-chunk` 验证 sequence 从 0 连续递增，使用同一个串行 Promise queue 执行 `appendFile(rawVideoPath, bytes)`，不得在内存聚合整条录像。
10. `capture:flush(lastSequence)` 只有在已落盘 sequence 等于 lastSequence 时返回；缺号时抛出具体 sequence 错误。
11. raw/output 已存在时拒绝开始，保护旧素材。
12. 正常停止后调用 `normalizeCapturedVideo`。
13. 捕获中断时关闭文件句柄、保留 raw、返回 `complete: false`。

- [ ] **Step 7: 写 Electron IPC/handler 单元测试**

`windows-electron.unit.test.ts` 注入假的 `desktopCapturer`、`session`、`webContents.fromFrame`、control `webContents.id` 和 chunk writer，验证：

```text
submit-checklist 验证 sender/payload 并写 checklist
capture-ready 仅在 source 绑定和 display handler 注册完成后发送；start 按钮此前 disabled
start click 的第一个 await 是 getDisplayMedia，不经过 IPC
first-chunk 只接受一次并建立 video origin
唯一 source 被 callback({video: source}) 授权
request.frame=null、已销毁/detached frame、control child frame、非 control webContents 请求均 callback({})
sequence 0,1,2 串行落盘
sequence 0,2 在 flush 时失败并指出缺少 1
停止后 display media handler 被重置为 null
```

- [ ] **Step 8: 运行单元和构建测试**

Run:

```bash
npx tsx --test tests/video-generator/capture-normalize-video.unit.test.ts tests/video-generator/capture-source-matcher.unit.test.ts tests/video-generator/windows-electron.unit.test.ts
npm run build:manual-poc
```

Expected: 所有测试 PASS；Electron POC 构建无类型错误；编译输出中的 HTML、main、preload、renderer 路径与 `BrowserWindow.loadFile()` / `webPreferences.preload` 使用的绝对路径一致。

- [ ] **Step 9: 提交 capture provider**

```bash
git add src/lib/video-generator/capture pocs/manual-recording/capture-preload.cts pocs/manual-recording/capture-renderer.ts pocs/manual-recording/capture-renderer.d.ts tests/video-generator/capture-normalize-video.unit.test.ts tests/video-generator/windows-electron.unit.test.ts
git commit -m "feat: add Electron window capture provider"
```

---

### Task 5: POC 1——专用 Chromium session 与 Windows 验收矩阵

**Files:**
- Modify: `package.json`
- Create: `scripts/verify-manual-poc.mjs`
- Create: `src/lib/video-generator/recording/session.ts`
- Create: `src/lib/video-generator/recording/poc-report.ts`
- Create: `pocs/manual-recording/capture-main.ts`
- Test: `tests/video-generator/manual-window-capture-poc.test.ts`
- Test: `tests/video-generator/manual-capture-cli.unit.test.ts`
- Test: `tests/video-generator/manual-poc-report.unit.test.ts`

- [ ] **Step 1: 实现专用 Chromium 启动和绑定页**

`recording/session.ts` 导出 `launchManualChromiumSession()`，行为固定为：

```ts
const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
const bindingTitle = `VG-CAPTURE-${sessionId}`;
await page.setContent(`<title>${bindingTitle}</title><main>正在绑定窗口…</main>`);
await page.waitForFunction((title) => document.title === title, bindingTitle);
```

Electron 每 250ms 重新枚举 window sources，最多等待 10 秒；精确命中一个 title 后绑定，零个继续等待，多个立即报告冲突。绑定后由 session 根据 `--fixture` 导航到编译输出中的 `capture-fixture.html`、`clock-fixture.html` 或 `event-fixture.html`。模块不得导入或调用 `executeBrowserAction`。

- [ ] **Step 2: 实现 POC main 进程参数**

在 `package.json` 此时再添加：

```json
{
  "scripts": {
    "poc:manual-capture": "npm run build:manual-poc && electron dist/manual-recording-poc/pocs/manual-recording/capture-main.js",
    "test:manual-capture-poc": "node scripts/verify-manual-poc.mjs capture",
    "test:manual-clock-poc": "node scripts/verify-manual-poc.mjs clock",
    "test:manual-events-poc": "node scripts/verify-manual-poc.mjs events",
    "test:editing-poc": "tsx --test tests/video-generator/editing-preview-poc.test.ts"
  }
}
```

并创建 `scripts/verify-manual-poc.mjs`，实现 Task 1 原计划中的 `MANUAL_POC_RUN` 目录映射与 `npx tsx --test` 子进程包装。Task 5 的 Files 因此增加 Modify `package.json`、Create `scripts/verify-manual-poc.mjs`。

`capture-main.ts` 支持：

```text
--output <dir>
--display-mode f11|borderless-maximized
--fixture capture|clock|events
--duration-seconds <positive integer>
--help
```

未知参数、缺少值、duration 非正整数时打印用法并以 2 退出；`--help` 以 0 退出；非 Windows 以 3 退出；source 未绑定以 4 退出；capture/ffmpeg 失败以 5 退出。`--duration-seconds` 是无人值守兜底上限，不是硬切点：计时到期时与第一次 F10 相同，只进入 5 秒 `recording-stop-requested` 确认窗口；操作员第二次 F10/按钮确认优先。5 秒后无人确认则为了 POC 可恢复性自动停止，并追加 `recording-stop-timeout-confirmed`。`--output` 立即解析为绝对路径并调用 `assertManualRunIsWritable()`。所有退出路径在 `finally` 中执行 `globalShortcut.unregisterAll()`、清理 display media handler、关闭 event log、恢复 borderless window、关闭 BrowserContext/BrowserWindow。

- [ ] **Step 3: 写 CLI 解析和清理测试**

`manual-capture-cli.unit.test.ts` 注入假的 Electron/Browser/Capture deps，覆盖 `--help`、未知参数、缺值、duration=0、非 win32、source 未找到、capture 失败，并断言每个退出路径都调用 `unregisterAll`、handler reset、browser close 和 window restore。

Run: `npx tsx --test tests/video-generator/manual-capture-cli.unit.test.ts`  
Expected: 首次 FAIL，`capture-main.ts` 尚未导出可测试的 `parseManualPocArgs()` / `runManualCapturePoc()`。

- [ ] **Step 4: 实现最小置顶悬浮窗**

BrowserWindow 配置：

```ts
new BrowserWindow({
  width: 320,
  height: 180,
  alwaysOnTop: true,
  focusable: false,
  show: false,
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
  },
});
```

首次 `ready-to-show` 使用 `showInactive()`；按钮需要操作时暂时设 `focusable: true`，操作后立即把焦点还给 Chromium，并恢复 `focusable: false`。POC 报告记录 `overlayAlwaysOnTop`、`overlayEnteredCapture` 的人工结论。该窗口只是最小测试控制窗，不实现正式悬浮窗的 Segment、Action、置信度或 Agent UI。

- [ ] **Step 5: 定义并原子写 capture POC report**

`recording/poc-report.ts` 定义：

```ts
export interface CapturePocReport {
  version: 1;
  status: 'passed' | 'failed' | 'incomplete';
  displayMode: 'f11' | 'borderless-maximized';
  displayScaleFactor: number;
  video: {
    status: 'available';
    path: string;
    width: number;
    height: number;
    fps: number;
    durationMs: number;
    hasAudio: false;
  } | {
    status: 'unavailable';
    path: null;
    reason: string;
  };
  overlayAlwaysOnTop: boolean;
  overlayEnteredCapture: boolean | null;
  multiTabContinuous: boolean | null;
  normalizedVideoStatus: 'passed' | 'failed';
  windowModeRestoreRequired: boolean;
  evidence: { operatorChecklistPath: string; ffprobeJsonPath: string; sampledFrames: string[] };
  errors: string[];
}

export async function writeCaptureOperatorChecklist(
  filePath: string,
  checklist: { overlayEnteredCapture: boolean; multiTabContinuous: boolean; notes: string },
): Promise<void>;

export async function writeCapturePocReport(
  filePath: string,
  report: CapturePocReport,
): Promise<void>;
```

两个 writer 调用同一个 `writeJsonAtomically(filePath, value)`，写 `${filePath}.tmp` 后 rename。capture main 在停止并完成 normalize/ffprobe/抽帧后等待控制窗提交 checklist；没有 checklist 时仍写 report，但 `status='incomplete'`。规范化成功时 report 使用 `video.status='available'`；失败时用 `video.status='unavailable'` 和 stderr 摘要，不伪造媒体字段。程序自动填 video/scale/mode/status/errors，并把 ffprobe 原始 stdout 原子写到 `captureFfprobeJsonPath`。结束时用 ffmpeg 在首帧、中点、末帧和每次 tab switch 的 `videoTimeMs` 抽 PNG 到 `captureEvidenceFramesDir`；抽帧命令和路径写入 report。`overlayEnteredCapture` 和 `multiTabContinuous` 由操作员在控制窗查看这些证据后勾选，原子写入 `captureOperatorChecklistPath`；report 只引用该证据，不自行声称通过。writer 使用 `.tmp` + rename，并有 `manual-poc-report.unit.test.ts` 覆盖成功、失败、证据文件缺失和未填写人工结论时 `status='incomplete'`。

- [ ] **Step 6: 写独立 POC 测试包装器**

`manual-window-capture-poc.test.ts` 只在显式命令下运行：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const runDir = process.env.MANUAL_POC_RUN;
test('captures the selected Chromium window on Windows', async () => {
  assert.equal(process.platform, 'win32');
  assert.ok(runDir, 'MANUAL_POC_RUN must point to a completed capture POC run');
  const report = JSON.parse(await readFile(path.join(runDir, 'reports', 'capture-poc-report.json'), 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.video.status, 'available');
  if (report.video.status !== 'available') assert.fail(report.video.reason);
  assert.equal(report.video.width, 1920);
  assert.equal(report.video.height, 1080);
  assert.equal(report.video.fps, 30);
  assert.equal(report.video.hasAudio, false);
  assert.equal(report.overlayEnteredCapture, false);
  assert.equal(report.multiTabContinuous, true);
});
```

操作员先运行 Electron POC 并退出，再运行 `npm run test:manual-capture-poc`；wrapper 默认检查 `video-runs/manual-poc-borderless-100`，其他运行目录使用 `MANUAL_POC_RUN="<path>" npm run test:manual-capture-poc`。普通 `npm run test` 不运行真实桌面 POC。

- [ ] **Step 7: 运行 F11 模式验收**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-poc-f11-100" --display-mode f11 --fixture capture --duration-seconds 60
```

操作：

1. 在提示后按 F11。
2. 在同一 Chromium 窗口打开第二标签页。
3. 人工切换两个标签页各两次。
4. 把 Electron 悬浮窗拖到 Chromium 内容区域上方。
5. F10 二次确认结束。

Expected:

- `capture/original-window.mp4` 存在。
- 视频包含两个标签页的连续切换。
- 悬浮窗不出现在画面中。
- ffprobe：`width=1920`、`height=1080`、`r_frame_rate=30/1`、一个 video stream、零 audio stream。

- [ ] **Step 8: 运行无边框最大化验收**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-poc-borderless-100" --display-mode borderless-maximized --fixture capture --duration-seconds 60
```

Expected: Chromium 无标题栏并铺满 monitor work area；多标签页仍可用；结束后窗口 style 被恢复；输出规格与 F11 相同。

- [ ] **Step 9: 运行 Windows 缩放矩阵**

分别把 Windows 显示缩放设置为 125% 和 150%，每次运行：

```bash
npm run poc:manual-capture -- --output "video-runs/manual-poc-f11-125" --display-mode f11 --fixture capture --duration-seconds 60
npm run poc:manual-capture -- --output "video-runs/manual-poc-borderless-125" --display-mode borderless-maximized --fixture capture --duration-seconds 60
npm run poc:manual-capture -- --output "video-runs/manual-poc-f11-150" --display-mode f11 --fixture capture --duration-seconds 60
npm run poc:manual-capture -- --output "video-runs/manual-poc-borderless-150" --display-mode borderless-maximized --fixture capture --duration-seconds 60
```

Expected: 每个 `capture-poc-report.json` 的 `displayScaleFactor` 分别为 1.25 或 1.5；六个输出均为 1920×1080；没有裁掉浏览器内容；悬浮窗均不入镜。

- [ ] **Step 10: POC 1 独立验收门槛**

POC 1 只有在以下条件全部满足时通过：

```text
6/6 模式×缩放运行成功
6/6 输出 1920×1080、30fps、无音频
6/6 悬浮窗不入镜
6/6 同窗口多标签页连续可见
F11 与 borderless-maximized 均可结束并恢复桌面状态
捕获源缺失/歧义时 F7 禁用且无空视频
```

- [ ] **Step 11: 提交 POC 1**

```bash
git add package.json scripts/verify-manual-poc.mjs src/lib/video-generator/recording/session.ts src/lib/video-generator/recording/poc-report.ts pocs/manual-recording/capture-main.ts tests/video-generator/manual-window-capture-poc.test.ts tests/video-generator/manual-capture-cli.unit.test.ts tests/video-generator/manual-poc-report.unit.test.ts
git commit -m "test: validate Windows Chromium window capture"
```

---

### Task 6: POC 2——统一单调时钟和快捷键时间映射

**Files:**
- Create: `src/lib/video-generator/recording/clock.ts`
- Test: `tests/video-generator/recording-clock.unit.test.ts`

- [ ] **Step 1: 写映射测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecordingClock } from '../../src/lib/video-generator/recording/clock.js';

test('keeps session time monotonic and maps video time from first frame', () => {
  let nowNs = 1_000_000_000n;
  const clock = createRecordingClock(() => nowNs);
  assert.deepEqual(clock.stamp(), { sessionTimeMs: 0, videoTimeMs: null });
  nowNs += 250_000_000n;
  clock.markFirstVideoFrame();
  nowNs += 1_250_000_000n;
  assert.deepEqual(clock.stamp(), { sessionTimeMs: 1500, videoTimeMs: 1250 });
});

test('does not reset session or video time when F7 starts formal recording', () => {
  let nowNs = 0n;
  const clock = createRecordingClock(() => nowNs);
  nowNs = 500_000_000n;
  clock.markFirstVideoFrame();
  nowNs = 2_000_000_000n;
  const f7 = clock.stamp();
  assert.deepEqual(f7, { sessionTimeMs: 2000, videoTimeMs: 1500 });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npx tsx --test tests/video-generator/recording-clock.unit.test.ts`  
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 clock**

```ts
import type { RecordingTimestamp } from './types.js';

export interface RecordingClock {
  stamp(): RecordingTimestamp;
  markFirstVideoFrame(): RecordingTimestamp;
  firstVideoFrameSessionTimeMs(): number | null;
}

export function createRecordingClock(nowNs: () => bigint = process.hrtime.bigint): RecordingClock {
  const origin = nowNs();
  let firstFrameMs: number | null = null;
  let lastSessionTimeMs = -1;
  const readSessionTimeMs = () => Math.round(Number(nowNs() - origin) / 1_000_000);
  const stamp = (): RecordingTimestamp => {
    const sessionTimeMs = readSessionTimeMs();
    if (sessionTimeMs < lastSessionTimeMs) throw new Error(`Recording clock moved backwards: ${sessionTimeMs} < ${lastSessionTimeMs}`);
    lastSessionTimeMs = sessionTimeMs;
    return { sessionTimeMs, videoTimeMs: firstFrameMs === null ? null : sessionTimeMs - firstFrameMs };
  };
  return {
    stamp,
    markFirstVideoFrame() {
      if (firstFrameMs !== null) return stamp();
      const value = stamp();
      firstFrameMs = value.sessionTimeMs;
      return { sessionTimeMs: value.sessionTimeMs, videoTimeMs: 0 };
    },
    firstVideoFrameSessionTimeMs: () => firstFrameMs,
  };
}
```

重复 first-frame 通知不得重置基线；时钟返回值倒退时抛出明确错误。

- [ ] **Step 4: 把 F7/F9/F10 统一交给 clock**

`capture-main.ts` 注册：

```ts
globalShortcut.register('F7', () => session.recordUserMarker('recording-start'));
globalShortcut.register('F9', () => session.recordUserMarker('retry-start'));
globalShortcut.register('F10', () => session.requestStopConfirmation());
```

`getDisplayMedia()` 已在操作员点击控制窗“开始捕获”时完成；F7 只标记正式素材区间，不负责创建 display stream，因此全局快捷键不需要 renderer transient activation。`recordUserMarker()` 只能调用 `clock.stamp()`，不能调用 `Date.now()` 或 renderer 的 `performance.now()`。第一次 F10 追加 `recording-stop-requested` 并在 POC 控制窗显示确认；5 秒内再次按 F10 才追加 `recording-stop` 并停止。人工 F10 请求超时后回到 recording；只有 `--duration-seconds` 兜底上限触发的请求在 5 秒无人响应后自动停止并追加 `recording-stop-timeout-confirmed`。F8/Shift+F8 的 Action 指针语义不属于这四个基础 POC，不在本任务注册。

- [ ] **Step 5: 运行测试**

Run:

```bash
npx tsx --test tests/video-generator/recording-clock.unit.test.ts
npm run build:manual-poc
```

Expected: PASS；Electron main/preload/renderer 类型一致。

- [ ] **Step 6: 提交统一 clock**

```bash
git add src/lib/video-generator/recording/clock.ts tests/video-generator/recording-clock.unit.test.ts pocs/manual-recording/capture-main.ts
git commit -m "feat: add unified recording clock"
```

---

### Task 7: POC 2——JSONL、漂移检测和 manifest

**Files:**
- Create: `src/lib/video-generator/recording/event-log.ts`
- Create: `src/lib/video-generator/recording/drift.ts`
- Create: `src/lib/video-generator/recording/manifest.ts`
- Test: `tests/video-generator/recording-event-log.unit.test.ts`
- Test: `tests/video-generator/recording-drift.unit.test.ts`
- Test: `tests/video-generator/recording-manifest.unit.test.ts`

- [ ] **Step 1: 写 JSONL 追加测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createEventLog } from '../../src/lib/video-generator/recording/event-log.js';

test('appends one durable JSON object per line', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'event-log-'));
  const file = path.join(dir, 'events.jsonl');
  try {
    const log = await createEventLog(file);
    await log.append({ sessionTimeMs: 100, videoTimeMs: 20, type: 'recording-start' });
    await log.append({ sessionTimeMs: 200, videoTimeMs: 120, type: 'retry-start' });
    await log.close();
    assert.equal((await readFile(file, 'utf8')).split('\n').filter(Boolean).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 实现 append-only log**

```ts
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingEvent } from './types.js';

export async function createEventLog(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'ax');
  return {
    async append(event: RecordingEvent) {
      await handle.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
      await handle.sync();
    },
    async close() { await handle.close(); },
  };
}
```

使用 `'ax'` 拒绝覆盖已有 `events.jsonl`；恢复场景必须创建新 run 或显式版本文件，而不是截断旧日志。

- [ ] **Step 3: 写漂移测试**

```ts
test('detects residual or duration drift above the duration-scaled threshold', () => {
  const ok = analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 900_000, videoTimeMs: 900_000, mediaTimeMs: 900_090 },
    { sessionTimeMs: 1_800_000, videoTimeMs: 1_800_000, mediaTimeMs: 1_800_180 },
  ], 1_800_180);
  assert.equal(ok.status, 'ok');
  const bad = analyzeClockDrift([
    { sessionTimeMs: 0, videoTimeMs: 0, mediaTimeMs: 0 },
    { sessionTimeMs: 900_000, videoTimeMs: 900_000, mediaTimeMs: 900_100 },
    { sessionTimeMs: 1_800_000, videoTimeMs: 1_800_000, mediaTimeMs: 1_800_500 },
  ], 1_801_000);
  assert.equal(bad.status, 'drift-detected');
});
```

- [ ] **Step 4: 实现漂移分析**

`drift.ts` 输出：

```ts
export interface DriftAnalysis {
  status: 'ok' | 'drift-detected';
  maxObservedDriftMs: number;
  maxAllowedDriftMs: number;
  slopePpm: number;
  ffprobeDurationDeltaMs: number;
}
```

实现签名固定为：

```ts
export function analyzeClockDrift(
  samples: readonly CaptureClockSample[],
  ffprobeDurationMs: number,
): DriftAnalysis
```

令 `originVideoMs = samples[0].videoTimeMs ?? 0`、`originMediaMs = samples[0].mediaTimeMs`，把每条样本转成 `x = videoTimeMs - originVideoMs`、`y = mediaTimeMs - originMediaMs` 后做普通最小二乘：`slope = covariance(x,y) / variance(x)`、`slopePpm = (slope - 1) * 1_000_000`；每条 residual 为 `mediaTimeMs - (intercept + slope * videoTimeMs)`。`maxObservedDriftMs` 取最大绝对 residual 与 `abs(ffprobeDurationMs - (last.mediaTimeMs - originMediaMs))` 的较大值；`maxAllowedDriftMs = Math.max(250, ffprobeDurationMs * 0.00015)`。少于 3 个 sample、`variance(x) === 0` 或任一字段非有限数时 status 为 `drift-detected`，原因写入 manifest，避免无证据静默通过。

- [ ] **Step 5: 实现 manifest 原子写入**

`manifest.ts` 先写同目录临时文件，再 rename：

```ts
const tempPath = `${manifestPath}.tmp`;
await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await rename(tempPath, manifestPath);
```

manifest 必须由 ffprobe 实际数据和 drift analysis 构造；规范化成功时使用 `video.status='available'`，规范化失败或不存在正式 MP4 时使用 `video.status='unavailable'` 并记录 stderr 摘要，不伪造宽高/时长。未收到第一帧时 `firstVideoFrameSessionTimeMs=null`、`clockStatus='drift-detected'`、`captureComplete=false`。`clockStatus !== 'ok'` 时 POC CLI 返回非零，但仍保留 manifest 和视频。

- [ ] **Step 6: 运行定向测试**

Run:

```bash
npx tsx --test tests/video-generator/recording-event-log.unit.test.ts tests/video-generator/recording-drift.unit.test.ts tests/video-generator/recording-manifest.unit.test.ts
```

Expected: JSONL、阈值边界、manifest 临时文件清理全部 PASS。

- [ ] **Step 7: 提交日志和 drift**

```bash
git add src/lib/video-generator/recording/event-log.ts src/lib/video-generator/recording/drift.ts src/lib/video-generator/recording/manifest.ts tests/video-generator/recording-event-log.unit.test.ts tests/video-generator/recording-drift.unit.test.ts tests/video-generator/recording-manifest.unit.test.ts
git commit -m "feat: add recording clock drift diagnostics"
```

---

### Task 8: POC 2——F7/F9/F10 画面对齐与 30 分钟漂移验收

**Files:**
- Create: `pocs/manual-recording/clock-fixture.html`
- Test: `tests/video-generator/manual-clock-poc.test.ts`
- Modify: `pocs/manual-recording/capture-main.ts`
- Modify: `pocs/manual-recording/capture-renderer.ts`

- [ ] **Step 1: 创建只用于 POC 的时钟 fixture**

`clock-fixture.html` 显示 30fps 变化的画面、当前 session time 和最近 marker；marker 由 POC IPC 更新 DOM，不执行网页业务动作：

```html
<main><output id="clock">0</output><output id="marker">none</output><div id="marker-color" style="width:240px;height:240px;background:#111"></div></main>
<script>
  const markerColors = { 'recording-start': '#ff0000', 'retry-start': '#00ff00', 'recording-stop': '#0000ff' };
  const origin = performance.now();
  function tick() {
    document.querySelector('#clock').textContent = String(Math.round(performance.now() - origin));
    requestAnimationFrame(tick);
  }
  tick();
  globalThis.showMarker = async (name, requestedVideoTimeMs) => {
    document.querySelector('#marker').textContent = `${name}:${requestedVideoTimeMs}`;
    document.querySelector('#marker-color').style.background = markerColors[name];
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now();
  };
</script>
```

- [ ] **Step 2: 把 MediaRecorder timecode 写成 clock sample**

每次 `dataavailable` 除了 append chunk，还发送 `timecode`；main 用统一 clock 盖章，追加：

```json
{"type":"capture-clock-sample","sessionTimeMs":10250,"videoTimeMs":10000,"payload":{"mediaTimeMs":9992}}
```

不得把 renderer 的 wall clock 直接写入 `sessionTimeMs`。

- [ ] **Step 3: 写 POC 验证器**

`manual-clock-poc.test.ts` 读取 manifest/events 并断言：

```ts
assert.equal(manifest.video.status, 'available');
assert.equal(manifest.clockStatus, 'ok');
assert.ok(manifest.maxObservedDriftMs <= manifest.maxAllowedDriftMs);
for (const type of ['recording-start', 'retry-start', 'recording-stop']) {
  const event = events.find((item) => item.type === type);
  assert.equal(typeof event?.videoTimeMs, 'number');
}
```

`capture-main.ts` 持有 Playwright `Page` 引用；快捷键到达时先记 `marker-requested`，只为 clock fixture 执行：

```ts
await page.evaluate(({ name, requestedVideoTimeMs }) => {
  const fixture = globalThis as typeof globalThis & {
    showMarker(name: string, requestedVideoTimeMs: number): Promise<number>;
  };
  return fixture.showMarker(name, requestedVideoTimeMs);
}, request);
```

fixture 等两个 requestAnimationFrame 后返回 ack，main 再用 `clock.stamp()` 记录正式 `recording-start` / `retry-start` / `recording-stop`，确保事件时间对应已可见的颜色块。该调用只更新 POC 颜色块，不触发任何业务交互。然后用 ffmpeg 在三个 marker 的 `videoTimeMs ± 1 frame` 抽帧，通过 OCR-free 的颜色编码块确认 marker 位于对应画面时刻；容差固定为 2 帧（30fps 下约 67ms）。

- [ ] **Step 4: 运行短时快捷键对齐 POC**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-clock-markers" --display-mode borderless-maximized --fixture clock --duration-seconds 30
```

操作：开始后约 3 秒按 F7，约 8 秒按 F9，约 15 秒按 F10 请求结束，并在 5 秒内再次按 F10 确认结束。

Expected: F7、F9 和第二次 F10 对应的三个 marker 事件时间与画面颜色标记偏差均不超过 67ms；第一次 F10 只产生 `recording-stop-requested`，F7 不重置底层 `videoTimeMs`。

- [ ] **Step 5: 运行 30 分钟漂移 POC**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-clock-30m" --display-mode borderless-maximized --fixture clock --duration-seconds 1800
```

Expected:

```text
clock sample 间隔约 250ms
样本数 >= 7000
maxObservedDriftMs <= max(250, durationMs*0.00015)
ffprobeDurationDeltaMs <= 同一阈值
clockStatus = ok
```

若超限，POC 必须失败并在 manifest 保留 slopePpm、最大漂移、ffprobe delta，禁止继续宣称可用于剪辑。

- [ ] **Step 6: 提交 POC 2**

```bash
git add pocs/manual-recording/clock-fixture.html pocs/manual-recording/capture-main.ts pocs/manual-recording/capture-renderer.ts tests/video-generator/manual-clock-poc.test.ts
git commit -m "test: validate unified recording clock"
```

---

### Task 9: POC 3——页面事件协议和只读观察器

**Files:**
- Create: `src/lib/video-generator/browser/manual-observer.ts`
- Create: `tests/fixtures/video-generator/manual-observer-fixture.html`
- Test: `tests/video-generator/manual-observer.unit.test.ts`

- [ ] **Step 1: 创建 observer 单元测试 fixture**

`tests/fixtures/video-generator/manual-observer-fixture.html` 包含 button、text input、select、scroll container、pushState 按钮和动态 DOM 替换按钮；它只服务 Task 9 单元测试，不是 POC 3 综合 fixture。

- [ ] **Step 2: 写事件采集失败测试**

测试启动该本地 fixture，观察器安装后通过测试驱动执行动作，断言事件，不检查业务结果推断：

```ts
const types = events.map((event) => event.type);
assert.ok(types.includes('pointer-click'));
assert.ok(types.includes('input'));
assert.ok(types.includes('change'));
assert.ok(types.includes('scroll'));
assert.ok(types.includes('navigation'));
```

再对 observer 源码导出依赖做静态约束：它不得导入 `./actions.js` 或 `./interaction-rules.js`。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx tsx --test tests/video-generator/manual-observer.unit.test.ts`  
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 browser binding**

`manual-observer.ts` 先调用：

```ts
await context.exposeBinding('__videoGeneratorRecordEvent', async ({ page, frame }, event: unknown) => {
  await onEvent(page, { ...normalizeEvent(event), frameUrl: frame.url(), isMainFrame: frame === page.mainFrame() });
});
await context.addInitScript({ content: MANUAL_OBSERVER_SCRIPT });
```

`MANUAL_OBSERVER_SCRIPT` 只注册 capture-phase/passive listeners，不调用目标元素方法：

```js
addEventListener('click', emit, { capture: true, passive: true });
addEventListener('input', emit, { capture: true, passive: true });
addEventListener('change', emit, { capture: true, passive: true });
addEventListener('scroll', emitScroll, { capture: true, passive: true });
addEventListener('popstate', emitNavigation, { passive: true });
addEventListener('hashchange', emitNavigation, { passive: true });
```

`normalizeEvent()` 只接受 plain object，并将字段白名单化为 string/number/boolean/null；DOM node、Event、函数和循环对象不得通过 IPC。记录 target 的 tag、role、accessible-ish text、name、inputType、valueLength、selectedText、scrollX/scrollY、URL、frameUrl 和 isMainFrame；不调用 `preventDefault()`、`stopPropagation()` 或 `stopImmediatePropagation()`。

- [ ] **Step 5: 覆盖 SPA navigation**

init script 包装 `history.pushState` 和 `history.replaceState`，调用原函数后发 navigation event；保留原函数参数、return value 和 `this`。

- [ ] **Step 6: 运行刷新和动态 DOM 测试**

测试必须：

1. 采集第一页事件。
2. `page.reload()`。
3. 再采集同样事件。
4. 动态替换表单节点后继续采集。

Expected: 两次导航后事件均存在；不需要手工重新 `page.evaluate()` 注入。

- [ ] **Step 7: 提交观察器**

```bash
git add src/lib/video-generator/browser/manual-observer.ts tests/fixtures/video-generator/manual-observer-fixture.html tests/video-generator/manual-observer.unit.test.ts
git commit -m "feat: observe manual browser events"
```

---

### Task 10: POC 3——多标签页生命周期和重新注入

**Files:**
- Create: `src/lib/video-generator/browser/tab-observer.ts`
- Test: `tests/video-generator/tab-observer.unit.test.ts`

- [ ] **Step 1: 写多 Page 测试**

```ts
assert.deepEqual(events.filter((event) => event.type === 'tab-created').map((event) => event.tabId), ['tab-1', 'tab-2']);
assert.ok(events.some((event) => event.type === 'tab-activated' && event.tabId === 'tab-2'));
assert.ok(events.some((event) => event.type === 'tab-closed' && event.tabId === 'tab-2'));
```

新 tab 内由测试驱动点击后必须产生带 `tab-2` 的 `pointer-click`。这里的 Playwright click 只存在于测试代码，用来模拟用户输入；`manual-observer.ts`、`tab-observer.ts` 和生产 session 不调用 click/fill/bringToFront。

- [ ] **Step 2: 实现稳定 tabId**

`tab-observer.ts` 使用 `WeakMap<Page, string>` 和自增序号；`context.pages()` 中已有 Page 先注册，再监听 `context.on('page')`。Page 创建时只绑定 listener，不调用 `bringToFront()`。

- [ ] **Step 3: 实现激活判定**

页面 init script 在 `focus` 和 `visibilitychange` 时上报 `{ visibilityState, hasFocus }`；`visibilityState === 'visible' && hasFocus === true` 时记录 `tab-activated`。POC 明确把该事件作为“用户切到该 Page”的可观测代理；如果 Windows/Chromium 实测中手动切 tab 不触发该组合，则 POC 3 判定不通过并在结果文档记录，不能由 Playwright `bringToFront()` 补造事件。连续相同 tab 激活事件去重。

- [ ] **Step 4: 实现导航和关闭事件**

Node 侧监听 main frame `framenavigated` 和 Page `close`，写入：

```json
{"type":"navigation","tabId":"tab-2","payload":{"url":"https://fixture/detail"}}
{"type":"tab-closed","tabId":"tab-2","payload":{"url":"https://fixture/detail"}}
```

- [ ] **Step 5: 运行测试**

Run:

```bash
npx tsx --test tests/video-generator/tab-observer.unit.test.ts tests/video-generator/manual-observer.unit.test.ts
```

Expected: PASS；测试没有调用 observer 内部的业务点击函数。

- [ ] **Step 6: 提交 tab observer**

```bash
git add src/lib/video-generator/browser/tab-observer.ts tests/video-generator/tab-observer.unit.test.ts
git commit -m "feat: observe manual browser tabs"
```

---

### Task 11: POC 3——真实 pointer 驱动虚拟鼠标

**Files:**
- Create: `src/lib/video-generator/browser/manual-cursor-overlay.ts`
- Test: `tests/video-generator/manual-cursor-overlay.unit.test.ts`

- [ ] **Step 1: 写不拦截测试**

测试页面按钮的原生 click handler 增加计数；移动和点击后断言：

```ts
assert.equal(await page.locator('#click-count').textContent(), '1');
assert.equal(await page.locator('#__video-generator-manual-cursor').evaluate((element) => getComputedStyle(element).pointerEvents), 'none');
assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).cursor), 'none');
```

- [ ] **Step 2: 实现 overlay init script**

复制现有 `cursor-overlay.ts` 的 SVG 视觉到人工专用脚本，但使用独立 id `__video-generator-manual-cursor`，不改动或复用自动 recorder 的 controller；位置完全由真实 `pointermove`：

```js
addEventListener('pointermove', (event) => {
  overlay.style.transform = `translate3d(${event.clientX - 6}px,${event.clientY - 3}px,0)`;
  overlay.hidden = false;
}, { capture: true, passive: true });
addEventListener('pointerdown', pulse, { capture: true, passive: true });
addEventListener('pointerleave', hide, { capture: true, passive: true });
addEventListener('blur', hide, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
```

CSS 必须包含：

```css
#__video-generator-manual-cursor { pointer-events: none; z-index: 2147483647; }
html.__video-generator-hide-native-cursor,
html.__video-generator-hide-native-cursor body,
html.__video-generator-hide-native-cursor body * { cursor: none !important; }
```

- [ ] **Step 3: 验证新 tab 和 reload**

在 tab-1、tab-2 和 reload 后页面分别触发 pointermove，三处都能找到 overlay。window `blur`、document `visibilitychange`、pointer `pointerout` 且 `relatedTarget === null` 时隐藏 overlay 并移除 `__video-generator-hide-native-cursor` class；下一次 pointermove 再恢复。切出 Chromium 后 overlay 必须隐藏。

- [ ] **Step 4: 运行测试**

Run: `npx tsx --test tests/video-generator/manual-cursor-overlay.unit.test.ts`  
Expected: click count 不受影响、overlay pointer-events none、三种页面生命周期均重新注入。

- [ ] **Step 5: 提交虚拟鼠标**

```bash
git add src/lib/video-generator/browser/manual-cursor-overlay.ts tests/video-generator/manual-cursor-overlay.unit.test.ts
git commit -m "feat: add manual cursor overlay"
```

---

### Task 12: POC 3——综合事件 fixture 和独立验收

**Files:**
- Create: `pocs/manual-recording/event-fixture.html`
- Create: `src/lib/video-generator/recording/events-poc-report.ts`
- Test: `tests/video-generator/manual-events-poc.test.ts`
- Test: `tests/video-generator/manual-events-poc-report.unit.test.ts`
- Modify: `src/lib/video-generator/browser/tab-observer.ts`
- Modify: `src/lib/video-generator/recording/artifacts.ts`
- Modify: `src/lib/video-generator/recording/session.ts`

- [ ] **Step 1: 创建综合 fixture**

`event-fixture.html` 必须包含：普通按钮、text input、select、长滚动区、`history.pushState` 按钮、指向同一 fixture `?tab=2` 且 `target="_blank"` 的新标签页链接、same-origin iframe 和动态 DOM 替换按钮。fixture 自己实现业务行为，observer 只记录。

- [ ] **Step 2: 原子写 tabs snapshot**

`tab-observer.ts` 维护当前 tab registry：`{ tabId, url, title, createdSessionTimeMs, closedSessionTimeMs }[]`。每次 created/navigation/closed 后把完整 snapshot 写 `tabs.json.tmp` 再 rename 为 `capture/tabs.json`；session 关闭前 await 最后一次写入。`tab-observer.unit.test.ts` 增加断言：两个 tab 的 title/url/id 写入，关闭 tab 后 `closedSessionTimeMs` 非 null，重复写不会产生损坏 JSON。

- [ ] **Step 3: 在 session 安装三个观察组件**

顺序固定：

```ts
await installManualObserver(context, appendPageEvent);
await installManualCursorOverlay(context);
const tabs = await installTabObserver(context, appendTabEvent);
```

任何页面监听失败只追加 `observer-error`，不得停止 capture；报告 `eventCaptureComplete: false`。

- [ ] **Step 4: 定义事件 POC 报告**

`events-poc-report.ts` 定义并原子写：

```ts
export interface ManualEventsPocReport {
  version: 1;
  status: 'passed' | 'failed' | 'incomplete';
  eventsPath: string;
  tabsPath: string;
  eventCaptureComplete: boolean;
  counts: Record<'pointer-click' | 'input' | 'change' | 'scroll' | 'navigation' | 'tab-created' | 'tab-activated' | 'tab-closed' | 'observer-error', number>;
  reloadReinjectionPassed: boolean;
  newTabReinjectionPassed: boolean;
  childFrameReinjectionPassed: boolean;
  dynamicDomPassed: boolean;
  cursorDidNotBlockInteraction: boolean;
  errors: string[];
}
export async function writeManualEventsPocReport(filePath: string, report: ManualEventsPocReport): Promise<void>;
```

`manual-events-poc-report.unit.test.ts` 覆盖完整通过、observer-error 导致 incomplete、缺少任一必需事件导致 failed，以及 `.tmp` + rename。

- [ ] **Step 5: 写综合 POC 断言**

`manual-events-poc.test.ts` 读取 JSONL 并断言：

```text
pointer-click >= 3
input >= 1
change >= 1
scroll >= 1
navigation >= 2（history.pushState + 新 Page main-frame navigation）
tab-created >= 2
tab-activated >= 2
tab-closed >= 1
observer-error = 0（正常流程）
所有页面事件均带 tabId
same-origin iframe 事件带 isMainFrame=false 和 frameUrl
事件 sessionTimeMs 单调不下降
第一帧后的事件均有 videoTimeMs
```

- [ ] **Step 6: 运行 POC 3**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-events-poc" --display-mode borderless-maximized --fixture events --duration-seconds 60
npm run test:manual-events-poc
```

人工执行 fixture 中所有控件并手动切换 tab；不得由程序自动切 tab。session 结束时根据事件、tabs snapshot 和 overlay 测试结果写 `reports/manual-events-poc-report.json`；验证 wrapper 同时读取 JSONL 和该报告，要求 `status='passed'`。

- [ ] **Step 7: POC 3 独立验收门槛**

```text
pointer-click/input/change/scroll/navigation/tab-created/tab-activated/tab-closed 八类事件全部出现
JSONL 异常中止后除最后一条可能未完整写入的行外，前序完整行均可逐行解析
刷新、新 tab、child frame、动态 DOM 后继续采集
虚拟鼠标与波纹可见且网页 click/input/select 均正常
离开 Chromium 或 tab 不可见时虚拟指针隐藏
注入一个 observer callback 异常时视频继续、出现 observer-error、报告明确不完整
源码无 actions.ts/interaction-rules.ts 依赖
```

- [ ] **Step 8: 提交 POC 3**

```bash
git add pocs/manual-recording/event-fixture.html src/lib/video-generator/browser/tab-observer.ts src/lib/video-generator/recording/artifacts.ts src/lib/video-generator/recording/events-poc-report.ts src/lib/video-generator/recording/session.ts tests/video-generator/manual-events-poc.test.ts tests/video-generator/manual-events-poc-report.unit.test.ts tests/video-generator/tab-observer.unit.test.ts
git commit -m "test: validate manual event observation"
```

---

### Task 13: POC 4——edit plan 类型、时长和校验

**Files:**
- Create: `src/lib/video-generator/editing/types.ts`
- Create: `src/lib/video-generator/editing/duration.ts`
- Create: `src/lib/video-generator/editing/validator.ts`
- Test: `tests/video-generator/editing-duration.unit.test.ts`
- Test: `tests/video-generator/editing-validator.unit.test.ts`

- [ ] **Step 1: 定义与设计一致的类型**

```ts
export interface EditCanvas { width: 1920; height: 1080; fps: 30; }
export interface EditSource { id: string; path: string; durationMs: number; width: number; height: number; fps: number; codecName: string; pixelFormat: string; hasAudio: boolean; }
export interface EditClip { sourceId: string; sourceStartMs: number; sourceEndMs: number; playbackRate: number; }
export interface EditPlanSegment {
  segmentId: string;
  title: string;
  clips: EditClip[];
  holdLastFrameMs?: number;
  transition?: 'cut' | 'short-fade';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}
export interface EditPlan { version: 1; canvas: EditCanvas; segments: EditPlanSegment[]; }
export interface PreviewTimelineClip extends EditClip { outputStartMs: number; outputEndMs: number; }
export interface PreviewTimelineSegment {
  segmentId: string;
  startsAtMs: number;
  contentEndsAtMs: number;
  endsAtMs: number;
  clips: PreviewTimelineClip[];
}
export interface PreviewTimeline { version: 1; durationMs: number; segments: PreviewTimelineSegment[]; }
```

`EditSource.path` 来自可信 POC manifest/source registry；`edit-plan.json` 本身不得自定义任意文件路径。`media-probe.ts` 返回完整 `EditSource`，其中 `id` 由调用方传入，其他媒体字段来自 ffprobe。

- [ ] **Step 2: 写 duration 测试**

```ts
assert.equal(calculateEditClipDurationMs({ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 2 }), 1000);
assert.equal(calculateEditSegmentDurationMs({
  segmentId: 'segment-1', title: 'one', confidence: 'high', reason: 'fixture', transition: 'short-fade', holdLastFrameMs: 500,
  clips: [{ sourceId: 'original', sourceStartMs: 0, sourceEndMs: 2000, playbackRate: 2 }],
}), 1500);
```

short-fade 不重叠，所以不从时长中扣除 120ms。

- [ ] **Step 3: 实现唯一时长算法**

```ts
export function calculateEditClipDurationMs(clip: EditClip): number {
  return Math.round((clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate);
}
export function calculateEditSegmentDurationMs(segment: EditPlanSegment): number {
  return segment.clips.reduce((sum, clip) => sum + calculateEditClipDurationMs(clip), 0) + (segment.holdLastFrameMs ?? 0);
}
```

preview timeline、validator 和 filtergraph 均调用这两个函数，不各自复制公式。

- [ ] **Step 4: 写 validator 失败矩阵**

覆盖：未知 source、区间倒置、越界、`playbackRate < 1`、`> 2`、hold `> 5000`、设置 short-fade 的当前或下一 Segment 总时长 `<=120ms`、最后一个 Segment 设置 short-fade、重复 segmentId、空 clips、非 1920×1080/30 canvas。每个错误消息必须包含 JSON path，例如：

```text
segments[1].clips[0].sourceEndMs exceeds source "pickup-001" duration 2000ms
```

- [ ] **Step 5: 实现 validator**

签名：

```ts
export function validateEditPlan(plan: unknown, sources: readonly EditSource[]): asserts plan is EditPlan
```

区间严格要求 `sourceEndMs <= source.durationMs`，不对越界区间静默裁切；ffprobe 容器 duration 的一帧误差由 POC fixture 生成时控制，而不是 validator 放宽。source id 和 segment id 必须唯一；所有 number 字段必须 finite，canvas 必须严格为 1920×1080/30，`hasAudio` 不影响 preview 但必须由 probe 明确记录。

- [ ] **Step 6: 运行测试**

Run:

```bash
npx tsx --test tests/video-generator/editing-duration.unit.test.ts tests/video-generator/editing-validator.unit.test.ts
```

Expected: 所有合法/非法矩阵 PASS。

- [ ] **Step 7: 提交 editing 协议**

```bash
git add src/lib/video-generator/editing/types.ts src/lib/video-generator/editing/duration.ts src/lib/video-generator/editing/validator.ts tests/video-generator/editing-duration.unit.test.ts tests/video-generator/editing-validator.unit.test.ts
git commit -m "feat: validate multi-source edit plans"
```

---

### Task 14: POC 4——ffprobe source 元数据和 filtergraph builder

**Files:**
- Create: `src/lib/video-generator/editing/media-probe.ts`
- Create: `src/lib/video-generator/editing/filtergraph.ts`
- Test: `tests/video-generator/editing-media-probe.unit.test.ts`
- Test: `tests/video-generator/editing-filtergraph.unit.test.ts`

- [ ] **Step 1: 写 ffprobe JSON 解析测试**

输入：

```json
{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"r_frame_rate":"30000/1001","pix_fmt":"yuv420p"}],"format":{"duration":"6.000000"}}
```

Expected: `durationMs=6000`、`fps≈29.97`、`hasAudio=false`。缺少 video stream、duration 非数字、ffprobe stderr 都抛出包含 source path 的错误。

- [ ] **Step 2: 实现 media probe**

调用：

```text
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt:format=duration -of json <source>
```

输出 `EditSource` 所需元数据；不复用语义为 audio 的 `getAudioDurationMs()`。

- [ ] **Step 3: 写 filtergraph 参数测试**

使用 original 和 pickup 两个 source，断言 filtergraph 包含：

```text
[0:v]trim=start=0.5:end=1.5
[0:v]trim=start=2:end=4,setpts=(PTS-STARTPTS)/2
[1:v]trim=start=0.5:end=1.5
tpad=stop_mode=clone:stop_duration=0.5
fade=t=out:st=<segmentDurationSeconds-0.12>:d=0.12
fade=t=in:st=0:d=0.12
concat=n=3:v=1:a=0
```

每条 clip 的完整链固定为：

```text
[input:v]trim=start=S:end=E,setpts=(PTS-STARTPTS)/<playbackRateNumericLiteral>,settb=AVTB,fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[clipN]
```

builder 必须把每个 `clip.playbackRate` 格式化成数值字面量（例如 `2`、`1.5`）后插入表达式；`RATE` 不是 ffmpeg `setpts` 常量，禁止原样输出占位符。`short-fade` 不增加额外黑帧：它把当前 Segment 已有的最后 120ms 逐渐变黑，并把下一 Segment 已有的前 120ms 从黑变亮，因此总时长仍是 clip duration + hold；每段时长必须大于 120ms。

- [ ] **Step 4: 实现纯 filtergraph builder**

导出：

```ts
export interface BuiltEditFiltergraph {
  filterComplex: string;
  outputLabel: '[v]';
  inputSourceIds: string[];
  timeline: PreviewTimeline;
}
export function buildEditFiltergraph(plan: EditPlan, sources: readonly EditSource[]): BuiltEditFiltergraph
```

source 按首次引用顺序映射 `-i` index；同一 source 只添加一次 input。Segment 内 clips 先 concat；hold 用 `tpad=stop_mode=clone`；short-fade 对当前 Segment 使用 `fade=t=out:st=(segmentDurationMs-120)/1000:d=0.12`，对下一 Segment 使用 `fade=t=in:st=0:d=0.12`，再进行普通 concat。所有秒数字符串通过同一 `formatSeconds()` 生成。

- [ ] **Step 5: 运行测试**

Run:

```bash
npx tsx --test tests/video-generator/editing-media-probe.unit.test.ts tests/video-generator/editing-filtergraph.unit.test.ts
```

Expected: source index、Windows 空格路径、filter labels、时长和 transition 全部 PASS。

- [ ] **Step 6: 提交 probe/filtergraph**

```bash
git add src/lib/video-generator/editing/media-probe.ts src/lib/video-generator/editing/filtergraph.ts tests/video-generator/editing-media-probe.unit.test.ts tests/video-generator/editing-filtergraph.unit.test.ts
git commit -m "feat: build multi-source preview filtergraph"
```

---

### Task 15: POC 4——真实 preview 渲染和媒体验收

**Files:**
- Create: `src/lib/video-generator/editing/preview.ts`
- Test: `tests/video-generator/editing-preview.unit.test.ts`
- Test: `tests/video-generator/editing-preview-poc.test.ts`

- [ ] **Step 1: 写 preview renderer 失败测试**

在 `tests/video-generator/editing-preview.unit.test.ts` 注入 `RunCommand`，断言：input args 按 `inputSourceIds` 顺序生成、带空格/中文路径保持为单独参数、输出先写 `.tmp.mp4`、ffmpeg 失败消息包含 source/segment/stderr、失败时不创建正式 `preview.mp4`。

Run:

```bash
npx tsx --test tests/video-generator/editing-preview.unit.test.ts
```

Expected: FAIL，模块 `editing/preview.js` 不存在。

- [ ] **Step 2: 实现 preview renderer**

签名：

```ts
export async function renderEditPreview(input: {
  plan: EditPlan;
  sources: readonly EditSource[];
  outputPath: string;
  timelinePath: string;
  runCommand?: RunCommand;
}): Promise<{ previewPath: string; timelinePath: string; durationMs: number }>
```

ffmpeg 参数由 `built.inputSourceIds` 动态生成，固定结构为：

```text
-hide_banner -loglevel error
-i <source path for inputSourceIds[0]>
-i <source path for inputSourceIds[1]>
...
-filter_complex <built graph>
-map [v]
-c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart
-an -y <preview.mp4.tmp.mp4>
```

`preview.ts` 从 `../audio.js` 导入 `RunCommand`，使用 `execFile(command,args[])` 风格；路径包含空格和中文时仍作为单独 args 传入，不做 shell 拼接。

失败消息必须包含 source ids、segment ids、输出路径和截断后的 stderr；原素材、edit plan 不删除。

- [ ] **Step 3: 原子写 preview timeline**

先渲染到 `preview.mp4.tmp.mp4`，ffprobe 验证成功后 rename；`preview-timeline.json` 同样临时写后 rename。渲染失败不得留下名为 `preview.mp4` 的半成品；单元测试注入命令失败时清理临时文件但保留 error 对象中的 stderr。真实 POC 测试成功后删除临时 fixture；失败时把临时目录路径打印到测试诊断并保留，便于复核。

- [ ] **Step 4: 在 POC 测试中生成两个确定性 source**

不提交二进制 fixture；测试用 ffmpeg lavfi 生成：

```text
original.mp4：6 秒，0-2s 红、2-4s 绿、4-6s 蓝，1920×1080/30，无音频
pickup.mp4：2 秒黄色，1920×1080/30，无音频
```

edit plan：

```json
{
  "version": 1,
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "segments": [
    {
      "segmentId": "segment-red",
      "title": "red",
      "clips": [{ "sourceId": "original", "sourceStartMs": 500, "sourceEndMs": 1500, "playbackRate": 1 }],
      "transition": "short-fade",
      "confidence": "high",
      "reason": "fixture"
    },
    {
      "segmentId": "segment-green-pickup",
      "title": "green and pickup",
      "clips": [
        { "sourceId": "original", "sourceStartMs": 2000, "sourceEndMs": 4000, "playbackRate": 2 },
        { "sourceId": "pickup-001", "sourceStartMs": 500, "sourceEndMs": 1500, "playbackRate": 1 }
      ],
      "holdLastFrameMs": 500,
      "transition": "short-fade",
      "confidence": "high",
      "reason": "fixture"
    },
    {
      "segmentId": "segment-blue",
      "title": "blue",
      "clips": [{ "sourceId": "original", "sourceStartMs": 4000, "sourceEndMs": 5000, "playbackRate": 1 }],
      "confidence": "high",
      "reason": "fixture"
    }
  ]
}
```

预期总时长 4500ms。

- [ ] **Step 5: 验证视频 stream 和时间戳结构**

执行：

```bash
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt -show_entries format=duration -of json preview.mp4
ffmpeg -v error -i preview.mp4 -f null -
```

解析 JSON 断言：

```text
streams.filter(codec_type==video).length == 1
streams.filter(codec_type==audio).length == 0
codec_name == h264
width == 1920
height == 1080
r_frame_rate == 30/1
pix_fmt == yuv420p
duration == 4.5s ± 1 frame
```

ffmpeg 解码命令退出码为 0，stderr 不得包含 non-monotonous DTS、invalid timestamp 或 decode error。

- [ ] **Step 6: 验证 trim、source、加速、定格和 fade**

在 0.50s、1.50s、2.50s、4.00s 抽取 1×1 RGB，主色依次为红、绿、黄、蓝。3.05s 和 3.30s 的 `framemd5` 完全一致，证明 3.0–3.5s 为 500ms 黄色末帧定格。短淡化用 0.95s 与 1.05s、3.45s 与 3.55s 四个靠近边界但避开精确切点的帧，与各自 Segment 中部亮度比较；边界帧应显著更暗。

- [ ] **Step 7: 运行 POC 4**

Run:

```bash
npm run test:editing-poc
```

Expected: 实际 ffmpeg/ffprobe POC PASS，临时 source 和输出在测试 finally 中删除。

- [ ] **Step 8: POC 4 独立验收门槛**

```text
original + pickup 两个 source 均被实际引用
trim 边界与 preview-timeline 一致
2× 区间输出时长减半
500ms 定格可通过 framemd5 证明
short-fade 可通过边界亮度证明
preview 为 1920×1080/30 H.264、单视频流、无音频、PTS/DTS 正常
非法 source/range/rate/hold/transition 在调用 ffmpeg 前拒绝
```

- [ ] **Step 9: 提交 POC 4**

```bash
git add src/lib/video-generator/editing/preview.ts tests/video-generator/editing-preview.unit.test.ts tests/video-generator/editing-preview-poc.test.ts
git commit -m "test: validate multi-source preview rendering"
```

---

### Task 16: 汇总 POC 结果、回归并关闭第一阶段计划

**Files:**
- Create: `docs/research/manual-recording-infrastructure-poc-results.md`
- Modify: `docs/research/README.md`
- Modify: `docs/exec-plans/active/manual-recording-infrastructure-pocs.md`
- Modify: `docs/exec-plans/README.md`

- [ ] **Step 1: 运行逻辑测试**

Run:

```bash
npm run test
```

Expected: typecheck 和全部 `*.unit.test.ts` PASS；现有自动录制测试不得因人工 POC 变更而失败。

- [ ] **Step 2: 运行四个独立 POC**

Run:

```bash
npm run test:manual-capture-poc
npm run test:manual-clock-poc
npm run test:manual-events-poc
npm run test:editing-poc
```

Expected: 四项分别 PASS；任何一项失败都保持对应 Phase 为“进行中”，不得把计划移入 completed。

- [ ] **Step 3: 运行现有自动录制回归**

Run:

```bash
npm run test:video-poc
node -e "process.exit(process.env.DASHSCOPE_API_KEY ? 0 : 1)" && npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo-manual-poc-regression
```

Expected: Playwright recordVideo POC PASS；有 `DASHSCOPE_API_KEY` 时基础 demo 生成 `final.mp4`。没有凭据时不运行真实 TTS，改为：

```bash
npm run video:doctor
npm run video:generate -- --script examples/video-generator/basic-demo.md --dry-run --output video-runs/basic-demo-manual-poc-preflight
```

Expected: doctor 明确把 TTS 凭据标为缺失；preflight 成功且 `reports/preflight-report.json` 存在；结果文档记录“未执行真实 TTS/final 回归”，不得写成已验证。

- [ ] **Step 4: 写 POC 结果文档**

`docs/research/manual-recording-infrastructure-poc-results.md` 必须逐项记录：

```text
环境：Windows 版本、scaleFactor、Node、Electron、Playwright、Chromium、ffmpeg
命令：实际运行命令
产物：报告、manifest、preview 路径
结果：每项可量化指标
失败：错误信息和保留素材
结论：通过/不通过
后续：只有 POC 证据支持的正式实现约束
```

不得写“基本可行”“看起来正常”；窗口不入镜、漂移、PTS/DTS 和画面内容必须有可复核证据。

- [ ] **Step 5: 更新索引和计划状态**

- `docs/research/README.md` 添加 POC 结果文档。
- `docs/exec-plans/README.md` 把本计划状态更新为“四个 POC 已完成，待正式产品实施计划”或准确失败状态。
- 本文件的 checkbox、状态表、决策日志按实际结果更新。
- 四个 POC 全部通过后，移动本文件到 `docs/exec-plans/completed/manual-recording-infrastructure-pocs.md`；任何 POC 未通过则留在 `active/`。

- [ ] **Step 6: 检查工作区无生成产物**

Run:

```bash
git status --short
git diff --check
```

Expected: 只有预期源码、测试和文档；没有 `video-runs/`、`dist/`、MP4、WebM、WAV、临时 JSON 或调试截图被跟踪。

- [ ] **Step 7: 提交 POC 结果与计划状态**

```bash
git add docs/research/manual-recording-infrastructure-poc-results.md docs/research/README.md docs/exec-plans/README.md docs/exec-plans/active/manual-recording-infrastructure-pocs.md
git commit -m "docs: record manual recording poc results"
```

如果计划已全部完成并移动目录，改为 add `docs/exec-plans/completed/manual-recording-infrastructure-pocs.md`。

---

## 失败处理矩阵

| 失败 | 必须行为 | 禁止行为 |
|---|---|---|
| Chromium 启动失败 | 报告 executable path、launch args；不启动 capture | 创建空视频 |
| source 未找到 | 保持 Chromium 打开；允许重新扫描；F7 禁用 | 选择 `sources[0]` |
| source 多个匹配 | 显示所有 id/name；要求关闭重复绑定页后重试 | 静默选择一个 |
| Electron overlay 失败 | capture 可继续；CLI 提供 F10/关闭备用；报告不完整 | 终止并删除 raw |
| globalShortcut 注册失败 | 报告具体键；按钮/CLI 备用控制 | 假装快捷键可用 |
| MediaRecorder codec 不支持 | VP9→VP8→默认 WebM 顺序降级 | 改录系统声音 |
| chunk 写入失败 | 停止 capture；保留已写 raw；manifest `captureComplete=false` | 继续写损坏 MP4 |
| ffmpeg 规范化失败 | 保留 raw 和 stderr；不生成正式命名 MP4 | 删除 raw |
| 页面 observer 失败 | 视频继续；写 `observer-error`；报告事件不完整 | 停止录像 |
| clock sample 不足 | `clockStatus=drift-detected`，POC 失败 | 只看末端 duration 并通过 |
| drift 超阈值 | manifest 记录 slope/max/delta，阻止 preview POC 串联 | 静默校正时间 |
| edit plan 无效 | 报告 JSON path，调用 ffmpeg 前失败 | 猜测 source 或截断区间 |
| preview ffmpeg 失败 | 保留 source/edit plan/stderr；删除临时 preview | 覆盖原素材 |
| borderless 恢复失败 | 报告 handle/style/bounds；提示用户关闭 Chromium | 无提示退出 |

## Windows 环境验证清单

```text
[ ] Windows 10 22H2 或 Windows 11 实际桌面会话
[ ] Node >=22.12.0
[ ] Electron 43.1.1
[ ] Playwright Chromium 可启动
[ ] ffmpeg/ffprobe 可用且包含 libx264
[ ] 单显示器 100%/125%/150% 缩放
[ ] F11 与 borderless-maximized
[ ] 同一 Chromium 窗口两个标签页
[ ] overlay 位于 Chromium 上方但不入镜
[ ] 30 分钟持续录制
[ ] 输出路径包含空格和中文
```

## 决策日志

- 2026-07-17：设计已经确认，本计划不重新讨论产品需求，只规划第 20 节四个 POC。
- 2026-07-17：保留现有自动 recorder/pipeline；人工 POC 使用独立模块和命令，避免替换式重构。
- 2026-07-17：选择 Electron 43.1.1；指定窗口通过 main process 的 `desktopCapturer` + `setDisplayMediaRequestHandler`，不使用 `deviceId` 或系统 screen picker。
- 2026-07-17：原始 capture 先分块追加写 WebM，再以 ffmpeg 规范化成固定 1920×1080 MP4；失败时保留 raw。
- 2026-07-17：统一 clock 以 main process `hrtime` 为基准，video first frame 建立 offset，MediaRecorder timecode + ffprobe 双重检测 drift。
- 2026-07-17：short-fade 定义为 120ms 非重叠淡黑，保持 preview timeline 总时长可直接累加。
- 2026-07-17：POC preview 无音频，显式验证单视频流、零音频流；TTS/final 音轨不在本计划范围。

## 计划完成前自检

### 规格覆盖

- [ ] POC 1 覆盖指定 Chromium、同窗口多 tab、overlay 不入镜、1920×1080、F11、无边框、125%/150%。
- [ ] POC 2 覆盖 `sessionTimeMs`、`videoTimeMs`、F7/F9/F10、30 分钟漂移。
- [ ] POC 3 覆盖 click/input/change/scroll/navigation/tab、JSONL 追加、新 Page/刷新注入、虚拟指针不拦截。
- [ ] POC 4 覆盖 original + pickup、trim、concat、2×、hold、fade、preview、分辨率/帧率/PTS/stream 结构。
- [ ] 所有明确排除项没有被提前实现。

### 占位符检查

执行：

```bash
node -e "const fs=require('fs');const p='docs/exec-plans/active/manual-recording-infrastructure-pocs.md';const bad=[['T','BD'].join(''),['T','ODO'].join(''),['implement','later'].join(' '),['适当','处理'].join(''),['类似','Task'].join(' '),['待','补充'].join('')];const text=fs.readFileSync(p,'utf8');const hits=bad.filter(x=>text.includes(x));if(hits.length){console.error(hits);process.exit(1)}"
```

Expected: 退出码 0，无输出。

### 类型一致性检查

- [ ] `RecordingTimestamp` 在 clock、event log、manifest 使用同一字段名。
- [ ] `EditClip.playbackRate` 在 validator、duration、filtergraph 使用同一范围和公式。
- [ ] `short-fade` 在 validator、timeline、filtergraph 均为 120ms 非重叠语义。
- [ ] `original-window.mp4`、`events.jsonl`、`recording-manifest.json`、`preview.mp4` 的路径在 artifacts、POC 和文档一致。
- [ ] Electron main/preload/renderer IPC channel 名完全一致。

## 后续边界

四个 POC 全部通过后，下一份计划才可以覆盖正式人工录制产品：recording guide schema、Action tracker、正式悬浮窗、Agent edit-plan、Segment pickup、审核流程、TTS/字幕/final、RunReport 扩展。下一份计划必须引用本 POC 结果，不得仅凭本设计文档假定窗口捕获、漂移和多源 filtergraph 已经可靠。
