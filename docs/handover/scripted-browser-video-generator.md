> 产品思考见 [docs/insights/scripted-browser-video-generator.md](../insights/scripted-browser-video-generator.md)

# 脚本驱动浏览器教程视频生成器

## 模块边界

- `src/cli/video-generator.ts`：CLI 参数解析，支持 `--script`、`--output` 和 `--tts-smoke`。
- `src/lib/video-generator/pipeline.ts`：串联脚本解析、TTS、录制、字幕、音频合并、视频渲染和报告。
- `src/lib/video-generator/script-parser.ts`：把自然语言脚本块解析为 `Timeline`，支持内置 `demo:basic` 页面。
- `src/lib/video-generator/timeline-validator.ts`：校验 timeline、动作、等待目标、时长和可打开 URL。
- `src/lib/video-generator/tts/aliyun.ts`：通过 DashScope CosyVoice 非实时 HTTP API 生成并下载音频。
- `src/lib/video-generator/browser/actions.ts`：执行 Playwright 浏览器动作和等待目标。
- `src/lib/video-generator/browser/recorder.ts`：先在准备页执行动作并等待稳定，再录制稳定后的分段 clip。
- `src/lib/video-generator/subtitles.ts`：根据最终 timeline 生成 SRT。
- `src/lib/video-generator/audio.ts`：读取音频时长并合并分段旁白音频。
- `src/lib/video-generator/ffmpeg.ts`：拼接 clips、混入旁白、烧录字幕并输出 `final.mp4`。
- `src/lib/video-generator/report.ts`：写入 `run-report.json`。

## 数据流

1. CLI 调用 `runVideoGenerator({ scriptPath, configOverrides })`。
2. Pipeline 读取脚本，`parseVideoScript` 生成 `Timeline`，再由 validator 做结构校验。
3. 每个 segment 调用 TTS provider，写入 `audio/{segmentId}.wav`，回填 `actualAudioDurationMs`、`startsAtMs`、`endsAtMs` 和 `assets.audioPath`。
4. `recordTimelineSegments` 在非录制 context 中执行动作、等待页面稳定并保存 `storageState`，再创建录制 context 录制每段稳定画面。
5. Pipeline 写入 `timeline.json`、`subtitles.srt`，调用 `mergeAudioSegments` 生成 `audio/narration.wav`。
6. `renderFinalVideo` 生成 concat list，调用 `ffmpeg` 输出 `final.mp4`。
7. 成功或失败都会写入 `run-report.json`，CLI 根据 `ok` 返回退出码。

## 配置

默认配置来自 `loadVideoGeneratorConfig`：

- viewport：`1920x1080`
- speechRateCharsPerMinute：`220`
- segmentBufferMs：`500`
- actionTimeoutMs：`15000`
- ttsProvider：`aliyun`
- subtitleMode：`burn-in`
- outputDir：`./video-runs`

CosyVoice TTS 必需环境变量：

- `DASHSCOPE_API_KEY`

可选环境变量：

- `ALIYUN_TTS_MODEL`，默认 `cosyvoice-v3-flash`
- `ALIYUN_TTS_VOICE`，默认 `longanyang`
- `ALIYUN_TTS_FORMAT`，默认 `wav`
- `ALIYUN_TTS_SAMPLE_RATE`，默认 `24000`
- `ALIYUN_TTS_VOLUME`
- `ALIYUN_TTS_RATE`
- `ALIYUN_TTS_PITCH`
- `ALIYUN_TTS_LANGUAGE_HINT`
- `ALIYUN_TTS_ENABLE_SSML`

## 关键设计决策

- CLI-first：核心逻辑可单测、可复用，未来 Skill/UI 只需生成脚本并调用 CLI。
- 分段录制：每段先准备页面，再录制稳定状态，避免加载等待进入正片。
- Prepared HTML snapshot：录制 context 通过快照保留动态 DOM、表单值、相对资源 base 和滚动位置。
- Provider 接口：TTS 使用接口隔离，单测用 fake provider，真实实现用 CosyVoice 非实时 HTTP API，先拿到音频 URL 再下载本地素材。
- ffmpeg 本地合成：用 concat demuxer 拼接 clips，合并旁白音频并烧录 SRT 字幕。

## 失败模式

- 缺少 DashScope API Key：`MISSING_TTS_CONFIG`，写入失败报告。
- CosyVoice 合成或音频下载失败：`TTS_SYNTHESIS_FAILED`，报告包含 segment id 和响应体/网络错误。
- 浏览器动作失败：报告包含 failed segment 和截图路径。
- 缺少 ffmpeg/ffprobe 或输入不可读：`FFMPEG_FAILED` / `FFPROBE_FAILED`，错误消息提示安装或检查输入。
- CLI 参数错误：返回非零退出码并打印 usage。

## 常用命令

```bash
npm run test
npx tsx --test tests/video-generator/browser-recorder.unit.test.ts
npx tsx --test tests/video-generator/aliyun-tts.unit.test.ts
npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo
npm run video:tts-smoke -- "你好，这是一次语音合成测试"
```

## 验收状态

- 单元测试和 typecheck 已覆盖 pipeline、CLI、TTS、录制、字幕、报告和 ffmpeg 参数生成。
- 真实 `video:generate` 需要有效阿里云 TTS 凭据和本地 ffmpeg/ffprobe。
- 当前示例脚本使用内置 `demo:basic` 页面，不需要 dev server。
