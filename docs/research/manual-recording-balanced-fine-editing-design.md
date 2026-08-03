# 人工录制平衡精剪与受控自进化设计

> 日期：2026-08-03
> 状态：待用户评审
> 适用范围：人工录制、Segment pickup、Agent 粗剪、真实 TTS、final timeline 与 ffmpeg finalize

## 1. 背景

现有人工录制流程已经具备 Agent 粗剪、用户审核、pickup、旁白、TTS 和 finalize，但粗剪通过后，真实 TTS 只用于在旁白长于画面时延长末帧；旁白短于画面时不会触发二次节奏调整。音频合并会为每个 Segment 补静音直至已审核画面结束。

真实验收 run `video-runs/manual-acceptance-rawpaper-master-order-20260803` 暴露了该问题：最终画面 96.667 秒，真实旁白合计 29.760 秒，旁白结束后的累计空余画面为 66.907 秒。技术合成成功不代表剪辑质量合格。

本设计保留现有粗剪和唯一一次人工审核，在真实 TTS 后增加自动精剪与质量门槛，不增加常规人工审核步骤。

## 2. 目标

- 采用平衡模式：旁白控制节奏，关键操作控制最低时长。
- 用户只进行一次常规审核，用于确认内容正确性、素材来源和 pickup。
- 自动精剪删除误操作、重复输入、大面积空白和无教学意义的等待。
- 关键点击、最终有效输入、保存和结果反馈不得丢失或改变顺序。
- 真实 TTS 参与最终时长决策，但不强制画面严格等于旁白时长。
- final 只有在不存在硬失败时才生成；软质量问题允许输出带警告的 final。
- 剪辑规则版本化、可追溯、可回滚，并允许受控自进化。

## 3. 非目标

- 不增加第二次常规人工审核。
- 不让 Agent 自由改写硬规则。
- 不使用高倍变速处理点击、输入、保存或结果反馈。
- 不把技术渲染成功等同于质量完全通过。
- 不覆盖原始录制、pickup、原始 Agent plan 或历史 final。

## 4. 最终流程

```text
真实人工录制
→ Agent 粗剪（内容选择）
→ 用户唯一一次审核（通过 / pickup）
→ Agent 最终旁白
→ 真实 TTS
→ 自动精剪（节奏优化）
→ 自动质量验证
→ ffmpeg finalize
→ final：quality=passed 或 quality=warning
```

### 4.1 粗剪职责

粗剪继续决定：

- Segment 使用哪个 original/pickup source；
- 哪段素材包含必要业务操作；
- 操作和结果是否完整；
- 是否需要 pickup；
- 用户需要审核的内容边界。

粗剪不负责根据尚未生成的真实 TTS 做最终节奏收口。

### 4.2 自动精剪职责

自动精剪读取已审核 effective plan、source-specific events、抽帧分析结果和真实 TTS 时长，在不改变业务顺序的前提下生成独立的 fine edit plan。

自动精剪不得修改用户已选择的 source，不得引入未审核 source，不得删除必要操作事件。

## 5. 规则文件与运行产物

### 5.1 默认规则

项目内维护受版本控制的机器可读默认规则：

```text
src/lib/video-generator/manual/fine-edit-rules.default.json
```

默认规则包含硬规则、软参数范围、质量阈值和自进化边界。硬规则不能由运行时学习修改。

### 5.2 本地学习配置

跨 run 的本地学习配置保存于已忽略的运行数据目录：

```text
video-runs/.manual-fine-edit-learning/
├── current.json
├── profile.v01.json
├── profile.v02.json
└── evidence.vNN.json
```

`current.json` 只保存当前 profile 指针。每次晋升创建新版本，不覆盖历史版本。

### 5.3 单次 run 快照

每次精剪必须把实际生效规则复制到当前 run：

```text
<run>/edit/fine-edit-rules.snapshot.json
<run>/edit/edit-plan.fine.vNN.json
<run>/edit/edit-plan.fine.current.json
<run>/reports/fine-edit-quality.json
<run>/reports/fine-edit-learning-candidate.json
```

final report 必须引用规则版本、规则快照哈希、fine plan 和质量报告。

## 6. 剪辑数据模型

fine edit clip 在现有 source、范围和倍速基础上增加用途与证据：

```json
{
  "sourceId": "segment-004-attempt-003",
  "sourceStartMs": 14200,
  "sourceEndMs": 15600,
  "playbackRate": 5,
  "clipKind": "mistake-wait",
  "evidenceEventIds": [],
  "reason": "同一输入框最终有效输入前的 1.4 秒误操作等待"
}
```

`clipKind` 允许值：

- `context`：动作前必要上下文；
- `action`：点击、输入、选择等关键操作；
- `result`：保存结果或状态反馈；
- `idle`：普通短等待；
- `mistake-wait`：误操作链中的等待；
- `transition`：删除中间素材后的短衔接。

