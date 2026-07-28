# 人工录制与 Agent 辅助剪辑产品化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 创建时间：2026-07-28  
> 最后更新：2026-07-28  
> 设计基线：`docs/research/manual-recording-agent-editing-design.md`  
> POC 基线：`ee849df docs: complete manual recording poc acceptance`

**Goal:** 在已通过的 Windows 窗口捕获、统一时钟、页面事件、虚拟鼠标和多源 preview POC 之上，交付可实际运行的“Markdown → Agent guide → 人工录制 → Agent 初剪 → 三栏审核/补录 → Agent 旁白 → TTS/字幕/final”完整产品流程。

**Architecture:** 现有自动模式 `video:generate` 保持不变；人工模式新增独立的 manual application layer、正式 Electron overlay/review 应用和确定性 CLI。第一版 Agent 由 Claude Code/Codex 会话承担，通过版本化 request/response JSON 与 CLI 交接，不把远程 AI provider 内置进录制进程；CLI 只负责编译请求、schema 校验、素材管理、状态机和 ffmpeg/TTS 执行。POC 入口保留为回归基线，正式产品不依赖 `pocs/manual-recording/` 的 UI 或 runner。

**Tech Stack:** TypeScript ESM、Node.js >=22.12.0、Electron 43.1.1、Playwright 1.60、node:test + tsx、ffmpeg/ffprobe、DashScope TTS、Windows 10/11。

---

## 0. 已完成基线和范围

### 已完成且不重复

- POC 1：Windows 100%/125%/150% × F11/borderless-maximized 6/6 通过。
- POC 2：统一 `sessionTimeMs`/`videoTimeMs`、F7/F9/F10、marker evidence、30 分钟漂移通过。
- POC 3：click/input/change/scroll/navigation/tab、iframe/reload 注入和虚拟鼠标通过。
- POC 4：original/pickup、trim、2×、hold、120ms short-fade 和 preview 通过。
- 产品化阶段复用 `capture/`、`recording/`、`browser/manual-*`、`editing/` 的稳定实现和 verifier。
- 不重跑 30 分钟漂移和 DPI 6/6 矩阵；只有修改相应底层模块时才重跑相关实机验收。

### 第一版明确包含

- Claude Code/Codex Agent 生成 guide、edit plan、edit report 和最终旁白建议。
- 正式 Electron 悬浮窗、F7/F8/Shift+F8/F9/F10、Action/attempt、结果状态判断。
- 单/多标签页人工录制、Segment pickup、三栏审核和局部 preview。
- 已审核有效时间轴上的 TTS、字幕和 final。

### 第一版明确不包含

- macOS/Linux、独立 popup、其他桌面应用、整屏录制、系统声音/麦克风。
- 自动登录、自动点击/填写、自动切换标签页、自动恢复网页状态。
- 隐私脱敏和业务数据外传治理；Agent request 第一版保留本地业务文本，并在报告中明确告知。
- 内置 Claude/OpenAI provider；模型调用发生在当前 Agent 会话，录制进程不可依赖模型在线。

## 1. 产品命令和完整流程

```text
video:guide
  → 生成 agent/guide-request.vNN.json
  → Claude Code/Codex 写 agent/guide-response.vNN.json
  → CLI 校验并保存 recording-guide.approved.json

video:record
  → 正式 Electron overlay + Chromium
  → 用户登录/准备 → F7 → 3 秒倒计时 → 人工操作
  → original-window.mp4 + events + manifest + source-catalog

video:analyze
  → 抽关键帧并生成 agent/edit-request.vNN.json
  → Claude Code/Codex 写 agent/edit-response.vNN.json
  → CLI 校验为 edit-plan.agent.vNN.json + edit-report.agent.vNN.md

video:preview
  → 根据 agent plan 生成 preview

video:review
  → 三栏审核 UI
  → edit-review.vNN.json + edit-plan.effective.vNN.json

video:pickup
  → 指定 Segment 独立补录
  → 更新 source-catalog，再次 analyze/preview/review

video:narration
  → 生成 agent/narration-request.vNN.json
  → Claude Code/Codex 写 agent/narration-response.vNN.json
  → CLI 校验并保存 narration-final.approved.md

video:finalize
  → final-timeline.json → TTS → SRT → final.mp4
```

## 2. 目标素材结构

```text
video-runs/<run>/
├── scripts/
│   ├── original.md
│   ├── polished.vNN.md
│   ├── executable.vNN.md
│   ├── recording-guide.vNN.json
│   ├── recording-guide.approved.json
│   ├── narration-final.vNN.md
│   └── narration-final.approved.md
├── agent/
│   ├── guide-request.vNN.json
│   ├── guide-response.vNN.json
│   ├── edit-request.vNN.json
│   ├── edit-response.vNN.json
│   ├── narration-request.vNN.json
│   └── narration-response.vNN.json
├── capture/
│   ├── raw-window.webm
│   ├── original-window.mp4
│   ├── events.jsonl
│   ├── tabs.json
│   ├── recording-manifest.json
│   ├── source-catalog.json
│   └── keyframes/
├── pickups/
│   └── segment-003-attempt-001.mp4
├── edit/
│   ├── edit-plan.agent.vNN.json
│   ├── edit-plan.agent.current.json
│   ├── edit-plan.effective.vNN.json
│   ├── edit-plan.effective.current.json
│   ├── edit-review.vNN.json
│   ├── edit-review.current.json
│   ├── edit-report.agent.vNN.md
│   ├── preview-timeline.json
│   └── preview.mp4
├── audio/
│   └── segment-003.wav
├── subtitles.srt
├── final-timeline.json
├── final.mp4
└── reports/
    ├── manual-run-report.json
    ├── guide-verification.json
    ├── capture-verification.json
    ├── preview-verification.json
    ├── review-verification.json
    ├── pickup-verification.json
    └── final-verification.json
```

