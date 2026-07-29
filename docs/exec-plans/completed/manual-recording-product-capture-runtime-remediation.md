# Manual Recording Product Capture Runtime Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 回补正式 Electron capture runtime，使 `video:record` 与 `video:pickup` 默认路径能真实录制指定 Chromium 窗口，并由同一 overlay/controller 状态驱动。

**Architecture:** 从已通过验收的 POC 提取通用能力，但产品代码不 import POC。新增隐藏 recorder window、typed capture IPC 和正式 Electron capture session；正式 overlay main 作为唯一 composition root，持有 Chromium、capture、快捷键、attempt 和 cleanup 生命周期，并将结构化结果交还 CLI/controller。

**Tech Stack:** TypeScript ESM、Electron 43.1.1、Playwright Chromium、MediaRecorder、ffmpeg/ffprobe、node:test + tsx、Windows User32 helper。

**设计文档：** `docs/research/manual-recording-product-capture-runtime-design.md`

**提交规则：** 本计划执行期间不 commit、不 push；由用户另行决定提交时机。

---

## 状态

| Phase | 内容 | 状态 | 退出门槛 |
|---|---|---|---|
| Phase 1 | Recorder IPC 与隐藏 renderer | 已完成 | IPC、chunk 与 renderer 单测通过 |
| Phase 2 | 正式 Electron capture session | 已完成 | source/normalize/cleanup 集成测试通过 |
| Phase 3 | 产品 Chromium session 与 observer | 已完成 | startUrl、事件、tab 和关闭测试通过 |
| Phase 4 | Overlay/controller runtime bridge | 已完成 | F7/F8/F9/F10 单一状态链通过 |
| Phase 5 | CLI composition root 与 record/pickup 接线 | 已完成 | 默认路径不再 runtime unavailable |
| Phase 6 | 构建与真实桌面验收 | 已完成 | build、record、pickup 实机通过 |

## 决策日志

- 2026-07-28：选择共享正式 capture session，不直接 import POC，也不把 POC 主文件复制进 overlay main。
- 2026-07-28：Electron main 是唯一运行状态所有者；CLI 只启动 runtime 并消费结构化结果。
- 2026-07-28：开发中跑定向测试；`npm run test` 只在准备提交或最终里程碑运行。
- 2026-07-29：pickup attempt 由 composition 预留并显式传入 controller；残留 observer/media artifact 也参与下一 attempt 编号，保留失败审计且允许安全重试。
- 2026-07-29：composition 运行期间阻止 Electron 在最后窗口关闭时隐式退出，确保 cleanup 完成后最终报告仍可原子写入。
- 2026-07-29：连续性末帧抽取回退至少 100ms，避免 ffprobe 容器时长四舍五入超过实际最后视频帧。

## 文件职责

- `src/lib/video-generator/capture/product-ipc.ts`：recorder window 的 channel、payload validator 和类型。
- `src/lib/video-generator/recording-overlay/recorder-preload.cts`：最小 context bridge。
- `src/lib/video-generator/recording-overlay/recorder-renderer.ts`：`getDisplayMedia`、MediaRecorder、chunk/flush。
- `src/lib/video-generator/recording-overlay/recorder.html`：隐藏 recorder renderer 宿主。
- `src/lib/video-generator/capture/electron-capture-session.ts`：desktop source 授权、chunk writer、normalize/probe、cleanup。
- `src/lib/video-generator/recording/session.ts`：正式 Chromium `startUrl` session 与 observer 生命周期。
- `src/lib/video-generator/manual/product-runtime.ts`：record/pickup composition、signals、attempt 和 controller adapter。
- `src/lib/video-generator/recording-overlay/main.ts`：Electron entry、overlay command bridge、全局快捷键和退出。
- `src/cli/manual-record.ts`、`src/cli/manual-pickup.ts`：启动正式 Electron child 并消费退出结果。
- `scripts/run-manual-recording.mjs`：构建 Electron spawn 参数，不承载业务状态。

## Task 1: Typed recorder IPC 与隐藏 MediaRecorder renderer

**Files:**

- Create: `src/lib/video-generator/capture/product-ipc.ts`
- Create: `src/lib/video-generator/recording-overlay/recorder-preload.cts`
- Create: `src/lib/video-generator/recording-overlay/recorder-renderer.ts`
- Create: `src/lib/video-generator/recording-overlay/recorder.html`
- Modify: `scripts/copy-manual-recording-assets.mjs`
- Test: `tests/video-generator/manual-capture-runtime.unit.test.ts`

- [ ] **Step 1: 写 IPC validator 失败测试**

