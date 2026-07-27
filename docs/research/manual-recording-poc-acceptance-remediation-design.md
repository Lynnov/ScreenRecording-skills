# 人工录制 POC 实机验收问题修复设计

> 日期：2026-07-27  
> 分支：`worktree-manual-recording-poc-round1`  
> 状态：已批准，待实施

## 背景与实测证据

第一轮 Windows 实机验收得到以下结果：

- F11 + 150% 缩放重跑通过，抽帧确认浏览器框架隐藏，输出为
  1920×1080、30 fps、H.264、无音频。
- `borderless-maximized` 实际仍是普通最大化窗口；抽帧可见标题栏、标签栏和地址栏，
  但现有报告仍可根据两个操作员勾选项写成 `passed`。
- 页面事件 POC 重跑通过，八类必需事件、刷新、新标签页、iframe、动态 DOM 和虚拟鼠标
  均有证据。
- 时钟短测记录了 F7/F9/F10，但 manifest 因
  `ffprobeDurationDeltaMs=273.564` 超过统一的 250 ms 门槛而失败；同次样本的
  `slopePpm=1.131`，线性时钟漂移正常。manifest 没有保存 slope 和 ffprobe delta，
  验证器也没有读取红/绿/蓝 marker 抽帧。

本修复只补齐当前基础设施 POC 的验收闭环，不实现正式录制产品 UI、Agent 编辑、
Segment 补录或 TTS/final 流程。

## 方案选择

采用“严格补齐当前 POC 计划”的方案：

1. 实现 Windows User32 真无边框与可靠恢复。
2. 让报告状态由完整证据决定，禁止人工勾选覆盖客观失败。
3. 分离持续时钟漂移与容器尾部时长差，并保存完整诊断。
4. 为 F7/F9/F10 生成和验证 OCR-free 颜色抽帧证据。

不采用以下方案：

- 只修报告和时钟、继续用普通最大化冒充 borderless：无法完成 POC 1。
- 提前建设正式产品级跨显示器恢复工具：超出本轮 POC 范围。

## Windows 无边框模式

### 边界

新增独立 Windows window-mode helper。它接收从 Electron desktop source ID 解析出的
HWND，不依赖 Playwright action 或录制 pipeline。

### 应用流程

1. 通过 User32 读取 `GWL_STYLE`、`GWL_EXSTYLE` 和 `GetWindowRect`。
2. 保存可序列化 snapshot：handle、style、exStyle、原始 bounds。
3. 获取窗口所在显示器的 work area。
4. 移除 caption、thick frame、min/max box 等非客户区样式。
5. 使用 `SetWindowLongPtr` 和带 `SWP_FRAMECHANGED` 的 `SetWindowPos` 铺满 work area。
6. 回读 style 与 bounds，确认无边框状态确实生效；回读失败即中止录制。

PowerShell 通过 UTF-16LE encoded command 调用内嵌 C# P/Invoke，参数仅来自已校验的
数字 handle/snapshot，不拼接用户文本或输出路径。

### 恢复流程

正常结束、捕获失败、ffmpeg 失败和 Electron 清理路径均使用同一个幂等 restore：

1. 恢复 style 与 exStyle。
2. 恢复原始 bounds，并触发 `SWP_FRAMECHANGED`。
3. 回读确认恢复值。

恢复失败时保留 Chromium，报告
`windowModeRestoreRequired=true`、handle、snapshot 和错误；不得写 `passed`。

## 捕获报告状态

`CapturePocReport` 增加结构化 `windowMode` 证据：

```ts
{
  requested: 'f11' | 'borderless-maximized';
  applied: boolean;
  restored: boolean | null;
  handle: string | null;
  snapshot: WindowModeSnapshot | null;
  errors: string[];
}
```

通过条件固定为：

- 视频可用且规格为 1920×1080、30 fps、无音频。
- normalization 通过且报告证据文件存在。
- `overlayAlwaysOnTop=true`。
- `overlayEnteredCapture === false`。
- `multiTabContinuous === true`。
- borderless 模式必须 `applied=true` 且 `restored=true`。
- F11 模式必须保存操作员确认和抽帧证据；不伪造自动全屏检测。
- `errors` 与 `windowMode.errors` 均为空。

