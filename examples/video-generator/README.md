# Video Generator Examples

本目录包含脚本驱动浏览器教程视频生成器的最小示例。

## basic-demo.md

`basic-demo.md` 演示三段基础流程：打开内置演示页面、点击按钮、填写输入框。

示例脚本使用内置 `demo:basic` 页面，不需要启动 dev server，也不需要替换端口。

```bash
npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo
```

如果没有配置阿里云 TTS 环境变量，命令会生成清晰的失败报告，而不会联网或写入假音频冒充成功。

## 脚本写作规范

视频脚本建议使用“操作行 + 旁白行”的交替结构，便于浏览器自动操作和 TTS 配音同时生成。

```markdown
打开 https://example.com
旁白：首先打开业务系统，进入需要演示的功能页面。

点击“新增调价”。
旁白：点击新增后，系统会进入调价方案创建页面。
```

### 操作行

- 使用明确、可执行的动作描述，例如“点击”“选择”“输入”“打开”。
- 尽量写清楚目标控件名称，例如“点击页面右下角的‘保存’按钮”。
- 表单字段建议一项一行，避免把多个复杂动作写在同一句里。
- 保留真实业务文案，例如菜单名、按钮名、选项名，方便自动识别页面元素。

### 旁白行

- 每个关键操作后添加一行 `旁白：`，说明当前操作的目的或业务含义。
- 旁白应简洁自然，适合直接用于语音播报。
- 避免只重复操作行内容，例如不要写“现在点击保存按钮”，而应说明“提交当前配置，完成方案创建”。
- 涉及业务规则时，优先解释用户能理解的结果，例如“符合条件的产品单价统一上调 0.5”。

### 推荐节奏

- 页面跳转、菜单进入、点击新增、填写关键字段、保存提交，都建议配置旁白。
- 连续填写多个简单字段时，可以将相关字段分组，但关键选择项仍建议保留独立操作。
- 一段旁白控制在一句话内，避免 TTS 过长影响录屏节奏。

## 可执行稿 Stage 写法

真实业务录制建议保留“三稿”结构：原始稿保留业务人员写法，润色稿整理旁白和节奏，可执行稿再加入 `@stage`、`scope`、`anchor`、稳定等待点和绝对素材路径。

```markdown
@stage orderEntry.list scope="main" anchor="input[placeholder='请输入客户名称/手机号']"
打开 https://example.com/order-entry
点击「新增」
旁白：进入订单录入页面后，点击新增开始创建订单。

@stage orderEntry.createDialog scope=".el-dialog:visible" anchor="text=新增订单" anchor="input[placeholder='请选择客户名称']"
远程选择「客户名称」为「测试客户」
上传文件「合同图片」为「E:/Code/ScreenRecording/视频脚本原稿/xxx.png」
点击「生成订单」
旁白：填写订单关键资料后，提交生成订单。
```

- 独立页面用 URL 或页面级 selector 作为 anchor。
- 弹窗、抽屉、下拉层用可见容器作为 `scope`，例如 `.el-dialog:visible`。
- 一个 stage 可以重复出现，表示脚本回到同一个页面状态。
- `preflight-report.json` 会输出 stage 的 scope 和 anchor 命中情况。
- `run-report.json` 会在动作失败时输出 diagnostics，用于判断 selector 歧义、遮挡、下拉未加载或页面过慢。
