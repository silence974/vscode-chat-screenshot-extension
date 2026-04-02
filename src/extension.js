const vscode = require('vscode');

const COMMAND_CAPTURE = 'codexChatScreenshot.captureFromClipboard';
const PANEL_VIEW_TYPE = 'codexChatScreenshot.preview';

function activate(context) {
  const previewPanel = new ScreenshotPreviewPanel(context.extensionUri);

  context.subscriptions.push(previewPanel);
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CAPTURE, async () => {
      const clipboardText = await vscode.env.clipboard.readText();
      const autoCopyOnOpen = vscode.workspace
        .getConfiguration('codexChatScreenshot')
        .get('autoCopyOnOpen', true);

      previewPanel.show({
        sourceText: clipboardText,
        autoCopy: autoCopyOnOpen && Boolean(clipboardText.trim()),
        filenameBase: buildFilenameBase(),
        sourceLabel: clipboardText.trim() ? '来自系统剪贴板' : '等待粘贴聊天内容'
      });

      if (!clipboardText.trim()) {
        vscode.window.showInformationMessage(
          '剪贴板里还没有可用文本。请先在 Codex 聊天窗口复制回复内容，或直接在预览面板中粘贴。'
        );
      }
    })
  );
}

class ScreenshotPreviewPanel {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.panel = undefined;
    this.isReady = false;
    this.pendingPayload = undefined;
    this.disposables = [];
  }

  dispose() {
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }

    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  show(payload) {
    this.pendingPayload = payload;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        PANEL_VIEW_TYPE,
        'Codex Chat Screenshot',
        {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
        }
      );

      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.disposables.push(
        this.panel.onDidDispose(() => {
          this.panel = undefined;
          this.isReady = false;
          this.pendingPayload = undefined;
        }),
        this.panel.webview.onDidReceiveMessage((message) => {
          void this.handleMessage(message);
        })
      );
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    this.flushPendingPayload();
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        this.isReady = true;
        this.flushPendingPayload();
        return;
      case 'requestClipboardText': {
        const sourceText = await vscode.env.clipboard.readText();
        if (!this.panel) {
          return;
        }

        this.panel.webview.postMessage({
          type: 'clipboardText',
          payload: {
            sourceText,
            autoCopy: Boolean(sourceText.trim()),
            filenameBase: buildFilenameBase(),
            sourceLabel: sourceText.trim() ? '重新从系统剪贴板读取' : '系统剪贴板为空'
          }
        });

        if (!sourceText.trim()) {
          vscode.window.showWarningMessage('系统剪贴板里暂时没有文本内容。');
        }
        return;
      }
      case 'copied':
        vscode.window.showInformationMessage('PNG 截图已复制到系统剪贴板。');
        return;
      case 'copyFailed':
        vscode.window.showWarningMessage(
          `自动复制 PNG 失败：${message.reason || '浏览器剪贴板接口不可用'}`
        );
        return;
      case 'notify':
        if (message.level === 'error') {
          vscode.window.showErrorMessage(message.message);
        } else if (message.level === 'warning') {
          vscode.window.showWarningMessage(message.message);
        } else {
          vscode.window.showInformationMessage(message.message);
        }
        return;
      default:
        return;
    }
  }

  flushPendingPayload() {
    if (!this.panel || !this.isReady || !this.pendingPayload) {
      return;
    }

    this.panel.webview.postMessage({
      type: 'setPayload',
      payload: this.pendingPayload
    });
    this.pendingPayload = undefined;
  }

  getHtml(webview) {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'preview.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'preview.js'));
    const nonce = buildNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>Codex Chat Screenshot</title>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Codex Chat Screenshot</p>
          <h1>把已复制的聊天回复转成 PNG</h1>
          <p class="hero-copy">
            在 Codex 聊天窗口中复制一段或多段内容，然后执行命令。预览面板会生成截图，并优先自动复制到系统剪贴板。
          </p>
        </div>
        <div class="hero-pills">
          <span class="pill">MVP</span>
          <span class="pill">Clipboard First</span>
          <span class="pill">PNG Preview</span>
        </div>
      </header>

      <section class="workspace-card">
        <div class="toolbar">
          <div class="toolbar-copy">
            <strong>聊天源文本</strong>
            <span id="sourceLabel" class="source-label">等待载入</span>
          </div>
          <div class="toolbar-actions">
            <button id="readClipboardButton" class="button button-secondary" type="button">读取系统剪贴板</button>
            <button id="renderButton" class="button button-secondary" type="button">更新预览</button>
            <button id="copyButton" class="button button-primary" type="button">复制 PNG</button>
            <button id="downloadButton" class="button button-secondary" type="button">下载 PNG</button>
          </div>
        </div>

        <label class="input-shell" for="sourceInput">
          <textarea
            id="sourceInput"
            spellcheck="false"
            placeholder="先在 Codex 聊天窗口复制回复内容，再执行命令。也可以直接把内容粘贴到这里。"
          ></textarea>
        </label>

        <div id="statusBanner" class="status-banner status-idle" aria-live="polite">
          等待聊天内容
        </div>
      </section>

      <section class="preview-section">
        <div class="preview-heading">
          <div>
            <p class="eyebrow">Preview</p>
            <h2>截图画布</h2>
          </div>
          <p class="preview-note">生成 PNG 时只会截取下方卡片区域，不会包含按钮和输入框。</p>
        </div>

        <div class="preview-frame">
          <div id="captureSurface" class="capture-surface">
            <div class="capture-header">
              <div>
                <p class="capture-kicker">Codex Chat</p>
                <h3>Conversation Snapshot</h3>
              </div>
              <div id="captureTimestamp" class="capture-timestamp"></div>
            </div>

            <div id="captureContent" class="capture-content">
              <div class="empty-state">
                <strong>还没有可截图的聊天内容</strong>
                <p>复制 Codex 聊天回复后执行命令，或者把文本直接粘贴进上面的输入框。</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function buildFilenameBase() {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ];

  return `codex-chat-${parts.join('')}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 16; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return nonce;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
