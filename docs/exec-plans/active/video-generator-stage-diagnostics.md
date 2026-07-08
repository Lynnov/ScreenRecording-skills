# 视频生成器录制可靠性二期：Stage 别名与失败诊断包

> 创建时间：2026-05-29
> 最后更新：2026-05-29

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 需求收敛与边界确认 | 已完成 | 来源于原纸贸易订单录入录制复盘 |
| Phase 1 | Stage 别名脚本语法与类型 | 待开始 | 先支持页面/弹窗阶段声明，不做复杂流程编排 |
| Phase 2 | Stage 预检与报告接入 | 待开始 | 让 dry-run 和失败报告能说明“未进入哪个阶段” |
| Phase 3 | 浏览器动作失败诊断包 | 待开始 | 优先覆盖 click/fill/remoteSelect/uploadFile/waitFor |
| Phase 4 | 正式录制模式回归验证 | 待开始 | 覆盖 recordVideo、cursor overlay、慢 UI 场景 |
| Phase 5 | 文档与示例更新 | 待开始 | 更新 README、handover、insights、检查清单 |

## 决策日志

- 2026-05-29: 不把原始业务脚本改成技术脚本；继续保留“原始稿 / 润色稿 / 可执行稿”三稿结构，Stage、scope、稳定等待点只进入可执行稿。
- 2026-05-29: 页面阶段别名不是简单页面命名，而是“可稳定识别的 UI 状态”。独立页面用 URL 片段 + anchor；弹窗用 visible scope + anchor。
- 2026-05-29: 失败时优先生成诊断信息，不立即切到坐标点击或图像识别。Playwright 仍负责真实操作，诊断包负责解释失败现场。

## 背景

`docs/research/video-generator-rawpaper-order-entry-retrospective-2026-05-29.md` 记录了原纸贸易订单录入视频的正式录制经验：直达订单录入页、收紧 selector、修复 Element UI remote select、区分 dry-run 与正式录制差异，最终成功生成 `final.mp4`。

复盘里暴露的核心问题是：真实业务脚本按人工顺序可以完成，但自动录制失败时报告过于粗糙，常常只看到 `locator timeout`，无法快速判断是页面慢、selector 歧义、弹窗没进入、元素被遮挡，还是正式录制模式带来的性能开销。

## 目标

本计划目标是把复盘经验沉淀为项目能力：

1. 在可执行稿阶段显式标注页面阶段别名，让动作归属于稳定的页面或弹窗状态。
2. 在 preflight 和 run report 中展示当前 stage、stage anchor 命中情况和失败上下文。
3. 在浏览器动作失败时生成诊断包，用结构化信息解释 Playwright 为什么找不到、不能点、不能填或等不到。
4. 增加正式录制模式的最小回归场景，减少 dry-run 通过但正式录制失败的盲区。

## 非目标

- 不引入图像识别作为主操作路径。
- 不把坐标点击作为默认兜底。
- 不改变原始业务脚本的保存规则。
- 不一次性重写所有语义动作或 selector 匹配策略。
- 不要求 Stage 语法覆盖复杂条件分支、循环或跨页面工作流编排。

## 文件职责

| 文件 | 改动职责 |
|------|----------|
| `src/lib/video-generator/types.ts` | 新增 stage 定义、stage 引用、诊断包类型，并扩展报告相关类型 |
| `src/lib/video-generator/script-parser.ts` | 解析 `@stage` 声明和当前 stage 上下文，把后续 action 绑定到 stage |
| `src/lib/video-generator/preflight.ts` | 校验 stage 定义、anchor 和上传素材；dry-run 失败时附带 stage 诊断 |
| `src/lib/video-generator/browser/actions.ts` | 动作执行失败时收集诊断包并挂到 `VideoGeneratorError` 或失败结果里 |
| `src/lib/video-generator/browser/interaction-rules.ts` | 为 remoteSelect/dropdown/poppers 暴露更细的诊断信息 |
| `src/lib/video-generator/report.ts` | 写入 stage 诊断、action 诊断、失败截图和候选报告 |
| `src/lib/video-generator/pipeline.ts` | 在正式运行失败时把诊断包传给 report |
| `examples/video-generator/README.md` | 说明三稿流程、`@stage`、页面 stage 与弹窗 stage 写法 |
| `docs/research/video-generator-recording-checklist-2026-05-29.md` | 增加可执行稿 stage 检查项和失败诊断包检查项 |
| `docs/handover/video-generator-recording-reliability.md` | 更新技术交接里的录制流程和报告结构 |
| `docs/insights/video-generator-recording-reliability.md` | 更新产品视角：从“自动录制”提升到“可诊断录制” |
| `tests/video-generator/types.unit.test.ts` | 覆盖 stage 和诊断包类型约束 |
| `tests/video-generator/script-parser.unit.test.ts` | 覆盖 `@stage` 解析和 action 绑定 |
| `tests/video-generator/preflight.unit.test.ts` | 覆盖 stage anchor 校验和失败报告 |
| `tests/video-generator/browser-actions.unit.test.ts` | 覆盖 click/fill/waitFor 失败诊断 |
| `tests/video-generator/interaction-rules.unit.test.ts` | 覆盖 remoteSelect/dropdown 诊断 |
| `tests/video-generator/report.unit.test.ts` | 覆盖诊断包脱敏与报告输出 |
| `tests/video-generator/pipeline.unit.test.ts` | 覆盖正式运行失败时诊断包传递 |

