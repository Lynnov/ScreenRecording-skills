# 人工录制与 Agent 辅助剪辑设计

> 创建时间：2026-07-17  
> 状态：设计基线已确认，暂未进入实施计划

## 1. 背景与目标

当前主流程为：

```text
Markdown → Timeline → TTS → Playwright 自动操作与连续录制 → ffmpeg 合成
```

真实业务页面中的 Playwright 自动操作存在两个主要问题：

1. 为保证 actionability、等待页面状态和语义匹配，执行速度偏慢；
2. 动态弹窗、重复文案、远程下拉、遮罩层和正式录制时序会导致结果随机、失败率偏高。

本设计保留现有自动录制流程，同时新增一条人工录制流程：网页操作由人完成，系统负责窗口捕获、页面事件观察、录制步骤推断、素材管理、Agent 初剪、TTS、字幕与最终合成。

第一版重点不是完全无人审核，而是让人工操作稳定、AI 初剪可解释、单段错误可补录，显著降低手工剪辑成本。

## 2. 已确认的产品原则

- 保留现有 Playwright 自动录制模式，不做替换式重构；
- 新增 `manual` 人工录制模式；
- 人负责所有业务页面操作，系统不自动点击、填写、登录或切换标签页；
- Playwright 只观察页面事件和状态，不执行业务动作；
- Electron 捕获指定 Chromium 窗口，并显示独立悬浮控制窗；
- 人工录制阶段不采集系统声音或麦克风；
- 第一版由兼容 Agent 承担脚本拆解、素材分析和剪辑推理，不绑定具体 Agent 产品、模型或供应商；
- CLI 承担确定性录制、数据校验、素材管理和 ffmpeg 渲染；
- 原始 Markdown、原始视频和旧补录素材永不覆盖；
- Agent 只输出结构化剪辑建议，不直接修改原始素材；
- 用户审核决定与 Agent 建议分开保存；
- 第一版暂不考虑隐私、脱敏和业务数据外传限制。

## 3. 总体架构

采用“双流程并存、共用后处理协议”的结构。

```text
                         Markdown
                            │
                    ┌───────▼────────┐
                    │ Timeline / Guide│
                    └───────┬────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
    ┌─────────▼──────────┐      ┌────────▼──────────┐
    │ Automatic Runner   │      │ Manual Runner      │
    │ Playwright 自动操作│      │ 人工窗口录制       │
    └─────────┬──────────┘      └────────┬──────────┘
              │                           │
              └─────────────┬─────────────┘
                            │
                 ┌──────────▼──────────┐
                 │ RecordingBundle     │
                 │ clip/events/attempts│
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Agent edit-plan     │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ preview / finalize  │
                 │ TTS / SRT / ffmpeg  │
                 └─────────────────────┘
```

产品上保持两条独立流程；代码中只抽取稳定、确有共性的录制结果与后处理接口，不一次性重构现有 pipeline。

## 4. 第一阶段的 AI 与 CLI 边界

采用“确定性 CLI + Agent 辅助推理”。

### CLI 负责

- 启动专用 Chromium；
- 打开脚本起始 URL；
- Electron 窗口捕获；
- 悬浮窗、全局快捷键和录制状态机；
- 页面事件、标签页事件和用户标记采集；
- 原始录像、补录素材和事件日志落盘；
- recording guide、manifest、edit plan 的 schema 校验；
- 关键帧抽取；
- preview 和 final 的 ffmpeg 渲染；
- TTS、字幕和报告输出。

### 兼容 Agent 负责

- 将不够清晰的 Markdown 拆解成 `Segment + Action`；
- 为 Action 生成事件匹配条件和结果状态；
- 根据事件日志、关键帧和必要的短视频片段生成 `edit-plan.json`；
- 生成 `edit-report.md`；
- 根据确认后的有效画面时长生成最终旁白稿；
- 根据用户审核意见修订 guide、edit plan 或旁白稿。

