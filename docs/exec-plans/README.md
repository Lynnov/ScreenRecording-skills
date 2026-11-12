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
### 技术债务
| 文件 | 主题 | 状态 |
|------|------|------|
| [tech-debt-tracker.md](./tech-debt-tracker.md) | 已复现的可靠性问题：重生成保留旧成片、人工 finalize 配置加载一致性 | 两项已修复并验证 |

### Active
| 文件 | 主题 | 状态 |
|------|------|------|
| active/chat-latency-remediation.md | 聊天链路提速 + 模式入口收敛 + MCP 持久开关 | Phase 0 完成，Phase 1-4 待开始 |
| active/context-storage-migration.md | 上下文共享与存储迁移 | Phase 0 部分完成，Phase 1-3 待开始 |
| active/site-and-docs.md | 官网 + 文档站（apps/site） | Phase 0-1 进行中 |
| active/weixin-bridge-channel.md | 微信 Bridge 通道一次性交付方案 | One Shot 待开始 |
| active/unified-context-layer.md | 统一上下文层 + 浮窗助理 + 产品架构演进 | Phase 1-3 已完成，Phase 4-5 待开始 |
| active/provider-governance.md | 服务商系统治理：Preset Schema 校验、宿主接管、连通性验证、引导 UX、错误治理 | Phase 0 完成，Phase 1-6 待开始 |
| active/decouple-claude-code.md | 脱离 Claude Code 依赖 — 自建 Agent Runtime（Provider/Loop/Tools/MCP/Permission/Session/Skills/SubAgent） | Phase 0 完成，Phase 1-8 待开始 |
| active/runtime-auto-and-onboarding.md | Runtime auto 简化（CLI binary check 代替凭据推断）+ Chat 入口拦截 + 错误归一翻译（复用现有 SetupCenter）+ FileTree hotfix + 百炼 catalog 替换 | Phase 0-4 已完成（commits bc308e9/2d06f50/d1fac18/3e03919/a32837e），Phase 5 待发版 |
| active/issue-tracker.md | **统一问题跟踪** — 合并所有 Bug / Feature Request / Sentry 监控，持续更新（替代 open-issues + v0.48-post-release） | 持续维护 |
| active/opus-4-7-upgrade.md | Opus 4.7 模型升级：双 SDK 升级（agent-sdk + ai-sdk/anthropic）、`xhigh` effort + catalog 能力元数据回填、Native 路径 thinking/display/beta header 清理、tokenizer + vision 预算复核、prompt 字面化回归 | Phase 0 部分完成，Phase 1-6 待开始 |
| active/continuous-video-recording.md | 连续操作视频录制：1920×1080 全脚本连续录制、selector 滚动等待、字幕规范化、Pacdora 可见路径 | 最终验证完成，待提交/归档 |
| active/video-generator-recording-reliability.md | 视频生成器真实业务录制可靠性：preflight dry-run、脚本三稿、新动作语法、报告脱敏、产物目录基础规范化 | P0 已完成，Phase 4-5 待开始 |
| active/video-generator-stage-diagnostics.md | 视频生成器录制可靠性二期：Stage 别名与失败诊断包 | Phase 0 完成，Phase 1-5 待开始 |
| active/agent-sdk-0-2-111-adoption.md | Agent SDK 0.2.111 能力采纳（Codex 审核后双层化 + 用户视角推进路线图）：Layer A 已完成 Phase 1 chip + Phase 2b 类型适配 / 待做 Phase 1b chip 按钮 + Phase 2 限流 UI；Layer B 待 POC 后推进 WarmQuery / session fork / getContextUsage / 新 hooks / Elicitation / Deferred tools | SDK 升级已完成，下一步阶段 1（chip 按钮 + 限流 UI）1-2 周可发版 |
| active/v0.48-post-release-issues.md | v0.48.0/0.48.1 发版后问题追查（已归档至 issue-tracker.md，保留原始记录） | 已归档 |
### Completed
| 文件 | 主题 | 完成日期 |
|------|------|----------|
| completed/manual-finalize-failure-safety.md | 人工生成失败保护、项目 .env 加载及回归验证 | 2026-11-12 |
| completed/manual-recording-balanced-fine-editing.md | 人工录制 TTS 后平衡精剪：重复输入收口、误操作等待 5 倍、空白删除、质量警告和受控自进化 | 2026-08-03 |
| completed/manual-recording-agent-editing-productization.md | 人工录制与 Agent 辅助剪辑完整产品链路 | 2026-07-29 |
| completed/manual-recording-product-capture-runtime-remediation.md | 人工录制正式 Capture Runtime 回补：Electron capture session、overlay/controller bridge、record/pickup 默认产品路径 | 2026-07-29 |
| completed/manual-recording-infrastructure-pocs.md | 人工录制 + Agent 辅助剪辑第一阶段：Windows 窗口捕获、统一时钟、页面事件/虚拟鼠标、多源 preview 四个基础 POC | 2026-07-28 |
| completed/manual-recording-poc-acceptance-remediation.md | 人工录制 POC 实机验收修复：Windows 真无边框、报告门槛、漂移拆分、marker 画面证据及 6/6 DPI 矩阵 | 2026-07-28 |
| completed/scripted-browser-video-generator.md | 脚本驱动浏览器教程视频生成器：自然语言脚本 → Playwright 浏览器录制 → 阿里云 TTS → 字幕 → ffmpeg 合成 | 2026-05-21 |
