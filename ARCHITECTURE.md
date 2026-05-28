# ARCHITECTURE.md

脚本驱动网页教程视频生成器是一个本地 CLI 工具。它用 TypeScript 组织流水线，用 Playwright 控制并录制 Chromium 页面，用阿里云 DashScope CosyVoice 生成旁白音频，用 ffmpeg/ffprobe 合成音频、字幕和最终视频。

## 目录结构

```
src/
├── cli/
│   └── video-generator.ts        # CLI 入口：参数解析、TTS smoke、退出码和报告展示
└── lib/
    └── video-generator/
        ├── types.ts              # Timeline、BrowserAction、RunReport、错误类型
        ├── config.ts             # 默认配置、环境变量和 CLI override 合并
        ├── script-parser.ts      # Markdown/自然语言脚本 → Timeline
        ├── timeline-validator.ts # Timeline 结构、动作、等待目标和时长校验
        ├── pipeline.ts           # 主流水线：解析、TTS、录制、字幕、音频、视频、报告
        ├── duration.ts           # 片段时长计算
        ├── subtitles.ts          # SRT 字幕生成
        ├── audio.ts              # ffprobe 读取音频时长、ffmpeg 合并旁白音轨
        ├── ffmpeg.ts             # final.mp4 渲染、字幕烧录、连续 clip 裁切/合成
        ├── report.ts             # run-report.json 和 candidate-report.json 写入
        ├── tts/
        │   ├── types.ts          # TTS Provider 接口
        │   └── aliyun.ts         # DashScope CosyVoice 非实时 HTTP TTS
        └── browser/
            ├── recorder.ts       # Playwright 连续录制和失败截图
            ├── actions.ts        # goto/click/fill/wait/scroll/semantic 动作执行
            ├── demo-page.ts      # 内置 demo 页面
            ├── page-snapshot.ts  # 页面候选元素抽取
            ├── candidate-matcher.ts # 语义目标匹配和候选报告
            └── interaction-rules.ts # 常见 Web 交互规则

tests/
└── video-generator/              # node:test + tsx 单元测试和 Playwright POC

examples/
└── video-generator/              # 可复制脚本示例和脚本写作说明

docs/
├── research/                     # 技术调研、POC、复盘
├── exec-plans/                   # 活跃/完成执行计划
├── handover/                     # 技术交接文档
├── insights/                     # 产品思考文档
└── future/                       # 暂未排期想法
```

## 数据流

```
Markdown 脚本
  → parseVideoScript
  → Timeline + timeline-validator
  → TTS provider 逐段生成 audio/{segmentId}.wav
  → recordTimelineSegments 用 Playwright 顺序执行动作并连续录制 Chromium
  → timeline.json + subtitles.srt
  → mergeAudioSegments 生成 audio/narration.wav
  → renderFinalVideo 调用 ffmpeg 输出 final.mp4
  → writeRunReport 写入 run-report.json / candidate-report.json
```

**失败诊断数据流：**
```
Playwright/TTS/ffmpeg 错误
  → VideoGeneratorError 标准化错误码和 segment id
  → recorder 捕获 screenshots/{segmentId}.png
  → semantic matcher 输出候选元素和失败 reason
  → pipeline 汇总 RunReport
  → CLI 打印失败摘要并返回非零退出码
```

## Timeline 模型

核心类型定义在 `src/lib/video-generator/types.ts`：

| 类型 | 用途 |
|----|------|
| `Timeline` | 一条视频脚本的标准结构，包含标题、顶层素材和 segments |
| `TimelineSegment` | 单段旁白、字幕、动作、时长和素材引用 |
| `BrowserAction` | 浏览器动作联合类型：打开、点击、填写、等待、滚动、语义点击、语义填写、语义选择 |
| `WaitTarget` | 等待目标：文本、选择器、隐藏选择器、URL、network idle |
| `SemanticActionTarget` | 语义动作目标：按钮、链接、字段、可见文本 |
| `TimelineSegmentAssets` | 单段素材：音频、clip、截图、视频起止时间、已解析动作 |
| `TimelineAssets` | 顶层素材：连续录制 clip 和起始偏移 |
| `VideoGeneratorConfig` | viewport、时长估算、timeout、TTS、字幕模式、输出目录、storage state |
| `RunReport` | 成功/失败报告，包含 final video、timeline、字幕、失败动作、候选和截图 |
| `VideoGeneratorError` | 带错误码、segment id、失败动作和候选报告的结构化错误 |

## 浏览器录制子系统

`src/lib/video-generator/browser/` 负责把 timeline action 转为真实页面操作，并输出可供 ffmpeg 使用的视频素材。

**核心组件：**
- `recorder.ts` — 创建 Chromium browser/context/page，按 segment 顺序执行动作，使用 Playwright `recordVideo` 连续录制整条脚本，并在失败时截图。
- `actions.ts` — 执行精确动作和语义动作，处理动作后的等待目标。
- `page-snapshot.ts` — 抽取当前页面可见候选元素，保留角色、名称、文本、层级和 selector hint。
- `candidate-matcher.ts` — 将用户脚本中的“按钮/链接/字段/文本”匹配为页面唯一候选，区分强/中/弱置信度和歧义。
- `interaction-rules.ts` — 封装常见 Web 交互规则，例如可点击祖先、输入字段定位、下拉选择和遮挡判断。
- `demo-page.ts` — 提供 `demo:basic` 内置页面，保证基础示例无需外部 dev server。

