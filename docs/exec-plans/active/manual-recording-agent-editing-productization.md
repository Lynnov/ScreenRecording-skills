# 人工录制与 Agent 辅助剪辑产品化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 创建时间：2026-07-28  
> 最后更新：2026-07-28  
> 设计基线：`docs/research/manual-recording-agent-editing-design.md`  
> POC 基线：`ee849df docs: complete manual recording poc acceptance`

**Goal:** 在已通过的窗口捕获、统一时钟、页面事件、虚拟鼠标和多源 preview POC 之上，补齐 Windows 人工录制产品的 guide、录制状态机、Action/attempt 管理、Segment 补录、Agent 结构化剪辑、审核、TTS、字幕和 final 输出闭环。

**Architecture:** 保留现有自动录制 `video:generate` 和 `browser/recorder.ts` 不变，新增独立的 manual application layer。CLI 负责确定性状态机、素材和 schema 校验；Electron 负责窗口捕获与悬浮控制窗；Playwright 只观察页面；Agent 通过可替换 provider 生成结构化 guide/edit-plan/旁白建议；ffmpeg 只执行校验后的计划。所有原始脚本、原始视频、事件日志和 Agent 初始建议不可覆盖，用户审核结果单独落盘。

**Tech Stack:** TypeScript ESM、Node.js >=22.12.0、Electron 43.1.1、Playwright 1.60、node:test + tsx、ffmpeg/ffprobe、DashScope TTS、Windows 10/11。

---

## 已完成基线与明确不重复的工作

- POC 1：Windows 100%/125%/150% × F11/borderless-maximized 6/6 通过；复用 `capture/`、`windows-window-mode.ts`、`normalize-video.ts`。
- POC 2：统一 `sessionTimeMs`/`videoTimeMs`、F7/F9/F10、marker evidence 和 30 分钟漂移通过；不重写时钟。
- POC 3：页面事件、Page/iframe/reload 注入、tab observer、虚拟鼠标通过；不让 observer 执行业务动作。
- POC 4：original/pickup、trim、2×、hold、short-fade、preview 通过；沿用 `editing/`。
- 已有自动流程 `video:generate`、TTS provider、字幕和 ffmpeg pipeline 继续可用；新增 manual 命令必须和它们隔离。
- 本计划不包含 macOS/Linux、独立 popup、整屏录制、系统音频/麦克风、自动登录、自动切换标签页、隐私治理或第一版内置 AI provider。

## 目标产物

每次运行使用唯一的 `video-runs/<run>/`，目录结构扩展为：

```text
scripts/original.md
scripts/polished.md
scripts/executable.md
scripts/recording-guide.json
scripts/recording-guide.vNN.json
capture/original-window.mp4
capture/raw-window.webm
capture/events.jsonl
capture/tabs.json
capture/recording-manifest.json
capture/keyframes/
pickups/<segment-id>-attempt-NNN.mp4
edit/edit-plan.json
edit/edit-plan.agent.json
edit/edit-review.json
edit/edit-report.md
edit/preview-timeline.json
edit/preview.mp4
audio/<segment-id>.wav
subtitles.srt
scripts/narration-final.md
final.mp4
reports/*.json
```

## 分阶段状态

| Phase | 内容 | 状态 | 退出门槛 |
|---|---|---|---|
| Phase 0 | 公共协议、bundle、CLI 参数和保护性写入 | 待开始 | schema/路径/不覆盖测试通过 |
| Phase 1 | Markdown → recording guide 和 guide 审核版本 | 待开始 | fixture 脚本可生成稳定 guide |
| Phase 2 | Action tracker、attempt、F8/Shift+F8/F9/F10 和悬浮窗状态 | 待开始 | 状态机与错误恢复集成测试通过 |
| Phase 3 | `video:record` 人工录制命令接入已通过 POC | 待开始 | 单/多 tab、重试、异常退出产物完整 |
| Phase 4 | 关键帧、Agent provider、edit-plan 和 edit-report | 待开始 | 无效计划 fail closed，离线 stub 可复现 |
| Phase 5 | preview、edit-review、Segment pickup | 待开始 | 单 Segment 补录不影响其他 Segment |
| Phase 6 | narration-final、TTS、SRT、finalize | 待开始 | 无 key 时报告清晰，有 key 时生成 final |
| Phase 7 | 完整端到端、文档、回归和交付 | 待开始 | 设计文档第 21 节端到端验收通过 |

