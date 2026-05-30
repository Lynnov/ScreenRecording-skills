> 技术实现见 [docs/handover/video-generator-recording-reliability.md](../handover/video-generator-recording-reliability.md)

# 视频生成器录制可靠性二期产品思考

## 用户问题

真实业务录制的难点不是“脚本按人工顺序能不能做完”，而是自动录制失败时用户不知道原因。页面看起来只是变慢、下拉没展开或按钮没点上，但报告里常常只有 `locator timeout`，无法判断该改脚本、改 selector、等接口，还是绕过不稳定页面状态。

## 为什么引入 Stage

Stage 把“页面当前处于什么状态”显式写进可执行稿。用户和开发者不用只看散落的 selector，而能知道动作发生在 `orderEntry.list`、`orderEntry.createDialog` 这类稳定语义状态里。

这个设计把业务脚本工程化，但不要求业务人员掌握技术细节：原始稿保持不变，润色稿关注旁白和节奏，可执行稿才加入 `@stage`、`scope`、`anchor`。

## 为什么不直接用坐标点击或图像识别

坐标点击和图像识别能绕过一部分 Playwright actionability 问题，但会把失败从“可解释的 selector 问题”变成“不可解释的画面匹配问题”。真实业务页面里布局、缩放、滚动、弹窗层级都会变化，坐标兜底容易制造新的不稳定性。

本阶段选择继续让 Playwright 负责真实操作，但在失败时生成诊断包，先解释为什么失败，再决定是否需要改 stage、selector、等待条件或脚本结构。

## 为什么失败诊断比自动兜底更重要

录制器面对的是动态业务系统：远程搜索、Element UI popper、遮罩层、loading、重复文案和正式录制性能开销都会影响结果。如果系统只尝试更多 workaround，用户仍然不知道下一次为什么失败。

诊断包让失败变成可讨论的信息：候选有几个、哪个被遮挡、哪个 dropdown 为空、当前属于哪个 stage、截图在哪里。这能显著降低真实录制调试成本。

## 用户体验变化

以前失败报告主要告诉用户“某个动作失败”。现在报告可以告诉用户：

- 没进入预期 stage。
- stage scope 没命中。
- 某个 anchor 缺失。
- selector 命中了多个候选。
- 目标元素可见但被遮罩挡住。
- remoteSelect 的 dropdown 出现了，但没有可见选项。
- 失败截图保存到了哪里。

这让用户从“猜 Playwright 为什么没点上”变成“按诊断结论修脚本”。

## 适用场景

- 真实业务系统教程视频。
- Element UI / Ant Design 等组件库页面。
- 文案重复多、弹窗多、下拉异步加载多的后台系统。
- dry-run 通过但正式录制失败的录制链路。

## 已知局限

- Stage 需要在可执行稿中手动标注，暂时没有自动推断。
- diagnostics 只采样前 5 个候选，完整 DOM 仍需结合截图或后续 trace。
- 本阶段没有引入 Playwright trace viewer。
- 本阶段没有真实业务站端到端验收，仍需具体录制任务验证实际报告可读性。

## 后续方向

- 在 CLI 控制台输出精简诊断摘要，减少打开 JSON 的成本。
- 为常见业务页沉淀 Stage 模板。
- 在失败产物目录中增加 HTML 诊断页，把截图、stage、candidates、dropdowns 放到同一视图。
- 对正式录制模式增加更接近生产的慢接口和 animation fixture。
