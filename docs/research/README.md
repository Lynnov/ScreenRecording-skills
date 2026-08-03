# Research / 调研文档

技术方案调研、可行性分析、POC 验证记录。

**AI 须知：修改或新增文件后更新下方索引；检索本目录前先读此文件。**

## 索引

| 文件 | 主题 |
|------|------|
| scripted-browser-video-generator.md | 脚本驱动浏览器教程视频生成器设计规格：自然语言脚本 → 浏览器录制 → 阿里云 TTS → 字幕 → ffmpeg 合成 |
| 非实时语音合成CosyVoice HTTP API参考.md | DashScope CosyVoice 非实时语音合成 HTTP API 参考，用于阿里云 TTS provider 实现 |
| video-generator-product-batch-price-adjustment-retrospective-2026-05-22.md | 产品批量调价视频生成调试复盘：前景层定位、默认选项演示、下拉选择器、真实生成验证 |
| video-generator-rawpaper-order-entry-retrospective-2026-05-27.md | 原纸贸易订单录入录制复盘：时间轴错位、手动录制、Element UI remote select、合同上传阻塞和后续优化 |
| video-generator-rawpaper-order-entry-retrospective-2026-05-29.md | 原纸贸易订单录入录制复盘：直达页录制、选择器收敛、远程下拉稳定性和正式生成经验 |
| video-generator-recording-checklist-2026-05-29.md | 真实业务视频录制检查清单：三稿、登录态、选择器、dry-run、正式生成和验收 |
| manual-recording-agent-editing-design.md | 人工录制与 Agent 辅助剪辑设计：窗口捕获、录制步骤推断、重试、初剪审核、Segment 补录和双流程架构 |
| manual-recording-balanced-fine-editing-design.md | 人工录制平衡精剪与受控自进化设计：单次人工审核、TTS 后自动精剪、重复输入/等待/空白处理、质量门槛和可回滚学习配置 |
| manual-recording-product-capture-runtime-design.md | 人工录制正式 Capture Runtime 回补设计：产品 Electron capture session、overlay/controller bridge、录制清理与真实 record/pickup 验收 |
| manual-recording-infrastructure-poc-results.md | 人工录制基础设施第一轮 POC 结果：四个 POC 全部通过，Windows 100%/125%/150% × F11/borderless 6/6 通过 |
| manual-recording-poc-acceptance-remediation-design.md | 人工录制 POC 实机验收问题修复设计：Windows 真无边框、报告证据闭环、漂移指标拆分和 marker 颜色抽帧 |

## 2026-07-29 补充索引

| 文件 | 主题 |
|---|---|
| manual-recording-productization-results.md | 人工录制、Agent 剪辑、finalize、verifier 与无人值守 E2E 结果 |