覆盖 channel 常量、`start/stop` control、`first-chunk/append/flush/completed/failed` payload，拒绝非 `Uint8Array`、负 sequence、非有限 timecode 和重复 completion。

预期接口：

```ts
export interface RecorderChunkPayload {
  bytes: Uint8Array;
  sequence: number;
  timecodeMs: number;
}

export const MANUAL_RECORDER_CHANNELS = {
  start: 'manual-recorder:start',
  stop: 'manual-recorder:stop',
  firstChunk: 'manual-recorder:first-chunk',
  appendChunk: 'manual-recorder:append-chunk',
  flush: 'manual-recorder:flush',
  completed: 'manual-recorder:completed',
  failed: 'manual-recorder:failed',
} as const;
```

- [ ] **Step 2: 运行 RED**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-capture-runtime.unit.test.ts
```

Expected: FAIL，模块或 recorder assets 不存在。

- [ ] **Step 3: 实现最小 preload/renderer**

Renderer 必须：

1. 等待 main 的 start；
2. 调用 `getDisplayMedia({video:true,audio:false})`；
3. 第一帧可见后启动 MediaRecorder；
4. 250ms chunk 串行发送；
5. stop 后等待 `dataavailable`、flush 和 track stop；
6. 捕获异常发送 failed；
7. 不读取 Node API、任意路径或业务 guide。

- [ ] **Step 4: 复制 recorder HTML**

`copy-manual-recording-assets.mjs` 继续只复制正式 `recording-overlay/` HTML，不出现 `pocs/manual-recording`。

- [ ] **Step 5: 运行 GREEN**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-capture-runtime.unit.test.ts tests/video-generator/manual-overlay.integration.test.ts
```

Expected: PASS。

## Task 2: 正式 Electron capture session

**Files:**

- Create: `src/lib/video-generator/capture/electron-capture-session.ts`
- Modify: `src/lib/video-generator/capture/windows-electron.ts`
- Test: `tests/video-generator/manual-capture-session.integration.test.ts`

- [ ] **Step 1: 写 session 失败测试**

使用 fake Electron boundary 测试：

- 只授权 recorder main frame；
- source 轮询缺失、唯一、多匹配；
- first chunk 只允许 sequence 0；
- chunk 严格单调；
- stop 后 normalize/probe；
- normalize 失败返回 unavailable；
- `close()` 重复调用不重复注销或覆盖首个错误。

Session API：

```ts
export interface ProductCaptureSession {
  start(): Promise<void>;
  stop(): Promise<ProductCaptureResult>;
  close(): Promise<void>;
}

export interface ProductCaptureResult {
  video: RecordingManifest['video'];
  recordingStartMs: number;
  recordingEndMs: number;
  firstVideoFrameSessionTimeMs: number | null;
  clockSamples: CaptureClockSample[];
}
```

- [ ] **Step 2: 运行 RED**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-capture-session.integration.test.ts
```

Expected: FAIL，`electron-capture-session` 不存在。

- [ ] **Step 3: 实现 source 与 recorder window**

完整复用正式原语：

- `matchUniqueWindowSource()`
- `resolveDisplayMediaRequest()`
- `createCaptureChunkWriter()`
- `normalizeCapturedVideo()`
- `parseNormalizedVideoProbe()`

Source poll 使用 250ms 间隔与 10 秒上限；多匹配立即失败。

- [ ] **Step 4: 实现 normalize/probe 结果**

成功结果必须固定：

```ts
{
  status: 'available',
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: false
}
```

失败保留 raw WebM，删除临时 MP4，不返回假 available。

- [ ] **Step 5: 运行 GREEN**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-capture-runtime.unit.test.ts tests/video-generator/manual-capture-session.integration.test.ts tests/video-generator/capture-normalize.unit.test.ts
```

Expected: PASS。

## Task 3: 产品 Chromium session 与 observer 生命周期

**Files:**

- Modify: `src/lib/video-generator/recording/session.ts`
- Test: `tests/video-generator/manual-product-chromium.unit.test.ts`

- [ ] **Step 1: 写产品 session 失败测试**

预期入口：

```ts
export async function launchProductManualChromiumSession(input: {
  sessionId: string;
  startUrl: string;
}): Promise<ManualChromiumSession>
```

验证唯一 binding title 在导航前出现，随后导航 `startUrl`；产品入口不引用 fixture path，不自动操作或切换 tab。

- [ ] **Step 2: 运行 RED**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-product-chromium.unit.test.ts
```

Expected: FAIL，产品入口不存在。

- [ ] **Step 3: 抽取共享 launch helper**

Fixture 与产品入口共享 browser/context/title binding；仅导航策略不同：

```ts
type ManualNavigationTarget =
  | { kind: 'fixture'; fixtureDir: string; fixture: ManualPocFixture }
  | { kind: 'url'; startUrl: string };