---

## Task 1: 公共 ManualRecordingBundle 与 CLI 基础

**Files:**
- Modify: `src/lib/video-generator/recording/types.ts`
- Modify: `src/lib/video-generator/recording/artifacts.ts`
- Create: `src/lib/video-generator/manual/types.ts`
- Create: `src/lib/video-generator/manual/bundle.ts`
- Create: `src/lib/video-generator/manual/schema.ts`
- Modify: `package.json`
- Test: `tests/video-generator/manual-bundle.unit.test.ts`
- Test: `tests/video-generator/manual-schema.unit.test.ts`

- [ ] **Step 1: 写 bundle 和 schema 失败测试**

测试必须覆盖：唯一输出目录、`scripts/capture/pickups/edit/audio/reports` 路径、原始 Markdown/视频/events/manifest 不可覆盖、同一 `segmentId` 的 attempt 编号从 001 递增、非法 guide/manifest/edit-review 被拒绝。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npx tsx --test tests/video-generator/manual-bundle.unit.test.ts tests/video-generator/manual-schema.unit.test.ts`

Expected: 新模块不存在或导出缺失，测试失败。

- [ ] **Step 3: 实现不可覆盖 bundle 和显式 schema**

定义 `ManualRecordingBundle`、`RecordingGuide`、`GuideSegment`、`GuideAction`、`EditReview` 和 `NarrationDraft`；所有 JSON writer 使用原子临时文件 + rename，保护原始文件拒绝覆盖，版本字段固定为 `1`。

- [ ] **Step 4: 运行测试并接入命令占位**

Run: `npx tsx --test tests/video-generator/manual-bundle.unit.test.ts tests/video-generator/manual-schema.unit.test.ts && npm run typecheck`

Expected: 定向测试和类型检查通过；新增 scripts 只注册入口，不启动 Electron。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/recording/types.ts src/lib/video-generator/recording/artifacts.ts src/lib/video-generator/manual package.json tests/video-generator/manual-bundle.unit.test.ts tests/video-generator/manual-schema.unit.test.ts
git commit -m "feat: add manual recording bundle protocol"
```

## Task 2: Markdown → recording-guide 与版本化审核

**Files:**
- Create: `src/lib/video-generator/manual/guide.ts`
- Create: `src/lib/video-generator/manual/guide-writer.ts`
- Create: `src/cli/manual-recording.ts`
- Modify: `src/lib/video-generator/script-parser.ts`
- Test: `tests/video-generator/manual-guide.unit.test.ts`
- Test: `tests/video-generator/manual-guide-cli.unit.test.ts`
- Create: `examples/manual-recording/basic-form.md`
- Modify: `examples/video-generator/README.md` or add `examples/manual-recording/README.md`

- [ ] **Step 1: 先写 guide 解析失败测试**

用本地 fixture 脚本覆盖：Segment 标题/旁白意图、Action instruction、expected event/result、缺少 Segment id、重复 Action id、空 action 和非法 URL。解析必须保留原始脚本路径，不修改原始 Markdown。

- [ ] **Step 2: 实现确定性 guide 编译器**

`compileRecordingGuide({ sourceScriptPath, outputDir })` 输出 `scripts/original.md`、`polished.md`、`executable.md` 和 `recording-guide.json`；没有 Agent 时只使用明确的 Markdown 结构，不凭空生成业务动作。`--guide` 指定已有 guide 时先 schema 校验再使用。

- [ ] **Step 3: 实现 guide 版本保存**

`saveGuideRevision()` 写入 `recording-guide.vNN.json`，审核后的 guide 另写 `recording-guide.approved.json`，任何版本均不可覆盖原始 Markdown。

- [ ] **Step 4: 添加 CLI 命令和失败报告**

提供：

```bash
npm run video:guide -- --script <script.md> --output <video-runs/run>
npm run video:guide -- --guide <recording-guide.json> --output <video-runs/run>
```

非法脚本退出码为 1，并打印具体 Segment/Action/字段路径。

- [ ] **Step 5: 运行测试、fixture 和提交**

Run: `npx tsx --test tests/video-generator/manual-guide.unit.test.ts tests/video-generator/manual-guide-cli.unit.test.ts && npm run typecheck`

```bash
git add src/lib/video-generator/manual src/cli/manual-recording.ts src/lib/video-generator/script-parser.ts examples/manual-recording examples/video-generator/README.md tests/video-generator/manual-guide*.test.ts package.json
git commit -m "feat: compile manual recording guides"
```

