# 脚本驱动网页教程视频生成器

> 把 Markdown 操作脚本转换成网页教程视频：自动打开网页、点击、填写、等待结果，生成旁白、字幕和 `final.mp4`。

这个项目当前是一个以本地 CLI 为主的轻量工具，人工录制提供操作浮层和审核窗口。适合先通过 Codex、Claude Code 等 coding agent 代为检查环境和运行命令，不要求试用者自己熟悉命令行。

## 适合做什么

- 生成网页功能演示视频。
- 把产品操作流程录成带旁白和字幕的教程视频。
- 用脚本反复生成相似流程的视频。
- 先用内置 demo 验证本机环境，再替换成自己的网页脚本。

## 不适合做什么

- 录制桌面软件或系统级操作。
- 自动处理所有复杂网页交互。
- 在没有阿里云 DashScope API Key 的情况下生成真实旁白。
- 在没有 ffmpeg/ffprobe 的机器上直接合成最终 MP4。

## 小白试用入口

如果你会打开 Claude Code、Codex 或类似 coding agent，请不要自己输入命令。

请在这个项目目录里打开 agent，然后把下面这段话复制给它。后续如果它要安装依赖、下载浏览器或修改配置，看懂说明后授权即可。

```text
我是代码小白，请你帮我试用这个项目。不要让我手动输入命令，请你自己执行需要的检查、安装、配置和生成命令。

请先阅读 README.md、AGENTS.md、package.json 和 examples/video-generator/README.md，理解这个项目如何运行。

请先自动检查项目运行环境，包括：
- Node.js 和 npm 是否可用；
- npm 依赖是否已经安装；
- Playwright Chromium 是否可用；
- ffmpeg 和 ffprobe 是否可用；
- DASHSCOPE_API_KEY 是否已经配置；
- examples/video-generator/basic-demo.md 是否存在。

请优先运行项目内置的环境检查命令 npm run video:doctor；不要让我手动输入这条命令。

如果发现缺少依赖、浏览器、ffmpeg/ffprobe、环境变量或其他必需配置，请先用简单中文告诉我：
1. 缺少什么；
2. 为什么需要；
3. 你准备执行哪些操作；
4. 这些操作会影响哪里。

涉及安装、下载、修改配置、写入环境变量或修改系统设置时，请先请求我授权。获得授权后，请你直接执行，不要让我手动操作。

环境准备好后，请先生成内置演示视频。使用 examples/video-generator/basic-demo.md，输出到 video-runs/basic-demo。

如果成功，请告诉我 final.mp4 的位置。
如果失败，请读取输出目录里的 run-report.json、candidate-report.json 和 screenshots，解释失败原因，并尽量修复后重试。
```

### 生成自己的脚本

内置 demo 成功后，可以继续把下面这段话发给 agent：

```text
请帮我生成自己的网页教程视频。

请先打开 examples/video-generator/README.md，了解脚本写法。然后帮我检查我的 Markdown 脚本，确认动作描述是否清楚、按钮和字段名称是否容易被网页识别。

如果脚本不清楚，请直接帮我改成更适合这个项目识别的写法。确认后，请生成视频并输出到 video-runs/my-video。

如果失败，请读取 run-report.json、candidate-report.json 和 screenshots，解释失败原因，并尽量修复后重试。
```

## API Key 配置

真实旁白需要阿里云 DashScope API Key。推荐在项目根目录创建 `.env` 文件，内容如下：

```bash
DASHSCOPE_API_KEY=你的 DashScope API Key
```

不要把真实 API Key 发到公开仓库、聊天截图或文档里。如果你让 agent 帮你配置，请让它只写入本机 `.env` 或当前终端环境。

可选 TTS 配置：

```bash
ALIYUN_TTS_MODEL=cosyvoice-v3-flash
ALIYUN_TTS_VOICE=longanyang
ALIYUN_TTS_FORMAT=wav
ALIYUN_TTS_SAMPLE_RATE=24000
ALIYUN_TTS_VOLUME=
ALIYUN_TTS_RATE=
ALIYUN_TTS_PITCH=
ALIYUN_TTS_LANGUAGE_HINT=
ALIYUN_TTS_ENABLE_SSML=
```