```

- [ ] **Step 4: 验证 observer flush**

关闭顺序固定为：停止接收事件 → flush tab/manual observer → flush event sink → close event log → close Chromium。

- [ ] **Step 5: 运行 GREEN**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-product-chromium.unit.test.ts tests/video-generator/manual-session.unit.test.ts tests/video-generator/tab-observer.unit.test.ts
```

Expected: PASS。

## Task 4: Overlay/controller 单一 runtime bridge

**Files:**

- Create: `src/lib/video-generator/manual/product-runtime.ts`
- Modify: `src/lib/video-generator/recording-overlay/ipc.ts`
- Modify: `src/lib/video-generator/recording-overlay/main.ts`
- Modify: `src/lib/video-generator/manual/state-machine.ts`
- Test: `tests/video-generator/manual-product-runtime.integration.test.ts`
- Test: `tests/video-generator/manual-controls.integration.test.ts`

- [ ] **Step 1: 写 command bridge 失败测试**

测试：

- source 未 ready 时 F7 不开始；
- Record F7 走 3 秒 countdown 后才 `capture.start()`；
- Pickup F7 无普通 countdown，写 `pickup-start`；
- F8 confirm 当前 Action；
- Shift+F8 只回退指针；
- F9 写 discarded attempt，并为同 Action 开新 attempt；
- F10 第一次列未确认项，5 秒内第二次才 stop；
- 按钮与 global shortcut 调用同一 `dispatch(command)`。

- [ ] **Step 2: 运行 RED**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-product-runtime.integration.test.ts tests/video-generator/manual-controls.integration.test.ts
```

Expected: FAIL，runtime bridge 不存在或 overlay 仍独立改状态。

- [ ] **Step 3: 实现 runtime signals**

```ts
export interface ManualRuntimeSignals {
  waitForStart(): Promise<void>;
  waitForStop(): Promise<void>;
  dispatch(command: ManualOverlayCommand): Promise<ManualOverlaySnapshot>;
}
```

`main.ts` 不再直接调用 `manualOverlayReducer` 维护第二份状态；snapshot 来自 runtime。

- [ ] **Step 4: 实现 attempt 事件**

每次 attempt 必须保存真实 `actionId/segmentId/sourceId/startMs/endMs/confirmedAtMs/status`。F9 不改变 pickup source attempt 编号。

- [ ] **Step 5: 实现幂等 cleanup**

顺序：

```text
stop recorder → flush capture → flush observers/events
→ restore window → unregister IPC/shortcuts/display handler
→ close recorder/overlay/Chromium
```

保存首个错误，后续 cleanup 错误附加到 report。

- [ ] **Step 6: 运行 GREEN**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-product-runtime.integration.test.ts tests/video-generator/manual-controls.integration.test.ts tests/video-generator/manual-overlay.unit.test.ts
```

Expected: PASS。

## Task 5: Record/Pickup composition 与 CLI

**Files:**

- Modify: `src/lib/video-generator/manual/record-controller.ts`
- Modify: `src/lib/video-generator/manual/pickup-controller.ts`
- Modify: `src/cli/manual-record.ts`
- Modify: `src/cli/manual-pickup.ts`
- Modify: `scripts/run-manual-recording.mjs`
- Modify: `package.json`
- Test: `tests/video-generator/manual-record.integration.test.ts`
- Test: `tests/video-generator/manual-pickup.integration.test.ts`
- Test: `tests/video-generator/manual-record-cli.unit.test.ts`
- Test: `tests/video-generator/manual-pickup.unit.test.ts`

- [ ] **Step 1: 写默认 runtime 失败测试**

删除“默认必须 runtime unavailable”的旧断言，改为注入 fake child launcher 验证：

```text
video:record → electron main --mode recording --run ... --display-mode ...
video:pickup → electron main --mode pickup --run ... --segment ... --display-mode ...
```

Child 非零退出时 CLI 返回非零并打印 report path。

- [ ] **Step 2: 运行 RED**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-record-cli.unit.test.ts tests/video-generator/manual-pickup.unit.test.ts
```

Expected: FAIL，默认路径仍直接调用无 adapter controller。

- [ ] **Step 3: 实现 Electron composition 参数**

`run-manual-recording.mjs` 只构造：

```ts
{
  command: electronPath,
  args: [
    entryPath,
    '--mode', mode,
    '--run', absoluteRunDir,
    '--display-mode', displayMode,
    ...(segmentId ? ['--segment', segmentId] : []),
  ],
}
```

所有路径在 CLI 层解析为绝对路径；Electron main 再验证路径属于 run。

- [ ] **Step 4: 接入 controller**

Record 使用完整 guide；Pickup 只使用目标 Segment actions。两者均由 product runtime 提供 `launchChromium/waitForStart/capture/probe/attempts/cleanup`。

- [ ] **Step 5: 运行 GREEN**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-record-cli.unit.test.ts tests/video-generator/manual-record.integration.test.ts tests/video-generator/manual-pickup.unit.test.ts tests/video-generator/manual-pickup.integration.test.ts tests/video-generator/manual-product-runtime.integration.test.ts
```