## Task 3: Action tracker、attempt 和人工控制状态机

**Files:**
- Create: `src/lib/video-generator/manual/action-tracker.ts`
- Create: `src/lib/video-generator/manual/state-machine.ts`
- Create: `src/lib/video-generator/manual/attempts.ts`
- Modify: `src/lib/video-generator/browser/manual-observer.ts`
- Modify: `src/lib/video-generator/recording/event-log.ts`
- Modify: `src/lib/video-generator/recording/session.ts`
- Modify: `pocs/manual-recording/capture-preload.cts`
- Modify: `pocs/manual-recording/capture-renderer.ts`
- Modify: `pocs/manual-recording/capture.html`
- Test: `tests/video-generator/manual-action-tracker.unit.test.ts`
- Test: `tests/video-generator/manual-state-machine.unit.test.ts`
- Test: `tests/video-generator/manual-attempts.unit.test.ts`
- Test: `tests/video-generator/manual-control.integration.test.ts`

- [ ] **Step 1: 写状态转换和快捷键失败测试**

固定转换：`preparing → countdown → recording → finishing → analyzing → review-ready`；非法转换拒绝。F7 只允许开始，F8 确认当前 Action，Shift+F8 回退指针但不修改页面，F9 关闭当前 attempt 并创建下一个，F10 必须二次确认后结束。

- [ ] **Step 2: 实现 Action tracker**

tracker 只消费 observer 事件和 guide 期望，不调用 `page.click/fill/goto/bringToFront`。高置信度需要目标事件或目标事件+结果共同匹配；中低置信度保持当前 Action 等待 F8。每次确认写入 `action-confirmed`，回退写入 `action-rewind`。

- [ ] **Step 3: 实现 attempt 记录**

每次 F9 写 `retry-start`、关闭上一次 attempt 为 `discarded`，新 attempt 从当前视频时间开始；F8 将当前 attempt 标为 `confirmed`。录制结束时保留全部 attempt，edit-plan 只能引用 confirmed attempt。

- [ ] **Step 4: 扩展控制窗和快捷键 IPC**

preload 只暴露 typed commands/events；renderer 显示状态、Segment、Action、attempt、置信度和异常，不显示业务敏感值；控制窗不抢 Chromium 焦点，所有退出路径调用同一个 cleanup。

- [ ] **Step 5: 运行单测和 Electron integration fixture**

Run: `npx tsx --test tests/video-generator/manual-action-tracker.unit.test.ts tests/video-generator/manual-state-machine.unit.test.ts tests/video-generator/manual-attempts.unit.test.ts tests/video-generator/manual-control.integration.test.ts`

