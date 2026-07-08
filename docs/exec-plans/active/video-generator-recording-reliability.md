# 视频生成器真实业务录制可靠性改造

> 创建时间：2026-05-28  
> 最后更新：2026-05-28  
> 状态：P0 已完成，Phase 4-5 待开始

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在继续录制原纸贸易订单录入视频之前，补齐录制前验证、脚本保护、复杂网页动作、半自动时间轴和产物目录能力，避免再次覆盖原始脚本、改动业务测试数据或生成音画不同步的成片。

**Architecture:** 先把“录制前能否执行”从完整视频生成 pipeline 中拆出来，形成不生成 TTS/视频的 preflight dry-run；再把脚本处理拆成原始稿、润色稿、可执行稿，确保用户原文和业务数据可追溯；随后扩展动作模型与 Playwright 执行层，支持 hover、remote select、选择第一个、上传文件；最后让自动与 custom handler 录制都走同一 segment timeline，并统一输出目录结构。所有阶段都以本地 HTML fixture、单元测试和内置 demo 先验证，不直接在真实业务网页上试错。

**Tech Stack:** TypeScript、Node.js test runner、Playwright 1.58、现有 video-generator CLI、TTS/ffmpeg pipeline。

---

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 边界确认与当前能力盘点 | 已完成 | 已确认 pipeline、preflight 复用边界和 Playwright API 支持 |
| Phase 1 | 录制前 preflight dry-run | 已完成 | 已支持脚本解析、登录态、上传文件、浏览器动作、截图和候选报告；不生成 TTS/视频 |
| Phase 2 | 脚本三稿机制 | 已完成 | 已支持 original/polished/executable 三稿和 manifest，原始稿冲突会失败 |
| Phase 3 | 新动作语法与执行规则 | 已完成 | 已支持 hover、remote select、选择第一个、上传文件和 cursor overlay |
| Phase 4 | 半自动/custom handler 保留 segment 时间轴 | 待开始 | P0 未实现，留待下一阶段 |
| Phase 5 | 产物目录规范化 | 部分完成 | 已统一基础 run 目录和 reports；debug attempt 与完整素材迁移留待下一阶段 |
| Phase 6 | 文档、示例和端到端验证 | 进行中 | 已更新示例 README、交接文档、产品思考文档，等待最终验证 |

## 决策日志

- 2026-05-28: 先做 preflight dry-run，再继续真实业务录制。原因是昨天失败的根因不是单一 selector，而是录制前缺少登录态、控件数据、上传文件和动作语法的统一验证。
- 2026-05-28: 原始脚本必须只读保存，润色稿和可执行稿必须复制生成。原因是昨天覆盖原始脚本、过度润色旁白、改动“测试”客户数据导致复盘失真。
- 2026-05-28: 复杂页面先用本地 HTML fixture 做 POC 和单测，再应用到真实业务网页。原因是项目规则要求不确定交互模式不能直接在真实业务网页上试错。
- 2026-05-28: 半自动录制必须复用 segment timeline，不允许再用固定 waitForTimeout 拼接短视频后压缩音频。原因是成片时长应由实际旁白、动作耗时和 segment buffer 自然计算。
- 2026-05-28: P0 先交付 preflight、三稿和复杂动作语法，Phase 4 custom handler 与剩余目录规范化留到下一阶段。原因是当前最紧急风险是录制前验证、原始脚本保护和动作可执行性。
- 2026-05-28: 失败报告必须脱敏输入值、远程选择关键字和上传文件路径。原因是真实业务录制可能包含客户名、合同文件名、本地用户目录或密码/token。

---

## 文件结构

### 计划内主要修改文件

