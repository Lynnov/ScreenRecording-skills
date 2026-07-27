# 人工录制基础设施 POC 第一轮结果

> 验证日期：2026-07-27  
> 分支：`worktree-manual-recording-poc-round1`  
> 结论：POC 4 通过；POC 1-3 尚未执行人工桌面验收，计划继续保留在 `active/`

## 环境

| 项目 | 实测值 |
|---|---|
| 操作系统 | Windows 10 专业版 10.0.19045（build 19045） |
| 显示缩放 | 未测；本轮没有启动人工桌面录制流程 |
| Node.js | 22.14.0 |
| npm | 10.9.2 |
| Electron | 43.1.1 |
| Playwright | 1.60.0（项目声明 `^1.58.1`） |
| Chromium | Playwright revision 1223，路径由 `video:doctor` 验证可用 |
| ffmpeg / ffprobe | 8.1.1 full build |
| DashScope | `DASHSCOPE_API_KEY` 缺失 |

## 通用回归

| 命令 | 结果 | 可复核指标 |
|---|---|---|
| `npm run test` | 通过 | typecheck 通过；289/289 单元测试通过，0 failed |
| `npm run test:video-poc` | 通过 | Playwright `recordVideo` POC 1/1 通过 |
| `npm run video:doctor` | 未完全通过 | Node、npm、依赖、Chromium、ffmpeg、ffprobe、demo 均为 OK；仅 DashScope key 为 missing |
| `npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo-manual-poc-preflight --dry-run` | 通过 | 3 个 segment 解析成功；4 个 browser action 检查通过；报告为 `ok: true` |

dry-run 报告生成于
`video-runs/basic-demo-manual-poc-preflight/reports/preflight-report.json`；核验内容后已清理该忽略的临时运行目录，不纳入提交。

由于没有 `DASHSCOPE_API_KEY`，本轮没有执行真实 TTS，也没有生成或验收基础 demo 的
`final.mp4`；以上 dry-run 结果不能视为 TTS、音视频合成或最终视频回归。

## POC 1：Windows 指定 Chromium 窗口捕获

- 命令：`npm run test:manual-capture-poc`
- 结果：未验收。
- 直接错误：读取
  `video-runs/manual-poc-borderless-100/reports/capture-poc-report.json` 时返回 `ENOENT`。
- 缺失产物：`capture/original-window.mp4`、`reports/capture-poc-report.json`。
- 保留素材：无；本轮没有启动 Electron 人工捕获流程。
- 未验证项：指定窗口、多标签页连续性、overlay 不入镜、1920×1080、F11、
  borderless-maximized、100%/125%/150% 缩放、中文和空格输出路径、桌面状态恢复。

结论：实现和逻辑测试已具备，但没有人工操作证据，POC 1 不通过验收门槛。

## POC 2：统一时钟、标记和漂移

- 命令：`npm run test:manual-clock-poc`
- 结果：未验收。
- 直接错误：读取
  `video-runs/manual-clock-markers/capture/recording-manifest.json` 时返回 `ENOENT`。
- 缺失产物：`capture/events.jsonl`、`capture/recording-manifest.json`。
- 保留素材：无；本轮没有执行 30 分钟人工录制。
- 未验证项：F7/F9/F10 画面对齐、`sessionTimeMs`/`videoTimeMs` 映射、漂移 slope、
  max residual、duration delta 及阈值判定。

结论：时钟、manifest 和漂移判定的单元测试通过，但缺少真实长录制数据，POC 2
不通过验收门槛。

## POC 3：页面事件、多标签页和虚拟鼠标

- 命令：`npm run test:manual-events-poc`
- 结果：未验收。
- 直接错误：读取
  `video-runs/manual-events-poc/reports/manual-events-poc-report.json` 时返回 `ENOENT`。
- 缺失产物：`capture/events.jsonl`、`reports/manual-events-poc-report.json`。
- 保留素材：无；本轮没有启动综合事件 fixture 的人工流程。
- 未验证项：真实 click/input/change/scroll/navigation/tab 序列、新 Page 与刷新重注入、
  手动切 tab 的激活代理、虚拟指针画面可见且不拦截业务交互。

结论：观察器、标签页和指针覆盖层的逻辑测试通过，但没有真实人工交互日志和录像，
POC 3 不通过验收门槛。

## POC 4：多源 Segment preview

- 命令：`npm run test:editing-poc`
- 结果：通过，1/1。
- 输入：测试在系统临时目录生成 6 秒 original 和 2 秒 pickup，均为
  1920×1080、30 fps、H.264、无音频。
- 编辑：original trim、pickup source、2× 局部加速、500 ms 末帧定格、
  120 ms 非重叠淡黑和三段 concat 均被画面采样断言覆盖。
- 输出：`preview.mp4` 为单 H.264 视频流、零音频流、1920×1080、30/1 fps、
  yuv420p；timeline 和 probe 时长均为 4500 ms（容差不超过 1 帧）。
- 时间戳：完整解码 stderr 不包含 non-monotonous DTS、invalid timestamp 或 decode error。
- 产物：成功后测试主动清理临时 original、pickup、`preview-timeline.json` 和
  `preview.mp4`；失败时才会保留 fixture 与 `edit/error.stderr.txt`。

结论：POC 4 通过本计划定义的独立验收门槛。

## 第一轮结论与后续约束

1. 多源 preview 的 trim、concat、2×、hold、short-fade 和媒体结构已有真实 ffmpeg
   证据，可作为正式剪辑实现的输入约束。
2. POC 1-3 只能确认代码路径和自动测试已建立，不能据此宣称 Windows 指定窗口捕获、
   长录制漂移或真实多标签页观察可靠。
3. 下一轮必须在实际桌面会话运行 Electron POC，按 100%/125%/150%、
   F11/borderless、双标签页和 30 分钟录制矩阵生成报告；报告通过后再归档本计划。
4. 在 DashScope 凭据可用前，真实 TTS 与最终 `final.mp4` 回归仍是独立的未验证项。
