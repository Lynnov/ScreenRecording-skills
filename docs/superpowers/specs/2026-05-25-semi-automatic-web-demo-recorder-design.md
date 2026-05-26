# 半自动网页演示录制器设计规格

> 创建时间：2026-05-25  
> 状态：设计草案，待用户审阅  
> 方向：把现有脚本驱动录制器升级为“保守半自动”的网页演示录制能力。

## 背景

现有 video-generator 已具备脚本解析、timeline、Playwright 连续录制、TTS、字幕、ffmpeg 合成和失败截图能力。当前动作执行仍偏精确脚本：用户需要写清楚点击文本、选择器、等待目标或滚动位置。

要录制的网页内容形态会非常多，包括官网、SaaS 后台、表单页、弹窗、下拉选择器、长页面、动态加载页面等。如果继续要求用户提供稳定 selector，使用门槛会高，失败后也很难知道系统到底看到了什么。

本设计的目标是在现有 timeline 链路前增加一层页面理解和候选确认能力，让用户可以用更自然的脚本描述操作，同时保持执行可解释、失败可定位、不盲目探索。

## 目标

第一阶段实现“保守半自动网页演示器”：

- 用户可以写“点击登录”“在邮箱输入 demo@example.com”“选择销售类型平台团购”等语义化动作。
- 系统基于当前页面的可见控件生成候选，并按规则匹配目标。
- 只有唯一可信候选时自动执行。
- 存在歧义、弱匹配、遮挡或危险动作时停止，并输出候选报告。
- 保留现有精确动作能力，已有脚本、测试和录制流程继续可用。

## 非目标

- 不做跨页面目标规划，例如“帮我演示创建项目”后自动探索整条路径。
- 不做真实互联网网页自动 benchmark。
- 不自动关闭 cookie banner、权限弹窗或引导遮罩，除非脚本明确写出对应操作。
- 不自动执行删除、支付、发布、提交订单等高风险操作。
- 不把已解析出的 selector 写死回用户脚本。

## 推荐方案

在现有 video-generator 里新增三层能力：

1. **PageSnapshot**：从当前页面抽取可见、可交互、可等待、可填写的候选元素。
2. **CandidateMatcher**：把语义动作匹配到候选元素，输出置信度、候选列表和失败原因。
3. **InteractionRules**：根据常见 Web 交互模式决定如何点击、填写、选择和等待。

现有执行链路保持为：

```text
自然语言脚本 -> script-parser -> Timeline -> recorder -> executeBrowserAction -> ffmpeg
```

新链路在 `executeBrowserAction` 内部扩展：

```text
SemanticAction -> PageSnapshot -> CandidateMatcher -> InteractionRules -> ResolvedAction -> Playwright 执行
```

这样可以复用现有录制、TTS、字幕、合成和报告机制，避免另起一套系统。

## 动作模型

保留现有低层动作：

```ts
{ type: 'click', text: '登录' }
{ type: 'click', selector: '.login' }
{ type: 'fill', text: '邮箱', value: 'demo@example.com' }
{ type: 'waitFor', target: { type: 'text', value: '成功' } }
```

新增语义动作：

```ts
{ type: 'semanticClick', target: { kind: 'button', name: '登录' } }
{ type: 'semanticFill', target: { kind: 'field', name: '邮箱' }, value: 'demo@example.com' }
{ type: 'semanticSelect', target: { kind: 'field', name: '销售类型' }, option: '平台团购' }
{ type: 'semanticWaitFor', target: { kind: 'visibleText', name: '登录成功' } }
```

脚本语法第一版建议支持：

```markdown
点击 登录
点击按钮 登录
点击链接 文档
在 邮箱 输入 demo@example.com
选择 销售类型 平台团购
等待出现 登录成功
```

精确语法继续保留：

```markdown
点击选择器 .login-button
等待选择器 .ready
向下滚动到选择器 .target-card
```

## PageSnapshot

`PageSnapshot` 不保存整棵 DOM，只保存执行和诊断需要的摘要。

候选元素字段：

- `role`：button、link、textbox、combobox、menuitem、option、checkbox 等。
- `name`：优先 accessible name，其次 innerText、aria-label、title、placeholder。
- `text`：可见文本，做长度截断。
- `selectorHint`：仅用于调试和报告，不作为长期稳定 selector。
- `bounds`：元素位置和尺寸。
- `context`：附近 label、父级 dialog/dropdown、表单区域、附近标题。
- `state`：visible、enabled、checked、selected、editable。
- `layer`：page、dialog、drawer、popover、dropdown、toast、overlay。

快照来源组合：

- Playwright role/name locator 与 accessibility 信息，用于规范控件。
- DOM 可见元素扫描，用于补足没有正确 ARIA 的后台系统和自定义组件。

快照只在执行时生成。成功时可把 resolved 摘要写入 segment assets；失败时写入候选报告。

## CandidateMatcher

匹配分三档：

- **强匹配**：role 或 kind 符合，name/text 精确匹配。
- **中匹配**：role 不完全确定，但元素可点击或可编辑，文本精确匹配。
- **弱匹配**：包含匹配、附近文本匹配、placeholder/label 附近匹配。

执行决策：