第二阶段再将已经稳定的 Agent 推理能力抽象成 AI provider 内置 CLI，录制与渲染层不重写。

## 5. 人工录制流程

```text
1. 用户提供 Markdown 原始脚本
2. Agent 生成 recording-guide.json
3. 默认直接进入录制，也可先审核 guide
4. CLI 启动专用 Chromium 和 Electron 悬浮窗
5. CLI 自动打开起始 URL
6. 用户自行登录并准备页面
7. 用户点击开始录制或按 F7
8. 3 秒倒计时后进入正式素材区间
9. 用户人工执行页面操作
10. 本地事件规则推断当前 Action
11. 高置信度自动推进；中低置信度等待 F8
12. 自动推进错误时使用 Shift+F8 修正步骤指针
13. 操作出错时，用户先恢复页面，再按 F9 创建新 attempt
14. F10 二次确认后结束录制
15. Agent 生成 edit-plan 和初剪报告
16. CLI 生成 preview.mp4
17. 用户审核；有问题时按 Segment 补录
18. 用户确认全部 Segment
19. Agent 生成最终旁白稿
20. CLI 生成 TTS、字幕和 final.mp4
```

## 6. 脚本结构化模型

现有 Markdown 不够清晰，且一段可能包含多个连续操作，因此人工录制清单使用两级结构：

```text
Segment：用于旁白、字幕和最终剪辑段
└── Action：用于录制步骤推断和事件对齐
```

示例：

```text
Segment 3：填写订单信息
├── Action 3.1：点击新增
├── Action 3.2：选择客户
├── Action 3.3：选择收货地址
├── Action 3.4：填写订单数量
└── Action 3.5：点击保存
```

`recording-guide.json` 默认生成后直接使用；复杂脚本可以通过可选审核入口先调整 guide。原始 Markdown 不因结构化而被覆盖。

## 7. 录制控制与交互

### 7.1 状态机

```text
preparing
→ countdown
→ recording
→ finishing
→ analyzing
→ review-ready
```

Segment 补录使用：

```text
pickup-preparing
→ pickup-recording
→ pickup-finishing
→ segment-analyzing
→ review-ready
```

### 7.2 Electron 悬浮窗

悬浮窗始终展开，默认停靠右上角，要求：

- 始终置顶；
- 不进入 Chromium 窗口录像；
- 默认不抢焦点；
- 可拖动；
- 显示录制状态和计时；
- 显示当前 Segment、Action、attempt 和下一步；
- 显示事件推断、置信度和异常提示；
- 支持按钮和全局快捷键；
- 新标签页出现时提示用户手动切换；
- 不展示复杂调试信息。

### 7.3 快捷键语义

| 快捷键 | 语义 |
|---|---|
| `F7` | 从准备状态开始正式录制 |
| `F8` | 人工确认当前 Action 完成 |
| `Shift + F8` | 将步骤指针返回上一个 Action，不自动恢复网页 |
| `F9` | 用户恢复页面后，从当前时刻开始当前 Action 的新 attempt |
| `F10` | 请求结束录制；检查未确认步骤并二次确认 |

`F9` 支持任意次数连续重试。最终剪辑使用最后一个被确认成功的 attempt，而不是简单使用最后一次 attempt。

### 7.4 实时推断

采用“页面事件规则优先，视觉 AI 兜底”：

```text
页面事件与结果状态
→ 本地规则匹配
→ 高置信度：自动确认并推进
→ 中低置信度：必要时分析关键帧
→ 仍不明确：停留并等待 F8
```

高置信度至少需要目标事件匹配，或目标事件与预期页面结果共同匹配；不能仅因为发生了一次点击就推进。

第一阶段的实时视觉兜底是可选增强，不是录制成功的硬依赖。Agent 会话或视觉模型可用时，可以异步分析关键帧；不可用、超时或结果不明确时，悬浮窗直接等待用户按 `F8`，不得阻塞或终止录像。录制结束后的离线 Agent 初剪仍按本设计执行。

## 8. 浏览器与捕获边界

