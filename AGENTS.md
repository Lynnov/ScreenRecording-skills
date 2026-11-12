# AGENTS.md

脚本驱动网页教程视频生成器 — 项目统一协作规则，适用于 Codex、Claude Code 及其他 coding agent。

> 架构细节见 [ARCHITECTURE.md](./ARCHITECTURE.md)，本文件只包含规则和流程。

## 规则维护与沟通

- 项目协作规则统一维护在本文件；根目录及 `docs/` 下的 `CLAUDE.md` 仅保留兼容指引，不再分别维护同一套规则。
- 与用户沟通时称呼用户为“小花”。

## 项目定位

本项目是以本地 CLI 为主的网页教程视频工具，基于 TypeScript、Playwright、阿里云 TTS 和 ffmpeg，输出旁白、字幕与 `final.mp4`。

- 自动模式：Markdown 脚本驱动浏览器打开页面、点击、填写、选择、等待并录制。
- 人工模式：操作指引、人工录制、Agent 辅助剪辑、预览审核、补录、旁白和最终合成；已有 Electron 录制浮层与审核窗口。
- 自动模式入口：`src/cli/video-generator.ts`；人工模式入口：`src/cli/manual-*.ts`。
- 核心流水线：`src/lib/video-generator/`。
- 示例脚本：`examples/video-generator/`、`examples/manual-recording/`。
- 默认输出目录：`video-runs/`。

## 开发规则

**提交前必须详尽测试：**
- 每次提交代码前，必须在开发环境中充分测试所有改动的功能，确认无回归
- 修改代码后至少运行 `npm run test`，确认 TypeScript 类型检查和单元测试通过
- 涉及真实视频生成、TTS、ffmpeg 或 Playwright 录制路径时，优先用内置 demo 脚本做一次端到端验证
- 涉及阿里云 TTS 的真实验证需要确认本机有 `DASHSCOPE_API_KEY`，没有凭据时只能验证失败报告和单元测试
- 涉及 ffmpeg/ffprobe 的改动，需要确认本机命令可用或明确记录无法验证的原因
- 涉及跨平台路径、shell 参数、ffmpeg filtergraph 时，要考虑 Windows 路径和空格转义

**浏览器录制改动必须做真实路径验证：**
- 修改 Playwright 动作、录制时序、storage state、候选匹配或页面快照后，必须至少运行相关单测
- 影响生成视频效果时，使用 `examples/video-generator/basic-demo.md` 或 `semantic-demo.md` 做端到端验证
- 对不确定的网页交互模式，先用本地 HTML fixture 或内置 demo 做 POC，不要直接在真实业务网页上试错
- 语义动作失败报告需要包含失败 segment、失败动作、候选元素或截图路径，不能只返回模糊错误

**新增功能前必须详尽调研：**
- 涉及 Playwright API、浏览器录制、storage state、locator 策略时，先确认当前 Playwright 版本支持情况
- 涉及 ffmpeg 参数、字幕滤镜、音频合并时，先用最小命令或单元测试验证参数
- 涉及 TTS provider 时，避免把凭据写入脚本、报告或测试快照
- 涉及脚本语法扩展时，先确认 parser、types、timeline-validator、examples 和相关单测是否需要同步

**Worktree 隔离规则：**
- 如果任务设置了 Worktree，所有代码改动只能在该 Worktree 内进行
- 严格禁止跨 Worktree 提交（不得在主目录提交 Worktree 的改动，反之亦然）
- 严格禁止 `git push`，除非用户主动提出
- 启动测试或生成命令只从当前 Worktree 启动，不得跨目录运行
- 合并回主分支必须由用户主动发起，不得自动合并
- **输出隔离**：Worktree 内生成视频时使用当前 Worktree 下的 `video-runs/` 或显式 `--output`，避免覆盖主目录产物
- **禁止跨目录编辑**：属于 Worktree 任务范围的文件，只在该 Worktree 内编辑，不得在主目录修改
- **合并前检查 untracked 文件**：合并回主分支前先 `git status` 确认无调试残留、临时视频、音频、截图或报告产物

**Commit 信息规范：**
- 标题行使用 conventional commits 格式（feat/fix/refactor/test/docs/chore 等）
- body 中按文件或功能分组，说明改了什么、为什么改、影响范围
- 修复 bug 需说明根因；架构决策需简要说明理由

## 自检命令

**自检命令（提交前至少执行 `npm run test`）：**
- `npm run typecheck` — TypeScript 类型检查
- `npm run test:unit` — 运行所有单元测试
- `npm run test` — typecheck + 单元测试
- `npm run test:video-poc` — Playwright 视频录制 POC 测试
- `npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo` — 基础内置 demo 端到端生成
- `npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo` — 语义动作 demo 端到端生成
- `npm run video:tts-smoke -- "你好，这是一次语音合成测试"` — 真实 TTS smoke，需要 `DASHSCOPE_API_KEY`

修改代码后，commit 前至少确保 `npm run test` 通过。
涉及真实浏览器录制、ffmpeg 合成或脚本语法时，额外运行对应 demo 或单项测试。