保护规则：

- `original.md`、原始 capture、events、Agent 原始 response 和 `edit-plan.agent.vNN.json` 永不覆盖。
- guide/narration 修订使用 `vNN`；`recording-guide.approved.json` 和 `narration-final.approved.json` 是只含版本号、路径和批准时间的 current pointer，历史版本永不覆盖。
- 用户审核写递增版本的 `edit-review.vNN.json` 和 `edit-plan.effective.vNN.json`；`*.current.json` 只保存当前版本号和对应路径，不修改历史版本或 Agent 原始建议。
- attempt/pickup 使用单调递增编号；失败文件保留并标记状态。
- `final.mp4` 只允许由已审核的 effective plan 和 approved narration 生成。

## 3. Phase 状态

| Phase | 内容 | 状态 | 退出门槛 |
|---|---|---|---|
| Phase 0 | bundle/schema/source catalog/Agent exchange | 待开始 | 协议与不可覆盖测试通过 |
| Phase 1 | Agent guide 交接和 `video:guide` | 待开始 | 非结构化 Markdown 可经 Agent 生成并批准 guide |
| Phase 2 | 正式 Electron 产品边界和 overlay 状态机 | 待开始 | 产品构建与 IPC/焦点/cleanup 测试通过 |
| Phase 3 | result evaluator、Action tracker、attempt | 待开始 | F7/F8/Shift+F8/F9/F10 语义通过 |
| Phase 4 | `video:record` 产品录制 | 待开始 | 单/多 tab、准备/倒计时/中断恢复通过 |
| Phase 5 | 关键帧、Agent edit 交接和 preview | 待开始 | Agent plan 可复核且无效输出 fail closed |
| Phase 6 | 三栏 review UI 和 effective plan | 待开始 | 调边界/换 attempt/局部 preview 可保存 |
| Phase 7 | Segment pickup | 待开始 | pickup 不改变其他已批准 Segment |
| Phase 8 | Agent narration、final timeline、TTS/finalize | 待开始 | 无 key 失败清晰，有 key 生成 final |
| Phase 9 | verifier、doctor、E2E、文档和交付 | 待开始 | 设计文档第 21/23 节全部通过 |

---

## Task 1: Manual bundle、source catalog 和 schema

**Files:**
- Create: `src/lib/video-generator/manual/types.ts`
- Create: `src/lib/video-generator/manual/schema.ts`
- Create: `src/lib/video-generator/manual/bundle.ts`
- Create: `src/lib/video-generator/manual/source-catalog.ts`
- Create: `src/lib/video-generator/manual/atomic-writer.ts`
- Modify: `src/lib/video-generator/recording/types.ts`
- Modify: `src/lib/video-generator/recording/artifacts.ts`
- Modify: `src/lib/video-generator/editing/types.ts`
- Test: `tests/video-generator/manual-bundle.unit.test.ts`
- Test: `tests/video-generator/manual-schema.unit.test.ts`
- Test: `tests/video-generator/manual-source-catalog.unit.test.ts`

- [ ] **Step 1: 写失败测试**

测试覆盖目录路径、run lock、protected artifacts、原子 JSON、guide/review/Agent response schema、attempt 编号和 source catalog。

`ManualSource` 必须包含：

```ts
interface ManualSource extends EditSource {
  kind: 'original' | 'pickup';
  segmentId: string | null;
  attempt: number | null;
  status: 'available' | 'failed' | 'superseded';
  createdAt: string;
}

interface ManualSourceCatalog {
  version: 1;
  sources: ManualSource[];
}
```

`RecordingAttempt` 增加 `segmentId`、`sourceId`、`confirmedAtMs`；Action 重试和 Segment pickup 不再混用不可区分的记录。

同时在 `manual/types.ts` 固定 `ExpectedEvent` 与 `ExpectedResult` 判别联合；Task 2 的 guide schema 和 Task 4 的 result evaluator 必须共用这些类型，禁止各自维护字符串集合。

- [ ] **Step 2: 运行失败测试**

Run: `npx tsx --test tests/video-generator/manual-bundle.unit.test.ts tests/video-generator/manual-schema.unit.test.ts tests/video-generator/manual-source-catalog.unit.test.ts`

Expected: 新模块不存在，测试失败。

- [ ] **Step 3: 实现最小协议和保护性 writer**

`createManualBundle()` 返回全部目标路径；`acquireManualRunLock()` 拒绝同一 run 并发写；`writeProtectedJson()` 拒绝覆盖；`writeVersionedJson()` 使用 `vNN`；`appendSource()` 校验 probe 信息后原子写 catalog。

- [ ] **Step 4: 运行测试**

