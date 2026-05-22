# Video Generator Examples

本目录包含脚本驱动浏览器教程视频生成器的最小示例。

## basic-demo.md

`basic-demo.md` 演示三段基础流程：打开内置演示页面、点击按钮、填写输入框。

示例脚本使用内置 `demo:basic` 页面，不需要启动 dev server，也不需要替换端口。

```bash
npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo
```

如果没有配置阿里云 TTS 环境变量，命令会生成清晰的失败报告，而不会联网或写入假音频冒充成功。