Expected: 快捷键重复、F10 未二次确认、F9 连续重试、observer 失败继续录像和 cleanup 幂等全部通过。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-generator/manual src/lib/video-generator/browser/manual-observer.ts src/lib/video-generator/recording src/cli/manual-recording.ts pocs/manual-recording tests/video-generator/manual-*test.ts
git commit -m "feat: add manual action tracking and controls"
```

## Task 4: `video:record` 产品命令接入 POC

**Files:**
- Create: `src/lib/video-generator/manual/record.ts`
- Modify: `src/cli/manual-recording.ts`
- Modify: `scripts/run-manual-capture-poc.mjs` or extract reusable runner beside it
- Modify: `src/lib/video-generator/recording/manifest.ts`
- Modify: `src/lib/video-generator/recording/poc-report.ts`
- Test: `tests/video-generator/manual-record-cli.unit.test.ts`
- Test: `tests/video-generator/manual-record.integration.test.ts`

- [ ] **Step 1: 写命令和失败路径测试**

覆盖：缺少 script/guide、输出目录已有 protected artifact、无法解析窗口源、borderless apply/restore 失败、Electron 异常退出、事件监听失败继续落盘、正常结束生成完整 manifest。

- [ ] **Step 2: 抽取 POC runner 为可复用 manual recorder**

复用已通过的 source matching、User32 window mode、MediaRecorder、clock、observer、marker/drift verifier；POC fixture 只作为测试入口，不把业务 fixture 逻辑带入产品 recorder。所有 cleanup 顺序固定为 capture handlers → window restore → observer/context/window cleanup。

- [ ] **Step 3: 暴露产品命令**

```bash
npm run video:record -- --script <script.md> --output video-runs/<run> --display-mode f11
npm run video:record -- --guide <guide.json> --output video-runs/<run> --display-mode borderless-maximized
```

命令启动前编译并校验 guide，成功结束后写 `recording-manifest.json`，失败时保留 raw video/events/ffmpeg stderr，不生成伪成功 MP4。

- [ ] **Step 4: 运行自动测试与一次本地 fixture 实机验证**

Run: `npx tsx --test tests/video-generator/manual-record-cli.unit.test.ts tests/video-generator/manual-record.integration.test.ts && npm run test`

实机验证至少执行一次 100% 或 125% 的短录制；不重复 30 分钟漂移矩阵，使用新 `video-runs/manual-product-record-*` 目录。

- [ ] **Step 5: 提交**

```bash
git add src/cli/manual-recording.ts src/lib/video-generator/manual src/lib/video-generator/recording scripts package.json tests/video-generator/manual-record*.test.ts
git commit -m "feat: add manual recording command"
```

## Task 5: 关键帧索引与 Agent provider 协议

**Files:**
- Create: `src/lib/video-generator/manual/keyframes.ts`
- Create: `src/lib/video-generator/manual/agent-types.ts`
- Create: `src/lib/video-generator/manual/agent-provider.ts`
- Create: `src/lib/video-generator/manual/offline-agent.ts`
- Create: `src/lib/video-generator/manual/edit-report.ts`
- Modify: `src/lib/video-generator/editing/types.ts`
- Modify: `src/lib/video-generator/editing/validator.ts`
- Test: `tests/video-generator/manual-keyframes.unit.test.ts`
- Test: `tests/video-generator/manual-agent-provider.unit.test.ts`
- Test: `tests/video-generator/manual-edit-report.unit.test.ts`

- [ ] **Step 1: 写关键帧和 provider contract 测试**

关键帧覆盖 recording-start/stop、click 前后、input 起止、result、navigation、tab switch、action-confirmed、retry、segment end 和 2–3 秒低频采样。provider 输入只包含脱敏后的 guide、manifest、events、keyframe index；输出必须是结构化 `EditPlan` + reason/confidence，禁止修改原始素材。

- [ ] **Step 2: 实现确定性关键帧索引**

使用 ffmpeg/ffprobe 从 `videoTimeMs` 抽帧，路径写入 `capture/keyframes/index.json`；缺帧、越界或 ffmpeg 失败进入报告并保留 stderr。默认不上传整条视频。

- [ ] **Step 3: 实现 offline provider**

offline provider 根据 confirmed attempt、事件区间和等待规则生成可复现 edit-plan，支持 original/pickup、删除 discarded attempt、最长 2× 等待压缩、最多 5 秒 hold、120ms short-fade；无法确定时输出 `confidence=low` 和审核原因，不静默删除。

- [ ] **Step 4: 强化 edit-plan 校验**

validator 必须拒绝不存在 source/Segment、越界区间、倒置时间、非法 playbackRate、未确认 Segment、超过 5 秒 hold 和超过 2× 的正常操作，并报告具体字段路径。

- [ ] **Step 5: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-keyframes.unit.test.ts tests/video-generator/manual-agent-provider.unit.test.ts tests/video-generator/manual-edit-report.unit.test.ts tests/video-generator/editing-validator.unit.test.ts`

```bash
git add src/lib/video-generator/manual src/lib/video-generator/editing tests/video-generator/manual-keyframes.unit.test.ts tests/video-generator/manual-agent-provider.unit.test.ts tests/video-generator/manual-edit-report.unit.test.ts tests/video-generator/editing-validator.unit.test.ts
git commit -m "feat: add manual keyframes and edit plan provider"
```

## Task 6: preview、审核和 Segment pickup

**Files:**
- Create: `src/lib/video-generator/manual/review.ts`
- Create: `src/lib/video-generator/manual/pickup.ts`
- Create: `src/cli/manual-preview.ts`
- Create: `src/cli/manual-pickup.ts`
- Modify: `src/lib/video-generator/editing/preview.ts`
- Modify: `src/lib/video-generator/recording/artifacts.ts`
- Test: `tests/video-generator/manual-review.unit.test.ts`
- Test: `tests/video-generator/manual-pickup.unit.test.ts`
- Test: `tests/video-generator/manual-preview-cli.unit.test.ts`

- [ ] **Step 1: 写审核状态机测试**

