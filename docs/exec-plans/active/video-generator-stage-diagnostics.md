# 视频生成器录制可靠性二期：Stage 别名与失败诊断包

> 创建时间：2026-05-29
> 最后更新：2026-05-29

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 需求收敛与边界确认 | ✅ 已完成 | 来源于真实业务录制复盘 |
| Phase 1 | Stage 别名脚本语法与类型 | ✅ 已完成 | 支持 `@stage`、`scope=`、多个 `anchor=` |
| Phase 2 | Stage 预检与报告接入 | ✅ 已完成 | preflight 输出 scope/anchor 命中诊断 |
| Phase 3 | 浏览器动作失败诊断包 | ✅ 已完成 | click/fill/waitFor/remoteSelect/uploadFile 失败输出 diagnostics |
| Phase 4 | 正式录制模式回归验证 | ✅ 已完成 | 覆盖遮罩、重复文本、截图和报告透传 |
| Phase 5 | 文档与示例更新 | ✅ 已完成 | README、检查清单、handover、insights 已同步 |

## 决策日志

- 2026-05-29: 保留“原始稿 / 润色稿 / 可执行稿”三稿结构，Stage、scope、稳定等待点只进入可执行稿，不改原始业务脚本。
- 2026-05-29: 页面阶段别名不是简单页面命名，而是“可稳定识别的 UI 状态”。独立页面用 URL 片段 + anchor；弹窗用 visible scope + anchor。
- 2026-05-29: 失败时优先生成诊断信息，不引入坐标点击或图像识别兜底。Playwright 仍负责真实操作，诊断包负责解释失败现场。
- 2026-05-29: `candidateCount` 表示真实 locator 匹配总数，`candidates` 只采样前 5 条，避免报告误导。

## 目标

把真实业务录制复盘沉淀为项目能力：

1. 在可执行稿阶段显式标注页面阶段别名，让动作归属于稳定的页面或弹窗状态。
2. 在 preflight 和 run report 中展示当前 stage、scope、anchor 命中情况和失败上下文。
3. 在浏览器动作失败时生成诊断包，用结构化信息解释 Playwright 为什么找不到、不能点、不能填或等不到。
4. 增加正式录制模式的最小回归场景，减少 dry-run 通过但正式录制失败的盲区。

## 已交付能力

### Stage 语法

```md
@stage orderEntry.list scope="main" anchor="input[placeholder='请输入客户名称/手机号']"
打开 https://example.com/order-entry
点击「新增」

@stage orderEntry.createDialog scope=".el-dialog:visible" anchor="text=新增订单" anchor="input[placeholder='请选择客户名称']"
远程选择「客户名称」为「测试客户」
点击「生成订单」
```

- `@stage <name>` 切换当前 stage。
- 同一个段落中 stage 可按顺序切换，后续 action 绑定最近 stage。
- `scope=` 可选，用于把弹窗、抽屉、下拉层限定为局部查找范围。
- `anchor=` 可重复，用于 preflight 判断 stage 是否真实命中。
- 旧脚本不写 `@stage` 时行为保持不变。

### Preflight 诊断

`runPreflightChecks` 会输出 `stageDiagnostics`：

- `stageName`
- `scope`
- `scopeMatched`
- `scopeCount`
- `anchors[].matched`
- `anchors[].count`
- `missingAnchors`

scope 缺失时，失败消息会明确包含 missing scope；anchor 缺失时，失败消息会列出缺少的 anchor。

### 动作失败诊断包

失败报告中的 `diagnostics` 包含：

- 当前 `url`
- `stageName`
- `actionType`
- `selector`
- `candidateCount`
- 前 5 个候选元素诊断
- 可见性、可编辑性、可用性、bounding box
- `elementFromPoint` 遮挡元素摘要
- `missingText`
- `failureReason`
- remoteSelect 的 dropdown/popper 数量和可见项数量
- recorder 捕获的失败截图路径

### 回归验证

新增测试覆盖：

- 遮罩层挡住可见元素时能报告 `overlayElement`。
- 重复文本时能区分真实候选总数与采样候选详情。
- recorder 失败时把 diagnostics 和 screenshotPath 一起上抛。
- pipeline 失败报告会保留 diagnostics 和 screenshotPath。

## 验收命令

- `npm run test:unit -- tests/video-generator/browser-actions.unit.test.ts tests/video-generator/browser-recorder.unit.test.ts tests/video-generator/pipeline.unit.test.ts tests/video-generator/report.unit.test.ts`
- `npm run test`

## 当前验证结果

- 2026-05-29: `npm run test` 通过，113 个单测全部通过。

## 后续可选方向

- 用真实业务 demo 跑一次端到端录制，验证 diagnostics 在正式 `recordVideo` 场景下的可读性。
- 在 CLI 输出中增加失败诊断摘要，减少用户打开 JSON 的成本。
- 将常见业务页 stage 模板沉淀为可复用脚本片段。
