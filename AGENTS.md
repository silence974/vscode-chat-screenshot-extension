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

阶段：收集器模式已实现，进入真实环境验证与体验打磨阶段

当前结论：
- 仓库当前几乎为空，仅有 `LICENSE`。
- 已建立最小可运行的 VS Code 扩展骨架。
- 已补充本地调试启动配置，便于直接在 VS Code 中试跑扩展。
- 已将扩展宿主收敛为 `ui`，避免 clipboard/webview 相关能力被错误放到 workspace host。
- 已确认 VS Code 扩展 API 的 `Clipboard` 只提供 `readText` / `writeText` 文本能力。
- 已确认聊天 API 中 `ChatContext.history` 目前只包含“当前 participant”的消息，不能作为读取任意 Codex 聊天回复的通用方案。
- 已确认 VS Code webview 在远程开发场景下仍运行在用户本机侧，可作为本地图像剪贴板写入的可行承载层。
- 已实现命令入口、预览 webview、轻量 markdown 渲染、PNG 导出、自动复制尝试与下载兜底。
- 已在真实运行中发现当前 `SVG foreignObject -> canvas -> PNG` 导出链路会触发 tainted canvas。
- 已确认当前公开的 VS Code Chat API 不能稳定读取任意第三方 participant 的现有回复，也没有通用的“直接勾选聊天记录后交给扩展”的公开选择 API。
- 已澄清 `ChatContext.history` 中的“current participant”语义：它指当前聊天处理方，而不是当前用户眼前整个聊天面板中的所有消息。
- 已确定产品方向切换为 `clipboard-first` 收集器：用户在 Codex 中复制，插件自动累计、预览并持续输出最新 PNG。
- 已实现常驻收集器面板、自动剪贴板监听、多段回复列表与逐条删除。
- 已用直接 canvas 绘制替换 `foreignObject` 导出链路，规避 tainted canvas。

当前问题：
- webview 内对 PNG 剪贴板写入的浏览器支持需要在实际 VS Code 环境中验证。
- 需要在真实 Codex 聊天复制样本上验证“多段回复”的视觉效果是否足够稳定。
- 需要避免把“当前 participant”误解为“当前整个 Codex 会话”，以免走错技术路径。
- 需要评估“通过当前聊天渲染结果直接获取内容或截图”是否存在稳定实现路径。
- 需要验证当前默认快捷键与用户环境是否冲突。

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
- 不承诺在 Codex 聊天面板内直接勾选任意历史消息后由扩展读取，因为当前缺少稳定公开 API。

## Collector Workflow

新的目标交互：
1. 用户执行命令，打开常驻收集器面板。
2. 用户在 Codex 中选中需要的回复并复制。
3. 面板自动读取最新剪贴板文本，并把它加入收集列表。
4. 面板展示已收集内容与最终渲染预览。
5. 用户可以删除某一段、清空全部，或继续追加更多段。
6. 每次列表变化后，都自动生成新的 PNG 并尝试复制到系统剪贴板。
7. 用户把最新 PNG 直接粘贴到目标位置。

约束说明：
- VS Code 扩展没有标准的“独立悬浮窗”能力。
- 当前实现将使用最接近目标的常驻 `WebviewPanel` 作为收集器窗口。

## Current Implementation

已实现内容：
- 扩展命令 `codexChatScreenshot.openCollector`
- 兼容命令 `codexChatScreenshot.captureFromClipboard`
- 默认快捷键打开收集器
- 常驻 `WebviewPanel` 收集器界面
- 自动监听系统剪贴板并收集新复制内容
- 多段回复列表、逐条删除、清空全部
- 基础 markdown 到卡片 HTML 的轻量渲染
- 直接 canvas 绘制 PNG 导出
- 每次变更后自动复制 PNG 的最佳努力实现
- 自动复制失败后的手动复制与下载兜底
- 命令执行时直接读取系统剪贴板，不应要求用户再次手动粘贴

待修复问题：
- 仍需在真实 VS Code 环境中验证自动复制 PNG 是否足够稳定

关键概念：
- `current participant` = 当前处理这次 chat request 的聊天参与方
- 它通常是某个具体助手或扩展注册的 chat participant
- 它不等于用户当前看到的整个聊天面板
- 因此，`ChatContext.history` 不能直接当成“读取当前 Codex 会话全部消息”的接口

渲染抓取方向的当前判断：
- 普通 VS Code 扩展没有公开 API 可以直接读取工作台里另一块 UI 的渲染 DOM
- 普通 VS Code 扩展也没有公开 API 可以直接对任意工作台区域执行元素级截图
- 如果走渲染抓取，更可能依赖系统级截图、辅助功能树或自动化工具，而不是标准扩展 API

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
- 决定放弃 `foreignObject` 截图导出路径，改为直接 canvas 绘制 PNG。
- 决定继续以 clipboard-first 作为稳定交互路径，直到 VS Code/Codex 提供可依赖的聊天选择或读取接口。
- 决定将产品交互升级为常驻收集器面板，而非每次手动粘贴的单次预览面板。
- 决定提供默认快捷键打开收集器，贴近目标操作流。

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
- 记录用户反馈的 `tainted canvas` 导出问题，并切换修复方向。
- 记录“直接在 Codex 中勾选聊天记录生成截图”当前缺少稳定公开 API。
- 将扩展改为 `ui` host 优先，降低本机剪贴板读取偏差。
- 记录 `current participant` 与“当前整个聊天面板”不是同一个概念。
- 开始评估“渲染抓取”作为备选路线，但暂不视为标准扩展内的稳定方案。
- 根据新的目标交互，开始重构为“复制后自动收集、自动预览、自动复制 PNG”的收集器工作流。
- 实现常驻收集器面板、自动剪贴板轮询、多段内容列表与逐条删除。
- 用直接 canvas 绘制替换原先的 `foreignObject` 导出路径。
- 更新 `README.md`，同步新的收集器工作流、配置项与验证步骤。
