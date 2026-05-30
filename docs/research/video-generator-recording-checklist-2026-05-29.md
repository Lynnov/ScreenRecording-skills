---
title: 视频生成器真实业务录制检查清单（2026-05-29）
---

# 视频生成器真实业务录制检查清单（2026-05-29）

## 1. 三稿准备

- 原始稿：保留业务人员写法，不改测试数据、不改业务术语。
- 润色稿：整理旁白、步骤顺序和演示节奏。
- 可执行稿：补充 `@stage`、`scope`、`anchor`、稳定等待点和上传素材绝对路径。

## 2. Stage 标注

- 独立页面用 URL 片段或页面级 selector 做 anchor。
- 弹窗、抽屉、下拉层用可见容器做 `scope`，例如 `.el-dialog:visible`。
- 每段关键动作都应归属到一个明确 stage。
- 回到同一页面状态时，可以重复声明同名 stage。
- 文本重复多的页面，优先在 stage scope 内查找，不直接依赖全局文本。

## 3. 登录态和环境

- 正式录制前确认 storage state 可用。
- 真实 TTS 验证前确认 `DASHSCOPE_API_KEY` 可用。
- 涉及 ffmpeg/ffprobe 的路径要确认本机命令可用。
- Windows 路径和带空格路径优先使用正斜杠或绝对路径。

## 4. Preflight

- 先跑 dry-run / preflight，确认脚本可解析、上传文件存在、stage anchor 命中。
- 检查 `preflight-report.json` 中的 `stageDiagnostics`：
  - `scopeMatched` 是否为 true。
  - `scopeCount` 是否符合预期。
  - `missingAnchors` 是否为空。
- 如果 scope 缺失，先修 stage scope，不要急着改业务动作。
- 如果 anchor 缺失，先确认页面阶段是否正确，再确认 selector 是否稳定。

## 5. 正式生成

- dry-run 通过后再跑正式录制。
- 正式录制失败时先查看 `run-report.json` 的 `diagnostics`。
- 对照失败截图判断是否是遮罩、loading、残留 dropdown、页面慢或 selector 歧义。
- 不建议直接改成坐标点击或图像识别兜底。

## 6. 失败诊断

`run-report.json` 的 diagnostics 优先看：

- `stageName`：失败动作属于哪个页面阶段。
- `selector`：实际用于查找的 selector。
- `candidateCount`：真实候选总数。
- `candidates`：前 5 个候选的可见性、可编辑性、尺寸和遮挡信息。
- `overlayElement`：目标中心点上方是否有遮挡元素。
- `dropdowns`：remoteSelect 失败时的 popper 数量、可见项数量和隐藏容器数量。
- `screenshotPath`：失败瞬间截图。

## 7. 验收

- `npm run test` 通过。
- 涉及真实录制路径时，优先跑内置 demo。
- 涉及真实业务视频时，确认最终 `run-report.json` 为 `ok: true`，并人工观看 `final.mp4`。
- 失败复盘要记录根因，不只记录 workaround。