倍速上限按用途固定：`context`、`action`、`result` 保持 1 倍；普通 `idle` 最多 2 倍；只有满足误操作证据且持续时间大于 1 秒、不超过 3 秒的 `mistake-wait` 固定使用 5 倍。

## 7. 自动精剪规则

### 7.1 必要事件锚点

每个 Segment 从 recording guide 和审核后的语义约束得到必要事件集合，例如：

- 点击管理出库单；
- 选择左侧批次；
- 修改客户签收单价；
- 修改订单量；
- 点击保存；
- 保存后的结果或稳定页面。

精剪后所有必要事件必须按原顺序被 clip 覆盖。每个动作默认保留动作前 500 毫秒上下文和动作后 500 毫秒反馈；最终结果默认保留 1000 毫秒，可在允许范围内自适应至 800～2000 毫秒。

### 7.2 同一输入框反复输入

系统使用页面、frame、表格行上下文、字段标签、DOM id/name/type 和空间邻近关系生成稳定 `targetKey`。

同一 Segment、同一 `targetKey` 的连续输入尝试按以下规则处理：

1. 找到最终产生有效 `change`、`blur`、后续保存或结果反馈的最后一次输入簇；
2. 保留最后一次输入簇及其必要前后文；
3. 删除此前的清空、输错、重复修改和犹豫过程；
4. 不同 `targetKey` 分别处理，不能因为单价和订单量都属于 input 而合并；
5. 无法稳定区分输入框时不得自动删除，输出 `AMBIGUOUS_INPUT_TARGET` 警告。

事件日志不得记录或恢复敏感字段明文；目标识别只能使用现有脱敏元数据和画面证据。

### 7.3 等待与误操作

- 不超过 1 秒的必要等待：原速保留。
- 大于 1 秒且不超过 3 秒的普通等待：作为 `idle` clip，最多加速到 2 倍。
- 大于 1 秒且不超过 3 秒、并具有误操作证据的等待：作为独立 `mistake-wait` clip，固定以 5 倍速播放。
- 超过 3 秒且没有必要事件或教学信息：删除中间部分。
- 无效点击、打开错误区域后立即返回、最终输入前的废弃尝试：在不影响上下文时删除整个操作窗口。
- 点击、输入、保存和结果反馈必须保持 1 倍速。
- 5 倍速只能用于经分类器和校验器共同确认的 `mistake-wait`，不能用于普通 `idle`，也不能仅凭 Agent 声明放行。

删除中间素材后，如果前后画面出现明显跳变，使用 100～200 毫秒短淡化；不得使用夸张转场。

### 7.4 大面积空白屏

自动抽帧分析浏览器内容区域，组合使用亮度占比、边缘密度、视觉熵、相邻帧变化和事件邻接判断空白片段。

- 高置信度大面积白屏、空容器或无内容加载区直接删除。
- 点击入口与目标页面出现之间的空白全部删除，只保留点击和最终页面。
- 骨架屏或加载动画仅在有助于表达系统响应时保留 500～1000 毫秒。
- 最终结果尚未出现的空白帧不能充当结果停留。
- 检测置信度不足时不自动删除，输出 `AMBIGUOUS_BLANK_REGION` 警告。

### 7.5 时长目标

每个 Segment 的软目标为：

```text
targetDuration = max(
  actualTtsDuration + narrationTail,
  compressedRequiredActionDuration + resultReactionTime
)
```

默认值：

- `narrationTail = 1000ms`；
- `resultReactionTime = 1000ms`，允许在 800～2000ms 范围内自适应；
- 旁白结束后的普通无操作画面不得超过 2000ms；
- 如果旁白结束后必要操作仍在继续，允许超过 2000ms，但必须有必要事件证据和原因。

精剪优先级：删除废弃输入和误操作、删除空白、删除长等待、5 倍压缩 1～3 秒误操作等待、保留必要动作、保留结果反应时间。不得为了命中软目标删除关键操作。

## 8. 质量门槛

### 8.1 硬失败

以下情况阻止 final：

- 必要点击、最终有效输入、保存或结果反馈缺失；
- 必要事件顺序被改变；
- 使用了未经审核或不可用 source；
- clip 越界、音画无法解码或 final 媒体验证失败；
- 精剪后无法证明业务语义仍完整；
- 敏感输入被写入规则、报告或日志。

硬失败保留当前 run 和全部报告，不重开 run 掩盖问题。

### 8.2 可警告输出

以下情况允许输出带警告 final：

- 必要操作客观上长于 TTS 软目标；
- 低置信度空白区域为避免误删而保留；
- 输入目标无法稳定区分，因而保留了可能重复的输入；
- 达到允许的最大压缩后，仍存在超出软目标的非关键尾部；
- 质量指标略超阈值但不影响业务完整性和媒体可播放性。

### 8.3 报告语义

