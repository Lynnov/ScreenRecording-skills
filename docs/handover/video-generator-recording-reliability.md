> 产品思考见 [docs/insights/video-generator-recording-reliability.md](../insights/video-generator-recording-reliability.md)

# 视频生成器录制可靠性二期交接文档

## 模块边界

- `src/lib/video-generator/types.ts`：定义 `StageDefinition`、`StageDiagnostic`、`ActionFailureDiagnostics` 和相关报告字段。
- `src/lib/video-generator/script-parser.ts`：解析 `@stage` 行，把后续 action 绑定到最近 stage。
- `src/lib/video-generator/preflight.ts`：检查 stage scope 和 anchors，生成 `stageDiagnostics`。
- `src/lib/video-generator/browser/actions.ts`：执行浏览器动作，失败时收集 action diagnostics。
- `src/lib/video-generator/browser/interaction-rules.ts`：收集 remoteSelect dropdown/popper 诊断。
- `src/lib/video-generator/browser/recorder.ts`：录制失败时截图，并把 screenshotPath 合并到 diagnostics。
- `src/lib/video-generator/pipeline.ts`：失败时把 failedAction、screenshotPath、diagnostics 写入 run report。
- `src/lib/video-generator/report.ts`：写入 `run-report.json` 和 `preflight-report.json`，并保持敏感输入脱敏。

## 脚本语法

```md
@stage orderEntry.list scope="main" anchor="input[placeholder='请输入客户名称/手机号']"
打开 https://example.com/order-entry
点击「新增」

@stage orderEntry.createDialog scope=".el-dialog:visible" anchor="text=新增订单" anchor="input[placeholder='请选择客户名称']"
远程选择「客户名称」为「测试客户」
点击「生成订单」
```

规则：

- `@stage <name>` 切换当前页面阶段。
- `scope=` 可选，用于限定弹窗、抽屉、下拉层等局部查找范围。
- `anchor=` 可重复，用于 preflight 判断 stage 是否命中。
- 同一段落内可以多次切换 stage，action 绑定最近一次 stage。
- 同名 stage 重复声明时合并 anchors 并去重。
- 旧脚本不写 `@stage` 时保持兼容。

## 数据流

1. `parseVideoScript` 解析可执行稿，生成 `Timeline.stages` 和 action 上的 `stageName`。
2. `runPreflightChecks` 遍历 stage，检查 scope 和 anchors，输出 `stageDiagnostics`。
3. `writePreflightReport` 写入 `preflight-report.json`。
4. 正式录制中，`executeBrowserAction` 捕获失败并生成 `ActionFailureDiagnostics`。
5. `recordTimelineSegments` 捕获失败截图，把 screenshotPath 合并进 diagnostics。
6. `runVideoGenerator` 生成失败 `RunReport`。
7. `writeRunReport` 写入脱敏后的 `run-report.json`。

## 诊断字段

### StageDiagnostic

- `stageName`：页面阶段名。
- `scope`：局部容器 selector。
- `scopeMatched`：scope 是否命中。
- `scopeCount`：scope 命中数量。
- `anchors`：每个 anchor 的 selector、matched、count。
- `missingAnchors`：未命中的 anchors。

### ActionFailureDiagnostics

- `url`：失败时页面 URL。
- `stageName`：失败 action 归属 stage。
- `actionType`：失败 action 类型。
- `selector`：实际查找 selector。
- `candidateCount`：真实候选总数。
- `candidates`：最多前 5 个候选详情。
- `overlayElement`：目标中心点上方遮挡元素。
- `dropdowns`：remoteSelect 下拉诊断。
- `missingText`：等待或选择中缺失的文本。
- `failureReason`：归一化失败原因。
- `screenshotPath`：录制器失败截图路径。

## 关键设计决策

- Stage 是 UI 状态别名，不是页面路由别名；弹窗必须用 visible scope + anchors 识别。
- Stage 信息只进入可执行稿，避免污染原始业务脚本。
- Playwright 仍然是操作执行层，不引入坐标点击或图像识别作为默认兜底。
- 诊断包用于解释失败现场，帮助区分页面慢、selector 歧义、弹窗未进入、元素被遮挡和 dropdown 未加载。
- `candidateCount` 记录真实匹配总数，`candidates` 只采样前 5 条，避免报告过大。
- `fill.value` 和 `remoteSelect.keyword` 在报告中继续脱敏。

## 失败模式

- scope 未命中：preflight 会报告 missing scope，优先修 stage scope。
- anchor 未命中：preflight 会列出 missing anchors，优先确认页面阶段是否正确。
- 候选过多：run report 的 `candidateCount` 会显示真实数量，需要收紧 selector 或 stage scope。
- 元素被遮挡：`overlayElement` 会显示遮挡元素摘要。
- remoteSelect 失败：`dropdowns` 会显示 popper 数量、可见项数量和隐藏容器数量。
- 正式录制失败：recorder 会附加截图路径，便于对照视频或截图复盘。

## 验证

- `npm run test` 已通过，113 个单测全绿。
- 未在本阶段跑真实业务站录制；真实端到端验证仍需有效登录态、TTS 凭据和本机 ffmpeg/ffprobe。