Run: `npx tsx --test tests/video-generator/manual-bundle.unit.test.ts tests/video-generator/manual-schema.unit.test.ts tests/video-generator/manual-source-catalog.unit.test.ts && npm run typecheck`

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/manual src/lib/video-generator/recording/types.ts src/lib/video-generator/recording/artifacts.ts src/lib/video-generator/editing/types.ts tests/video-generator/manual-bundle.unit.test.ts tests/video-generator/manual-schema.unit.test.ts tests/video-generator/manual-source-catalog.unit.test.ts
git commit -m "feat: define manual recording product protocols"
```

## Task 2: Claude Code/Codex guide 交接和 `video:guide`

**Files:**
- Create: `src/lib/video-generator/manual/agent-exchange.ts`
- Create: `src/lib/video-generator/manual/guide-request.ts`
- Create: `src/lib/video-generator/manual/guide-response.ts`
- Create: `src/lib/video-generator/manual/guide-writer.ts`
- Create: `src/cli/manual-guide.ts`
- Create: `examples/manual-recording/README.md`
- Create: `examples/manual-recording/basic-form.md`
- Modify: `package.json`
- Test: `tests/video-generator/manual-agent-exchange.unit.test.ts`
- Test: `tests/video-generator/manual-guide.unit.test.ts`
- Test: `tests/video-generator/manual-guide-cli.unit.test.ts`

- [ ] **Step 1: 写 Agent exchange 失败测试**

协议固定为：

```ts
interface GuideAgentRequest {
  version: 1;
  kind: 'manual-guide-request';
  sourceScriptPath: string;
  sourceText: string;
  constraints: {
    observerOnly: true;
    manualTabSwitching: true;
    allowedExpectedEventTypes: string[];
    allowedExpectedResultTypes: string[];
  };
}

interface GuideAgentResponse {
  version: 1;
  kind: 'manual-guide-response';
  requestVersion: number;
  polishedMarkdown: string;
  executableMarkdown: string;
  guide: RecordingGuide;
  warnings: string[];
}
```

测试非法 kind/version、重复 id、空 Action、非法 startUrl、未知 expected event/result，以及 Agent 修改原始脚本的企图。

- [ ] **Step 2: 实现 prepare/apply 两阶段 CLI**

```bash
npm run video:guide -- --script examples/manual-recording/basic-form.md --output video-runs/run --prepare-agent
npm run video:guide -- --run video-runs/run --apply-agent-response video-runs/run/agent/guide-response.v01.json
```

第一条只写 original 和递增版本的 `guide-request.vNN.json`；Agent 会话读取 request 并写同版本 response；第二条 schema 校验 response，保存同版本 `polished.vNN.md`、`executable.vNN.md` 和 `recording-guide.vNN.json`。用户明确批准后运行：

```bash
npm run video:guide -- --run video-runs/run --approve-version 1
```

生成 `recording-guide.approved.json`。CLI 不在没有 Agent response 时伪造业务 Action。

- [ ] **Step 3: 明确第一版数据边界**

request 保留业务文本，因为设计明确第一版不做脱敏；CLI 在 stdout 和 `manual-run-report.json` 写出本地数据提示。错误报告继续复用现有 redaction 规则，不把输入值写入失败快照。

- [ ] **Step 4: 运行测试**

Run: `npx tsx --test tests/video-generator/manual-agent-exchange.unit.test.ts tests/video-generator/manual-guide.unit.test.ts tests/video-generator/manual-guide-cli.unit.test.ts && npm run typecheck`

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-generator/manual src/cli/manual-guide.ts examples/manual-recording package.json tests/video-generator/manual-agent-exchange.unit.test.ts tests/video-generator/manual-guide.unit.test.ts tests/video-generator/manual-guide-cli.unit.test.ts
git commit -m "feat: add agent-assisted recording guides"
```

## Task 3: 正式 Electron overlay 产品边界

**Files:**
- Create: `tsconfig.manual-recording.json`
- Create: `scripts/copy-manual-recording-assets.mjs`
- Create: `scripts/run-manual-recording.mjs`
- Create: `src/lib/video-generator/recording-overlay/main.ts`
- Create: `src/lib/video-generator/recording-overlay/preload.cts`
- Create: `src/lib/video-generator/recording-overlay/renderer.ts`
- Create: `src/lib/video-generator/recording-overlay/overlay.html`
- Create: `src/lib/video-generator/recording-overlay/ipc.ts`
- Create: `src/lib/video-generator/manual/state-machine.ts`
- Modify: `package.json`
- Test: `tests/video-generator/manual-overlay.unit.test.ts`
- Test: `tests/video-generator/manual-overlay.integration.test.ts`

- [ ] **Step 1: 写产品构建和 IPC 失败测试**

正式 build 只包含 product modules 和共享 `capture/recording/editing/browser/manual-*`，不把 `pocs/manual-recording/` 打进产品。IPC channel 使用常量联合类型；preload 不暴露 Node API。

- [ ] **Step 2: 实现完整状态机**

普通录制：

```text
preparing → countdown → recording → finishing → analyzing → review-ready
```

补录：

```text
pickup-preparing → pickup-recording → pickup-finishing → segment-analyzing → review-ready
```

`beginCountdown(3000)` 结束后才写正式 `recording-start`；底层 capture 可保留 pre-roll，但 edit plan 默认从正式 marker 开始。

- [ ] **Step 3: 实现正式 overlay**

显示状态、计时、当前 Segment/Action/attempt、下一步、置信度、observer 异常和新 tab 提示；始终置顶、默认不抢焦点、可拖动。按钮与 F7/F8/Shift+F8/F9/F10 使用同一 command handler。

- [ ] **Step 4: 实现产品 build**

```bash
npm run build:manual
```

Expected: 生成 `dist/manual-recording/` 下 main/preload/renderer/HTML；`build:manual-poc` 仍独立通过。

