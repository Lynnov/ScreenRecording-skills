# Manual Recording POC Acceptance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复实机验收暴露的伪 borderless、报告误判、漂移指标混合和 marker 无画面证据问题，使 POC 1/2 能按原计划产生可复核结论。

**Architecture:** Windows window mode 保持独立于 Playwright 和 capture renderer，通过受限的 encoded PowerShell/User32 runner 应用并恢复；capture main 只编排 lifecycle 并把结构化证据写入报告。时钟分析拆分线性 residual 与容器尾差，marker validator 用 ffmpeg 抽取固定色块中心像素，不使用 OCR。

**Tech Stack:** TypeScript、Node.js test runner、Electron 43.1.1、Playwright、PowerShell/C# P/Invoke、ffmpeg/ffprobe。

**Design:** `docs/research/manual-recording-poc-acceptance-remediation-design.md`

---

## 文件职责

- `src/lib/video-generator/capture/windows-window-mode.ts`：HWND snapshot、apply、verify、restore 和 PowerShell runner。
- `src/lib/video-generator/recording/poc-report.ts`：capture POC 报告证据类型及 passed invariant。
- `src/lib/video-generator/recording/drift.ts`：线性 residual、slope 与尾部 duration delta 的独立判定。
- `src/lib/video-generator/recording/marker-evidence.ts`：marker 抽帧、RGB 采样和颜色验证。
- `src/lib/video-generator/recording/types.ts`：manifest 中持久化的完整 drift/marker 类型。
- `pocs/manual-recording/capture-main.ts`：在 source 绑定后应用 window mode，在所有退出路径恢复，并汇总 drift/marker 证据。
- `tests/video-generator/*.unit.test.ts`：每个边界的确定性失败/成功测试。
- `tests/video-generator/manual-*-poc.test.ts`：只读取真实运行产物的独立验收器。

---

### Task 1: Windows 真无边框 helper

**Files:**
- Modify: `src/lib/video-generator/capture/windows-window-mode.ts`
- Modify: `tests/video-generator/windows-window-mode.unit.test.ts`

- [ ] **Step 1: 写 handle、apply/restore 和回读验证的失败测试**

在测试中定义注入 runner，并要求下列 API：

```ts
const calls: WindowsCommand[] = [];
const mode = await enableBorderlessWindowMode('window:123456:0', async (command) => {
  calls.push(command);
  return {
    stdout: JSON.stringify({
      handle: '123456',
      snapshot: {
        style: '13565952',
        exStyle: '256',
        bounds: { left: 10, top: 20, right: 1290, bottom: 740 },
      },
      appliedBounds: { left: 0, top: 0, right: 1920, bottom: 1040 },
      applied: true,
    }),
    stderr: '',
  };
});
assert.equal(mode.applied, true);
assert.equal(mode.snapshot.exStyle, 256n);
await restoreBorderlessWindowMode(mode, async (command) => {
  assert.match(command.decodedScript, /13565952/);
  assert.match(command.decodedScript, /256/);
  return { stdout: '{"restored":true}', stderr: '' };
});
```

同时断言 malformed source ID、`applied=false`、无效 JSON 和 `restored=false` 均 reject。

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
npx tsx --test tests/video-generator/windows-window-mode.unit.test.ts
```

Expected: FAIL，提示 `enableBorderlessWindowMode` / `restoreBorderlessWindowMode` 尚未导出或 snapshot 缺少 `exStyle`。

- [ ] **Step 3: 实现最小 helper**

导出固定接口：

```ts
export interface WindowModeSnapshot {
  style: bigint;
  exStyle: bigint;
  bounds: WindowBounds;
}

export interface AppliedBorderlessWindowMode {
  handle: bigint;
  snapshot: WindowModeSnapshot;
  appliedBounds: WindowBounds;
  applied: true;
}

export type RunWindowsCommand = (
  command: WindowsCommand,
) => Promise<{ stdout: string; stderr: string }>;

export async function enableBorderlessWindowMode(
  sourceId: string,
  runCommand: RunWindowsCommand,
): Promise<AppliedBorderlessWindowMode>;

