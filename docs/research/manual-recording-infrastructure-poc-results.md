# 人工录制基础设施 POC 第一轮结果

> 验证日期：2026-07-27—2026-07-28
> 分支：`worktree-manual-recording-poc-round1`  
> 结论：POC 1—4 全部通过；POC 1 的 Windows 100%/125%/150% ×
> F11/borderless-maximized 六项矩阵全部通过

## 环境

| 项目 | 实测值 |
|---|---|
| 操作系统 | Windows 10 专业版 10.0.19045（build 19045） |
| 显示缩放 | Windows 100%/125%/150%（Electron `displayScaleFactor=1/1.25/1.5`） |
| Node.js | POC runner 24.18.0；项目开发环境另有 Node.js 22.14.0 |
| Electron / Chromium | Electron 43.1.1 / Chromium 150.0.7871.114 |
| Playwright | 1.60.0（项目声明 `^1.58.1`） |
| ffmpeg / ffprobe | 8.1.1 full build |
| DashScope | `DASHSCOPE_API_KEY` 缺失；不影响本轮录制基础设施 POC |

这里的 100%/125%/150% 是 Windows 显示缩放，不是 Chrome 单标签页页面缩放。实测确认 Chrome 页面
缩放不会自动传播到新标签页，因此它不能代替 Windows DPI 矩阵。

## 通用回归

| 命令 | 结果 | 可复核指标 |
|---|---|---|
| `npm run test` | 通过 | typecheck 通过；301/301 单元测试通过 |
| `npm run test:video-poc` | 通过 | Playwright `recordVideo` POC 1/1 通过 |
| `npm run test:editing-poc` | 通过 | 真实 ffmpeg 多源 preview POC 1/1 通过 |

## POC 1：Windows 指定 Chromium 窗口捕获

### 已通过的缩放矩阵

| Windows 缩放 | 模式 | 运行目录 | 结果 |
|---|---|---|---|
| 100% | F11 | `video-runs/manual-poc-f11-100-20260728-1` | report/verifier passed；`displayScaleFactor=1` |
| 100% | borderless-maximized | `video-runs/manual-poc-borderless-100-20260728-1` | report/verifier passed；`displayScaleFactor=1`；`windowMode.applied=true`、`restored=true` |
| 125% | F11 | `video-runs/manual-poc-f11-125-20260728-1` | report/verifier passed；`displayScaleFactor=1.25` |
| 125% | borderless-maximized | `video-runs/manual-poc-borderless-125-20260728-1` | report/verifier passed；`displayScaleFactor=1.25`；`windowMode.applied=true`、`restored=true` |
| 150% | F11 | `video-runs/manual-poc-f11-150-rerun` | report passed；`displayScaleFactor=1.5` |
| 150% | borderless-maximized | `video-runs/manual-poc-borderless-150-fixed3` | report/verifier passed；`displayScaleFactor=1.5`；`windowMode.applied=true`、`restored=true` |

borderless 实机修复覆盖了原生最大化窗口、DWM/User32 坐标差异、DPI 坐标空间和边框取整；
三个缩放档位的证据均显示真正移除窗口 chrome，退出后完整恢复原窗口状态。六次运行均为
1920×1080、30fps、无音频，overlay 不入镜，多标签页内容连续，POC 1 通过。

## POC 2：统一时钟、标记和漂移

### 快捷键画面对齐短测

- 运行目录：`video-runs/manual-clock-markers-fixed12`
- 独立验收：`MANUAL_POC_RUN=... npm run test:manual-clock-poc` 通过。
- 红色 `recording-start`、绿色 `retry-start`、蓝色 `recording-stop` 均在
  `videoTimeMs ± 1 frame` 内命中；停止标记在精确帧由绿变蓝。
- `clockStatus=ok`，`slopePpm=32.4708`，最大 residual `0.569ms <= 250ms`。
- ffprobe 尾差 `908.780ms <= 1112.094ms`。
- `captureComplete=true`，窗口模式应用和恢复均成功。

短测期间多次重跑分别暴露了时钟原点、ffmpeg 精确 seek、yuv420p 颜色采样、DOM marker
稳定时间和停止尾帧排空问题。最终修复在正式停止前保留 350ms，使已显示的蓝色帧进入编码
输出；这不是扩大颜色或时间容差。

### 30 分钟漂移

- 运行目录：`video-runs/manual-clock-30m-fixed1`
- 视频时长 `1,800,667ms`，1920×1080、30fps、无音频。
- `clockStatus=ok`，`slopePpm=0.05999`。
- 最大 residual `2.068ms <= 270.100ms`。
- ffprobe 尾差 `1059.179ms <= 1150.560ms`。
- 1815 个 MediaRecorder timecode 样本覆盖 `399ms → 1,800,006ms`；
  中位间隔约 1050ms，最大间隔 1304ms。
- 独立长测验收：`MANUAL_POC_RUN=... npm run test:manual-clock-long-poc` 通过。

原计划把 `MediaRecorder.start(250)` 的 timeslice 误解为严格 250ms 回调保证，因此写了
`样本数 >= 7000`。实机静态窗口录制显示 Chromium 会合并 chunk；正确门槛改为至少 900
个样本、首尾覆盖误差不超过 2 秒、最大样本间隔不超过 2 秒，并继续要求 residual 和
ffprobe 尾差分别过门槛。长测未重复三色快捷键；三色证据由短测独立承担。

结论：短测画面对齐和 30 分钟长期稳定性分别通过独立验收，POC 2 通过。

## POC 3：页面事件、多标签页和虚拟鼠标

- 运行目录：`video-runs/manual-events-poc-rerun`
- 独立验收：`npm run test:manual-events-poc` 通过。
- 报告 `status=passed`、`eventCaptureComplete=true`、`eventsTruncated=false`。
- 事件计数：pointer-click 26、input 33、change 5、scroll 50、navigation 6、
  tab-created 2、tab-activated 2、tab-closed 2、observer-error 0。
- reload、新标签页、child frame、动态 DOM 重注入全部通过。
- 虚拟光标没有拦截页面交互；视频 1920×1080、30fps、无音频。

结论：POC 3 通过。

## POC 4：多源 Segment preview

- 命令：`npm run test:editing-poc`
- 结果：通过，1/1。
- original trim、pickup source、2× 局部加速、500ms 末帧定格、120ms 非重叠淡黑和
  三段 concat 均有画面采样断言。
- 输出为 1920×1080、30fps、H.264、yuv420p、无音频，timeline 和 probe 时长均为
  4500ms（容差不超过一帧），完整解码无时间戳错误。

结论：POC 4 通过。

## 第一轮结论与后续约束

1. POC 1—4 均已具有自动回归和真实产物双重证据。
2. POC 1 的 Windows 100%/125%/150% × F11/borderless 六次运行全部通过，可归档。
3. Chrome 单标签页页面缩放不属于 Windows DPI 验收，不计入缩放矩阵。
4. 30 分钟漂移和 fixed12 三色 marker 已独立通过，本轮未重复运行。
5. 在 DashScope 凭据可用前，真实 TTS 与最终 `final.mp4` 回归仍是独立未验证项。