## TTS 和音频

TTS 通过 `src/lib/video-generator/tts/types.ts` 的 `TtsProvider` 接口隔离。当前真实实现是 `src/lib/video-generator/tts/aliyun.ts`，使用 `DASHSCOPE_API_KEY` 调用 DashScope CosyVoice 非实时 HTTP API，再下载音频到本地 `audio/` 目录。

音频相关处理分两层：

| 模块 | 说明 |
|------|------|
| `duration.ts` | 根据估算时长、真实音频时长和 buffer 计算 segment 时长 |
| `audio.ts` | 用 ffprobe 读取音频时长，用 ffmpeg 把分段旁白合并为 `audio/narration.wav` |

## ffmpeg 合成

`src/lib/video-generator/ffmpeg.ts` 负责最终视频输出。当前渲染优先使用顶层连续录制 clip，根据 segment 的 `videoStartMs` / `videoEndMs` 对画面进行裁切或拼接，再混入旁白音轨并烧录 SRT 字幕。

输出目录默认是 `video-runs/`，一次运行通常包含：

| 路径 | 内容 |
|------|------|
| `audio/{segmentId}.wav` | 每段 TTS 音频 |
| `audio/narration.wav` | 合并后的完整旁白 |
| `clips/` | Playwright 录制的视频素材 |
| `screenshots/{segmentId}.png` | 失败时页面截图 |
| `timeline.json` | 回填音频、时长和素材后的 timeline |
| `subtitles.srt` | 字幕文件 |
| `candidate-report.json` | 语义匹配失败时的候选元素报告 |
| `run-report.json` | 本次运行成功/失败摘要 |
| `final.mp4` | 最终可交付视频 |

## 新增功能标准触及点

添加新功能时通常需要检查以下位置：

| 触及点 | 路径 | 说明 |
|--------|------|------|
| 类型定义 | `src/lib/video-generator/types.ts` | 新增 timeline 字段、动作类型、报告字段或错误码 |
| 脚本解析 | `src/lib/video-generator/script-parser.ts` | 新增用户脚本语法或动作句式 |
| Timeline 校验 | `src/lib/video-generator/timeline-validator.ts` | 新增字段和动作必须同步校验 |
| 浏览器动作 | `src/lib/video-generator/browser/actions.ts` | 新增 Playwright 动作执行分支 |
| 语义匹配 | `src/lib/video-generator/browser/page-snapshot.ts`、`candidate-matcher.ts`、`interaction-rules.ts` | 新增半自动定位和交互规则 |
| 录制流程 | `src/lib/video-generator/browser/recorder.ts` | 修改录制时序、storage state、截图或连续 clip 行为 |
| TTS | `src/lib/video-generator/tts/` | 新增或修改语音 provider |
| 音视频合成 | `src/lib/video-generator/audio.ts`、`ffmpeg.ts`、`subtitles.ts` | 修改 ffprobe/ffmpeg 参数、字幕或输出素材 |
| 失败报告 | `src/lib/video-generator/report.ts`、`pipeline.ts` | 新增可诊断字段时同步报告和 CLI 展示 |
| CLI | `src/cli/video-generator.ts` | 新增命令行参数、退出码或 smoke 命令 |
| 示例 | `examples/video-generator/` | 新增脚本语法或能力时同步用户示例 |
| 文档 | `docs/handover/`、`docs/insights/`、`docs/research/`、`docs/exec-plans/` | 新功能、大迭代、调研和复盘同步记录 |

## 关键文档索引

| 文档 | 路径 | 内容 |
|------|------|------|
| 技术交接 | `docs/handover/scripted-browser-video-generator.md` | CLI pipeline、TTS、Playwright 录制、SRT、ffmpeg 合成、失败报告 |
| 产品思考 | `docs/insights/scripted-browser-video-generator.md` | CLI-first、Playwright、阿里云 TTS、ffmpeg、内置 demo、后续方向 |
| 初始设计调研 | `docs/research/scripted-browser-video-generator.md` | 自然语言脚本到教程视频的 MVP 设计规格 |
| TTS API 参考 | `docs/research/非实时语音合成CosyVoice HTTP API参考.md` | DashScope CosyVoice 非实时语音合成 HTTP API 参考 |
| 产品调试复盘 | `docs/research/video-generator-product-batch-price-adjustment-retrospective-2026-05-22.md` | 产品批量调价视频生成调试复盘 |
| 完成计划 | `docs/exec-plans/completed/scripted-browser-video-generator.md` | 初始视频生成器执行计划和完成记录 |
| 连续录制计划 | `docs/exec-plans/active/continuous-video-recording.md` | 连续操作视频录制、selector 等待、storage state 和字幕规范化 |
| 半自动录制计划 | `docs/exec-plans/active/semi-automatic-web-demo-recorder.md` | 语义动作、候选匹配、常见 Web 交互规则和候选报告 |

## 技术栈

| 层 | 技术 |
|----|----|
| 运行时 | Node.js + TypeScript ESM |
| CLI 执行 | tsx |
| 浏览器自动化 | Playwright Chromium |
| TTS | 阿里云 DashScope CosyVoice 非实时 HTTP API |
| 音频分析 | ffprobe |
| 视频合成 | ffmpeg |
| 字幕 | SRT + ffmpeg burn-in |
| 测试 | TypeScript typecheck、node:test、tsx、Playwright POC |
| 输出格式 | 本地素材目录 + `final.mp4` |