- Modify: `src/cli/video-generator.ts` — 增加 `--dry-run` / `--prepare-script` 等 CLI 参数入口，输出清晰的 preflight 结果和脚本副本路径。
- Modify: `src/lib/video-generator/types.ts` — 增加 dry-run report、script draft manifest、新动作类型、上传文件动作、custom handler 标记和规范化产物 assets 字段。
- Modify: `src/lib/video-generator/script-parser.ts` — 解析 `悬停`、`远程选择`、`选择 ... 第一个`、`上传文件`，并允许无旁白操作段在可执行稿中保留时间轴。
- Modify: `src/lib/video-generator/timeline-validator.ts` — 验证新动作参数、上传文件路径、无旁白 segment 的最小时长和 wait target。
- Modify: `src/lib/video-generator/pipeline.ts` — 让完整生成和 dry-run 共享 parse/validate 逻辑，但 dry-run 跳过 TTS、字幕、音频合并和 ffmpeg。
- Modify: `src/lib/video-generator/report.ts` — 写入 `preflight-report.json`、`script-manifest.json` 和规范化报告路径。
- Modify: `src/lib/video-generator/browser/actions.ts` — 执行 hover、remote select、first option select、file upload，并保持 cursor overlay 行为一致。
- Modify: `src/lib/video-generator/browser/interaction-rules.ts` — 封装 Element UI remote select、dropdown 第一项、上传控件等可复用交互规则。
- Modify: `src/lib/video-generator/browser/recorder.ts` — 支持 dry-run 模式、custom handler 模式和 segment 时间轴记录，不生成视频时仍验证动作结果。
- Modify: `src/lib/video-generator/config.ts` — 增加 dry-run、script draft、artifact layout 所需配置默认值。
- Modify: `src/lib/video-generator/ffmpeg.ts` — 在规范化产物结构后读取新的 clip/audio/subtitle 路径；不改变合成策略本身。
- Create: `src/lib/video-generator/script-drafts.ts` — 负责原始稿、润色稿、可执行稿的复制、命名、manifest 和只读保护策略。
- Create: `src/lib/video-generator/artifacts.ts` — 负责一次 run 的目录布局、路径分配和 debug attempt 命名。
- Create: `src/lib/video-generator/preflight.ts` — 负责 dry-run 调度、登录态检查、上传文件存在性检查、动作执行验证和报告汇总。
- Create: `src/lib/video-generator/browser/custom-handlers.ts` — 定义 custom handler registry 接口和内置空实现，避免真实业务 handler 混入通用动作层。

### 计划内主要测试文件

- Modify: `tests/video-generator/cli.unit.test.ts` — 覆盖 dry-run、prepare-script 参数解析和错误输出。
- Modify: `tests/video-generator/types.unit.test.ts` — 覆盖新动作、dry-run report、script manifest、artifact layout 类型。
- Modify: `tests/video-generator/script-parser.unit.test.ts` — 覆盖新脚本语法、中文引号、多词字段和无旁白操作段。
- Modify: `tests/video-generator/timeline-validator.unit.test.ts` — 覆盖新动作校验、上传路径校验和无旁白 segment 校验。
- Modify: `tests/video-generator/browser-actions.unit.test.ts` — 用本地 HTML fixture 覆盖 hover、remote select、选择第一项和上传文件。
- Modify: `tests/video-generator/interaction-rules.unit.test.ts` — 覆盖 Element UI remote select 的 readonly 解锁、键盘输入、popper 第一项选择。
- Modify: `tests/video-generator/browser-recorder.unit.test.ts` — 覆盖 dry-run 不生成 video、custom handler 后仍记录 segment 时间轴。
- Modify: `tests/video-generator/pipeline.unit.test.ts` — 覆盖完整生成与 dry-run 的依赖分流。
- Modify: `tests/video-generator/report.unit.test.ts` — 覆盖 preflight report、candidate report 和 artifact 路径写入。
- Create: `tests/video-generator/script-drafts.unit.test.ts` — 覆盖三稿复制、manifest、禁止覆盖原始脚本。
- Create: `tests/video-generator/artifacts.unit.test.ts` — 覆盖规范化目录结构和 debug attempt 编号。
- Create: `tests/video-generator/preflight.unit.test.ts` — 覆盖登录态路径、上传文件路径、下拉数据验证失败报告。

### 计划内文档文件

