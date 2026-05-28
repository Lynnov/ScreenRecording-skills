> 产品思考见 [docs/insights/video-generator-recording-reliability.md](../insights/video-generator-recording-reliability.md)

# 视频生成器真实业务录制可靠性改造

## 模块边界

- `src/cli/video-generator.ts`：新增 `--prepare-script` 和 `--dry-run`，分别用于生成脚本三稿和录制前验证。
- `src/lib/video-generator/script-drafts.ts`：复制原始稿、润色稿、可执行稿，并写入 `scripts/script-manifest.json`。
- `src/lib/video-generator/preflight.ts`：执行 dry-run，验证脚本解析、登录态、上传文件存在性和浏览器动作，不生成 TTS、音频、字幕或视频。
- `src/lib/video-generator/artifacts.ts`：统一 run 目录结构，提供 `scripts/`、`auth/`、`clips/`、`audio/`、`screenshots/`、`reports/`、`debug/` 路径。
- `src/lib/video-generator/action-redaction.ts`：脱敏失败动作，避免报告写入输入值、远程选择关键字或上传文件路径。
- `src/lib/video-generator/browser/actions.ts`：执行 `hover`、`remoteSelect`、`selectFirst`、`uploadFile` 等动作。
- `src/lib/video-generator/browser/interaction-rules.ts`：封装远程选择、下拉第一项、上传控件定位规则。
- `src/lib/video-generator/browser/cursor-overlay.ts`：在录制页面注入鼠标指示器，hover 动作会先移动指示器再执行悬停。

## 数据流

### 脚本三稿

1. CLI 执行 `--prepare-script`。
2. `prepareScriptDrafts` 读取源脚本，但不修改源文件。
3. 在输出目录的 `scripts/` 下写入：
   - `original.md`：原始稿，内容必须等于源脚本。
   - `polished.md`：润色稿，初始等于原始稿。
   - `executable.md`：可执行稿，初始等于润色稿。
4. 写入 `scripts/script-manifest.json`，记录三稿路径、来源路径、覆盖策略和业务数据保护提示。
5. 如果 `scripts/original.md` 已存在且内容不同，流程失败，避免覆盖用户原始脚本。

### Preflight dry-run

1. CLI 执行 `--dry-run`。
2. `runPreflight` 读取脚本并解析 timeline。
3. 检查 `storageStatePath` 是否存在；未配置时记录 skipped。
4. 将上传文件相对路径按脚本文件所在目录解析，检查本地文件是否存在。
5. 启动 Playwright 浏览器执行非上传动作，但不启用 `recordVideo`。
6. `uploadFile` 在 dry-run 中只做文件存在性检查，文件存在时跳过浏览器上传执行。
7. 失败时写入截图、失败 segment/action、页面候选元素和 `reports/candidate-report.json`。
8. 写入 `reports/preflight-report.json`。

### 完整生成

完整生成仍走原 pipeline：脚本解析、TTS、浏览器录制、字幕、音频合并、ffmpeg 合成和 `reports/run-report.json`。`--prepare-script` 与 `--dry-run` 互斥，避免用户误以为同一次命令同时准备脚本并完成 preflight。

## 脚本语法

新增动作语法：

```markdown
悬停 原纸贸易
悬停选择器 .menu-item
远程选择 客户名称 测试 第一个
远程选择 客户名称 测试 选择 张三公司
选择 收货地址 第一个
选择选择器 .address-select 第一个
上传文件 合同附件 fixtures/contracts/demo.pdf
上传文件选择器 input[type="file"] fixtures/contracts/demo.pdf
```

规则：

- `远程选择` 保留用户给定查询词，例如“测试”，不会替换业务数据。
- `选择 ... 第一个` 会先打开目标控件，再在可见 dropdown/listbox 中选择第一项。
- `上传文件` 的相对路径以脚本文件所在目录为基准。
- 完整路径、输入值和远程选择关键字不会写入持久化失败报告。

## 输出素材结构

一次 run 会统一创建：

```text
<output>/
  scripts/
    original.md
    polished.md
    executable.md
    script-manifest.json
  auth/
  clips/
  audio/
  screenshots/
  reports/
    preflight-report.json
    run-report.json
    candidate-report.json
  debug/
  final.mp4
  timeline.json
  subtitles.srt
```

`final.mp4`、`timeline.json`、`subtitles.srt` 仍保留在 run 根目录，兼容现有生成习惯；报告统一进入 `reports/`。

## 关键设计决策

- 先 dry-run 再录制：真实业务页面失败通常来自登录态、控件数据、上传文件或交互模式，必须在生成 TTS 和视频前发现。
- 三稿分离：原始脚本只读保存，润色稿用于调整旁白，可执行稿用于补选择器和特殊动作，避免复盘时丢失用户原意。
- 上传动作 dry-run 只验文件：文件上传可能有业务副作用，preflight 只确认前置文件存在，完整执行留给正式生成。
- 候选报告脱敏：报告只保留结构化定位线索，不记录输入值、远程选择关键字或本地上传路径。
- 下拉候选收窄：只在可见 dropdown/listbox 容器内查找选项，避免点到页面上无关列表项。

## 失败模式

- 原始稿冲突：`scripts/original.md` 已存在且内容不同，`--prepare-script` 失败并提示检查原始稿。
- 登录态缺失：`--storage-state` 指向不存在文件，preflight 失败。
- 上传文件缺失：`uploadFile` 引用文件不存在，preflight 失败，但报告不暴露文件路径。
- 浏览器动作失败：preflight 写截图和候选报告，完整生成写运行失败报告。
- 下拉歧义：可见 dropdown/listbox 中找不到选项，或上传区域附近有多个 file input 且无法唯一判断时失败。

## 验证

- `npm run typecheck`
- `npm run test:unit`
- `npm run test`
- 建议额外运行：
  - `npm run video:generate -- --script examples/video-generator/basic-demo.md --dry-run --output video-runs/basic-demo-preflight`
  - `npm run video:generate -- --script examples/video-generator/basic-demo.md --prepare-script --output video-runs/basic-demo-drafts`

完整视频生成仍需要 DashScope API Key、Playwright Chromium 和 ffmpeg/ffprobe。
