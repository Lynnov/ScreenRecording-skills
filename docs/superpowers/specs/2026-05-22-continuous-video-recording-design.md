# 连续操作视频录制设计

## 背景

当前录制器会先在共享页面上预执行每个脚本段落，再把页面 DOM 快照下来，为每个段落录制一个静态片段。这个流程已经证明项目可以生成视频、音频、字幕和报告，但它不像真实的操作录屏：

- 页面切换时可能把目标页面尚未完全渲染好的状态录进视频。
- 页面内操作（例如修改长宽高）会被拆成多个静态片段，看起来像重新加载，容易出现加载图标。
- Pacdora 示例直接跳到详情 URL，用户没有看到“抽屉式礼盒”卡片出现并被点击。
- 字幕目前保留了不符合目标风格的标点。

## 目标

- 整条脚本使用一个连续浏览器会话和一个连续视频录制。
- 保留真实用户可见的操作过程：导航、滚动、点击、输入按顺序发生在同一个页面里。
- 页面内操作之间不重建页面、不重新加载页面。
- 脚本能表达“滚动直到目标卡片可见，再点击它”。
- 字幕文本去掉中文句号，并把逗号替换为空格。
- 支持通过 `--storage-state <file>` 加载已导出的登录态，用于录制需要登录的业务系统。

## 非目标

- 本轮不实现逐帧精确剪辑，也不实现录制暂停/恢复。
- 不构建可视化脚本编辑器。
- 不加入 AI 元素识别。
- 不移除现有报告和 timeline 产物模型。

## 推荐方案

把“按段落录制静态剪辑”改为“连续录制整条脚本”：

1. 创建一个启用 `recordVideo` 的 Playwright browser context。
2. 创建一个页面，使用 `1920 × 1080` 作为全屏录制画布。
3. 在同一个页面里顺序执行所有 timeline segment 的 actions。
4. 每个 action 执行后，如果动作自带等待目标，则先等待目标；随后等待页面稳定。
5. 保留每个 segment 的时间信息，用于字幕和报告；视频源使用同一个连续录制文件。
6. 最终渲染时，把连续录制文件、合并后的旁白音频和规范化字幕合成最终视频。

这个模型最符合“操作视频”的预期，也能避免页面内操作之间反复加载的问题。

## 浏览器行为

录制 context 使用 `1920 × 1080` viewport。这里的“全屏”定义为录制画布尺寸，而不是操作系统原生全屏。因为 Playwright 的视频录制基于 viewport，如果未来需要 OS 级全屏，应作为独立增强处理。

录制器不再为每个 segment 创建新 page。只有脚本中出现 `打开 <url>` 时才进行真实页面导航。

## 登录态

真实业务系统录制需要复用登录态。本轮采用 `--storage-state <file>` 方案：用户先通过独立流程导出 Playwright storage state JSON，生成器录制时把该文件传给 browser context。这样不会直接读取或锁定日常 Chrome profile，也便于测试和复现。

CLI 增加 `--storage-state <file>` 参数，并写入 `configOverrides.storageStatePath`。`VideoGeneratorConfig` 增加可选 `storageStatePath`。`recordTimelineSegments` 创建 context 时，如果 `storageStatePath` 存在，就传入 Playwright `storageState`。

如果 storage state 文件不存在、不可读或格式无效，录制应在创建 context 阶段失败，并在报告中给出清晰错误。导出登录态的辅助命令可以后续单独做；本轮先提供加载入口，满足已登录业务系统录制的最小闭环。

## 动作与等待

保留现有动作：

- `打开 <url>`
- `点击 <text>`
- `点击选择器 <selector>`
- `在 <label|placeholder> 输入 <value>`
- `在选择器 <selector> 输入 <value>`
- `等待 <text>`
- `向下滚动 <pixels>`

新增脚本动作：

- `等待选择器 <selector>`：等待 selector 对应元素可见。
- `向下滚动到选择器 <selector>`：滚动页面直到 selector 对应元素可见。

Pacdora 脚本应使用这些动作先展示“抽屉式礼盒”卡片，再点击进入详情页，而不是直接打开详情 URL。

## Pacdora 脚本形态

脚本应保留用户可见路径：

1. 打开原始 mockups 页面。
2. 进入刀版页面。
3. 滚动到“抽屉式礼盒”卡片可见。
4. 点击“抽屉式礼盒”卡片。
5. 切换到“内尺寸”。
6. 在同一个页面内输入长度、宽度、高度。
7. 等待页面显示 `300 × 300 × 100 mm`。

当页面文字有歧义时可以使用 selector，但视频画面必须先展示目标卡片，再导航到详情页。

## 字幕规范化

写入字幕前处理字幕文本：

- 删除 `。`。
- 将 `，` 和 `,` 替换为单个空格。
- 合并连续空白。
- 去掉首尾空白。

TTS 旁白文本保持原样，只规范化字幕输出。

## 渲染

渲染器需要支持 timeline 使用一个连续录制文件。推荐新增顶层连续录制产物字段，同时保留 segment 元数据用于字幕和报告。

如果为了最小改动，也可以让所有 segment 指向同一个连续 clip，但长期更清晰的接口是 top-level continuous recording artifact。

## 错误处理

连续录制中任一 action 失败时，失败报告仍需包含：

- 失败 segment id。
- 失败 action。
- 截图路径。
- 输出目录。

失败截图应来自当前正在录制的 live page，而不是 prepared static page。

## 测试计划

新增或更新测试覆盖：

- 多个 segment 只生成一个连续视频 clip。
- 页面内 fill 操作不会导致每个 segment 重建 page/context。
- `等待选择器` 可以解析并等待可见 selector。
- `向下滚动到选择器` 可以解析并滚动到目标元素。
- 字幕规范化会删除句号并替换逗号。
- Pacdora 示例脚本在进入详情前会先滚动展示目标卡片。
- CLI 能解析 `--storage-state <file>` 并传入 pipeline config overrides。
- recorder 创建 context 时会使用 `storageStatePath`，并能用测试服务验证登录态 cookie/localStorage 生效。

实现后运行 `npm run test`。再运行 Pacdora 脚本作为真实录制冒烟测试，确认生成 `video-runs/pacdora-dieline/final.mp4`。

## 已确认决策

- 本轮采用 `1920 × 1080` viewport 作为全屏录制画布。
- 本轮先不做逐帧剪辑。连续录制和显式等待会先减少加载伪影；如果后续仍需要去掉导航初期画面，再做后处理裁剪增强。
