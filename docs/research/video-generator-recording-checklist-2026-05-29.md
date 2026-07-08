---
title: 视频生成器真实业务录制检查清单（2026-05-29）
---

# 视频生成器真实业务录制检查清单（2026-05-29）

## 录制前

- 保留原始脚本，不直接改 `视频脚本原稿/` 下的文件。
- 先用 `--prepare-script` 生成三稿，只改 `scripts/executable.md`。
- 确认登录态是最新导出的 `storageState`，不要默认旧文件还能用。
- 确认上传附件存在，复杂路径优先用绝对路径。
- 能直达业务页就直达业务页，首页导航只在必须演示时保留。

## 写可执行稿

- 每段必须有明确动作和 `旁白：`，避免只有旁白或只有动作。
- 页面状态等待优先用稳定 selector，不优先用普通文本。
- 重复文案使用 `>> nth=0/1` 或限定 `.el-dialog:visible`。
- 远程搜索使用 `远程选择 字段 查询词 第一个`，不要改用户给定测试数据。
- 上传使用 `上传文件选择器 "input[type=file]" "绝对路径"`。

## 选择器优先级

- 优先：稳定 class、placeholder、value、弹窗限定、nth 定位。
- 谨慎：`点击 文案`、`等待出现 文案`，真实页面里经常重复。
- 避免：依赖 hover 后长时间存在的菜单状态。
- 菜单必须保留时，把 `点击入口 -> 悬停一级菜单 -> 点击二级菜单` 放同一段。

## dry-run

- 正式生成前必须跑 dry-run。
- dry-run 失败先看 `reports/preflight-report.json` 和失败截图。
- 如果失败在登录页，先重新导出登录态。
- 如果失败在上传文件，先检查路径解析结果。
- 如果失败在下拉选择，先判断是无数据、隐藏 dropdown、空 popper，还是字段 selector 指错。

## 正式生成

- dry-run 通过后再跑正式生成。
- 正式生成失败时，不要只信 dry-run；正式录制有 cursor overlay、视频录制上下文和旁白停顿。
- 如果正式生成卡在 hover 菜单，优先改为直达页面或合并菜单动作。
- 如果正式生成卡在点击可见元素，检查元素是否真实可点击、是否被 overlay 或 actionability 卡住。

## 生成后

- 检查 `reports/run-report.json` 是否 `ok: true`。
- 检查 `final.mp4` 是否存在。
- 用 `ffprobe` 查看视频时长是否明显异常。
- 保留 `timeline.json`、`subtitles.srt` 和 `audio/narration.wav`，便于排查音画不同步。
- 不要把失败目录当成交付目录，最终只交付明确成功的 run 目录。

## 快速命令模板

```bash
npm run video:generate -- --script "视频脚本原稿/xxx.md" --prepare-script --output "video-runs/xxx-script"

npm run video:generate -- --script "video-runs/xxx-script/scripts/executable.md" --dry-run --storage-state "video-runs/auth/intelligenttest-storage-state.json" --output "video-runs/xxx-preflight"

npm run video:generate -- --script "video-runs/xxx-script/scripts/executable.md" --storage-state "video-runs/auth/intelligenttest-storage-state.json" --output "video-runs/xxx-final"
```

## 本次订单录入的可复用结论

- 直达订单录入页比首页菜单演示稳定得多。
- Element UI remote select 必须等待 readonly 解除和下拉关闭。
- 下拉容器要跳过隐藏容器和空 popper。
- 结束页如果回到列表页，不要等待“详情”类文案。
- 正式录制失败时，先比较失败截图和 dry-run 截图，判断是不是录制上下文差异。
