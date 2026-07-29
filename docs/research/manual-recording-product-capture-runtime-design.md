# 人工录制正式 Capture Runtime 回补设计

> 创建时间：2026-07-28  
> 适用范围：`worktree-manual-recording-productization` 的 Task 5 回补与 Task 8 真实产品接线  
> 设计基线：`manual-recording-agent-editing-design.md`、已通过验收的 `pocs/manual-recording/`

## 1. 问题与目标

当前正式产品已具备 guide、overlay 状态机、record/pickup controller、source catalog、review 和局部 analyze，但 `video:record` 与 `video:pickup` 的默认 runtime adapter 仍会 fail closed。完整可工作的 Electron `desktopCapturer → getDisplayMedia → MediaRecorder → chunk IPC → normalize/probe` 链路只存在于 POC。

根因不是单个函数缺失，而是 Task 5 未将 POC 已验证能力提取为正式产品的 composition root、capture session 和 overlay/controller bridge。

本次目标：

- 正式产品不 import 或调用 POC UI/runner；
- `video:record` 和 `video:pickup` 复用一个正式 capture session；
- overlay 的按钮与 F7/F8/Shift+F8/F9/F10 驱动 controller，而不是维护另一份孤立状态；
- 产出受保护的 WebM、规范化 MP4、events、tabs、manifest、source catalog 和 attempts；
- 所有失败都保留可审计产物并执行确定性 cleanup；
- 不改变自动模式 `video:generate`。

## 2. 方案选择

采用“正式共享 capture session + Electron composition root”。

不采用：

- 直接从产品 import POC：违反产品边界，且会把 fixture/checklist 语义带入正式流程；
- 将 POC 主文件整体复制到 overlay main：形成新的超大文件，难以单测和复用；
- CLI 进程与 Electron 进程各自维护状态：容易造成快捷键、attempt、stop 和 manifest 状态分叉。

## 3. 模块边界

### 3.1 Capture session

新增正式 capture 模块，职责仅包括：

- 创建隐藏 recorder window；
- 只授权该 window 的 main frame 请求目标 Chromium window source；
- 接收并串行落盘 MediaRecorder chunk；
- 标记第一帧，写统一时钟 sample；
- 停止后 flush、normalize、ffprobe；
- 返回视频、时间、attempt 和失败信息；
- 注销 display-media handler、IPC handler，并关闭 recorder window。

Recorder renderer/preload 使用独立、最小、typed IPC，不包含业务 guide、review 或 POC checklist。

### 3.2 Chromium session

把现有 `launchManualChromiumSession()` 扩展为产品入口：

- 先以唯一 binding title 打开 Chromium；
- 安装 observer、虚拟鼠标和 tab observer；
- 绑定唯一 desktop source 后才导航到 approved guide 的 `startUrl`；
- 录制期间不自动执行业务动作或切 tab；
- cleanup 时 flush observer，再关闭 context/browser。

Fixture 导航继续仅供 POC 使用，不进入正式产品入口。

### 3.3 Electron composition root

正式 Electron main 同时拥有：

- overlay window；
- capture session；
- Chromium session；
- controller command bridge；
- global shortcuts；
- Windows display mode 生命周期。

它是唯一可修改运行中状态的进程。CLI 负责校验参数、构建并启动 Electron 子进程、读取最终结构化结果，不与 Electron 并行维护状态。

### 3.4 Controller adapter

`record-controller` 和 `pickup-controller` 保留可注入接口以支持单测，但默认产品路径由 composition root 注入真实 adapter。

- Record 传入完整 approved guide 和原始 capture 输出路径。
- Pickup 只传目标 Segment actions、递增 pickup source/output 和当前 review 上下文。
- Capture adapter 返回真实 `RecordingAttempt[]`；controller 不伪造 F9 历史。

## 4. IPC 与状态流

新增 channel 分组：