## Stage 语法设计

### 可执行稿示例

```md
@stage orderEntry.list
打开 https://intelligenttest.cpsol.net/microFront/djrawpaper_trade/#/orderManage/orderEntry
等待选择器 input[placeholder="请输入客户名称/手机号"]
点击「新增」

@stage orderEntry.createDialog
等待选择器 .el-dialog:visible
远程选择「客户名称」为「测试客户」
远程选择「收货地址」为「默认地址」
上传文件「合同图片」为「E:/Code/ScreenRecording/视频脚本原稿/xxx.png」
点击「生成订单」

@stage orderEntry.list
等待选择器 input[placeholder="请输入客户名称/手机号"]
```

### Stage 配置最小能力

第一阶段只支持轻量声明，不引入独立配置文件：

```md
@stage orderEntry.createDialog scope=.el-dialog:visible anchor="text=新增订单" anchor="input[placeholder='请选择客户名称']"
```

解析规则：

- `@stage <name>` 切换当前 stage。
- 同一 stage 可以多次出现，表示脚本回到同一个页面状态。
- `scope=` 可选；未设置时 action 在页面全局查找。
- `anchor=` 可重复；preflight 和失败报告用它判断 stage 是否命中。
- 后续 action 自动带上 `stageName`，不改变原有 action 文案。

## Phase 1：Stage 别名脚本语法与类型

### 验收标准

- `script-parser.ts` 能解析 `@stage orderEntry.list`。
- action 上带有 `stageName`。
- parser 能解析可选的 `scope=` 和多个 `anchor=`。
- 原有脚本不写 `@stage` 时行为不变。

### 步骤

1. 在 `tests/video-generator/script-parser.unit.test.ts` 新增失败测试：解析 `@stage orderEntry.list` 后，后续 action 都包含 `stageName: "orderEntry.list"`。
2. 运行 `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`，确认新增测试失败。
3. 在 `src/lib/video-generator/types.ts` 新增 `StageDefinition` 类型：`name`、`scope`、`anchors`。
4. 在 `BrowserAction` 基础字段中增加可选 `stageName?: string`。
5. 在 `src/lib/video-generator/script-parser.ts` 识别 `@stage` 行，维护当前 stage 上下文。
6. 再次运行 `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`，确认通过。
7. 补充测试：无 stage 的旧脚本解析结果不包含 `stageName`。

## Phase 2：Stage 预检与报告接入

### 验收标准

- preflight 能检查 stage anchor 是否存在。
- `preflight-report.json` 能展示 stage 名称、scope、anchor 命中状态。
- stage 未命中时，报告能说明缺少哪个 anchor。

### 步骤

1. 在 `tests/video-generator/preflight.unit.test.ts` 新增失败测试：stage anchor 缺失时返回失败 check。
2. 在 `src/lib/video-generator/preflight.ts` 增加 stage 校验函数，优先用 `scope` 限定 anchor 查询范围。
3. 在 `src/lib/video-generator/report.ts` 扩展 preflight report 输出结构，包含 stage diagnostics。
4. 在 `tests/video-generator/report.unit.test.ts` 增加 stage diagnostics 快照或结构断言。
5. 运行 `npm run test:unit -- tests/video-generator/preflight.unit.test.ts tests/video-generator/report.unit.test.ts`。

