# 人工录制与 Agent 辅助剪辑产品化结果

> 完成时间：2026-07-29

## 结果

已交付 `guide → record → analyze → preview → review → pickup → narration → finalize` 产品链路，以及 guide/capture/preview/review/pickup/final 六阶段 verifier。

无人值守 E2E 使用临时目录、stub Agent response、注入式 capture 和真实 ffmpeg/ffprobe，覆盖从原始 Markdown 到 `final.mp4`。真实桌面 record/pickup smoke 已在 Task 8 验收，不在自动 E2E 中重复启动。

## 验证入口

```bash
npm run test
npm run test:video-poc
npm run test:editing-poc
npm run build:manual
npm run build:manual-poc
npm run test:manual-product
```

分阶段校验：

```bash
npm run verify:manual -- --run video-runs/<run> --stage guide
npm run verify:manual -- --run video-runs/<run> --stage capture
npm run verify:manual -- --run video-runs/<run> --stage preview
npm run verify:manual -- --run video-runs/<run> --stage review
npm run verify:manual -- --run video-runs/<run> --stage pickup
npm run verify:manual -- --run video-runs/<run> --stage final
```

## 依赖与限制

- Windows 10/11、Node.js >=22.12、Electron、Playwright Chromium、ffmpeg/ffprobe/libx264。
- DashScope Key 缺失只阻止 finalize；其他人工录制阶段仍可运行。
- 自动 E2E 不调用真实 DashScope，使用注入式 TTS 和真实 ffmpeg，避免测试消耗外部额度。
- 第一版不包含自动登录、自动业务操作、隐私脱敏、系统声音或麦克风。