- [ ] **Step 5: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-overlay.unit.test.ts tests/video-generator/manual-overlay.integration.test.ts && npm run build:manual && npm run build:manual-poc`

```bash
git add tsconfig.manual-recording.json scripts/copy-manual-recording-assets.mjs scripts/run-manual-recording.mjs src/lib/video-generator/recording-overlay src/lib/video-generator/manual/state-machine.ts package.json tests/video-generator/manual-overlay.unit.test.ts tests/video-generator/manual-overlay.integration.test.ts
git commit -m "feat: add manual recording product overlay"
```

## Task 4: result evaluator、Action tracker 和 attempt

**Files:**
- Create: `src/lib/video-generator/manual/result-evaluator.ts`
- Create: `src/lib/video-generator/manual/action-tracker.ts`
- Create: `src/lib/video-generator/manual/attempts.ts`
- Modify: `src/lib/video-generator/browser/manual-observer.ts`
- Modify: `src/lib/video-generator/recording/event-log.ts`
- Modify: `src/lib/video-generator/recording/session.ts`
- Modify: `src/lib/video-generator/recording-overlay/main.ts`
- Test: `tests/video-generator/manual-result-evaluator.unit.test.ts`
- Test: `tests/video-generator/manual-action-tracker.unit.test.ts`
- Test: `tests/video-generator/manual-attempts.unit.test.ts`
- Test: `tests/video-generator/manual-controls.integration.test.ts`

- [ ] **Step 1: 写 result evaluator 失败测试**

第一版支持：`dialog-visible`、`text-visible`、`url-matches`、`element-state`、`selected-value`、`tab-created`。guide schema 拒绝其他 result type。evaluator 只读取 observer snapshot/event，不执行业务操作。

- [ ] **Step 2: 写快捷键和 attempt 失败测试**

- F7：从 preparing 启动 3 秒倒计时。
- F8：确认当前 Action，并确认当前 action attempt。
- Shift+F8：回退 Action 指针，不恢复网页、不删除事件。
- F9：关闭当前 attempt 为 discarded，立即创建递增 attempt。
- F10：第一次请求结束并列出未确认 Action，第二次在 5 秒内确认结束。
- 高置信度自动确认与 F8 必须走同一 `confirmAction()`，均写 `action-confirmed`。

- [ ] **Step 3: 实现 matcher 和 tracker**

高置信度要求明确 expected event 命中，或 event + expected result 命中；单纯任意点击不得推进。observer 失败时当前 Action 降为 `manual-confirmation-required`，录像继续。

- [ ] **Step 4: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-result-evaluator.unit.test.ts tests/video-generator/manual-action-tracker.unit.test.ts tests/video-generator/manual-attempts.unit.test.ts tests/video-generator/manual-controls.integration.test.ts`

```bash
git add src/lib/video-generator/manual src/lib/video-generator/browser/manual-observer.ts src/lib/video-generator/recording src/lib/video-generator/recording-overlay/main.ts tests/video-generator/manual-result-evaluator.unit.test.ts tests/video-generator/manual-action-tracker.unit.test.ts tests/video-generator/manual-attempts.unit.test.ts tests/video-generator/manual-controls.integration.test.ts
git commit -m "feat: track manual actions and results"
```

## Task 5: `video:record` 产品录制和中断恢复

**Files:**
- Create: `src/lib/video-generator/manual/record-controller.ts`
- Create: `src/lib/video-generator/manual/recovery.ts`
- Create: `src/cli/manual-record.ts`
- Modify: `pocs/manual-recording/capture-main.ts`
- Modify: `src/lib/video-generator/recording/manifest.ts`
- Modify: `src/lib/video-generator/recording/poc-report.ts`
- Modify: `package.json`
- Test: `tests/video-generator/manual-record-cli.unit.test.ts`
- Test: `tests/video-generator/manual-record.integration.test.ts`
- Test: `tests/video-generator/manual-recovery.unit.test.ts`

- [ ] **Step 1: 写启动/准备/倒计时测试**

record command 读取 approved guide，启动专用 Chromium，先用唯一 binding title 绑定 source，再导航 `startUrl`。用户在 preparing 状态手动登录和准备；只有 F7 才进入倒计时，3 秒后写正式 marker 和启动 Action tracker。

- [ ] **Step 2: 抽取共享 capture engine**

产品 controller 复用 source matching、User32、MediaRecorder、clock、observer 和 normalize。POC `capture-main.ts` 改为调用共享 engine 的薄 wrapper，确保 POC verifier 继续保护底层行为；产品不 import POC UI。

- [ ] **Step 3: 实现命令**

```bash
npm run video:record -- --run video-runs/run --display-mode f11
npm run video:record -- --run video-runs/run --display-mode borderless-maximized
```

成功输出 original/events/tabs/manifest/source-catalog；失败保留 raw/events/stage report，不生成伪成功 MP4。

- [ ] **Step 4: 实现中断恢复**

捕获中断时立即停止 Action 推进，flush 已有 chunk/events，manifest 写 `captureComplete=false`、中断时间和最后 confirmed Segment。`npm run video:record -- --run <run> --recover` 只允许把未完成 Segment 标记为 pickup-required，不覆盖原 capture。

- [ ] **Step 5: 运行测试和实机短测**

Run: `npx tsx --test tests/video-generator/manual-record-cli.unit.test.ts tests/video-generator/manual-record.integration.test.ts tests/video-generator/manual-recovery.unit.test.ts && npm run test`