### 8.1 第一版平台

- 仅支持 Windows 10/11；
- 最终输出固定为 `1920×1080`、16:9；
- 录制接口保留 capture provider 边界，后续再支持其他平台。

### 8.2 Chromium 窗口捕获

人工模式不使用 Playwright `recordVideo` 作为主录制后端，而由 Electron 捕获指定 Chromium 窗口。

优先使用 F11 全屏；若 F11 与悬浮窗置顶或 Windows 显示设置冲突，则降级为无边框最大化 Chromium。

支持：

- 同一 Chromium 窗口内的多个标签页；
- SPA 路由、页面刷新、弹窗、抽屉和普通页面跳转；
- 用户手动切换标签页；
- Playwright 观察所有 Page 的事件。

第一版不支持：

- 独立 popup 浏览器窗口；
- 其他桌面应用；
- 整个显示器录制；
- 自动切换新标签页。

系统文件选择器不属于 Chromium 窗口，通常不进入录像；其等待区间由后期压缩或删除。

### 8.3 虚拟鼠标

- 由真实 `pointermove` 驱动网页内虚拟指针；
- 点击显示波纹；
- 不拦截网页事件；
- 页面内容区域隐藏原生鼠标，避免双指针；
- 新标签页自动注入；
- 浏览器外窗口不显示虚拟指针。

## 9. 核心数据协议

### 9.1 `recording-guide.json`

由 Agent 生成，服务于悬浮窗、实时推断、素材对齐、补录和最终旁白。

```json
{
  "version": 1,
  "title": "供应商端审核修改交期申请",
  "startUrl": "https://example.com/order",
  "segments": [
    {
      "id": "segment-001",
      "title": "打开交期申请",
      "narrationIntent": "介绍如何进入修改交期申请页面",
      "actions": [
        {
          "id": "action-001",
          "instruction": "点击‘修改交期’",
          "expectedEvents": [{ "type": "click", "text": "修改交期" }],
          "expectedResults": [{ "type": "dialog-visible", "text": "修改交期申请" }]
        }
      ]
    }
  ]
}
```

### 9.2 `events.jsonl`

事件日志按行追加，程序异常退出时已写入内容仍可保留。

```jsonl
{"timeMs":0,"type":"recording-start"}
{"timeMs":1240,"type":"pointer-click","tabId":"tab-1","text":"修改交期"}
{"timeMs":1570,"type":"dialog-visible","tabId":"tab-1","text":"修改交期申请"}
{"timeMs":1620,"type":"action-confirmed","actionId":"action-001","confidence":"high"}
{"timeMs":6200,"type":"retry-start","actionId":"action-002","attempt":2}
{"timeMs":9400,"type":"tab-created","tabId":"tab-2","url":"https://example.com/detail"}
{"timeMs":10100,"type":"tab-activated","tabId":"tab-2"}
{"timeMs":42100,"type":"recording-stop"}
```

事件至少覆盖：录制起止、点击、输入、选择、滚动、URL、标签页、页面结果、Action 确认、回退、重试、Segment 边界、关键帧和视觉判断。

### 9.3 `recording-manifest.json`

描述实际录制素材和 attempt，不包含 AI 剪辑决定。

```json
{
  "video": {
    "path": "capture/original-window.mp4",
    "width": 1920,
    "height": 1080,
    "durationMs": 125000
  },
  "recordingStartMs": 18342,
  "recordingEndMs": 117420,
  "eventsPath": "capture/events.jsonl",
  "tabsPath": "capture/tabs.json",
  "attempts": [
    {
      "actionId": "action-003",
      "attempt": 1,
      "startMs": 32000,
      "endMs": 41000,
      "status": "discarded"
    },
    {
      "actionId": "action-003",
      "attempt": 2,
      "startMs": 41000,
      "endMs": 47800,
      "status": "confirmed"
    }
  ]
}
```

### 9.4 `edit-plan.json`

Agent 生成结构化剪辑决定，由校验器验证后交给 ffmpeg 执行。

