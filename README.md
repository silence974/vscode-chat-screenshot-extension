# Codex Chat Screenshot

把 VS Code 中已复制的 Codex 聊天回复转换成 PNG 截图，并优先自动复制到系统剪贴板。

## 当前 MVP 交互

1. 在 Codex 聊天窗口中选中一段或多段回复并复制。
2. 打开命令面板，执行 `Codex Chat Screenshot: Capture Copied Codex Chat as PNG`。
3. 扩展会打开预览面板，自动渲染截图卡片。
4. 如果当前 VS Code webview 环境支持图片剪贴板写入，会自动复制 PNG。
5. 如果自动复制失败，可以在面板里点击 `复制 PNG` 重试，或点击 `下载 PNG` 导出文件。

## 功能说明

- 支持从系统剪贴板读取聊天文本。
- 支持在面板内直接粘贴和编辑聊天内容。
- 支持基础 markdown 渲染：
  - 标题
  - 段落
  - 无序/有序列表
  - 引用
  - 分隔线
  - 行内代码
  - fenced code block
  - 链接
- 生成的截图只截取聊天卡片区域，不包含工具按钮和输入框。

## 已知限制

- 目前不直接读取 Codex 聊天视图内部消息，而是采用“先复制，再生成截图”的稳定方案。
- 自动复制 PNG 依赖 webview 中的浏览器剪贴板能力；若被系统或环境限制，需要手动点击按钮或下载文件。
- 当前 markdown 渲染是轻量实现，未完整覆盖表格、嵌套列表等全部语法。

## 开发

```bash
npm run lint
```

当前项目使用纯 JavaScript 扩展骨架，无需编译步骤。

## 本地试跑

### 方式一：直接调试运行

1. 用桌面版 VS Code 打开这个仓库目录。
2. 按 `F5`，或者进入“运行和调试”并选择 `Run Codex Chat Screenshot Extension`。
3. 会弹出一个新的 Extension Development Host 窗口。
4. 在这个新窗口里确认你能使用 Codex 聊天。
5. 先在 Codex 聊天窗口复制一段或多段回复。
6. 打开命令面板，执行 `Codex Chat Screenshot: Capture Copied Codex Chat as PNG`。
7. 查看右侧预览面板是否已生成截图，并测试是否已自动复制 PNG。

### 方式二：打包后安装

如果你想像普通扩展一样安装：

```bash
npm install -g @vscode/vsce
vsce package
```

然后在 VS Code 中执行：

1. `Extensions: Install from VSIX...`
2. 选择生成的 `.vsix` 文件
3. 安装完成后重载 VS Code

## 首次验证建议

建议你优先验证这 4 件事：

1. 复制纯文本回复后，是否能正常生成 PNG。
2. 复制包含代码块的回复后，代码块样式是否符合预期。
3. 一次复制多段回复时，最终截图排版是否稳定。
4. 自动复制 PNG 是否在你的系统和 VS Code 环境下生效；若失败，`下载 PNG` 是否可用。