`edit-review.json` 只允许 `approved | pickup-required | rejected`；未审核、缺 Segment、低置信度未处理、补录 source 缺失时禁止 finalize。Agent 原始 edit-plan 与用户审核结果分开保存。

- [ ] **Step 2: 实现 preview 命令**

```bash
npm run video:preview -- --run video-runs/<run> --edit-plan edit/edit-plan.json
```

命令校验 bundle/source/plan，调用已通过的 preview renderer，生成 `preview-timeline.json`、`preview.mp4`、`edit-report.md`；失败不修改原始素材。

- [ ] **Step 3: 实现 Segment pickup 命令**

```bash
npm run video:pickup -- --run video-runs/<run> --segment segment-003 --display-mode borderless-maximized
```

pickup 使用新 attempt 文件，不覆盖原视频；补录完成后更新 manifest attempts 和 source catalog，只有用户确认的 pickup 才能被 edit-plan 引用。

- [ ] **Step 4: 运行 preview/pickup fixture 集成测试**

测试必须证明：Segment 003 替换不会改变 Segment 001/002 的 timeline；失败 pickup 保留素材和 report；多次 pickup 编号稳定；preview 时长、PTS、stream 结构继续通过。

- [ ] **Step 5: 提交**

```bash
git add src/cli/manual-preview.ts src/cli/manual-pickup.ts src/lib/video-generator/manual src/lib/video-generator/editing src/lib/video-generator/recording/artifacts.ts tests/video-generator/manual-review.unit.test.ts tests/video-generator/manual-pickup.unit.test.ts tests/video-generator/manual-preview-cli.unit.test.ts package.json
git commit -m "feat: add manual preview review and pickup"
```

## Task 7: narration-final、TTS、字幕和 finalize

**Files:**
- Create: `src/lib/video-generator/manual/narration.ts`
- Create: `src/cli/manual-finalize.ts`
- Modify: `src/lib/video-generator/audio.ts`
- Modify: `src/lib/video-generator/subtitles.ts`
- Modify: `src/lib/video-generator/ffmpeg.ts`
- Modify: `src/lib/video-generator/types.ts`
- Test: `tests/video-generator/manual-narration.unit.test.ts`
- Test: `tests/video-generator/manual-finalize.unit.test.ts`
- Test: `tests/video-generator/manual-finalize.integration.test.ts`

- [ ] **Step 1: 写 finalize gate 测试**

未全部审核、存在 low confidence 未处理、manifest clock 非 ok、视频不可用、旁白段落缺失、TTS provider 失败或 subtitle 时间越界时，finalize 必须拒绝并指出具体 Segment/字段；不得生成假 `final.mp4`。

- [ ] **Step 2: 实现 narration draft**

根据已批准 preview 的有效画面时长生成 `scripts/narration-final.md`；只能精简重复表达、调整句序和停顿，不能改变业务含义、测试数据或编造未发生操作。用户编辑后的 narration 另存版本。

- [ ] **Step 3: 接入现有 TTS、SRT 和 ffmpeg**

```bash
npm run video:finalize -- --run video-runs/<run>
```

复用现有 DashScope provider、audio merge、SRT renderer 和 ffmpeg pipeline；finalize 只接受已验证 edit-review 和 narration，输出 `audio/`、`subtitles.srt`、`final.mp4`、final report。

- [ ] **Step 4: 运行无凭据和真实凭据两条路径**

无 `DASHSCOPE_API_KEY` 时验证结构化失败报告和无残留伪 final；有 key 时用短 fixture 生成真实 TTS/final，并用 ffprobe 检查视频、音频、字幕时长。

- [ ] **Step 5: 提交**

```bash
git add src/cli/manual-finalize.ts src/lib/video-generator/manual src/lib/video-generator/audio.ts src/lib/video-generator/subtitles.ts src/lib/video-generator/ffmpeg.ts src/lib/video-generator/types.ts tests/video-generator/manual-narration.unit.test.ts tests/video-generator/manual-finalize*.test.ts package.json
git commit -m "feat: finalize manual recordings with narration"
```

## Task 8: 完整端到端验收、文档和交付