- Modify: `examples/video-generator/README.md` — 增加三稿机制、dry-run 命令和新动作语法说明。
- Create: `docs/handover/video-generator-recording-reliability.md` — 技术交接文档，解释目录结构、数据流、核心类型、失败模式。
- Create: `docs/insights/video-generator-recording-reliability.md` — 产品思考文档，解释为什么先 preflight、为什么保留三稿、为什么允许半自动。
- Modify: `docs/handover/README.md` — 增加交接文档索引。
- Modify: `docs/insights/README.md` — 增加产品思考文档索引。

---

## Phase 0：边界确认与当前能力盘点

### Task 0.1：确认当前 parser、timeline、recorder、report 数据流

**Files:**
- Read: `src/lib/video-generator/script-parser.ts`
- Read: `src/lib/video-generator/types.ts`
- Read: `src/lib/video-generator/timeline-validator.ts`
- Read: `src/lib/video-generator/pipeline.ts`
- Read: `src/lib/video-generator/browser/recorder.ts`
- Read: `src/lib/video-generator/report.ts`

- [ ] 确认 `parseVideoScript -> validateTimeline -> synthesizeTimelineAudio -> recordTimelineSegments -> renderSrt -> mergeAudioSegments -> renderFinalVideo -> writeRunReport` 的现有顺序。
- [ ] 标出 dry-run 可以复用的步骤：读取脚本、解析 timeline、验证 timeline、启动浏览器、加载 storage state、执行动作、截图和候选报告。
- [ ] 标出 dry-run 必须跳过的步骤：TTS 合成、音频合并、字幕渲染、ffmpeg final video。
- [ ] 标出半自动录制必须保留的字段：`startsAtMs`、`endsAtMs`、`assets.videoStartMs`、`assets.videoEndMs`、`assets.clipPath`。
- [ ] 输出一段执行备注到本计划的“实施备注”区域，避免后续实现时重复摸索。

**Verification:**
- 不运行测试；这是阅读和标注任务。
- 不修改代码；只允许更新本计划中的实施备注。

### Task 0.2：确认 Playwright API 支持情况

**Files:**
- Read: `package.json`
- Inspect docs if needed: Playwright `locator.hover()`、`locator.setInputFiles()`、`locator.click()`、`keyboard.type()`、`storageState`、`recordVideo`

- [ ] 确认当前 Playwright 版本为 `^1.58.1`。
- [ ] 确认 `locator.hover()` 可用于 hover 菜单。
- [ ] 确认 `locator.setInputFiles()` 可用于文件上传。
- [ ] 确认 keyboard 输入可替代 readonly remote select 的 `fill()`。
- [ ] 确认 dry-run 不启用 `recordVideo` 时不会生成 clip 文件。

**Verification:**
- 用最小本地 HTML fixture 单测验证 hover、remote select 和 upload；不要直接访问真实业务系统。

---

## Phase 1：录制前 preflight dry-run

### Task 1.1：定义 dry-run 类型和报告结构

**Files:**
- Modify: `src/lib/video-generator/types.ts`
- Test: `tests/video-generator/types.unit.test.ts`

- [ ] 新增 `VideoGeneratorMode = 'generate' | 'dryRun'`。
- [ ] 新增 `PreflightCheckStatus = 'passed' | 'failed' | 'skipped'`。
- [ ] 新增 `PreflightCheck`，字段包含 `name`、`status`、`message`、`segmentId?`、`actionIndex?`、`screenshotPath?`、`candidates?`。
- [ ] 新增 `PreflightReport`，字段包含 `ok`、`outputDir`、`scriptPath`、`storageStatePath?`、`checks`、`failedSegmentId?`、`failedAction?`、`preflightReportPath?`。
- [ ] 扩展 `RunReport`，允许完整生成报告引用 `preflightReportPath`。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts`
- Expected: 新类型测试通过，现有类型测试不回退。

### Task 1.2：实现 preflight 目录和报告写入

**Files:**
- Create: `src/lib/video-generator/artifacts.ts`
- Modify: `src/lib/video-generator/report.ts`
- Test: `tests/video-generator/artifacts.unit.test.ts`
- Test: `tests/video-generator/report.unit.test.ts`

- [ ] 定义标准 run 目录：`scripts/`、`auth/`、`clips/`、`audio/`、`screenshots/`、`reports/`、`debug/`。
- [ ] `reports/preflight-report.json` 写入 dry-run 检查结果。
- [ ] `reports/run-report.json` 和 `reports/candidate-report.json` 不再散落在根输出目录。
- [ ] `debug/attempt-001/`、`debug/attempt-002/` 由 `artifacts.ts` 统一分配，避免多个同名输出目录。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/artifacts.unit.test.ts tests/video-generator/report.unit.test.ts`
- Expected: 路径断言通过，Windows 路径和空格路径不被手写 shell 拼接破坏。