## Phase 3：浏览器动作失败诊断包

### 验收标准

- click/fill/waitFor/remoteSelect 失败时产出结构化诊断包。
- 诊断包包含当前 URL、stage、selector、候选数量、可见性、尺寸、遮挡信息和截图路径。
- remoteSelect 失败时额外包含 dropdown/popper 诊断。
- 报告中敏感输入仍会脱敏。

### 步骤

1. 在 `tests/video-generator/browser-actions.unit.test.ts` 新增失败测试：click selector 超时时，错误对象包含 action diagnostics。
2. 在 `src/lib/video-generator/types.ts` 新增 `ActionDiagnostic` 类型：`url`、`stageName`、`selector`、`candidateCount`、`candidates`、`overlayElement`、`screenshotPath`。
3. 在 `src/lib/video-generator/browser/actions.ts` 的 catch 分支调用诊断收集函数。
4. 诊断收集函数使用 Playwright API 获取：`page.url()`、`locator.count()`、候选 `isVisible/isEnabled/boundingBox/textContent`。
5. 使用 `document.elementFromPoint()` 判断候选中心点是否被遮挡。
6. 保存失败截图到 run artifacts 目录，路径传入 report。
7. 在 `tests/video-generator/interaction-rules.unit.test.ts` 新增 remoteSelect dropdown 诊断测试。
8. 在 `src/lib/video-generator/browser/interaction-rules.ts` 给 dropdown 查找失败补充 popper 数量、可见项数量和隐藏容器数量。
9. 运行 `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts tests/video-generator/interaction-rules.unit.test.ts`。

## Phase 4：正式录制模式回归验证

### 验收标准

- 有一个最小 fixture 能模拟慢弹窗、慢 dropdown、遮罩层和重复文本。
- 测试覆盖 dry-run 通过但正式录制可能变慢的场景。
- 如果本地环境不支持完整视频录制，至少保留可运行的 browser action 回归测试，并在文档记录限制。

### 步骤

1. 在现有测试 fixture 或临时 HTML 中加入慢 dropdown 和遮罩层场景。
2. 在 `tests/video-generator/browser-actions.unit.test.ts` 增加“元素可见但被遮罩挡住”的诊断测试。
3. 在 `tests/video-generator/pipeline.unit.test.ts` 增加正式运行失败时 report 收到 diagnostics 的测试。
4. 本地运行 `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts tests/video-generator/pipeline.unit.test.ts`。
5. 如果改动触及真实录制路径，确认后运行 `npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo`。

## Phase 5：文档与示例更新

### 验收标准

- 示例 README 说明 Stage 写法。
- 录制检查清单包含“可执行稿阶段标注 stage”和“失败后先看诊断包”。
- handover 和 insights 文档同步更新，并保持互相反向链接。

### 步骤

1. 更新 `examples/video-generator/README.md`，增加 `@stage` 示例。
2. 更新 `docs/research/video-generator-recording-checklist-2026-05-29.md`，增加 stage 和诊断包检查项。
3. 更新 `docs/handover/video-generator-recording-reliability.md`，说明 Stage、preflight、report、diagnostics 的数据流。
4. 更新 `docs/insights/video-generator-recording-reliability.md`，说明用户价值从“生成视频”扩展为“失败可诊断”。
5. 运行 `npm run test`。
6. 如涉及真实录制路径，按 `CLAUDE.md` 再运行至少一个内置 demo。

## 风险与控制

- Stage 语法可能让脚本变复杂：只允许进入可执行稿，不要求业务原始稿掌握。
- 诊断包可能泄露输入内容：复用现有 redaction 逻辑，报告中不输出密码、token、Cookie 或完整 storage state。
- 截图和 DOM 片段可能变大：只在失败时生成，DOM 片段限制长度。
- 正式录制测试可能依赖本机浏览器/ffmpeg：单元测试优先覆盖诊断逻辑，端到端验证单独记录环境限制。

## 验收命令

- `npm run test:unit -- tests/video-generator/script-parser.unit.test.ts`
- `npm run test:unit -- tests/video-generator/preflight.unit.test.ts tests/video-generator/report.unit.test.ts`
- `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts tests/video-generator/interaction-rules.unit.test.ts`
- `npm run test:unit -- tests/video-generator/pipeline.unit.test.ts`
- `npm run test`
- `npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo`
