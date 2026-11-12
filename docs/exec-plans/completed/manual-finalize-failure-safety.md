# 人工生成失败保护与配置一致性修复计划

> 创建时间：2026-11-12
> 状态：已完成并验证

**目标：** 失败重试不删除既有 `final.mp4`；`video:finalize` 读取当前项目 `.env`，进程环境优先；补充可重复的回归验证。

**范围：** `src/lib/video-generator/manual/final-report.ts`、`src/cli/manual-finalize.ts` 及对应测试。保留原有审核边界、精剪算法与持久输出格式；不改录制动作，不清理 Claude 运行配置或开发副本。本地提交按用户指示执行，不推送远程。

## 步骤

- [x] 在 `manual-finalize.unit.test.ts` 增加旧成片存在时的配置、TTS、部分渲染、媒体校验失败，以及成功替换测试；检查失败前后内容相同、临时文件被清理。
- [x] 新增 `manual-finalize-cli.unit.test.ts`，覆盖 `.env` 独立配置、进程环境覆盖、输出不泄露密钥、缺少配置和参数错误。用注入式 finalizer 隔离网络，检查传入的实际配置。
- [x] 执行 `npx tsx --test tests/video-generator/manual-finalize.unit.test.ts tests/video-generator/manual-finalize-cli.unit.test.ts`，确认失败来自上述缺陷。
- [x] finalizer 在当前 run 创建唯一临时 `.mp4`，只渲染和探测临时视频；写成功报告后以同目录 `rename` 完成最后一步替换；异常只清理本次临时文件，并保留原始错误及清理错误。
- [x] CLI 调用 `loadProjectEnv(io.cwd, io.env)` 并把结果显式传给 finalizer；遵循已有 doctor 的配置覆盖语义，不修改全局 `process.env`。
- [x] 定向测试通过后执行 `npm run test`、`npm run test:manual-product`；扩展真实 ffmpeg E2E 检查成功生成后失败重跑保留可播放旧成片。
- [x] 复核 Windows 同目录替换、相对路径和报告写失败路径；更新技术债务状态，归档本计划及索引。

## 验收边界

本次保证失败时旧视频文件不变，并保留本次失败报告；不实现成片、字幕、音频、时间线的完整版本化回退。真实桌面操作和真实云端配音不由注入式 E2E 替代。

## 验证结果

- 修复前定向测试：14 项中 11 项失败；修复后 14/14 通过。
- `npm run test`：类型检查通过，453/453 单元测试通过。
- `npm run test:manual-product`：65/65 集成测试及 1/1 E2E 通过。
- E2E 使用 stub Agent、注入式 capture/TTS 和真实 ffmpeg；验证 `.env`、旧视频逐字节保留和解码、成功重试、final-stage verifier。
- 独立代码复核未发现阻塞问题。发布 rename 失败和临时文件删除失败的专门故障注入用例可后续补强；已有测试验证报告写失败、渲染/探测失败及正常清理。
- 提交范围仅限本地 Git；未触碰真实业务视频或 Claude 运行配置/开发副本。