## 改动自查

完成代码修改后，在提交前确认：
1. 改动是否涉及脚本语法 — 是否需要更新 `examples/video-generator/README.md` 和示例脚本
2. 改动是否涉及动作类型 — 是否需要更新 `src/lib/video-generator/types.ts`、`timeline-validator.ts` 和相关单测
3. 改动是否涉及浏览器动作 — 是否需要补 `tests/video-generator/browser-actions.unit.test.ts`、`browser-recorder.unit.test.ts` 或语义匹配相关测试
4. 改动是否涉及失败报告 — 是否需要同步 `RunReport`、`report.ts`、`pipeline.ts` 和报告测试
5. 改动是否涉及输出素材结构 — 是否需要更新 `docs/handover/` 和 `examples/video-generator/README.md`
6. 改动是否构成新功能或大迭代 — 是否需要写或更新执行计划、交接文档、产品思考文档

## 发版

**当前项目是本地 CLI 工具，不走桌面应用打包发版流程。** 对外给人试用时，优先提供源码或压缩包、快速开始说明、`.env.example` 或环境变量说明、示例脚本和必要依赖清单。

**发版纪律：** 禁止自动发布 npm 包、自动推送远程仓库、自动创建 GitHub Release 或自动打 tag。`git push`、`git tag`、npm 发布必须等用户明确指示后才执行。

**Release Notes 格式：** 标题 `scripted-browser-video-generator v{版本号}`，正文包含：更新内容、Breaking Changes、Requirements、Examples、Known Limitations、Changelog。

**运行依赖：** Node.js、Playwright Chromium、ffmpeg/ffprobe、DashScope API Key。涉及真实 TTS 或视频合成的验证，需要明确这些依赖是否可用。

## 执行计划

**中大型功能（跨 3+ 模块、涉及输出格式变更、需分阶段交付）必须先写执行计划再开工。**
- 活跃计划放 `docs/exec-plans/active/`，完成后移至 `completed/`
- 纯调研和 POC 记录放 `docs/research/`
- 发现技术债务时记录到 `docs/exec-plans/tech-debt-tracker.md`
- 模板和规范见 `docs/exec-plans/README.md`

## 文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 项目架构、目录结构、数据流、关键模块
- `examples/video-generator/` — 用户可复制的脚本示例
- `docs/research/` — 技术调研、POC、复盘
- `docs/exec-plans/` — 执行计划和阶段进度
- `docs/handover/` — 技术交接文档
- `docs/insights/` — 产品思考文档
- `docs/future/` — 暂未排期的方向和想法

**检索前先读对应目录的 README.md；增删文件后更新索引。**

### 新功能与大迭代的文档要求

完成新功能或大迭代时，必须同步提供以下两份文档：

1. **技术交接文档**：放在 `docs/handover/`，面向接手的开发者。说明目录结构、数据流、核心类型、脚本语法、录制流程、输出素材和关键设计决策；涉及 Playwright、TTS、ffmpeg 或候选匹配策略时，列出能力边界和失败模式。
2. **产品思考文档**：放在 `docs/insights/`，面向产品决策者。说明解决的用户问题、方案取舍、脚本使用体验、失败可诊断性、适用场景和已知局限。

两份文档使用相同文件名，并在开头互相链接：交接文档链接 `../insights/<同名文件>.md`，产品文档链接 `../handover/<同名文件>.md`。同时更新各自目录的 README 索引。

## 人工录制产品验证

- 自动回归：`npm run test:manual-product`
- 分阶段验证：`npm run verify:manual -- --run <run> --stage <guide|capture|preview|review|pickup|final>`
- 无人值守 E2E 使用 stub Agent、注入式 capture/TTS 和真实 ffmpeg；不得冒充人工桌面 record/pickup 验收。
- 真实桌面录制仍需在交互式 Windows 会话中单独执行。

## 人工录制精剪与媒体清洗规则

- `edit-plan.effective.current.json` 是人工审核后的内容边界；真实 TTS 生成后再生成独立的 `edit-plan.fine.vNN.json`，不得覆盖 effective plan。
- 媒体清洗优先级：坏帧/不可解码区间 > 高置信度白屏和无意义加载 > 页面生命周期 `navigation` > 普通节奏优化。
- 高置信度白屏优先删除；如果候选区间包含真实点击、输入或保存，则保留操作并输出 `AMBIGUOUS_BLANK_REGION` warning，不能静默删除。
- 重复输入只保留同一输入目标的最后一次有效尝试；普通等待最多 2 倍速，经过证据确认的 1～3 秒误操作等待才允许 5 倍速。
- final 可以 `ok=true + quality.status=warning`，但必须满足必需事件覆盖率 100%、`cleanupErrors=[]`、媒体可播放且 final-stage verifier 通过。
- 当前媒体清洗已在 finalize 精剪阶段生效；后续应复用到 Agent 粗剪/preview 阶段，让人工审核先看到清洗后的素材。