export async function restoreBorderlessWindowMode(
  mode: AppliedBorderlessWindowMode,
  runCommand: RunWindowsCommand,
): Promise<void>;
```

PowerShell 增加 `GWL_EXSTYLE`、`MONITOR_DEFAULTTONEAREST`、`GetMonitorInfo` 和应用后回读。
只接受 `^window:(\d+):\d+$`；JSON 中 bigint 使用十进制字符串。restore 同时恢复 style、
exStyle、bounds，并要求脚本返回 `{ restored: true }`。

- [ ] **Step 4: 运行 helper 测试确认通过**

Run:

```bash
npx tsx --test tests/video-generator/windows-window-mode.unit.test.ts
```

Expected: PASS，所有 handle 和 fail-closed 分支通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/capture/windows-window-mode.ts tests/video-generator/windows-window-mode.unit.test.ts
git commit -m "fix: implement Windows borderless window mode"
```

---

### Task 2: 接入 window mode lifecycle 与恢复

**Files:**
- Modify: `pocs/manual-recording/capture-main.ts`
- Modify: `tests/video-generator/manual-capture-cli.unit.test.ts`

- [ ] **Step 1: 写应用和所有退出路径恢复的失败测试**

扩展 `ManualCapturePocDeps`：

```ts
applyWindowMode?: (
  args: Required<Omit<ManualPocArgs, 'help'>>,
) => Promise<void>;
restoreWindowMode?: () => Promise<void>;
```

测试 `borderless-maximized` 调用 apply；`f11` 不调用。分别令 bind、apply、capture 抛错，
并断言进入 `finally` 后 restore 恰好一次。restore 自身失败时返回非零并保留错误文本。

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
npx tsx --test tests/video-generator/manual-capture-cli.unit.test.ts
```

Expected: FAIL，apply/restore callbacks 尚未被调用。

- [ ] **Step 3: 最小接线**

`runManualCapturePoc()` 固定顺序：

```ts
await deps.prepareOutput?.(args);
await deps.bindSource?.(args);
await deps.applyWindowMode?.(args);
await deps.startCapture?.(args);
```

finally 顺序为 capture handlers → `restoreWindowMode` → observers/context/window cleanup。
真实 deps 在 source 绑定后调用 `enableBorderlessWindowMode(matchedSource.id, runner)`，
保存 snapshot；F11 保存 `{ requested: 'f11', applied: false }`，不调用 User32。

- [ ] **Step 4: 运行相关测试**

Run:

```bash
npx tsx --test tests/video-generator/manual-capture-cli.unit.test.ts tests/video-generator/windows-window-mode.unit.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add pocs/manual-recording/capture-main.ts tests/video-generator/manual-capture-cli.unit.test.ts
git commit -m "fix: restore manual capture window mode"
```

---

### Task 3: 收紧 capture report 通过条件

**Files:**
- Modify: `src/lib/video-generator/recording/poc-report.ts`
- Modify: `pocs/manual-recording/capture-main.ts`
- Modify: `tests/video-generator/manual-poc-report.unit.test.ts`
- Modify: `tests/video-generator/manual-window-capture-poc.test.ts`

- [ ] **Step 1: 写报告 invariant 失败测试**

新增：

```ts
windowMode: {
  requested: 'f11' | 'borderless-maximized';
  applied: boolean;
  restored: boolean | null;
  handle: string | null;
  snapshot: {
    style: string;
    exStyle: string;
    bounds: WindowBounds;
  } | null;
  errors: string[];
};
```

测试 passed report 在以下情况均 reject：

```text
overlayAlwaysOnTop=false
overlayEnteredCapture=true
multiTabContinuous=false
borderless applied=false
borderless restored!=true
windowMode.errors 非空
ffprobeJsonPath 或 sampledFrames 为空
```

F11 passed 要求三个基础抽帧，但允许 `applied=false`、`restored=null`。

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
npx tsx --test tests/video-generator/manual-poc-report.unit.test.ts
```

Expected: FAIL，现有 writer 接受至少一个错误 passed report。

- [ ] **Step 3: 实现统一 status predicate**

导出：

```ts
export function capturePocEvidenceErrors(
  report: Omit<CapturePocReport, 'status' | 'errors'>,
): string[];
```

`capture-main.ts` 使用该函数加 capture/window errors 计算 `passed|failed|incomplete`；
writer 对声称 passed 但 predicate 返回错误的数据 reject。真实 restore 结果在最终报告前写入。

- [ ] **Step 4: 运行报告与独立 POC 测试**

Run:

```bash
npx tsx --test tests/video-generator/manual-poc-report.unit.test.ts tests/video-generator/manual-window-capture-poc.test.ts
```