任何客观条件失败时，即使操作员勾选两个项目，也只能写 `failed`；操作员没有提交时写
`incomplete`。

## 时钟漂移判定

### 指标分离

`analyzeClockDrift` 输出并由 manifest 完整保存：

- `slopePpm`
- `maxResidualMs`
- `maxAllowedResidualMs`
- `ffprobeDurationDeltaMs`
- `maxAllowedFfprobeDurationDeltaMs`
- 最终 `status`

持续漂移由 slope 回归 residual 判断。容器尾部差由 ffprobe duration 与最后
MediaRecorder timecode 单独判断，其容差为：

```text
max(250ms, observedChunkIntervalP95 + 2 * frameDuration)
```

其中 chunk interval 来自相邻 `mediaTimeMs`；没有足够样本时 fail closed。该容差覆盖
MediaRecorder 最后 chunk 到 muxed 最后一帧的正常封装尾差，但不会放宽线性漂移。

本次实测样本 `slopePpm=1.131`、尾差 `273.564ms`、约 250–320ms chunk 间隔，应被分类为
“持续漂移正常，尾差在基于实测 chunk cadence 的容差内”，而不是混成一个 250ms 指标。

## Marker 画面对齐证据

clock fixture 继续使用固定颜色：

- F7 / `recording-start`：红
- F9 / `retry-start`：绿
- 最终确认 F10 / `recording-stop`：蓝

完成规范化后，对每个正式 marker 在 `videoTimeMs - 1 frame`、`videoTimeMs`、
`videoTimeMs + 1 frame` 抽取 marker 色块中心像素。至少一个样本必须满足目标颜色阈值，
且不允许由文本 OCR 代替颜色判断。

报告或 manifest 保存每个 marker 的：

- event time
- 三个抽帧路径
- 命中的帧偏移
- 实测 RGB
- `passed`

缺 marker、`videoTimeMs=null`、抽帧失败或三帧均错色时，时钟 POC 失败。第一次 F10
`recording-stop-requested` 不作为蓝色正式 marker。

## 错误处理

- 无法解析 HWND：捕获开始前失败，不生成空视频。
- 无边框应用失败：立即尝试恢复，报告原始 User32/PowerShell 错误。
- 恢复失败：保留浏览器和 snapshot，明确提示人工关闭/恢复。
- 时钟样本不足或非有限值：fail closed。
- marker 抽帧失败：保留视频、事件、ffmpeg stderr 和已成功抽出的帧。
- 报告 writer 收到自相矛盾的 `passed` 数据：拒绝写入，而不是自动修饰证据。

## 测试与验收

严格采用 TDD，每项生产改动前先运行对应失败测试：

1. Window helper：handle 解析、encoded PowerShell、snapshot、apply/restore、幂等恢复。
2. Capture main：所有成功/失败清理路径都恢复；恢复失败进入报告。
3. Report：拒绝错误操作员结论、未应用 borderless、未恢复和缺失证据。
4. Drift：加入本次实测样本；验证低 slope/residual 与合理尾差通过，真实持续漂移仍失败。
5. Marker：红/绿/蓝成功、缺帧、错色和 null timestamp。
6. 运行相关单测、`npm run test`、`npm run test:video-poc`。
7. 实机重验 borderless + 150%、时钟短测；两者通过后才运行 30 分钟漂移测试。
8. 后续再补 100%/125% 的 F11 与 borderless 矩阵。

## 完成标准

- 真正的 borderless 模式可应用并在退出后恢复。
- 报告不再出现“备注承认失败但 status=passed”。
- 本次时钟样本被正确拆分诊断，manifest 保存全部指标。
- 三个 marker 有 ±1 帧颜色证据，独立验证器读取并断言。
- 全量自动测试通过，实机短测通过后才进入 30 分钟验收。