```json
{
  "version": 1,
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "segments": [
    {
      "segmentId": "segment-002",
      "title": "填写客户信息",
      "clips": [
        {
          "sourceId": "original",
          "sourceStartMs": 20300,
          "sourceEndMs": 26800,
          "playbackRate": 1
        },
        {
          "sourceId": "original",
          "sourceStartMs": 31200,
          "sourceEndMs": 37200,
          "playbackRate": 2
        }
      ],
      "holdLastFrameMs": 1500,
      "transition": "short-fade",
      "confidence": "high",
      "reason": "删除第一次失败尝试，并压缩无操作等待"
    }
  ]
}
```

第一版允许：保留、删除、局部加速、末帧定格、短淡化和 Segment 补录素材替换。

### 9.5 `edit-review.json`

用户审核结果单独保存，不覆盖 Agent 原始建议。

```json
{
  "decisions": [
    { "segmentId": "segment-002", "status": "approved" },
    {
      "segmentId": "segment-003",
      "status": "pickup-required",
      "reason": "商品数量输入被弹窗遮挡"
    }
  ]
}
```

只有全部必要 Segment 已确认后，正式渲染才可开始。

## 10. 素材目录

```text
video-runs/<run>/
├── scripts/
│   ├── original.md
│   ├── polished.md
│   ├── executable.md
│   ├── recording-guide.json
│   └── narration-final.md
├── capture/
│   ├── original-window.mp4
│   ├── events.jsonl
│   ├── tabs.json
│   ├── recording-manifest.json
│   └── keyframes/
├── pickups/
│   └── segment-003-attempt-001.mp4
├── edit/
│   ├── edit-plan.json
│   ├── edit-review.json
│   ├── edit-report.md
│   ├── preview-timeline.json
│   └── preview.mp4
├── audio/
├── subtitles.srt
├── final.mp4
└── reports/
```

保护规则：

```text
原始 Markdown          永不覆盖
原始视频              永不覆盖
events.jsonl           只追加
recording-guide.json   可修订并保留版本
edit-plan.json         Agent 建议，可重新生成
edit-review.json       用户最终决定
final.mp4              只由已确认计划生成
```

## 11. 平衡剪辑策略

### 11.1 自动删除

- 正式录制前的准备画面；
- 正式录制后的多余画面；
- 被 F9 废弃的 attempt；
- attempt 之间用于恢复页面的过程；
- 被 Segment 补录替换的旧素材；
- 明确无关的标签页或空白页面。

### 11.2 默认原速保留

- 点击目标前的短鼠标移动；
- 点击及结果反馈；
- 字段填写的关键过程；
- 下拉打开、搜索和选择；
- 有教学意义的滚动；
- 提交后的结果展示。

### 11.3 可压缩

- 页面和接口等待；
- 长时间静止；
- 鼠标寻找和犹豫；
- 文件选择器等待；
- 无教学信息的重复滚动。

第一版约束：正常操作不变速；等待片段默认不超过 `2×`；超长等待可删除中间部分；跳剪只用短淡化，不使用夸张转场。

### 11.4 可延长

旁白长于有效画面时按以下优先级处理：

1. 保留操作完成后的结果画面；
2. 延长 Segment 最后一帧；
3. 延长关键状态画面；
4. 精简旁白表达；
5. 仍无法匹配时标记 Segment 补录。

第一版单次末帧定格原则上不超过 5 秒。

## 12. 旁白与字幕

采用“先录制和初剪，再生成最终旁白”：

```text
人工录制
→ 平衡初剪
→ 用户确认有效画面
→ Agent 根据画面时长生成 narration-final.md
→ TTS
→ 字幕
→ 最终音画对齐
```

Agent可以精简重复表达、调整句序、拆分长句和调整停顿，但不能改变业务含义、测试数据或编造画面中未发生的操作。

若真实 TTS 略长，优先延长结果画面或调整句间停顿；仍不匹配则重新精简旁白，不使用高倍语音变速强行压缩。