实机使用新的 `video-runs/manual-product-record-*`；修改底层 window/capture 时额外运行相关 POC verifier。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-generator/manual src/cli/manual-record.ts src/lib/video-generator/recording pocs/manual-recording/capture-main.ts package.json tests/video-generator/manual-record-cli.unit.test.ts tests/video-generator/manual-record.integration.test.ts tests/video-generator/manual-recovery.unit.test.ts
git commit -m "feat: record and recover manual browser sessions"
```

## Task 6: 关键帧、Agent edit 交接和 preview

**Files:**
- Create: `src/lib/video-generator/manual/keyframes.ts`
- Create: `src/lib/video-generator/manual/edit-request.ts`
- Create: `src/lib/video-generator/manual/edit-response.ts`
- Create: `src/lib/video-generator/manual/edit-report.ts`
- Create: `src/cli/manual-analyze.ts`
- Create: `src/cli/manual-preview.ts`
- Modify: `src/lib/video-generator/editing/types.ts`
- Modify: `src/lib/video-generator/editing/validator.ts`
- Modify: `src/lib/video-generator/editing/preview.ts`
- Modify: `package.json`
- Test: `tests/video-generator/manual-keyframes.unit.test.ts`
- Test: `tests/video-generator/manual-edit-exchange.unit.test.ts`
- Test: `tests/video-generator/manual-preview-cli.unit.test.ts`

- [ ] **Step 1: 写关键帧和 exchange 测试**

关键帧包含 click 前 300ms/后 500ms、input 起止、result、navigation、tab、action confirm、retry、Segment end 和每 2.5 秒低频帧。`EditAgentRequest` 包含 approved guide、manifest、events、source catalog、keyframe index 和剪辑约束，不上传整条视频。

response 固定为：

```ts
interface EditAgentResponse {
  version: 1;
  kind: 'manual-edit-response';
  requestVersion: number;
  plan: EditPlan;
  decisions: Array<{
    segmentId: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    reviewReasons: string[];
  }>;
}
```

- [ ] **Step 2: 实现 analyze prepare/apply**

```bash
npm run video:analyze -- --run video-runs/run --prepare-agent
npm run video:analyze -- --run video-runs/run --apply-agent-response video-runs/run/agent/edit-response.v01.json
npm run video:analyze -- --run video-runs/run --segment segment-003 --prepare-agent
```

Agent response 包含 `EditPlan`、逐 Segment reason/confidence 和人工审核提示。每次 analyze 使用递增 request/response 版本；apply 后写 immutable `edit-plan.agent.vNN.json` 和 `edit-report.agent.vNN.md`，并原子更新只含当前版本号的 `edit-plan.agent.current.json` 指针。
带 `--segment` 时 request 仍包含相邻 Segment 只读上下文，但 response 只允许修改目标 Segment；apply 时其他 Segment 必须与上一版 plan 深度相等。

- [ ] **Step 3: 强化 validator**

拒绝不存在 source/Segment、越界/倒置区间、discarded attempt、非法 playbackRate、正常操作 >2×、hold >5s、未解释删除超过 Segment 一半、低置信度却未列 review reason。

- [ ] **Step 4: 实现 preview**

```bash
npm run video:preview -- --run video-runs/run --plan agent
npm run video:preview -- --run video-runs/run --plan effective
```

第一次审核前允许 agent plan；review 后默认 effective plan。输出 preview timeline/video，不修改任何 plan。

- [ ] **Step 5: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-keyframes.unit.test.ts tests/video-generator/manual-edit-exchange.unit.test.ts tests/video-generator/manual-preview-cli.unit.test.ts tests/video-generator/editing-validator.unit.test.ts tests/video-generator/editing-preview.unit.test.ts`

```bash
git add src/lib/video-generator/manual src/cli/manual-analyze.ts src/cli/manual-preview.ts src/lib/video-generator/editing package.json tests/video-generator/manual-keyframes.unit.test.ts tests/video-generator/manual-edit-exchange.unit.test.ts tests/video-generator/manual-preview-cli.unit.test.ts
git commit -m "feat: analyze and preview manual recordings"
```

## Task 7: 三栏审核 UI、edit-review 和 effective plan

**Files:**
- Create: `src/lib/video-generator/review-ui/main.ts`
- Create: `src/lib/video-generator/review-ui/preload.cts`
- Create: `src/lib/video-generator/review-ui/renderer.ts`
- Create: `src/lib/video-generator/review-ui/review.html`
- Create: `src/lib/video-generator/review-ui/review.css`
- Create: `src/lib/video-generator/review-ui/ipc.ts`
- Create: `src/lib/video-generator/manual/review.ts`
- Create: `src/lib/video-generator/manual/effective-plan.ts`
- Create: `src/cli/manual-review.ts`
- Modify: `tsconfig.manual-recording.json`
- Modify: `scripts/copy-manual-recording-assets.mjs`
- Modify: `package.json`
- Test: `tests/video-generator/manual-review.unit.test.ts`
- Test: `tests/video-generator/manual-effective-plan.unit.test.ts`
- Test: `tests/video-generator/manual-review-ui.integration.test.ts`

- [ ] **Step 1: 写 review/effective plan 失败测试**

状态固定为 `approved | pickup-required | rejected`。测试调整起止边界、改用其他 confirmed attempt、保留/压缩等待、非法越界、低置信度未处理、缺 Segment、补录 source 不存在和局部 preview 失败。

- [ ] **Step 2: 实现三栏 UI**