**Files:**
- Create: `examples/manual-recording/end-to-end.md`
- Create: `docs/research/manual-recording-productization-poc-results.md`
- Modify: `examples/manual-recording/README.md`
- Modify: `docs/exec-plans/README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `AGENTS.md` only if command/checklist changes are permanent
- Test: `tests/video-generator/manual-end-to-end.test.ts`

- [ ] **Step 1: 创建本地 fixture 业务流程**

fixture 必须覆盖单标签页、多标签页、表单输入、远程下拉、弹窗、SPA navigation、一次错误恢复/F9、一次 F8 人工确认和一个 Segment pickup；不得使用真实业务账号。

- [ ] **Step 2: 执行完整人工流程**

```bash
npm run video:guide -- --script examples/manual-recording/end-to-end.md --output video-runs/manual-product-e2e
npm run video:record -- --guide video-runs/manual-product-e2e/scripts/recording-guide.json --output video-runs/manual-product-e2e --display-mode borderless-maximized
npm run video:preview -- --run video-runs/manual-product-e2e
npm run video:pickup -- --run video-runs/manual-product-e2e --segment segment-003 --display-mode borderless-maximized
npm run video:preview -- --run video-runs/manual-product-e2e
npm run video:finalize -- --run video-runs/manual-product-e2e
```

每一步都使用独立 verifier；输出目录包含完整 bundle，原始素材未被覆盖，review gate 阻止未确认内容进入 final。

- [ ] **Step 3: 运行完整自动回归**

Run: `npm run test && npm run test:video-poc && npm run test:editing-poc`

另外运行 `npm run build:manual-poc`、`npm run typecheck` 和新增 manual CLI integration tests。

- [ ] **Step 4: 更新结果与索引**

记录每个阶段的命令、报告路径、媒体指标、失败样本和环境依赖；在所有验收通过前保持本计划位于 `active/`。完成后将本文件移动到 `docs/exec-plans/completed/`，并更新 `docs/exec-plans/README.md`。

- [ ] **Step 5: 提交**

```bash
git add examples/manual-recording docs/research/manual-recording-productization-poc-results.md docs/exec-plans/README.md ARCHITECTURE.md AGENTS.md tests/video-generator/manual-end-to-end.test.ts
git commit -m "docs: complete manual recording productization plan"
```

---

## 跨阶段验收门槛

1. 现有自动模式 `npm run test`、`npm run test:video-poc`、`npm run test:editing-poc` 不回归。
2. 所有 guide/manifest/edit-plan/edit-review/narration 输入先 schema 校验，失败具体到路径并 fail closed。
3. 原始 Markdown、原始视频、events.jsonl 和 Agent 初始 edit-plan 永不覆盖；每次 attempt/pickup 使用新文件。
4. observer 不执行业务动作；自动逻辑不能替代用户登录、点击、填写或切 tab。
5. Window restore、Electron cleanup、事件落盘和 ffmpeg stderr 在成功/失败/中断路径均可审计。
6. edit-plan 只能引用 confirmed attempt 和已存在 source；preview/finalize 不允许未审核或低置信度内容静默通过。
7. 真实 TTS 仅在检测到 `DASHSCOPE_API_KEY` 时执行；无凭据路径必须有可复核失败报告。
8. final.mp4 只在全部必要 Segment 审核通过、clock/媒体校验通过且字幕时间有效时生成。

## 风险与决策

- Agent provider 第一版采用离线 deterministic provider + 明确接口，先保证可测试和可复现，再接入 Claude/远程模型；模型不可用不能阻塞录制。
- 悬浮窗 UI 与业务 Action tracker 分层，避免 Electron 代码理解业务脚本；所有业务语义通过 guide/events 协议传递。
- Segment pickup 先复用 POC 的独立 source 和 preview 能力，不改写原始 capture；只在 review approval 后更新有效 source。
- 不把“输出路径含空格和中文”作为本轮产品化默认通过条件；若要支持，单独增加 Windows path matrix 测试并记录 ffmpeg shell 转义证据。

## 计划自检

- 设计文档第 5/6/7 节：Task 2–4 覆盖 guide、状态机、快捷键、attempt 和录制流程。
- 第 9/10/11 节：Task 1、5、6、7 覆盖 bundle、协议、素材保护、剪辑策略和最终输出。
- 第 12/13/14 节：Task 6–7 覆盖审核、Segment pickup、narration、TTS、字幕和四个 CLI。
- 第 16/17/18/19 节：Task 3–5 覆盖统一时钟、关键帧、失败处理和 Agent 不可静默决定的 gate。
- 第 21/23 节：Task 8 覆盖单元、Electron、fixture、端到端和验收标准。
- POC 已完成的模块只复用接口和 verifier，不重复 30 分钟漂移或 100/125/150% 矩阵验收。
