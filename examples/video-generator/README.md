# Video Generator Examples

本目录包含脚本驱动浏览器教程视频生成器的最小示例。

## basic-demo.md

`basic-demo.md` 演示三段基础流程：打开内置演示页面、点击按钮、填写输入框。

示例脚本使用内置 `demo:basic` 页面，不需要启动 dev server，也不需要替换端口。

```bash
npm run video:generate -- --script examples/video-generator/basic-demo.md --output video-runs/basic-demo
```

如果没有配置阿里云 TTS 环境变量，命令会生成清晰的失败报告，而不会联网或写入假音频冒充成功。

## 录制前推荐流程

真实业务录制建议先准备脚本三稿，再做 preflight dry-run，最后才生成视频。

```bash
npm run video:generate -- --script examples/video-generator/basic-demo.md --prepare-script --output video-runs/basic-demo-drafts
npm run video:generate -- --script video-runs/basic-demo-drafts/scripts/executable.md --dry-run --output video-runs/basic-demo-preflight
npm run video:generate -- --script video-runs/basic-demo-drafts/scripts/executable.md --output video-runs/basic-demo-final
```

三稿机制会在输出目录生成：

- `scripts/original.md`：保留用户原始脚本，不允许静默覆盖。
- `scripts/polished.md`：润色稿，用于调整旁白和节奏。
- `scripts/executable.md`：可执行稿，用于补选择器、上传文件路径和特殊动作。
- `scripts/script-manifest.json`：记录三稿来源和业务数据保护提示。

`--prepare-script` 与 `--dry-run` 互斥。先准备三稿，确认可执行稿后，再单独运行 dry-run。

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
- 不要在未确认前替换用户提供的业务测试数据，例如客户名、地址选择策略或合同文件路径。

### 新动作语法

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

说明：

- `悬停` 用于一级菜单 hover 后出现二级菜单的场景。
- `远程选择` 会点击控件、输入查询词、等待可见 dropdown/listbox，再选择第一项或指定选项。
- `选择 ... 第一个` 会先打开目标控件，再选择当前可见下拉中的第一项。
- `上传文件` 的相对路径以脚本文件所在目录为基准。
- preflight 报告会脱敏输入值、远程选择关键字和上传文件路径；截图仍可能包含页面可见业务数据，只适合作为本地诊断产物。

### 旁白行

- 每个关键操作后添加一行 `旁白：`，说明当前操作的目的或业务含义。
- 旁白应简洁自然，适合直接用于语音播报。
- 避免只重复操作行内容，例如不要写“现在点击保存按钮”，而应说明“提交当前配置，完成方案创建”。
- 涉及业务规则时，优先解释用户能理解的结果，例如“符合条件的产品单价统一上调 0.5”。

### 推荐节奏

- 页面跳转、菜单进入、点击新增、填写关键字段、保存提交，都建议配置旁白。
- 连续填写多个简单字段时，可以将相关字段分组，但关键选择项仍建议保留独立操作。
- 一段旁白控制在一句话内，避免 TTS 过长影响录屏节奏。
