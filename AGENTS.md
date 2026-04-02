# AGENTS.md

## Project

名称：VSCode Chat Screenshot Extension

目标：开发一个 VS Code 插件，用于把 VSCode 中 Codex 聊天窗口里的单段回复或多段回复转换为截图，并自动复制到系统剪贴板。

## Working Agreement

本项目开发过程使用本文件作为主控文档。

执行规则：
- 每次进入新的开发阶段前，先更新本文件。
- 关键技术结论、风险、假设变更后，及时更新本文件。
- 完成代码实现、验证、文档补充后，更新状态与日志。

## Current Status

阶段：MVP 已实现，进入说明补充与真实环境验证阶段

当前结论：
- 仓库当前几乎为空，仅有 `LICENSE`。
- 已建立最小可运行的 VS Code 扩展骨架。
- 已补充本地调试启动配置，便于直接在 VS Code 中试跑扩展。
- 已确认 VS Code 扩展 API 的 `Clipboard` 只提供 `readText` / `writeText` 文本能力。
- 已确认聊天 API 中 `ChatContext.history` 目前只包含“当前 participant”的消息，不能作为读取任意 Codex 聊天回复的通用方案。
- 已确认 VS Code webview 在远程开发场景下仍运行在用户本机侧，可作为本地图像剪贴板写入的可行承载层。
- 已实现命令入口、预览 webview、轻量 markdown 渲染、PNG 导出、自动复制尝试与下载兜底。

当前问题：
- webview 内对 PNG 剪贴板写入的浏览器支持需要在实际 VS Code 环境中验证。
- 需要在真实 Codex 聊天复制样本上验证“多段回复”的视觉效果是否足够稳定。

## Delivery Plan

### Phase 1: Feasibility
- 确认 VS Code 扩展可访问的聊天相关能力与限制。
- 确认 PNG 复制到系统剪贴板的可用实现方式。
- 输出 MVP 技术方案。

### Phase 2: Scaffold
- 初始化扩展工程。
- 配置扩展入口、基础校验脚本、调试入口与基础命令。

### Phase 3: MVP Implementation
- 实现聊天内容输入或获取流程。
- 实现截图渲染流程。
- 实现复制到剪贴板流程。
- 提供必要的失败兜底与用户提示。

### Phase 4: Verification and Docs
- 运行基础构建与必要验证。
- 补充 README 或使用说明。
- 记录已知限制与后续增强方向。

## Technical Hypotheses

- 假设 A：如果无法直接读取 Codex 聊天窗口消息，可通过“复制所选聊天内容后执行命令”的方式完成 MVP。
- 假设 B：图片复制到剪贴板可优先在 webview 中调用浏览器剪贴板能力，并在失败时提供回退方案。

当前状态：
- 假设 A 已验证成立，确定为 MVP 路径。
- 假设 B 已具备可实现依据，但仍需在真实运行中完成最终验证。

## MVP Decision

MVP 交互路径：
1. 用户在 Codex 聊天窗口中选中一段或多段回复并复制。
2. 执行扩展命令。
3. 扩展从系统剪贴板读取文本。
4. 扩展在 webview 中渲染聊天卡片并生成 PNG。
5. 优先自动复制 PNG 到系统剪贴板。
6. 若自动复制失败，保留预览并提供手动复制/下载兜底。

MVP 不做：
- 不依赖未公开的聊天内部数据结构或 DOM 注入。
- 不承诺直接“无复制步骤”抓取任意第三方聊天 participant 的历史消息。

## Current Implementation

已实现内容：
- 扩展命令 `codexChatScreenshot.captureFromClipboard`
- 侧边预览 webview
- 从系统剪贴板读取文本
- 在面板内手动粘贴与二次编辑
- 基础 markdown 到卡片 HTML 的轻量渲染
- 基于 SVG `foreignObject` + canvas 的 PNG 导出
- 自动复制 PNG 到系统剪贴板的最佳努力实现
- 自动复制失败后的手动复制与下载兜底

当前文件：
- `package.json`
- `src/extension.js`
- `media/preview.js`
- `media/preview.css`
- `README.md`
- `.vscode/launch.json`

## Decision Log

### 2026-04-02
- 决定先以 `AGENTS.md` 作为本项目的开发管理入口。
- 决定先完成可行性确认，再启动扩展脚手架与实现，避免在错误技术路径上投入。
- 确定 MVP 采用“用户先复制聊天内容，扩展再生成截图并复制 PNG”的方案。
- 决定使用纯 JavaScript 最小骨架，先避免额外构建依赖。

## Activity Log

### 2026-04-02
- 创建 `AGENTS.md`。
- 建立四阶段开发计划。
- 记录当前已知约束与待验证问题。
- 记录可行性阶段结论，并固化 MVP 技术路径。
- 创建扩展骨架、命令入口与 webview 预览实现。
- 实现 markdown 渲染、PNG 导出、自动复制与下载兜底。
- 运行 `npm run lint`，通过脚本级语法检查。
- 运行 `npm test`，结果通过。
- 补充 `README.md`。
- 补充 `.vscode/launch.json`，方便本地直接调试运行。
- 补充安装与试跑说明。