## 开发者快速运行

如果你熟悉命令行，可以直接使用下面的命令。

安装依赖：

```bash
npm install
```

安装 Playwright Chromium：

```bash
npx playwright install chromium
```

运行测试：

```bash
npm run test
```

生成内置 demo：

```bash
npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo
```

测试真实 TTS：

```bash
npm run video:tts-smoke -- "你好，这是一次语音合成测试"
```

生成语义动作 demo：

```bash
npm run video:generate -- --script examples/video-generator/semantic-demo.md --output video-runs/semantic-demo
```

## 脚本怎么写

视频脚本建议使用“操作行 + 旁白行”的结构：

```markdown
打开 demo:basic
旁白：首先打开内置演示页面，确认浏览器已经进入教程场景。

点击 开始
旁白：接着点击开始按钮，演示页面会显示下一步操作提示。

在 姓名 输入 小明
旁白：最后在姓名输入框里填入小明，完成一次基础表单演示。
```

更多写法见 [examples/video-generator/README.md](examples/video-generator/README.md)。

## 输出文件

一次生成通常会输出到 `video-runs/<本次任务名>/`：

| 文件或目录 | 说明 |
|---|---|
| `final.mp4` | 最终视频 |
| `subtitles.srt` | 字幕文件 |
| `timeline.json` | 回填后的时间线 |
| `run-report.json` | 成功或失败报告 |
| `candidate-report.json` | 语义匹配候选报告，失败时尤其有用 |
| `audio/` | 分段旁白和合并旁白 |
| `clips/` | Playwright 录制素材 |
| `screenshots/` | 失败截图 |

## 常见问题

### 没有生成 `final.mp4` 怎么办？

先看输出目录里的 `run-report.json`。如果是网页动作失败，再看 `screenshots/` 和 `candidate-report.json`。如果你在用 Claude Code 或 Codex，把这些文件路径告诉 agent，让它帮你读报告并修复脚本。

### 没有配置 `DASHSCOPE_API_KEY` 会怎样？

真实 TTS 会失败，项目会写入失败报告。它不会用假音频冒充成功。

### 为什么需要 ffmpeg 和 ffprobe？

`ffprobe` 用来读取音频时长，`ffmpeg` 用来合并画面、旁白和字幕，最后输出 MP4。

### 为什么需要 Playwright Chromium？

项目用 Playwright 控制 Chromium 打开网页、执行点击和填写，并录制页面画面。

### 能不能先不录真实业务网页？

建议先跑 `examples/video-generator/basic-demo.md`。它使用内置 `demo:basic` 页面，不需要真实网站，也更容易判断环境是否正常。

## 项目结构

```text
src/cli/video-generator.ts              CLI 入口
src/lib/video-generator/                视频生成核心流水线
examples/video-generator/               示例脚本和脚本写作说明
docs/handover/                          技术交接文档
docs/insights/                          产品思考文档
docs/research/                          调研和复盘
docs/exec-plans/                        执行计划
video-runs/                             默认输出目录
```

架构细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 人工录制与自动精剪

项目也支持真实 Windows 交互式人工录制：录制、预览审核、pickup 补录、Agent 旁白、真实 TTS 和 ffmpeg finalize 可在同一个 `video-runs/<run>/` 中追踪。

人工审核后的 effective plan 不会被覆盖。真实 TTS 后会生成独立 fine plan，按以下优先级清洗素材：

1. 坏帧或不可解码区间；
2. 高置信度白屏、无意义加载；
3. 重复输入和误操作等待；
4. TTS 对齐与最终节奏调整。

页面 `navigation` 事件不能保护整段白屏；如果白屏候选包含真实点击、输入或保存，则保留并输出 warning。最终报告允许 `ok=true + quality.status=warning`，但必须保证媒体可播放、必需事件覆盖率 100% 和 `cleanupErrors=[]`。

详细设计见 [人工录制平衡精剪设计](docs/research/manual-recording-balanced-fine-editing-design.md)。
