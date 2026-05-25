# 产品批量调价视频生成调试复盘

> 日期：2026-05-22  
> 关联交接文档：[scripted-browser-video-generator.md](../handover/scripted-browser-video-generator.md)  
> 关联脚本：`examples/video-generator/产品批量调价.md`  
> 产物目录：`video-runs/product-batch-price-adjustment/`

## 背景

本次任务是在已有部分产物的基础上，继续生成“产品批量调价”业务教程视频。初始失败报告显示录制停在 `seg-006`，原因是填写“调价名称”时 `getByPlaceholder('调价名称')` 匹配到两个输入框：页面背景搜索栏和新增调价弹窗内输入框。

用户明确指出：从交互语义看，既然前一步已经打开“新增调价”弹窗，后续操作应优先作用于前景弹窗，而不是背景页面。这个判断成为本轮修复的核心原则。

## 时间线

1. 读取 `run-report.json` 和失败截图，确认第一处阻塞为同名输入框导致的 Playwright strict mode violation。
2. 为“前景弹窗内同名 placeholder 优先”补单元测试，先确认红灯，再改 `actions.ts`。
3. 真实续跑越过 `调价名称` 后，继续暴露“销售类型”标签点击同名冲突，扩展点击定位：优先当前前景层，并在字段标签场景下解析同一表单行里的控件。
4. 真实页面从首页入口进入时会出现“易咚咚”助手层干扰，且左侧菜单文本加载/点击不稳定；最终把脚本入口改为直接打开目标功能 URL，避免录制无关首页导航的不确定性。
5. 下拉选项如“平台团购”“全部”“3层”与表格内容、已选值重复，脚本改为 `点击选择器 .el-select-dropdown...` 精确点击当前可见下拉浮层选项。
6. 对默认已选的业务选项（“仅原价方案”“按价位”“单价上涨”）保留演示节点，但使用 `等待` 表达无操作校验，旁白说明“默认选择”，避免点击不可交互文本。
7. 金额输入“单价调整”标签无法稳定映射到输入框，改为 `.el-dialog input[placeholder="请输入"]` 精确填写当前弹窗内金额输入框。
8. 完整生成成功，最终产物写入 `video-runs/product-batch-price-adjustment/final.mp4`。
9. `npm run test` 首次暴露 `window` DOM 类型错误，改用 `element.ownerDocument.defaultView?.getComputedStyle(...)` 后完整通过。

## 根因分析

### 1. 自动定位缺少“前景层”语义

生成器原始定位规则只按文本、label、placeholder 查找页面元素。真实业务系统中，弹窗打开后背景页面仍在 DOM 中，且搜索栏、表格、弹窗字段存在大量同名文案。没有前景层优先级时，Playwright strict mode 会因为多匹配直接失败。

修复方向不是在单个脚本里绕开所有同名文案，而是让生成器理解基本 UI 层级：弹窗、下拉浮层、popover 等前景层应优先于背景页面。

### 2. 表单 label 与真正控件不总是同一元素

“销售类型”等字段文案本身通常只是 label，不一定可点击。真实意图是点击同一表单行里的 select 控件。生成器需要在点击 label 时尝试解析同一字段容器下的 `input`、`textarea`、`button`、`role=button`、`role=combobox`。

### 3. 下拉选项常被渲染到独立浮层

Element UI 的 select 下拉通常渲染为页面末尾的 `.el-select-dropdown`，不一定在弹窗 DOM 子树内。仅判断“是否在 dialog 内”不足以处理下拉选项。正确优先级应是：当前可见下拉浮层选项 > 弹窗内控件 > 背景页面。

### 4. 默认选项不是“无价值步骤”

默认已选项没有必要点击，但演示视频需要向用户说明这些默认选择的业务含义。脚本层面应保留“无操作 + 旁白”的演示段，例如：

```markdown
等待 “仅原价方案”
旁白：价格方案选择默认的仅原价方案，表示本次调整只针对原价方案生效。
```

这比删除步骤更符合教程视频的完整性。

### 5. 真实站点入口导航会引入无关干扰