### Task 1.3：实现 dry-run 调度入口

**Files:**
- Create: `src/lib/video-generator/preflight.ts`
- Modify: `src/lib/video-generator/pipeline.ts`
- Test: `tests/video-generator/preflight.unit.test.ts`
- Test: `tests/video-generator/pipeline.unit.test.ts`

- [ ] `runPreflight(input)` 读取脚本并生成 timeline。
- [ ] dry-run 先检查 `storageStatePath` 文件是否存在；缺失时报告 `failed`，不启动 TTS 或 ffmpeg。
- [ ] dry-run 检查 `uploadFile` 动作引用的本地文件是否存在；缺失时报告缺少前置资料。
- [ ] dry-run 启动浏览器执行动作，但不启用 `recordVideo`。
- [ ] dry-run 失败时写截图、失败 segment、失败动作、候选元素；成功时写每个 segment/action 的 passed check。
- [ ] 完整生成路径保持现有行为，不受 dry-run 依赖注入影响。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/preflight.unit.test.ts tests/video-generator/pipeline.unit.test.ts`
- Expected: dry-run 不调用 TTS provider、不调用 ffmpeg、不生成 audio/clips/final.mp4。

### Task 1.4：增加 CLI dry-run 参数

**Files:**
- Modify: `src/cli/video-generator.ts`
- Test: `tests/video-generator/cli.unit.test.ts`

- [ ] 增加命令：`npm run video:generate -- --script <script.md> --dry-run [--output <dir>] [--storage-state <file>]`。
- [ ] dry-run 成功时 stdout 输出 `Preflight passed: <preflight-report-path>`。
- [ ] dry-run 失败时 stderr 输出失败 segment、动作和 report 路径，退出码为 `1`。
- [ ] 未传 `--script` 时 usage 包含 dry-run 示例。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/cli.unit.test.ts`
- Expected: CLI 参数解析和输出断言通过。

---

## Phase 2：脚本三稿机制

### Task 2.1：定义 script draft manifest

**Files:**
- Modify: `src/lib/video-generator/types.ts`
- Test: `tests/video-generator/types.unit.test.ts`

- [ ] 新增 `ScriptDraftRole = 'original' | 'polished' | 'executable'`。
- [ ] 新增 `ScriptDraftManifest`，记录三稿路径、来源路径、创建时间、是否允许覆盖、业务数据保护提示。
- [ ] manifest 中记录 `protectedBusinessTerms`，默认包含用户提供的客户名、地址选择策略、上传文件路径等人工确认数据。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts`
- Expected: manifest 类型可序列化且不影响现有 timeline 类型。

### Task 2.2：实现三稿复制工具

**Files:**
- Create: `src/lib/video-generator/script-drafts.ts`
- Test: `tests/video-generator/script-drafts.unit.test.ts`

- [ ] `prepareScriptDrafts({ sourceScriptPath, outputDir })` 创建 `scripts/original.md`、`scripts/polished.md`、`scripts/executable.md`。
- [ ] `original.md` 内容完全等于源脚本内容。
- [ ] `polished.md` 初始内容等于原始稿，只允许后续人工或 agent 在副本上改旁白。
- [ ] `executable.md` 初始内容等于润色稿，只允许后续添加 selector、上传文件路径和特殊动作语法。
- [ ] 如果 `scripts/original.md` 已存在且内容不同，函数失败并提示不要覆盖用户原始脚本。
- [ ] 生成 `scripts/script-manifest.json`，记录三稿路径。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/script-drafts.unit.test.ts`
- Expected: 原始稿永不被覆盖，manifest 路径稳定。