```json
{
  "ok": true,
  "renderOk": true,
  "quality": {
    "status": "warning",
    "rulesVersion": 1,
    "warnings": [
      {
        "segmentId": "segment-004",
        "code": "LONG_ACTION_AFTER_NARRATION",
        "message": "必要操作长于 TTS 软目标，已保留完整保存过程"
      }
    ]
  }
}
```

`ok=true` 表示 final 成功生成、没有硬失败且媒体可播放；`quality.status` 使用 `passed` 或 `warning` 表达剪辑质量状态。验证器必须同时展示这两个维度。

## 9. 受控自进化

### 9.1 不可进化的硬规则

- 必要事件覆盖率必须为 100%；
- 业务顺序不可改变；
- 最终有效输入优先；
- 保存和结果反馈不可删除；
- 操作 clip 不得高倍加速；
- 普通 `idle` 最多 2 倍，只有已证明且处于指定时长区间的 `mistake-wait` 才能使用 5 倍；
- source 必须来自用户审核范围；
- 敏感数据不得落盘。

### 9.2 可进化的软参数

- 动作前后上下文长度；
- 结果停留时间，范围 800～2000ms；
- 空白画面亮度、边缘和熵阈值；
- 短淡化长度，范围 100～200ms；
- 低运动等待的检测阈值；
- 质量警告的软阈值。

用户明确指定的等待分段边界（1 秒、3 秒）和误操作等待 5 倍速属于固定产品规则，不由学习器调整。

### 9.3 晋升条件

学习器只能生成结构化候选参数，不能生成可执行代码或改写硬规则。候选 profile 只有同时满足以下条件才自动晋升：

- 当前 final `ok=true`；
- `quality.status=passed`，不能为 warning；
- 所有必要事件覆盖率为 100%；
- 相比当前 profile，没有增加空白、重复输入或长尾指标；
- 参数全部位于允许范围内；
- 保存 evidence、来源 run、前后指标、规则哈希和上一版本指针。

候选未晋升时仍写入当前 run 报告，便于诊断。`current.json` 可原子切回任意历史 profile。

### 9.4 漂移保护

- 单次运行每个软参数最大调整 10%；
- 使用指数移动平均，避免单一业务页面主导全局配置；
- 连续出现 warning 或硬失败时自动回滚到上一 profile；
- 没有可量化证据时不调整参数；
- 学习状态损坏或缺失时回退到默认规则，不阻塞基础精剪。

## 10. 当前验收 run 的重剪要求

目标 run 固定为：

```text
E:\Code\ScreenRecording\video-runs\manual-acceptance-rawpaper-master-order-20260803
```

重剪时：

1. 不创建新 run；
2. 备份现有 `final.mp4`、`final-timeline.json`、`subtitles.srt` 和 final 报告为版本化历史；
3. 复用已经审批的 Segment 001～004、现有真实 TTS 和 source catalog；
4. 根据 original 与 pickup 各自的 events 文件生成 source-specific event anchors；
5. 生成 fine plan 和规则快照；
6. 通过硬校验后重新 finalize；
7. 输出 passed 或 warning final；
8. 对比重剪前后总时长、旁白覆盖率、每段尾部时长、删除/加速区间和必要事件覆盖率；
9. 保留所有失败报告，不用新 run 隐藏问题。

## 11. 验收标准

- 用户正常情况下只进行一次内容审核；
- Segment 001～004 的必要事件全部保留且顺序正确；
- 同一输入框仅保留最后一次有效输入，无法确定时给出警告；
- 1～3 秒误操作等待以 5 倍速处理；
- 高置信度大面积空白片段被删除；
- 旁白结束后的普通无操作尾部不超过 2 秒；
- TTS + 1 秒是软目标，必要操作可以使片段更长；
- final 媒体完整可播放，字幕、旁白、Segment 和画面对应；
- 硬失败不输出 final；软问题输出 `ok=true + quality.status=warning`；
- 规则、学习 profile、run 快照、fine plan 和报告均可追溯、可回滚；
- 当前验收 run 的旧 final 可恢复，且没有创建或切换到其他 run。

## 11. 2026-08-03 媒体清洗优先级修订

媒体清洗应前移到 Agent 粗剪/预览生成阶段，精剪阶段保留同一规则作为兜底：

- 坏帧、不可解码区间优先删除；
- 高置信度白屏和无意义加载区间优先于页面生命周期 `navigation` 事件；
- 如果候选白屏区间包含真实点击、输入、保存等用户操作，则不能直接删除，改为保留并输出 `AMBIGUOUS_BLANK_REGION` warning；
- `navigation` 只能作为上下文证据，不能保护整段白屏；
- 粗剪清洗结果必须记录删除区间、保留区间和冲突原因，供人工预览和后续精剪复用。

本次锁定 run 的 final 已先应用该优先级进行重剪；下一步将把媒体清洗从 finalize 兜底进一步复用到粗剪预览路径。
