const vscode = require('vscode');

const COMMAND_OPEN_COLLECTOR = 'codexChatScreenshot.openCollector';
const COMMAND_LEGACY_CAPTURE = 'codexChatScreenshot.captureFromClipboard';
const PANEL_VIEW_TYPE = 'codexChatScreenshot.collector';

function activate(context) {
  const collectorPanel = new CollectorPanel(context.extensionUri);

  context.subscriptions.push(collectorPanel);
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_COLLECTOR, async () => {
      await collectorPanel.show();
    }),
    vscode.commands.registerCommand(COMMAND_LEGACY_CAPTURE, async () => {
      await collectorPanel.show();
      await collectorPanel.captureCurrentClipboard({ force: true, notifyIfEmpty: true });
    })
  );
}

class CollectorPanel {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.panel = undefined;
    this.isReady = false;
    this.disposables = [];
    this.clipboardPollTimer = undefined;
    this.lastObservedClipboardText = '';
    this.isWatcherActive = false;
    this.isPolling = false;
    this.pendingMessages = [];
  }

  dispose() {
    this.stopClipboardWatcher();

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

  async show() {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        PANEL_VIEW_TYPE,
        'Codex Chat Screenshot Collector',
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
          this.stopClipboardWatcher();
          this.panel = undefined;
          this.isReady = false;
          this.pendingMessages = [];
        }),
        this.panel.onDidChangeViewState((event) => {
          if (event.webviewPanel.visible && this.isWatcherActive) {
            void this.captureCurrentClipboard({ force: false });
          }
        }),
        this.panel.webview.onDidReceiveMessage((message) => {
          void this.handleMessage(message);
        })
      );
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    await this.startClipboardWatcher();
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        this.isReady = true;
        this.flushPendingMessages();
        this.postWatcherState();
        return;
      case 'captureCurrentClipboard':
        await this.captureCurrentClipboard({ force: true, notifyIfEmpty: true });
        return;
      case 'setWatcherActive':
        if (message.active) {
          await this.startClipboardWatcher();
        } else {
          this.stopClipboardWatcher();
          this.postWatcherState();
        }
        return;
      case 'copied':
        vscode.window.showInformationMessage('最新 PNG 已复制到系统剪贴板。');
        return;
      case 'copyFailed':
        vscode.window.showWarningMessage(
          `复制 PNG 失败：${message.reason || '浏览器剪贴板接口不可用'}`
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

  async startClipboardWatcher() {
    const pollIntervalMs = getPollIntervalMs();
    const ignoreInitialClipboardOnOpen = vscode.workspace
      .getConfiguration('codexChatScreenshot')
      .get('ignoreInitialClipboardOnOpen', true);

    if (!this.panel) {
      return;
    }

    if (this.clipboardPollTimer) {
      clearInterval(this.clipboardPollTimer);
      this.clipboardPollTimer = undefined;
    }

    if (ignoreInitialClipboardOnOpen) {
      this.lastObservedClipboardText = await vscode.env.clipboard.readText();
    } else {
      this.lastObservedClipboardText = '';
      await this.captureCurrentClipboard({ force: false });
    }

    this.isWatcherActive = true;
    this.clipboardPollTimer = setInterval(() => {
      void this.captureCurrentClipboard({ force: false });
    }, pollIntervalMs);

    this.postWatcherState();
  }

  stopClipboardWatcher() {
    if (this.clipboardPollTimer) {
      clearInterval(this.clipboardPollTimer);
      this.clipboardPollTimer = undefined;
    }

    this.isWatcherActive = false;
  }

  async captureCurrentClipboard({ force, notifyIfEmpty }) {
    if (!this.panel || this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      const clipboardText = await vscode.env.clipboard.readText();

      if (!force && clipboardText === this.lastObservedClipboardText) {
        return;
      }

      this.lastObservedClipboardText = clipboardText;

      if (!clipboardText.trim()) {
        if (notifyIfEmpty) {
          vscode.window.showInformationMessage('系统剪贴板里还没有可用文本。');
        }
        return;
      }

      this.postMessage({
        type: 'appendEntry',
        payload: {
          id: buildEntryId(),
          text: clipboardText,
          capturedAt: new Date().toISOString(),
          filenameBase: buildFilenameBase(),
          source: force ? 'manual' : 'auto'
        }
      });
    } finally {
      this.isPolling = false;
    }
  }

  postWatcherState() {
    this.postMessage({
      type: 'watcherState',
      payload: {
        active: this.isWatcherActive,
        pollIntervalMs: getPollIntervalMs()
      }
    });
  }

  postMessage(message) {
    if (!this.panel || !this.isReady) {
      this.pendingMessages.push(message);
      return;
    }

    this.panel.webview.postMessage(message);
  }

  flushPendingMessages() {
    if (!this.panel || !this.isReady || !this.pendingMessages.length) {
      return;
    }

    for (const message of this.pendingMessages) {
      this.panel.webview.postMessage(message);
    }
    this.pendingMessages = [];
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
    <title>Codex Chat Screenshot Collector</title>
  </head>
  <body>
    <div class="shell">
      <section class="workspace-card">
        <div class="toolbar">
          <div class="toolbar-copy">
            <h1 class="toolbar-title">Chat Screenshot</h1>
            <span id="watcherLabel" class="source-label">准备中</span>
          </div>
          <div class="toolbar-actions">
            <button id="captureClipboardButton" class="button button-secondary" type="button">立即抓取</button>
            <button id="toggleWatcherButton" class="button button-secondary" type="button">暂停监听</button>
            <button id="clearButton" class="button button-secondary" type="button">清空</button>
            <button id="copyButton" class="button button-primary" type="button">复制 PNG</button>
            <button id="downloadButton" class="button button-secondary" type="button">下载</button>
          </div>
        </div>

        <div id="statusBanner" class="status-banner status-idle" aria-live="polite">
          等待新的复制内容
        </div>
      </section>

      <section class="collector-layout">
        <section class="collector-panel">
          <div class="section-heading">
            <h2>条目摘要</h2>
            <span id="entryCountLabel" class="section-meta">0 段</span>
          </div>

          <div id="entryList" class="entry-list">
            <div class="empty-state empty-state-light">
              <strong>还没有条目</strong>
              <p>保持面板开启，在 Codex 里复制回复。</p>
            </div>
          </div>
        </section>

        <section class="preview-section">
          <div class="section-heading">
            <h2>预览</h2>
          </div>

          <div class="preview-frame">
            <div id="captureSurface" class="capture-surface">
              <div class="capture-header">
                <div>
                  <p class="capture-kicker">Codex Chat</p>
                  <h3>Snapshot</h3>
                </div>
              </div>

              <div id="captureContent" class="capture-content">
                <div class="empty-state">
                  <strong>等待第一段回复</strong>
                  <p>复制内容后，这里会刷新。</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function getPollIntervalMs() {
  return vscode.workspace.getConfiguration('codexChatScreenshot').get('clipboardPollIntervalMs', 800);
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

function buildEntryId() {
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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