Expected: 单元测试 PASS；独立 POC 测试只在显式 `MANUAL_POC_RUN` 下使用新报告。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/recording/poc-report.ts pocs/manual-recording/capture-main.ts tests/video-generator/manual-poc-report.unit.test.ts tests/video-generator/manual-window-capture-poc.test.ts
git commit -m "fix: gate capture reports on window evidence"
```

---

### Task 4: 拆分时钟 residual 与尾差

**Files:**
- Modify: `src/lib/video-generator/recording/drift.ts`
- Modify: `src/lib/video-generator/recording/types.ts`
- Modify: `pocs/manual-recording/capture-main.ts`
- Modify: `tests/video-generator/recording-drift.unit.test.ts`
- Modify: `tests/video-generator/recording-manifest.unit.test.ts`

- [ ] **Step 1: 用实测样本写失败测试**

构造 cadence 约 270ms、duration delta `273.564ms`、slope 约 `1.13ppm` 的样本，并断言：

```ts
assert.equal(result.status, 'ok');
assert.ok(result.maxResidualMs < 2);
assert.ok(Math.abs(result.slopePpm) < 5);
assert.equal(result.ffprobeDurationDeltaMs, 273.564);
assert.ok(result.ffprobeDurationDeltaMs <= result.maxAllowedFfprobeDurationDeltaMs);
```

另建真正漂移样本，要求 residual 或 slope 超限时仍为 `drift-detected`；样本不足 fail closed。

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
npx tsx --test tests/video-generator/recording-drift.unit.test.ts
```

Expected: FAIL，现有统一 250ms 门槛把实测样本判为 `drift-detected`。

- [ ] **Step 3: 实现拆分指标**

`DriftAnalysis` 固定字段：

```ts
status: 'ok' | 'drift-detected';
slopePpm: number;
maxResidualMs: number;
maxAllowedResidualMs: number;
ffprobeDurationDeltaMs: number;
maxAllowedFfprobeDurationDeltaMs: number;
```

尾差门槛使用 `max(250, p95(media interval) + 2 * 1000 / 30)`；持续漂移要求
`maxResidualMs <= max(250, durationMs*0.00015)` 且有限。manifest 保存全部字段，
`captureComplete` 继续要求 `status==='ok'`。

- [ ] **Step 4: 运行 drift、manifest 和 clock 测试**

Run:

```bash
npx tsx --test tests/video-generator/recording-drift.unit.test.ts tests/video-generator/recording-manifest.unit.test.ts tests/video-generator/manual-clock-poc.test.ts
```

