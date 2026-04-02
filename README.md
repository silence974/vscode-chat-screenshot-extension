# Chat Screeenshot

把 VS Code 中复制出来的 Codex 聊天回复持续收集成一张 PNG，并支持手动复制到系统剪贴板。

## 当前工作流

1. 打开收集器面板：
   - 命令：`Chat Screeenshot: Open Collector`
   - 默认快捷键：`Ctrl+Alt+Shift+S`
2. 保持收集器面板开启。
3. 在 Codex 聊天窗口里选中需要的回复并复制。
4. 插件会自动监听系统剪贴板，把新复制的内容加入收集列表。
5. 右侧预览会实时更新最终截图。
6. 如果某一段不要了，点击该段旁边的 `去掉`。
7. 每次收集列表发生变化后，插件都会自动刷新最终 PNG 预览。
8. 点击 `复制 PNG`。
9. 去目标位置粘贴图片。

补充说明：
- 真正的独立悬浮窗不是 VS Code 标准扩展能力；当前实现使用常驻 `WebviewPanel`，是最接近的形式。

## 功能说明

- 自动轮询系统剪贴板，持续收集多段回复
- 收集列表支持逐条删除
- 支持一键清空全部已收集内容
- 自动更新最终渲染预览
- 支持手动 `复制 PNG`
- 支持手动 `下载 PNG`
- 支持基础 markdown 渲染：
  - 标题
  - 段落
  - 无序/有序列表
  - 引用
  - 分隔线
  - 行内代码
  - fenced code block
  - 链接

## 配置项

- `codexChatScreenshot.clipboardPollIntervalMs`
  - 默认 `800`
  - 剪贴板轮询间隔，单位毫秒
- `codexChatScreenshot.ignoreInitialClipboardOnOpen`
  - 默认 `true`
  - 打开收集器时，是否忽略当时已经存在于系统剪贴板中的旧文本

## 已知限制

- 当前不直接读取 Codex 聊天面板内部消息，而是采用更稳定的 `clipboard-first` 方案。
- 手动复制 PNG 依赖 webview 中的浏览器剪贴板能力；若受系统或环境限制，可以改用 `下载 PNG`。
- 当前 markdown 渲染是轻量实现，未完整覆盖表格、嵌套列表等全部语法。
- 当前 PNG 是通过 canvas 直接绘制的，视觉风格与面板 HTML 预览会保持接近，但不是逐像素截图。

## 开发

```bash
npm test
```

当前项目使用纯 JavaScript 扩展骨架，无需编译步骤。

## 本地试跑

### 方式一：直接调试运行

1. 用桌面版 VS Code 打开这个仓库目录。
2. 按 `F5`，或者进入“运行和调试”并选择 `Run Chat Screeenshot Extension`。
3. 会弹出一个新的 Extension Development Host 窗口。
4. 在新窗口里打开 Codex 聊天。
5. 运行 `Open Collector`。
6. 在 Codex 里连续复制你想保留的回复。
7. 查看左侧收集列表是否自动出现新内容，右侧预览是否实时更新。
8. 测试删除某一段后，预览是否自动刷新，再手动点 `复制 PNG`。

### 方式二：打包后安装

```bash
npm install -g @vscode/vsce
vsce package
```

然后在 VS Code 中执行：

1. `Extensions: Install from VSIX...`
2. 选择生成的 `.vsix` 文件
3. 安装完成后重载 VS Code

## 首次验证建议

建议你优先验证这 5 件事：

1. 打开收集器后，复制第一段回复是否会自动进入列表。
2. 连续复制多段回复时，是否会按顺序累计到最终截图。
3. 删除中间某一段后，预览和最终 PNG 是否同步更新。
4. 手动 `复制 PNG` 是否在你的系统和 VS Code 环境下生效。
5. 包含代码块的回复在最终 PNG 中是否足够清晰、排版是否符合预期。