## 13. 初剪审核与 Segment 补录

审核界面采用三栏布局：

```text
左侧：Segment 和问题列表
中间：preview.mp4 和简化时间轴
右侧：Agent 决定、理由、置信度和快速修正
```

用户可：

- 接受 Segment；
- 调整起止边界；
- 改用其他 attempt；
- 保留或压缩等待；
- 标记 Segment 补录；
- 查看 Agent 理由；
- 重新生成局部预览。

录制过程中按 Action 重试；录制结束后只支持 Segment 级补录。补录生成独立 source，Agent 只重算该 Segment，其他已确认 Segment 保持不变。

## 14. CLI 边界

建议提供以下确定性入口：

```bash
# 人工录制
npm run video:record -- --script examples/xxx.md --output video-runs/xxx

# 根据 edit plan 生成初剪
npm run video:preview -- --run video-runs/xxx

# 补录指定 Segment
npm run video:pickup -- --run video-runs/xxx --segment segment-003

# 生成正式成片
npm run video:finalize -- --run video-runs/xxx
```

现有自动模式命令保持不变。

## 15. 模块边界

建议按职责拆分：

```text
src/lib/video-generator/
├── recording/
│   ├── types.ts
│   ├── guide.ts
│   ├── event-log.ts
│   ├── session.ts
│   ├── action-tracker.ts
│   ├── tab-observer.ts
│   └── keyframes.ts
├── capture/
│   ├── types.ts
│   └── windows-electron.ts
├── recording-overlay/
│   ├── main.ts
│   ├── preload.ts
│   └── renderer.ts
├── editing/
│   ├── types.ts
│   ├── validator.ts
│   ├── preview.ts
│   ├── finalize.ts
│   └── report.ts
└── browser/
    ├── recorder.ts
    └── manual-observer.ts
```

隔离原则：

1. `manual-observer` 不执行任何业务点击或填写；
2. Electron 不理解业务脚本，只展示状态和发送用户命令；
3. Agent 只生成结构化决策；
4. ffmpeg 只执行已校验的 edit plan；
5. 人工模式不把特殊逻辑塞入现有自动 recorder。

## 16. 统一时钟

窗口视频和页面事件必须使用同一录制会话的单调时钟。

每个事件保留：

- `sessionTimeMs`：从工具启动开始；
- `videoTimeMs`：从捕获视频第一帧开始。

正式录制起点通过 `recording-start` 事件标记，不重新定义底层时钟。录制结束后校验视频实际时长与事件时钟；如果存在持续漂移，manifest 必须报告并阻止静默生成成片。

## 17. 关键帧策略

本地程序根据事件自动抽帧：

- 点击前约 300ms；
- 点击后约 500ms；
- 输入开始和结束；
- 弹窗出现和消失；
- URL 变化后；
- 标签页切换后；
- Action 自动或人工确认时；
- F9、Shift+F8 和 Segment 完成时。

额外按 2–3 秒低频抽帧，用于发现长等待和寻找过程。第一阶段不做逐帧视觉理解，也不默认上传整条视频。

## 18. 失败处理

### Chromium 启动失败

不启动悬浮窗、不创建空视频，明确报告浏览器路径和启动参数。

### 找不到 Chromium 捕获源

保持浏览器打开，允许重新检测或由用户选择窗口；成功绑定前禁用 F7。

### 悬浮窗或快捷键失败

浏览器和捕获尽量继续；提供悬浮窗按钮和 CLI 备用结束入口；manifest 标记不完整。

### 页面事件监听失败

视频继续；当前 Action 变为中低置信度；用户可按 F8 确认。事件监听失败不能终止整条录制。

### 窗口捕获中断

立即停止 Action 推进；尽量落盘已有分块；记录中断时间；允许保留中断前的 Segment，并通过 Segment 补录恢复。

### Agent 输出无效

所有 guide、manifest 和 edit plan 使用 schema 校验。引用不存在、时间越界、区间倒置、倍速非法或未审核 Segment 等情况必须拒绝执行，并指出具体字段。