从首页开始点击“开启工作”再展开菜单，会遇到左侧菜单加载延迟、助手浮层误触、菜单文本与实际可点击区域不一致等问题。这些问题不属于“产品批量调价”教程核心内容。脚本直接打开目标功能 URL 后，录制稳定性明显提升。

## 代码改动

### `src/lib/video-generator/browser/actions.ts`

- `fillByText` 的最终 `placeholder` 填写通过 `resolveActionLocator` 解析前景层唯一匹配项。
- `click` 操作增加 `resolveClickLocator`：
  - 先解析同名候选中的前景浮层/弹窗候选；
  - 再尝试提升到可点击祖先，例如 `li.el-select-dropdown__item`；
  - 对字段 label 尝试解析同一表单容器里的实际控件。
- `targetBlankHref` 改为短探测且失败不阻塞普通点击，避免链接检查本身因目标延迟或多匹配导致动作失败。
- 前景层判断拆分为 `overlay` 和 `dialog`，优先选择可见下拉浮层，再选择弹窗。
- 使用 `element.ownerDocument.defaultView?.getComputedStyle(...)`，避免项目未启用 DOM lib 时 `window` 类型不可用。

### `tests/video-generator/browser-actions.unit.test.ts`

新增回归覆盖：

- 弹窗内同名 placeholder 优先填写。
- 字段 label 点击时优先点击同一字段行控件。
- 可见下拉浮层选项优先于背景同名文本。
- 下拉选项文本 span 隐藏时，提升到可见 `li.el-select-dropdown__item`。
- 下拉浮层同名选项优先于弹窗内已选值。
- 延迟出现的文本目标不会被链接探测提前阻断。

### `examples/video-generator/产品批量调价.md`

- 入口改为直接打开产品批量调价页面 URL。
- 下拉选项改用 `.el-select-dropdown:not([style*="display: none"]) .el-select-dropdown__item:has-text(...)` 精确选择当前浮层。
- 默认已选项改为 `等待 + 旁白`，保留教程完整性。
- 单价金额输入改用弹窗内 input selector 精确定位。

## 验证结果

### 单元与类型检查

执行：

```bash
npm run test
```

结果：

- `tsc --noEmit` 通过。
- `tsx --test tests/**/*.unit.test.ts` 通过。
- 共 97 个测试全部通过。

### 真实生成

执行：

```bash
npm run video:generate -- --script "examples/video-generator/产品批量调价.md" --output "video-runs/product-batch-price-adjustment" --storage-state "video-runs/auth/supplier-storage-state.json"
```

结果：

- 命令成功输出：`Video generated: video-runs\product-batch-price-adjustment\final.mp4`
- `run-report.json` 中 `ok: true`。
- 最终视频文件：`video-runs/product-batch-price-adjustment/final.mp4`。

## 经验与原则

1. **脚本语义应优先当前前景层**：弹窗打开后，后续动作默认应在弹窗/浮层中解析，除非脚本显式指定背景选择器。
2. **默认选项需要演示，但不需要点击**：默认值用 `等待` 表达状态确认，用旁白解释业务含义。
3. **真实业务脚本可以适度使用 selector**：自然语言适合主流程，复杂同名下拉项应使用可见浮层选择器保证稳定。
4. **不要把无关导航录进核心教程**：如果教程主题是某个业务页面，直达目标页面更稳定，也更贴合观众目标。
5. **修复生成器能力时必须补回归测试**：每次真实站点暴露的新定位问题，都应沉淀为最小 DOM 测试，避免后续脚本反复踩坑。
6. **最终验证必须包含真实生成和基础测试**：真实生成验证业务路径，`npm run test` 验证类型和单元回归。

## 后续建议

- 为视频脚本语法增加“无操作说明”动作，例如 `说明 “仅原价方案”`，避免用 `等待` 表达纯旁白段时语义略显间接。
- 为下拉选择增加一等动作，例如 `选择 “销售类型” 为 “平台团购”`，由生成器统一处理 label、select 控件和浮层选项。
- 在失败报告中增加当前可见前景层摘要，帮助定位同名文本冲突。
- 考虑在脚本 README 中补充“默认选项演示”和“复杂下拉 selector”写法示例。