### Task 2.3：增加 prepare-script CLI

**Files:**
- Modify: `src/cli/video-generator.ts`
- Test: `tests/video-generator/cli.unit.test.ts`

- [ ] 增加命令：`npm run video:generate -- --script <script.md> --prepare-script --output <dir>`。
- [ ] 成功时输出三稿路径和 manifest 路径。
- [ ] 已存在冲突原始稿时退出 `1`，提示用户检查 `scripts/original.md`。
- [ ] `--prepare-script` 不执行 parse、TTS、browser 或 ffmpeg。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/cli.unit.test.ts tests/video-generator/script-drafts.unit.test.ts`
- Expected: 准备脚本只复制文件，不改变源脚本。

---

## Phase 3：新动作语法与执行规则

### Task 3.1：扩展动作类型和校验

**Files:**
- Modify: `src/lib/video-generator/types.ts`
- Modify: `src/lib/video-generator/timeline-validator.ts`
- Test: `tests/video-generator/types.unit.test.ts`
- Test: `tests/video-generator/timeline-validator.unit.test.ts`

- [ ] 新增 `{ type: 'hover'; text?: string; selector?: string; waitFor?: WaitTarget }`。
- [ ] 新增 `{ type: 'remoteSelect'; target: field target 或 selector; query: string; option?: string; selectFirst?: boolean; waitFor?: WaitTarget }`。
- [ ] 新增 `{ type: 'selectFirst'; target: field target 或 selector; waitFor?: WaitTarget }`。
- [ ] 新增 `{ type: 'uploadFile'; text?: string; selector?: string; path: string; waitFor?: WaitTarget }`。
- [ ] validator 要求 remote select 必须有 query，`option` 和 `selectFirst` 至少一种选择策略。
- [ ] validator 要求 upload file path 非空，实际存在性留给 preflight 检查。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts tests/video-generator/timeline-validator.unit.test.ts`
- Expected: 新动作校验通过，非法参数失败原因明确。

### Task 3.2：扩展中文脚本语法解析

**Files:**
- Modify: `src/lib/video-generator/script-parser.ts`
- Test: `tests/video-generator/script-parser.unit.test.ts`

- [ ] `悬停 原纸贸易` 解析为 hover text。
- [ ] `悬停选择器 .menu-item` 解析为 hover selector。
- [ ] `远程选择 客户名称 测试 第一个` 解析为 remote select，保留 query 为“测试”，不替换业务数据。
- [ ] `远程选择 客户名称 测试 选择 张三公司` 解析为 remote select 指定 option。
- [ ] `选择 收货地址 第一个` 解析为 select first。
- [ ] `上传文件 合同附件 fixtures/contracts/demo.pdf` 解析为 upload file。
- [ ] 支持中文引号包裹字段名和文件路径，例如 `上传文件 “合同附件” “fixtures/contracts/demo contract.pdf”`。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`
- Expected: 新语法 AST 与输入文本一致，不丢失“测试”等业务数据。

### Task 3.3：实现 hover 和菜单展开

**Files:**
- Modify: `src/lib/video-generator/browser/actions.ts`
- Modify: `src/lib/video-generator/browser/interaction-rules.ts`
- Test: `tests/video-generator/browser-actions.unit.test.ts`

- [ ] hover text 使用 `page.getByText(text, { exact: true })` 定位。
- [ ] hover selector 使用 `page.locator(selector)` 定位。
- [ ] hover 前移动 cursor overlay 到目标元素。
- [ ] hover 后执行 `waitForOptionalTarget`，用于等待二级菜单出现。
- [ ] 本地 fixture 覆盖 `点击 开启工作 -> 悬停 原纸贸易 -> 点击 订单录入`。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts`
- Expected: hover 后二级菜单可见，后续点击成功。

### Task 3.4：实现 Element UI remote select

**Files:**
- Modify: `src/lib/video-generator/browser/interaction-rules.ts`
- Modify: `src/lib/video-generator/browser/actions.ts`
- Test: `tests/video-generator/interaction-rules.unit.test.ts`
- Test: `tests/video-generator/browser-actions.unit.test.ts`