- 左：Segment、状态、问题列表。
- 中：preview、简化 timeline、当前 Segment 循环播放。
- 右：Agent reason/confidence、边界、attempt/source、等待策略、approve/pickup/reject。

review app 保持 `contextIsolation=true`、`nodeIntegration=false`，通过 typed preload IPC 读取白名单内的 bundle 文件；本地视频使用校验后的绝对路径或受限 custom protocol，不接受 renderer 传入任意文件路径。所有修改先形成 review draft；点击保存后原子写下一版 `edit-review.vNN.json` 和 `edit-plan.effective.vNN.json`，再更新 current 指针。局部 preview 使用临时文件，不覆盖完整 preview。

- [ ] **Step 3: 实现命令**

```bash
npm run video:review -- --run video-runs/run
```

没有 agent plan/preview 时拒绝启动。关闭未保存 UI 不创建 review；全部必要 Segment approved 后 `reviewComplete=true`。

- [ ] **Step 4: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-review.unit.test.ts tests/video-generator/manual-effective-plan.unit.test.ts tests/video-generator/manual-review-ui.integration.test.ts && npm run build:manual`

```bash
git add src/lib/video-generator/review-ui src/lib/video-generator/manual/review.ts src/lib/video-generator/manual/effective-plan.ts src/cli/manual-review.ts tsconfig.manual-recording.json scripts/copy-manual-recording-assets.mjs package.json tests/video-generator/manual-review.unit.test.ts tests/video-generator/manual-effective-plan.unit.test.ts tests/video-generator/manual-review-ui.integration.test.ts
git commit -m "feat: review manual recording edit plans"
```

## Task 8: Segment pickup 产品流程

**Files:**
- Create: `src/lib/video-generator/manual/pickup-controller.ts`
- Create: `src/cli/manual-pickup.ts`
- Modify: `src/lib/video-generator/manual/state-machine.ts`
- Modify: `src/lib/video-generator/manual/source-catalog.ts`
- Modify: `src/lib/video-generator/recording-overlay/main.ts`
- Modify: `package.json`
- Test: `tests/video-generator/manual-pickup.unit.test.ts`
- Test: `tests/video-generator/manual-pickup.integration.test.ts`

- [ ] **Step 1: 写 pickup 状态和隔离测试**

指定 Segment 必须存在且 review 为 pickup-required。pickup 只显示该 Segment/Action，生成新 source/attempt；失败 source 标为 failed。测试新 source 替换 Segment 003 时 Segment 001/002 的 effective plan 字节级不变。

- [ ] **Step 2: 实现 pickup command**

```bash
npm run video:pickup -- --run video-runs/run --segment segment-003 --display-mode borderless-maximized
```

流程严格走 pickup 状态机；结束后追加 source catalog 和 attempt，不自动批准。用户必须重新 analyze/preview/review 该 Segment。

- [ ] **Step 3: 连续性 gate**

Agent/review 必须比较 pickup 首尾关键帧与相邻 Segment；明显不连续时保持 `pickup-required`，禁止自动 approved。

- [ ] **Step 4: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-pickup.unit.test.ts tests/video-generator/manual-pickup.integration.test.ts`

```bash
git add src/lib/video-generator/manual/pickup-controller.ts src/lib/video-generator/manual/state-machine.ts src/lib/video-generator/manual/source-catalog.ts src/lib/video-generator/recording-overlay/main.ts src/cli/manual-pickup.ts package.json tests/video-generator/manual-pickup.unit.test.ts tests/video-generator/manual-pickup.integration.test.ts
git commit -m "feat: add segment pickup recording"
```

## Task 9: Agent narration、final timeline、TTS 和 finalize

**Files:**
- Create: `src/lib/video-generator/manual/narration-request.ts`
- Create: `src/lib/video-generator/manual/narration-response.ts`
- Create: `src/lib/video-generator/manual/final-timeline.ts`
- Create: `src/lib/video-generator/manual/final-report.ts`
- Create: `src/cli/manual-narration.ts`
- Create: `src/cli/manual-finalize.ts`
- Modify: `src/lib/video-generator/audio.ts`
- Modify: `src/lib/video-generator/subtitles.ts`
- Modify: `src/lib/video-generator/ffmpeg.ts`
- Modify: `package.json`
- Test: `tests/video-generator/manual-narration.unit.test.ts`
- Test: `tests/video-generator/manual-final-timeline.unit.test.ts`
- Test: `tests/video-generator/manual-finalize.unit.test.ts`
- Test: `tests/video-generator/manual-finalize.integration.test.ts`

- [ ] **Step 1: 写 narration exchange 测试**

request 包含 approved guide、effective preview timeline、每个 Segment 可用时长和业务语义约束。Agent response 每个 Segment 使用稳定 id、文本和预计时长；禁止缺 Segment、额外业务事实或 id 错位。

```ts
interface NarrationAgentResponse {
  version: 1;
  kind: 'manual-narration-response';
  requestVersion: number;
  segments: Array<{
    segmentId: string;
    text: string;
    estimatedDurationMs: number;
  }>;
  warnings: string[];
}
```

- [ ] **Step 2: 实现 narration prepare/apply/approve**

```bash
npm run video:narration -- --run video-runs/run --prepare-agent
npm run video:narration -- --run video-runs/run --apply-agent-response video-runs/run/agent/narration-response.v01.json
npm run video:narration -- --run video-runs/run --approve-version 1
```

