# CLAUDE.md

脚本驱动网页教程视频生成器 — 基于 TypeScript + Playwright + 阿里云 TTS + ffmpeg 的本地 CLI 工具。

> 架构细节见 [ARCHITECTURE.md](./ARCHITECTURE.md)，本文件只包含协作规则和项目流程。

## 项目定位

本项目将 Markdown 脚本转换为网页演示视频：脚本描述“打开页面、点击按钮、填写字段、选择选项、等待结果”等操作，系统自动执行浏览器动作、生成旁白音频和字幕，最后输出 `final.mp4`。

当前重点是 CLI 核心能力，不是桌面 UI：

- CLI 入口：`src/cli/video-generator.ts`
- 核心流水线：`src/lib/video-generator/`
- 示例脚本：`examples/video-generator/`
- 输出目录：默认 `video-runs/`

## 开发规则

**提交前必须详尽测试：**

- 修改代码后至少运行 `npm run test`，确认 typecheck 和单元测试通过。
- 涉及真实视频生成、TTS、ffmpeg 或 Playwright 录制路径时，优先用内置 demo 脚本做一次端到端验证。
- 涉及阿里云 TTS 的真实验证需要确认本机有 `DASHSCOPE_API_KEY`，没有凭据时只能验证失败报告和单元测试。
- 涉及 ffmpeg/ffprobe 的改动，需要确认本机命令可用或明确记录无法验证的原因。
- 涉及跨平台路径、shell 参数、ffmpeg filtergraph 时，要考虑 Windows 路径和空格转义。

**新增功能前必须详尽调研：**

- 涉及 Playwright API、浏览器录制、storage state、locator 策略时，先确认当前 Playwright 版本支持情况。
- 涉及 ffmpeg 参数、字幕滤镜、音频合并时，先用最小命令或单元测试验证参数。
- 涉及 TTS provider 时，避免把凭据写入脚本、报告或测试快照。
- 对不确定的网页交互模式，先用本地 HTML fixture 或内置 demo 做 POC，不要直接在真实业务网页上试错。

**Worktree 隔离规则：**

- 如果任务设置了 Worktree，所有代码改动只能在该 Worktree 内进行。
- 严格禁止跨 Worktree 提交，不得在主目录提交 Worktree 的改动，反之亦然。
- 严格禁止 `git push`，除非用户主动提出。
- 启动测试或生成命令只从当前 Worktree 启动，不得跨目录运行。
- 合并回主分支必须由用户主动发起，不得自动合并。
- 合并前先 `git status` 确认无调试残留、临时文件或生成产物。

**Commit 信息规范：**

- 标题行使用 conventional commits 格式，例如 `feat:`、`fix:`、`test:`、`docs:`、`chore:`。
- body 按功能或文件分组说明改了什么、为什么改、影响范围。
- 修复 bug 需说明根因；架构决策需简要说明理由。

## 自检命令

- `npm run typecheck` — TypeScript 类型检查。
- `npm run test:unit` — 运行所有单元测试。
- `npm run test` — typecheck + 单元测试。
- `npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo` — 用基础内置 demo 生成视频。
- `npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo` — 用语义动作 demo 生成视频。
- `npm run video:tts-smoke -- "你好，这是一次语音合成测试"` — 真实 TTS smoke，需要 `DASHSCOPE_API_KEY`。

## 改动自查

完成代码修改后，在提交前确认：

1. 改动是否涉及脚本语法 — 是否需要更新 `examples/video-generator/README.md` 和示例脚本。
2. 改动是否涉及动作类型 — 是否需要更新 `src/lib/video-generator/types.ts`、`timeline-validator.ts` 和相关单测。
3. 改动是否涉及浏览器动作 — 是否需要补 `tests/video-generator/browser-actions.unit.test.ts` 或 `browser-recorder.unit.test.ts`。
4. 改动是否涉及失败报告 — 是否需要同步 `RunReport`、`report.ts`、`pipeline.ts` 和报告测试。
5. 改动是否涉及输出素材结构 — 是否需要更新 `docs/handover/` 和 `examples/video-generator/README.md`。
6. 改动是否构成新功能或大迭代 — 是否需要写或更新执行计划、交接文档、产品思考文档。

## 功能文档

**新功能或大迭代完成后必须同时输出两份文档：**

1. **技术交接文档** — 放 `docs/handover/`
   - 目录结构、数据流、核心类型、脚本语法、录制流程、输出素材、关键设计决策。
   - 涉及 Playwright、TTS、ffmpeg 或候选匹配策略时，需列出边界和失败模式。
   - 目标读者：接手的开发者，需要能仅靠文档理解模块全貌。
2. **产品思考文档** — 放 `docs/insights/`
   - 功能解决了什么用户问题、为什么这样设计而不是其他方案。
   - 用户脚本体验、失败可诊断性、适用场景和已知局限。
   - 目标读者：产品决策者，需要能理解设计背后的“为什么”。

**两份文档必须互相反向链接：**

- 交接文档开头：`> 产品思考见 [docs/insights/xxx.md](../insights/xxx.md)`
- 产品文档开头：`> 技术实现见 [docs/handover/xxx.md](../handover/xxx.md)`

**文件命名保持一致**，方便对照查找。

## 发版与对外分发

当前项目是本地 CLI 工具，不走桌面应用安装包或自动发布流程。对外给人试用时，优先提供：

1. 项目源码或压缩包。
2. `README` / 快速开始说明。
3. `.env.example` 或环境变量说明。
4. `examples/video-generator/basic-demo.md` 和 `semantic-demo.md`。
5. 必要依赖：Node.js、Playwright Chromium、ffmpeg/ffprobe、DashScope API Key。

禁止自动发布 npm 包、自动推送远程仓库或自动创建 Release，除非用户明确要求。

## 执行计划

**中大型功能（跨 3+ 模块、涉及输出格式变更、需分阶段交付）必须先写执行计划再开工。**

- 活跃计划放 `docs/exec-plans/active/`，完成后移至 `completed/`。
- 纯调研和 POC 记录放 `docs/research/`。
- 发现技术债务时记录到 `docs/exec-plans/tech-debt-tracker.md`。
- 模板和规范见 `docs/exec-plans/README.md`。

## 文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 项目架构、目录结构、数据流、关键模块。
- `examples/video-generator/` — 用户可复制的脚本示例。
- `docs/research/` — 技术调研、POC、复盘。
- `docs/exec-plans/` — 执行计划和阶段进度。
- `docs/handover/` — 技术交接文档。
- `docs/insights/` — 产品思考文档。
- `docs/future/` — 暂未排期的方向和想法。

**检索前先读对应目录的 README.md；增删文件后更新索引。**

## 人工录制产品路径

人工录制完成后，Agent effective plan 仍是审核边界；真实 TTS 之后生成 fine plan 并 finalize。精剪优先删除坏帧、高置信度白屏和无意义加载，`navigation` 不能保护整段白屏；包含真实用户操作的白屏候选则保留并告警。重复输入只保留最后一次有效输入，warning final 仍必须满足媒体可播放、必需事件覆盖率 100% 和 `cleanupErrors=[]`。

当前实现先在 finalize 阶段执行媒体清洗，后续将同一清洗层前移到粗剪/preview，使人工审核面对的是已清洗素材。相关规则和验收记录见 `docs/research/manual-recording-balanced-fine-editing-design.md`。
