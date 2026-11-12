# 人工录制示例

本目录放人工录制产品流程使用的 Markdown 原始脚本。人工模式不会直接把脚本转换成浏览器自动操作，而是先生成 Agent request，由兼容 exchange schema 的 Agent 输出 guide，再由用户批准后进入人工录制。

## 基础流程

```bash
npm run video:guide -- --script examples/manual-recording/basic-form.md --output video-runs/manual-basic-form --prepare-agent
```

然后让任意兼容 Agent 读取：

```text
video-runs/manual-basic-form/agent/guide-request.v01.json
```

Agent 写入：

```text
video-runs/manual-basic-form/agent/guide-response.v01.json
```

再执行：

```bash
npm run video:guide -- --run video-runs/manual-basic-form --apply-agent-response video-runs/manual-basic-form/agent/guide-response.v01.json
npm run video:guide -- --run video-runs/manual-basic-form --approve-version 1
```

## 数据边界

第一版 request 会保留本地业务脚本文本，不做脱敏。请只在本地可信 Agent 会话中使用，不要把真实客户数据上传到不受控服务。

## 正式录制 runtime smoke

`product-capture-smoke.html` 是正式 Electron capture runtime 的本地验收页面。先启动隔离的本地服务器，再运行：

```bash
node scripts/serve-manual-capture-smoke.mjs
node scripts/prepare-manual-capture-smoke.mjs --output video-runs/manual-product-runtime-smoke
npm run video:record -- --run video-runs/manual-product-runtime-smoke --display-mode borderless-maximized
```

## 完整产品流程

端到端示例见 `end-to-end.md`。正式命令顺序为：

```text
video:guide → video:record → video:analyze → video:preview
→ video:review → video:pickup（按需）
→ video:narration → video:finalize
```

每阶段可使用 `npm run verify:manual -- --run <run> --stage <stage>` 生成结构化校验报告。

## 生成配置与重试

请从项目根目录运行 `video:finalize`。命令读取当前工作目录的 `.env`，其中可配置 `DASHSCOPE_API_KEY` 和 `ALIYUN_TTS_*`；同名进程环境变量优先于文件配置。

生成时先写入同目录临时视频，通过媒体校验并写入报告后才替换 `final.mp4`。配置、配音、渲染或校验失败时，已有成片保持不变，本次临时视频会尝试清理。

请以本次命令退出码和 `reports/final-verification.json` 判断是否成功：失败后仍存在的 `final.mp4` 是上一版，并不代表本次生成成功。本机制保护视频文件，不提供音频、字幕、时间线和报告的整套历史版本回退。