Expected: 单元测试 PASS；真实 POC wrapper 读取新字段并断言两类指标分别在门槛内。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/recording/drift.ts src/lib/video-generator/recording/types.ts pocs/manual-recording/capture-main.ts tests/video-generator/recording-drift.unit.test.ts tests/video-generator/recording-manifest.unit.test.ts tests/video-generator/manual-clock-poc.test.ts
git commit -m "fix: separate recording drift diagnostics"
```

---

### Task 5: Marker 颜色抽帧证据

**Files:**
- Create: `src/lib/video-generator/recording/marker-evidence.ts`
- Create: `tests/video-generator/marker-evidence.unit.test.ts`
- Modify: `src/lib/video-generator/recording/artifacts.ts`
- Modify: `src/lib/video-generator/recording/types.ts`
- Modify: `pocs/manual-recording/capture-main.ts`
- Modify: `tests/video-generator/manual-clock-poc.test.ts`

- [ ] **Step 1: 写颜色匹配和 ffmpeg 调用失败测试**

期望 API：

```ts
const evidence = await collectMarkerEvidence({
  videoPath: 'capture/original-window.mp4',
  outputDir: 'reports/clock-marker-frames',
  fps: 30,
  markers: [
    { type: 'recording-start', videoTimeMs: 3000 },
    { type: 'retry-start', videoTimeMs: 8000 },
    { type: 'recording-stop', videoTimeMs: 15000 },
  ],
  runCommand,
});
assert.deepEqual(evidence.map((item) => item.passed), [true, true, true]);
```

runner 返回 1×1 `rgb24` buffer；红 `[255,0,0]`、绿 `[0,255,0]`、蓝 `[0,0,255]`
分别通过。null timestamp、三次错色、命令失败均产生结构化 failed evidence。

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
npx tsx --test tests/video-generator/marker-evidence.unit.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小 marker collector**

对每个 marker 的 `-1/0/+1` 帧执行 ffmpeg：

```text
-ss <seconds> -i <video> -frames:v 1
-vf crop=1:1:<marker-center-x>:<marker-center-y>
-pix_fmt rgb24 -f rawvideo -
```

dominant channel >= 180 且另外两个 channel <= 80 视为命中。保存 PNG 证据和 RGB JSON；
manifest 保存 `markerEvidence`。只有 clock fixture 强制三种 marker 全部通过。

- [ ] **Step 4: 接入 capture main 与独立验证器**

normalize 成功后、写 manifest 前收集 marker evidence。`manual-clock-poc.test.ts` 要求：

```ts
assert.deepEqual(
  manifest.markerEvidence.map((item) => [item.type, item.passed]),
  [['recording-start', true], ['retry-start', true], ['recording-stop', true]],
);
```

- [ ] **Step 5: 运行 marker 和 clock 测试**

Run:

```bash
npx tsx --test tests/video-generator/marker-evidence.unit.test.ts tests/video-generator/manual-clock-poc.test.ts tests/video-generator/manual-artifacts.unit.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-generator/recording/marker-evidence.ts tests/video-generator/marker-evidence.unit.test.ts src/lib/video-generator/recording/artifacts.ts src/lib/video-generator/recording/types.ts pocs/manual-recording/capture-main.ts tests/video-generator/manual-clock-poc.test.ts tests/video-generator/manual-artifacts.unit.test.ts
git commit -m "fix: verify manual clock marker frames"
```

---

### Task 6: 自动回归、实机重验与文档

**Files:**
- Modify: `docs/research/manual-recording-infrastructure-poc-results.md`
- Modify: `docs/exec-plans/active/manual-recording-infrastructure-pocs.md`
- Modify: `docs/exec-plans/active/manual-recording-poc-acceptance-remediation.md`
- Modify: `docs/exec-plans/README.md`

- [ ] **Step 1: 运行完整自动测试**

Run:

```bash
npm run test
npm run test:video-poc
npm run test:editing-poc
```

Expected: typecheck、全部 unit、Playwright recordVideo 和真实 ffmpeg editing POC 均 PASS。

- [ ] **Step 2: 重验 borderless + 150%**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-poc-borderless-150-fixed" --display-mode borderless-maximized --fixture capture --duration-seconds 180
```

Expected: 实际无标题栏/地址栏；报告 `windowMode.applied=true`、
`windowMode.restored=true`；视频 1920×1080、30 fps、无音频；独立 capture verifier PASS。

- [ ] **Step 3: 重验时钟短测**

Run:

```bash
npm run poc:manual-capture -- --output "video-runs/manual-clock-markers-fixed" --display-mode borderless-maximized --fixture clock --duration-seconds 30
```

Expected: slope/residual 和尾差分别在门槛内；红/绿/蓝 marker evidence 全部通过；
`npm run test:manual-clock-poc` PASS。

- [ ] **Step 4: 运行 30 分钟漂移**

仅在 Step 3 通过后运行：

```bash
npm run poc:manual-capture -- --output "video-runs/manual-clock-30m" --display-mode borderless-maximized --fixture clock --duration-seconds 1800
```

Expected: 样本数 >= 7000；两类 drift 指标在各自门槛内；manifest `clockStatus=ok`。

- [ ] **Step 5: 更新结果文档和计划状态**

逐项记录旧失败证据、修复 commit、新实测命令、报告路径和量化指标。100%/125% 矩阵未完成前，
POC 1 仍保持 active；不把一次 150% 通过外推为 6/6。

- [ ] **Step 6: 检查工作区**

Run:

```bash
git status --short
git diff --check
```

Expected: 只有计划中的源码、测试和文档；`video-runs/`、`dist/`、日志和媒体均未跟踪。

- [ ] **Step 7: 提交结果文档**

```bash
git add docs/research/manual-recording-infrastructure-poc-results.md docs/exec-plans/active/manual-recording-infrastructure-pocs.md docs/exec-plans/active/manual-recording-poc-acceptance-remediation.md docs/exec-plans/README.md
git commit -m "docs: record remediated manual poc results"
```

---

## 计划自检

- [ ] Window helper 不接受用户文本拼入 PowerShell。
- [ ] Borderless 在所有退出路径恢复，恢复失败 fail closed。
- [ ] Capture report 的状态和操作员备注不再自相矛盾。
- [ ] Drift residual 与 ffprobe tail delta 使用不同字段和门槛。
- [ ] Marker 验证读取真实像素，不只检查事件存在。
- [ ] 30 分钟测试只在短测通过后启动。
- [ ] 100%/125% 未实测前不归档原计划。