- [ ] 点击字段对应 `.el-select` 或输入框。
- [ ] 等待 readonly 解除；如果真实控件保留 readonly，则改用 keyboard 输入触发框架事件，不调用 locator.fill。
- [ ] 使用 `Control+A` / `Meta+A` 清空已有值。
- [ ] 使用 `keyboard.type(query)` 输入用户原始关键字。
- [ ] 等待 dropdown/popper 中至少一个可见 option。
- [ ] `第一个` 策略点击第一项；指定 option 策略点击文本匹配项。
- [ ] 失败时返回 `UNSUPPORTED_INTERACTION_PATTERN` 或 `NO_TARGET_FOUND`，并保留候选信息。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/interaction-rules.unit.test.ts tests/video-generator/browser-actions.unit.test.ts`
- Expected: readonly remote select fixture 可用“测试”触发并选择第一项。

### Task 3.5：实现选择第一个和上传文件

**Files:**
- Modify: `src/lib/video-generator/browser/interaction-rules.ts`
- Modify: `src/lib/video-generator/browser/actions.ts`
- Test: `tests/video-generator/browser-actions.unit.test.ts`

- [ ] `selectFirst` 支持普通 select、Element UI dropdown 和已展开 popper 的第一项。
- [ ] `uploadFile` 优先按 selector 定位 file input。
- [ ] `uploadFile` 按文本定位时，先找 label/button 附近的 `input[type=file]`。
- [ ] 使用 `setInputFiles(path)` 上传文件。
- [ ] preflight 中缺失文件应在浏览器动作前失败；浏览器执行层只处理存在文件。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts tests/video-generator/preflight.unit.test.ts`
- Expected: 本地 fixture 能选第一个地址、上传测试文件；缺失文件由 preflight 报告阻断。

---

## Phase 4：半自动/custom handler 保留 segment 时间轴

### Task 4.1：定义 custom handler 接口

**Files:**
- Create: `src/lib/video-generator/browser/custom-handlers.ts`
- Modify: `src/lib/video-generator/types.ts`
- Test: `tests/video-generator/types.unit.test.ts`
- Test: `tests/video-generator/browser-recorder.unit.test.ts`

- [ ] 定义 `CustomSegmentHandler`，输入包含 `page`、`segment`、`config`、`cursor`、`outputDir`。
- [ ] handler 返回当前 `page`，允许页面跳转或弹窗处理。
- [ ] 定义 `CustomHandlerRegistry`，按 `segment.id` 或脚本标记匹配 handler。
- [ ] 默认 registry 为空，通用 CLI 不包含真实业务 handler。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/types.unit.test.ts tests/video-generator/browser-recorder.unit.test.ts`
- Expected: 没有 registry 时 recorder 行为保持不变。

### Task 4.2：让 recorder 在 custom handler 后仍记录 timeline

**Files:**
- Modify: `src/lib/video-generator/browser/recorder.ts`
- Test: `tests/video-generator/browser-recorder.unit.test.ts`

- [ ] 每个 segment 开始前计算 `startsAtMs`。
- [ ] custom handler 替代该 segment 的 actions 执行，但不替代 segment 时长计算。
- [ ] handler 执行结束后仍按 `actualAudioDurationMs + bufferMs` 或 `estimatedDurationMs + bufferMs` 等待。
- [ ] 写入 `assets.videoStartMs`、`assets.videoEndMs`、`startsAtMs`、`endsAtMs`。
- [ ] 无旁白 segment 使用 `estimatedDurationMs` 或显式最小停顿，不被压缩为 0ms。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/browser-recorder.unit.test.ts`
- Expected: custom handler 执行后 segment 时间轴连续，视频时长不短于旁白时长。

### Task 4.3：支持分段录制 timeline 拼接

**Files:**
- Modify: `src/lib/video-generator/browser/recorder.ts`
- Modify: `src/lib/video-generator/pipeline.ts`
- Test: `tests/video-generator/browser-recorder.unit.test.ts`
- Test: `tests/video-generator/pipeline.unit.test.ts`