### ffmpeg 预览失败

原始素材和 edit plan 不受影响；保留 stderr；报告具体 source、Segment 和时间区间；修正后可独立重试。

## 19. Agent 不可静默决定的情况

以下情况必须进入人工审核：

- 无法确认操作是否成功；
- 多个 attempt 都可能有效；
- Segment 缺少结尾状态；
- 计划删除超过 Segment 一半素材；
- 正常操作需要超过 `2×` 加速；
- 需要超过约 5 秒末帧定格；
- 补录和相邻 Segment 状态明显不连续；
- 旁白无法在不改变业务含义的情况下适配画面。

## 20. POC 顺序

正式接入 Agent 推理之前，先验证确定性基础设施。

### POC 1：窗口捕获

验证指定 Chromium、多标签页连续录像、悬浮窗不入镜、1920×1080 输出，以及 F11/无边框最大化兼容性。

### POC 2：统一时钟

验证事件与画面的时间对应、长录制漂移、F7/F9/F10 标记精度。

### POC 3：事件采集和虚拟鼠标

验证点击、填写、下拉、滚动、新标签页注入、虚拟指针和异常页面行为。

### POC 4：多源 Segment 渲染

使用原始录像和补录素材验证多 source trim、加速、定格、淡化和 preview 输出。

四个 POC 通过后，再接入 Agent 脚本拆解和剪辑推理。

## 21. 测试边界

### 单元测试

- 数据 schema；
- 录制状态机；
- F7/F8/F9/F10 语义；
- 任意次数 Action 重试；
- Action 回退；
- Segment 审核状态；
- 时间区间和时钟漂移校验；
- 补录 source 替换；
- 失败恢复报告。

### Electron 集成测试

- IPC；
- 始终置顶；
- 快捷键注册和注销；
- 悬浮窗按钮不抢 Chromium 焦点；
- 关闭后的清理。

### 本地 fixture

覆盖普通表单、Element UI 远程下拉、弹窗、SPA、新标签页、多次 F9、F8 人工确认和失败恢复。

### 端到端验证

至少完成：

1. 单标签页人工录制；
2. 多标签页人工录制；
3. Action 多次重试；
4. Segment 补录；
5. 初剪预览；
6. TTS、字幕和 final.mp4 正式生成。

## 22. 第一版范围

### 包含

- Windows 10/11；
- 1920×1080、16:9；
- 自动与人工模式并存；
- 专用 Chromium 与指定窗口捕获；
- 多标签页人工录制；
- Electron 始终展开悬浮窗；
- 页面事件优先、视觉判断兜底；
- Action 任意次数重试；
- Segment 级补录；
- Agent 辅助 recording guide 和 edit plan；
- 平衡剪辑；
- 初剪预览和三栏审核；
- 初剪确认后生成 TTS、字幕和 final.mp4。

### 不包含

- macOS、Linux；
- 独立 popup；
- 其他桌面应用；
- 整屏录制；
- 系统声音或麦克风；
- 暂停与继续；
- 单 Action 的录制后补录；
- 自动恢复页面状态；
- 自动登录；
- 自动切换标签页；
- 专业多轨剪辑；
- 任意重排业务操作；
- 完全无人审核；
- 第一版内置 AI provider；
- 隐私和业务数据治理。

## 23. 验收标准

第一版成功不要求 Agent 一次性完美剪辑，而要求：

1. 人工操作不再受到 Playwright 自动操作速度和随机失败影响；
2. 录制过程只需少量快捷键修正；
3. 明确标记的重试能稳定自动删除；
4. 大部分 Segment 能自动形成合理初剪；
5. 不确定内容明确进入审核，而不是静默误剪；
6. 单个 Segment 有问题时无需整条重录；
7. 初剪审核时间明显低于从头手工剪辑；
8. 最终复用现有 TTS、字幕、ffmpeg 和报告能力；
9. 原有自动录制模式继续可用。