Agent response 保存为 `narration-final.vNN.md`；用户批准生成 approved 文件。

- [ ] **Step 3: 定义 final timeline**

`FinalTimelineSegment` 必须保存 `segmentId`、video start/end、content end、hold、transition、narration text、audio duration、subtitle start/end。规则：

- hold/fade 计入 Segment 视频时长。
- TTS 短于视频时在音频尾部补静音。
- TTS 略长时先延长结果帧，单次总 hold 不超过 5 秒。
- 超过可延长范围时 finalize 拒绝并要求精简旁白或 pickup。
- SRT 使用 final timeline，不再复用自动模式的原始 Timeline 假设。

- [ ] **Step 4: 实现 finalize gate 和命令**

```bash
npm run video:finalize -- --run video-runs/run
```

要求 `reviewComplete=true`、effective plan 有效、clock ok、source 全部 available、approved narration 存在。无 `DASHSCOPE_API_KEY` 写结构化失败报告且无假 final；有 key 时生成 audio/SRT/final 并 ffprobe。

- [ ] **Step 5: 运行测试和提交**

Run: `npx tsx --test tests/video-generator/manual-narration.unit.test.ts tests/video-generator/manual-final-timeline.unit.test.ts tests/video-generator/manual-finalize.unit.test.ts tests/video-generator/manual-finalize.integration.test.ts`

```bash
git add src/lib/video-generator/manual src/cli/manual-narration.ts src/cli/manual-finalize.ts src/lib/video-generator/audio.ts src/lib/video-generator/subtitles.ts src/lib/video-generator/ffmpeg.ts package.json tests/video-generator/manual-narration.unit.test.ts tests/video-generator/manual-final-timeline.unit.test.ts tests/video-generator/manual-finalize.unit.test.ts tests/video-generator/manual-finalize.integration.test.ts
git commit -m "feat: finalize reviewed manual recordings"
```

## Task 10: 独立 verifier、doctor、端到端和文档

**Files:**
- Create: `src/lib/video-generator/manual/verifiers.ts`
- Create: `scripts/verify-manual-product.mjs`
- Create: `tests/video-generator/manual-verifiers.unit.test.ts`
- Create: `tests/video-generator/manual-product.integration.test.ts`
- Create: `tests/video-generator/manual-end-to-end.test.ts`
- Create: `examples/manual-recording/end-to-end.md`
- Create: `docs/research/manual-recording-productization-results.md`
- Modify: `src/cli/video-doctor.ts`
- Modify: `package.json`
- Modify: `ARCHITECTURE.md`
- Modify: `AGENTS.md`
- Modify: `examples/manual-recording/README.md`
- Modify: `docs/research/README.md`
- Modify: `docs/exec-plans/README.md`

- [ ] **Step 1: 实现分阶段 verifier**

```bash
npm run verify:manual -- --run video-runs/run --stage guide
npm run verify:manual -- --run video-runs/run --stage capture
npm run verify:manual -- --run video-runs/run --stage preview
npm run verify:manual -- --run video-runs/run --stage review
npm run verify:manual -- --run video-runs/run --stage pickup
npm run verify:manual -- --run video-runs/run --stage final
```

每个 verifier 写对应 JSON report，并校验上游不可变文件 hash、schema、媒体 probe、review gate 和 stage 状态。

- [ ] **Step 2: 把非 unit 测试纳入固定 scripts**

```json
{
  "test:manual-integration": "tsx --test tests/video-generator/manual-*.integration.test.ts",
  "test:manual-e2e": "tsx --test tests/video-generator/manual-end-to-end.test.ts",
  "test:manual-product": "npm run test:manual-integration && npm run test:manual-e2e"
}
```

`manual-end-to-end.test.ts` 使用临时目录、stub Agent response、注入式 capture 和真实 ffmpeg，保证无人值守可运行；它不冒充下面的人工桌面 E2E。`npm run test` 继续是 typecheck + unit；提交前额外运行 `test:manual-product`。

- [ ] **Step 3: 扩展 doctor**

manual checks 包含 Windows、Node、Electron、Playwright Chromium、ffmpeg/ffprobe/libx264、可写输出目录和 DashScope。DashScope 缺失只阻止 finalize，不阻止 guide/record/preview/review。

- [ ] **Step 4: 执行完整 E2E**

```bash
npm run video:guide -- --script examples/manual-recording/end-to-end.md --output video-runs/manual-product-e2e --prepare-agent
npm run video:guide -- --run video-runs/manual-product-e2e --apply-agent-response video-runs/manual-product-e2e/agent/guide-response.v01.json
npm run video:guide -- --run video-runs/manual-product-e2e --approve-version 1
npm run verify:manual -- --run video-runs/manual-product-e2e --stage guide
npm run video:record -- --run video-runs/manual-product-e2e --display-mode borderless-maximized
npm run verify:manual -- --run video-runs/manual-product-e2e --stage capture
npm run video:analyze -- --run video-runs/manual-product-e2e --prepare-agent
npm run video:analyze -- --run video-runs/manual-product-e2e --apply-agent-response video-runs/manual-product-e2e/agent/edit-response.v01.json
npm run video:preview -- --run video-runs/manual-product-e2e --plan agent
npm run verify:manual -- --run video-runs/manual-product-e2e --stage preview
npm run video:review -- --run video-runs/manual-product-e2e
npm run verify:manual -- --run video-runs/manual-product-e2e --stage review
npm run video:pickup -- --run video-runs/manual-product-e2e --segment segment-003 --display-mode borderless-maximized
npm run verify:manual -- --run video-runs/manual-product-e2e --stage pickup
npm run video:analyze -- --run video-runs/manual-product-e2e --segment segment-003 --prepare-agent
npm run video:analyze -- --run video-runs/manual-product-e2e --apply-agent-response video-runs/manual-product-e2e/agent/edit-response.v02.json
npm run video:preview -- --run video-runs/manual-product-e2e --plan agent
npm run video:review -- --run video-runs/manual-product-e2e
npm run verify:manual -- --run video-runs/manual-product-e2e --stage review
npm run video:narration -- --run video-runs/manual-product-e2e --prepare-agent
npm run video:narration -- --run video-runs/manual-product-e2e --apply-agent-response video-runs/manual-product-e2e/agent/narration-response.v01.json
npm run video:narration -- --run video-runs/manual-product-e2e --approve-version 1
npm run video:finalize -- --run video-runs/manual-product-e2e
npm run verify:manual -- --run video-runs/manual-product-e2e --stage final
```