- [ ] 允许一次 run 中多个 recorder section 共享同一 timeline cursor。
- [ ] 每段 clip 的 `continuousClipStartOffsetMs` 或等价字段可用于 ffmpeg 拼接。
- [ ] 多段 timeline 拼接时整体偏移字幕和音频，不重新估算旁白时长。
- [ ] 禁止用 `atempo` 压缩旁白来匹配短视频；如果后续需要兜底，只允许延长画面或冻结帧，另开计划实现。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/browser-recorder.unit.test.ts tests/video-generator/pipeline.unit.test.ts`
- Expected: 两段录制合并后 segment 时间轴单调递增，字幕时间与 audio duration 一致。

---

## Phase 5：产物目录规范化

### Task 5.1：集中管理 run artifacts

**Files:**
- Create: `src/lib/video-generator/artifacts.ts`
- Modify: `src/lib/video-generator/pipeline.ts`
- Modify: `src/lib/video-generator/browser/recorder.ts`
- Modify: `src/lib/video-generator/report.ts`
- Test: `tests/video-generator/artifacts.unit.test.ts`
- Test: `tests/video-generator/pipeline.unit.test.ts`
- Test: `tests/video-generator/report.unit.test.ts`

- [ ] 所有输出从 `createRunArtifacts(outputDir)` 获取路径。
- [ ] `final.mp4` 保持在 run 根目录。
- [ ] `timeline.json`、`subtitles.srt`、`narration.wav` 可继续保留根目录或迁移到标准路径，但必须在 report 中明确记录。
- [ ] clips、audio、screenshots、reports、scripts、auth、debug 均由 artifacts 模块统一创建。
- [ ] 失败重试只进入 `debug/attempt-NNN/`，不再创建多个同名前缀目录。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/artifacts.unit.test.ts tests/video-generator/pipeline.unit.test.ts tests/video-generator/report.unit.test.ts`
- Expected: report 中所有路径都位于同一个 run 目录下。

### Task 5.2：兼容现有 CLI 输出习惯

**Files:**
- Modify: `src/cli/video-generator.ts`
- Modify: `tests/video-generator/cli.unit.test.ts`

- [ ] `--output video-runs/basic-demo` 仍以该目录作为 run 根目录。
- [ ] 成功输出仍提示最终视频路径。
- [ ] dry-run 成功输出 preflight report 路径。
- [ ] prepare-script 成功输出 script manifest 路径。

**Verification:**
- Run: `npm run test:unit -- tests/video-generator/cli.unit.test.ts`
- Expected: 旧命令格式不破坏，新命令格式可发现。

---

## Phase 6：文档、示例和端到端验证

### Task 6.1：更新用户脚本语法文档和示例

**Files:**
- Modify: `examples/video-generator/README.md`
- Create or Modify: `examples/video-generator/semantic-demo.md`（仅在需要展示新动作时追加独立段落）

- [ ] 文档说明 `--prepare-script` 三稿流程。
- [ ] 文档说明 `--dry-run` 在录制前验证登录态、下拉数据和上传文件。
- [ ] 文档列出 `悬停`、`远程选择`、`选择 ... 第一个`、`上传文件` 的语法。
- [ ] 文档强调不要覆盖原始脚本，不要未经确认替换业务测试数据。
- [ ] 示例使用本地 demo/fixture，不包含真实业务凭据或真实客户数据。

**Verification:**
- 人工检查文档示例命令可复制。
- 不写入任何 API Key、storage state 内容或真实业务敏感信息。

### Task 6.2：新增交接文档和产品思考文档

**Files:**
- Create: `docs/handover/video-generator-recording-reliability.md`
- Create: `docs/insights/video-generator-recording-reliability.md`
- Modify: `docs/handover/README.md`
- Modify: `docs/insights/README.md`

- [ ] 交接文档开头链接产品思考文档：`> 产品思考见 [docs/insights/video-generator-recording-reliability.md](../insights/video-generator-recording-reliability.md)`。
- [ ] 产品思考文档开头链接交接文档：`> 技术实现见 [docs/handover/video-generator-recording-reliability.md](../handover/video-generator-recording-reliability.md)`。
- [ ] 交接文档覆盖目录结构、数据流、核心类型、脚本语法、录制流程、输出素材、边界和失败模式。
- [ ] 产品文档覆盖用户问题、设计取舍、脚本体验、失败可诊断性、适用场景和已知局限。
- [ ] 更新两个 README 索引。