Expected: PASS。

## Task 6: Build、失败路径与真实桌面验收

**Files:**

- Create: `examples/manual-recording/product-capture-smoke.html`
- Create: `scripts/prepare-manual-capture-smoke.mjs`
- Modify: `examples/manual-recording/README.md`
- Test: `tests/video-generator/manual-capture-product.integration.test.ts`

- [ ] **Step 1: 写无人值守产品边界测试**

测试 build output 包含 recorder/main/preload/renderer/assets，且不包含 POC UI/runner；fake Electron runtime 覆盖 source/normalize/cleanup 失败。

- [ ] **Step 2: 运行定向自动验证**

Run:

```powershell
npx.cmd tsx --test tests/video-generator/manual-capture-runtime.unit.test.ts tests/video-generator/manual-capture-session.integration.test.ts tests/video-generator/manual-product-chromium.unit.test.ts tests/video-generator/manual-product-runtime.integration.test.ts tests/video-generator/manual-capture-product.integration.test.ts tests/video-generator/manual-record.integration.test.ts tests/video-generator/manual-pickup.integration.test.ts
npm.cmd run build:manual
```

Expected: 全部 PASS，build exit 0。

- [ ] **Step 3: 准备隔离 smoke run**

Run:

```powershell
node scripts/prepare-manual-capture-smoke.mjs --output video-runs/manual-product-runtime-smoke
```

只写当前 worktree 的 `video-runs/`，生成本地 fixture、approved guide、pickup-required review 和必要 pointer。

- [ ] **Step 4: 用户配合真实 record**

Run:

```powershell
npm.cmd run video:record -- --run video-runs/manual-product-runtime-smoke --display-mode borderless-maximized
```

人工执行 F7、F8、F9、F10 二次确认。验证 overlay 不入镜、多 tab 连续、窗口恢复。

- [ ] **Step 5: 检查 record 媒体和 artifacts**

Run:

```powershell
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration -of json video-runs/manual-product-runtime-smoke/capture/original-window.mp4
npx.cmd tsx --test tests/video-generator/manual-record.integration.test.ts
```

Expected: H.264、1920×1080、30fps、yuv420p、无音频；manifest 有 discarded + confirmed attempt。

- [ ] **Step 6: 用户配合真实 pickup**

Run:

```powershell
npm.cmd run video:pickup -- --run video-runs/manual-product-runtime-smoke --segment segment-003 --display-mode borderless-maximized
```

Expected: 新 pickup source available；只包含目标 Segment actions；review 仍为 `pickup-required`；连续性材料存在。

- [ ] **Step 7: 最终分层验证**

仅当准备提交或用户要求最终里程碑时运行：

```powershell
npm.cmd run test
```

否则只保留 Step 2 的定向测试和 build 证据。

## 最终验证证据

- Task 7 既有结论保留：定向测试、`build:manual`、`npm run test` 均通过。
- 2026-07-29 定向回归：manual pickup、source catalog、product composition、smoke preparation 共 16 项通过。
- 2026-07-29 `npm run build:manual`：exit 0。
- 真实 record：`capture/original-window.mp4`，H.264、1920×1080、30fps、yuv420p、无音频，manifest `captureComplete=true`。
- 真实 pickup：`segment-003-attempt-005`，raw/MP4/events/tabs、两条 confirmed Action attempt、4 张连续性关键帧、continuity report 和 source catalog 均存在；review 保持 `pickup-required`；最终 runtime report `ok=true` 且 `cleanupErrors=[]`。
- 2026-07-29 最终 `npm run test`：400/400 通过，exit 0。

## 完成标准

1. 正式产品代码无 `pocs/manual-recording` import/reference。
2. `video:record`/`video:pickup` 默认路径可启动 Electron runtime。
3. Overlay 与 controller/capture 使用同一状态和 command path。
4. Raw/normalized media、events、tabs、manifest、source catalog、attempts 均可审计。
5. 任一失败均 fail closed 并执行幂等 cleanup。
6. 定向测试、`build:manual`、真实 record/pickup smoke 均通过。
7. 未经用户明确指示不 commit、不 push、不合并。
