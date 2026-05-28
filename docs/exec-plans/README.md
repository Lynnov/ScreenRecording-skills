# Exec Plans / 执行计划

中大型功能的执行计划，包含分阶段目标、进度状态和决策日志。

**AI 须知：**
- 新建执行计划放在 `active/`，完成后移至 `completed/`
- 纯调研/可行性分析仍放 `docs/research/`
- 修改或新增文件后更新下方索引
- 检索本目录前先读此文件

## 什么时候需要执行计划

- 跨 3 个以上模块的功能
- 涉及脚本语法、动作类型、输出素材结构或报告格式变更
- 涉及 Playwright 录制、TTS provider、ffmpeg 合成链路的中大型改造
- 需要分阶段交付的中大型功能
- 重构或迁移类任务

## 执行计划模板

```markdown
# {功能名称}

> 创建时间：YYYY-MM-DD
> 最后更新：YYYY-MM-DD

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | ... | 待开始 / 进行中 / 已完成 / 暂缓 | |

## 决策日志

- YYYY-MM-DD: 决策内容及原因

## 详细设计

（目标、技术方案、拆分步骤、依赖项、验收标准）
```

## 索引

### Active

| 文件 | 主题 | 状态 |
|------|------|------|
| active/continuous-video-recording.md | 连续操作视频录制：1920×1080 全脚本连续录制、selector 滚动等待、storage state、字幕规范化、Pacdora 可见路径 | 最终验证完成，待提交/归档 |
| active/semi-automatic-web-demo-recorder.md | 半自动网页演示录制器：页面快照、候选匹配、常见 Web 交互规则、语义脚本动作、候选失败报告 | 实现完成，待归档 |
| active/video-generator-recording-reliability.md | 真实业务录制可靠性改造：preflight dry-run、脚本三稿机制、复杂动作语法、半自动时间轴、产物目录规范化 | 待开始 |

### Completed

| 文件 | 主题 | 完成日期 |
|------|------|----------|
| completed/scripted-browser-video-generator.md | 脚本驱动浏览器教程视频生成器：自然语言脚本 → Playwright 浏览器录制 → 阿里云 TTS → 字幕 → ffmpeg 合成 | 2026-05-21 |