Agent response 文件由当前 Agent 会话根据 request 生成；E2E 记录具体 Agent、模型和生成时间，CLI 不假装自动调用模型。

- [ ] **Step 5: 运行全量回归**

Run:

```bash
npm run test
npm run test:video-poc
npm run test:editing-poc
npm run build:manual
npm run build:manual-poc
npm run test:manual-product
```

涉及 capture/window/clock 共享代码时，额外运行对应真实 POC；否则不重复 30 分钟和 DPI 矩阵。

- [ ] **Step 6: 更新文档、归档和提交**

结果文档记录命令、报告、媒体指标、凭据状态、失败样本和已知限制。全部通过后把本计划移动到 `docs/exec-plans/completed/` 并更新索引。

```bash
git add src/lib/video-generator/manual/verifiers.ts scripts/verify-manual-product.mjs tests/video-generator/manual-verifiers.unit.test.ts tests/video-generator/manual-product.integration.test.ts tests/video-generator/manual-end-to-end.test.ts examples/manual-recording docs/research/manual-recording-productization-results.md docs/research/README.md docs/exec-plans/README.md ARCHITECTURE.md AGENTS.md src/cli/video-doctor.ts package.json
git commit -m "docs: complete manual recording productization"
```

---

## 跨阶段验收门槛

1. 自动模式及既有 POC 不回归。
2. POC 文件只作为薄 wrapper/fixture 和回归入口；产品 build 不包含 POC UI。
3. 所有 Agent request/response、guide、manifest、source catalog、plan、review、narration 和 final timeline 先 schema 校验。
4. Agent 不可用不影响录制；没有合法 Agent response 时不伪造 guide/edit/narration 成功。
5. observer/result evaluator 不执行业务动作。
6. 原始脚本、capture、events、Agent response 和 agent plan 永不覆盖。
7. review UI 能完成设计要求的批准、边界调整、attempt/source 选择、等待策略、pickup 和局部 preview。
8. pickup 不改变其他已批准 Segment；连续性不确定时进入人工审核。
9. final 只使用 effective plan + approved narration；音频、字幕和视频共享 final timeline。
10. 每个阶段都有独立 verifier，integration/E2E 有固定 npm script。
11. 真实 TTS 只在存在 `DASHSCOPE_API_KEY` 时执行；无凭据路径必须可复核。
12. `video-runs/`、dist、关键帧、媒体和日志不得进入提交。

## 失败处理矩阵

| 失败 | 行为 | 可恢复入口 |
|---|---|---|
| Agent guide/edit/narration response 无效 | 拒绝 apply，保留 request/response 和字段错误 | 修订 response 后重新 apply |
| Chromium/source 绑定失败 | 保留浏览器，F7 禁用，不创建空视频 | 重新检测或退出 |
| overlay/快捷键失败 | 报告具体 channel/key；可用按钮时继续 | overlay 按钮或 CLI 结束 |
| observer/result evaluator 失败 | 录像继续，Action 等待 F8 | F8 人工确认 |
| capture 中断 | flush chunk/events，停止 Action，manifest incomplete | `video:record --recover` + pickup |
| preview/局部 preview 失败 | 保留 plan/source/stderr | 修复后重跑 preview |
| pickup 失败 | source 标记 failed，不改 effective plan | 再次 pickup |
| review 未完成 | 禁止 narration/finalize | `video:review` |
| TTS 失败 | 保留已成功音频和 provider 错误，无 final | 重跑 finalize |
| final ffmpeg 失败 | 保留 timeline/audio/SRT/stderr，无伪 final | 重跑 finalize |

## 计划自检

- 设计第 4–6 节：Task 1–2 明确 Agent/CLI 边界和 guide 交接。
- 第 7–8 节：Task 3–5 覆盖正式 overlay、准备/倒计时、快捷键、Action、结果状态、多 tab 和 capture。
- 第 9–11 节：Task 1、6 覆盖协议、source catalog、剪辑策略和保护规则。
- 第 12–14 节：Task 7–9 覆盖三栏 review、pickup、Agent narration、TTS/SRT/final 和全部产品命令。
- 第 16–19 节：Task 4–6、8–9 覆盖时钟、关键帧、失败恢复和人工 gate。
- 第 21–23 节：Task 10 覆盖 unit、Electron integration、fixture、端到端和最终验收。
- 文件路径无“或”“视情况”选择；每个命令、测试 script、verifier 和提交文件均有确定入口。