- overlay command：F7/F8/Shift+F8/F9/F10；
- overlay snapshot：状态、Segment、Action、attempt、提示；
- capture control：start/stop；
- capture chunks：first-chunk/append/flush/completed/failed；
- runtime result：成功或结构化失败。

普通录制：

```text
preparing
→ F7
→ countdown(3000ms)
→ capture start + recording-start marker
→ recording
→ F8/F9/Shift+F8 更新 Action/attempt
→ F10 request
→ F10 confirm
→ capture stop/flush/normalize/probe
→ analyzing
→ review-ready
```

补录：

```text
pickup-preparing
→ F7
→ capture start + pickup-start marker
→ pickup-recording
→ F8/F9/Shift+F8
→ F10 request/confirm
→ pickup-finishing
→ normalize/probe/keyframes/continuity material
→ segment-analyzing
→ review-ready
```

F9 只创建同一 source 内当前 Action 的新 attempt；Segment pickup source 编号不会因 Action retry 改变。

## 5. Windows 窗口与焦点

- Desktop source 必须通过唯一 binding title 匹配；缺失或多匹配均 fail closed。
- `borderless-maximized` 复用已验收的 User32 helper，并在 finally 中恢复完整 snapshot。
- `f11` 由用户准备；overlay 明确提示，不模拟按键。
- Overlay 始终置顶、默认不可聚焦、不得进入 capture source。
- Recorder window 隐藏，不出现在用户工作流中。

## 6. 数据与保护规则

- 原始 capture、events 和已存在 manifest 不覆盖。
- Chunk 必须严格单调，flush 检查缺失 sequence。
- Source catalog 只在 probe 成功后追加 available source；失败追加带 `failureReason` 的 failed source。
- Manifest 记录真实 attempts、captureComplete、clock 状态和媒体路径。
- IPC 不传任意写入路径；所有路径由 main 根据 validated run/segment 生成并限制在 run 内。

## 7. 失败与 cleanup

任一阶段失败时：

1. 停止 Action 推进；
2. 请求 MediaRecorder 停止并尽量 flush；
3. 写 failed manifest/source/report；
4. flush observer/event log；
5. 注销 IPC、display-media handler 和 global shortcuts；
6. 恢复 borderless window；
7. 关闭 recorder、overlay、Chromium；
8. CLI 返回非零，不生成假成功。

Cleanup 必须幂等，避免二次异常掩盖首个失败原因。

## 8. 测试与验收

### 自动测试

- typed IPC payload 和 frame authorization；
- chunk 顺序、首帧、flush 与异常；
- F7/F8/Shift+F8/F9/F10 到 controller 的单一 command path；
- record/pickup adapter 只接收允许的 Segment/actions/path；
- source 缺失、多匹配、normalize/probe 失败和 cleanup；
- build 不包含 `pocs/manual-recording/`；
- `build:manual` 通过。

开发中只跑定向测试；共享边界稳定后跑一次受影响测试。完整 `npm run test` 留到准备提交或阶段最终验收。

### 真实桌面验收

使用本地 demo：

1. 启动正式 `video:record`；
2. 验证 overlay 不入镜；
3. F7 开始，完成多 tab 操作；
4. F9 产生 discarded + confirmed attempt；
5. F10 二次确认结束；
6. ffprobe 确认 1920×1080、30fps、H.264、无音频；
7. 对一个 `pickup-required` Segment 执行正式 `video:pickup`；
8. 验证只录目标 Segment，生成新 source，review 仍不自动批准。

不重复 30 分钟漂移和 DPI 6/6 矩阵，除非修改对应 clock 或 User32 底层实现。

## 9. 完成标准

- `video:record` 与 `video:pickup` 默认路径不再报 runtime adapter unavailable；
- 产品代码不 import/reference POC runner/UI；
- overlay 与 capture/controller 使用同一运行状态；
- 自动定向测试和 `build:manual` 通过；
- 一次真实 record 与一次真实 pickup 验收通过；
- Task 8 的其余逻辑测试继续通过。