- 只有一个强匹配：自动执行。
- 多个强匹配：停止，输出候选列表。
- 没有强匹配但只有一个中匹配：允许执行，并记录 resolved target。
- 只有弱匹配：停止，要求用户把脚本写得更具体。
- 没有匹配：停止，输出当前页面相近候选。

存在前景层时，匹配优先级为：dropdown/popover > dialog/drawer > page。这样可以避免弹窗打开后误点背景页面上的同名按钮。

## Web Interaction Rules

第一版把常见网页交互规则做成独立模块，避免继续堆在动作执行器里。

P0 规则：

- **前景层优先**：dialog、drawer、popover、dropdown 中的候选优先于背景页面。
- **可点击祖先**：匹配到 span/text 时，向上寻找 button、a、role=button、menuitem、option 或常见 select option 容器。
- **表单字段定位**：填写动作按 label、placeholder、aria-label、附近文本的顺序定位 input、textarea 或 contenteditable。
- **选择控件两步执行**：`semanticSelect` 先打开 combobox/select，再在新出现的 dropdown 中匹配 option。
- **动作后等待**：点击、填写、选择、滚动之后执行对应稳定等待，而不是只等 domcontentloaded。

P1 规则：

- **遮挡检测**：执行前检查目标中心点是否被弹窗、遮罩或固定头部遮挡。
- **iframe 识别**：第一版支持同源 iframe 候选扫描；跨域 iframe 只做诊断提示。
- **长页面辅助**：目标不在视口内时先 scrollIntoViewIfNeeded；虚拟列表搜索暂不自动做。
- **阻挡层识别**：识别 cookie banner、权限弹窗、引导遮罩，但不自动关闭。
- **危险操作保护**：删除、支付、发布、提交订单等高风险动作需要脚本明确表达确认语义。

## Timeline 集成

语义动作保留在 timeline 的 `actions` 中，不在执行后改写成 selector。执行成功时，把 resolved 信息写入 segment assets：

```json
{
  "assets": {
    "resolvedActions": [
      {
        "actionIndex": 0,
        "strategy": "role-name",
        "confidence": "strong",
        "role": "button",
        "name": "登录",
        "layer": "dialog",
        "selectorHint": "button:nth-of-type(1)"
      }
    ]
  }
}
```

这样 timeline 仍表达用户意图，debug 信息表达本次运行细节。页面版本变化时，脚本不会被旧 selector 绑死。

## 失败报告

失败报告从 Playwright timeout 升级为结构化诊断。建议新增 `candidate-report.json`，同时在 `run-report.json` 中保留摘要。

错误类型：

- `NO_TARGET_FOUND`：找不到目标。
- `AMBIGUOUS_TARGET`：多个候选，无法确定。
- `LOW_CONFIDENCE_TARGET`：只有弱匹配，不自动执行。
- `TARGET_OCCLUDED`：目标被遮挡。
- `UNSUPPORTED_INTERACTION_PATTERN`：识别到了控件类型，但第一版还不会执行。
- `RISKY_ACTION_REQUIRES_EXPLICIT_CONFIRMATION`：危险操作需要明确确认。

报告示例：

```json
{
  "ok": false,
  "failedSegmentId": "seg-003",
  "reason": "AMBIGUOUS_TARGET",
  "message": "找到 3 个可能的“登录”目标，请把脚本写得更具体。",
  "candidates": [
    { "label": "顶部导航 / 登录", "role": "link", "name": "登录", "layer": "page" },
    { "label": "弹窗 / 登录", "role": "button", "name": "登录", "layer": "dialog" }
  ],
  "screenshotPath": "screenshots/seg-003.png"
}
```

## 测试方案

新增单元测试：

- `page-snapshot.unit.test.ts`：button、link、input、combobox、dialog、dropdown、placeholder、aria-label、可见性。
- `candidate-matcher.unit.test.ts`：强匹配、多候选、中匹配、弱匹配、前景层优先。
- `interaction-rules.unit.test.ts`：可点击祖先、label 填写、combobox 两步选择、遮挡检测。
- `script-parser.unit.test.ts`：新语义脚本语法。
- `browser-actions.unit.test.ts`：本地 HTML 模拟后台组件和弹窗下拉。
- `pipeline.unit.test.ts`：失败报告包含 candidates、screenshot、failedAction。

新增 smoke 示例：

- 打开本地 demo 页面。
- 填写邮箱和名称。
- 打开下拉选择一个选项。
- 点击确认。
- 等待成功提示。

## 验收标准

- 用户不写 selector，也能完成常见按钮点击、表单填写和下拉选择。
- 多个同名元素时不会误点，必须输出候选列表。
- 弹窗、抽屉、下拉中的元素优先于背景页面。
- 失败时报告能说明系统看到了哪些候选，以及为什么不执行。
- 现有精确脚本继续可用。
- `npm run test` 通过。
- 涉及真实 UI 的示例需要通过 dev server 或本地 Playwright 页面实际验证。

## 分阶段建议

第一阶段：实现 PageSnapshot、CandidateMatcher、P0 InteractionRules、语义脚本解析和候选报告。

第二阶段：补充遮挡检测、iframe 诊断、危险操作保护和更完整的候选报告展示。

第三阶段：考虑从“保守半自动”升级到“智能规划”，允许用户描述更高层目标，但每个大步骤执行前仍需要确认。