**Verification:**
- 人工检查双向链接相对路径正确。
- 文档全部中文。

### Task 6.3：运行分层验证

**Files:**
- No source changes in this task.

- [ ] 运行 `npm run test`，确认 typecheck 和单元测试通过。
- [ ] 运行 `npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo-recording-reliability`，确认基础 demo 仍可生成。
- [ ] 运行 `npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo-recording-reliability`，确认语义 demo 仍可生成。
- [ ] 如涉及真实 TTS，先确认 `DASHSCOPE_API_KEY` 是否存在；没有凭据时只记录无法验证真实 TTS 的原因。
- [ ] 如涉及 ffmpeg/ffprobe，确认命令可用；不可用时记录无法验证合成的原因。

**Verification:**
- `npm run test` 通过。
- 至少一个内置 demo 端到端生成通过；如果环境缺依赖，报告缺失依赖而不是宣称完成。

---

## 优先级与交付切片

### P0：必须先做，完成后才建议继续真实业务录制

1. Phase 1 preflight dry-run。
2. Phase 2 脚本三稿机制。
3. Phase 3 中的 hover、remote select、选择第一个、上传文件。

**P0 验收标准:**
- 可以执行 dry-run，明确告诉用户登录态是否可用、客户下拉是否可触发、收货地址是否可选第一项、合同文件是否存在。
- `examples/video-generator/原纸贸易-订单录入.md` 这类原始脚本不会被覆盖。
- “测试”客户等用户给定业务数据不会被 agent 自动替换。

### P1：解决音画时间轴根因

1. Phase 4 custom handler 保留 segment 时间轴。
2. Phase 5 产物目录规范化。

**P1 验收标准:**
- 即使某些 segment 使用 custom handler，最终 timeline 仍有可信的 `videoStartMs` / `videoEndMs`。
- 不再出现把 98 秒旁白压成 44 秒视频的处理路径。
- 一次 run 的 scripts、auth、clips、audio、screenshots、reports、debug 和 final 产物在同一目录下。

### P2：交付与复盘质量

1. Phase 6 文档、示例和端到端验证。

**P2 验收标准:**
- 交接文档和产品思考文档互相反向链接。
- 示例和 README 能指导代码小白先 dry-run 再录制。
- 失败报告能解释失败 segment、失败动作、候选元素、截图和缺失前置资料。

---

## 风险与约束

- 真实业务网页不可作为第一验证场；所有不确定交互先用本地 HTML fixture 或内置 demo 验证。
- 不允许把 `DASHSCOPE_API_KEY`、storage state 内容、真实合同文件内容写入报告、文档或测试快照。
- 不允许未经用户确认替换“测试”客户、收货地址选择策略或其他业务测试数据。
- 不允许直接覆盖用户原始脚本；源脚本只能作为输入读取。
- 不允许用压缩旁白速度来弥补视频短于音频的问题。
- 不允许自动 `git push`、发布 npm 包、创建 release 或 tag。

## 实施备注

- 当前 active 计划 `continuous-video-recording.md` 和 `semi-automatic-web-demo-recorder.md` 已显示实现完成待归档；本计划应作为后续真实业务录制可靠性改造的主计划。
- 昨天错误成片 `video-runs/原纸贸易-订单录入-final/final.mp4` 只能作为问题样例，不应作为正式交付。
- 后续重新录制原纸贸易订单录入时，应先运行 prepare-script，再人工确认润色稿和可执行稿，再运行 dry-run，最后才运行完整 generate。
- P0 已完成：`--prepare-script`、`--dry-run`、hover、remote select、选择第一个、上传文件和报告脱敏均已实现并通过单元测试。
- P0 未完成：custom handler 保留 segment 时间轴仍属 Phase 4；debug attempt 完整规范化和最终素材迁移仍属 Phase 5。
