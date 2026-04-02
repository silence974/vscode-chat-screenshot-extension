(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    sourceText: '',
    filenameBase: 'codex-chat',
    sourceLabel: '等待载入',
    autoCopy: false
  };

  const elements = {
    sourceInput: document.getElementById('sourceInput'),
    sourceLabel: document.getElementById('sourceLabel'),
    statusBanner: document.getElementById('statusBanner'),
    captureSurface: document.getElementById('captureSurface'),
    captureContent: document.getElementById('captureContent'),
    captureTimestamp: document.getElementById('captureTimestamp'),
    readClipboardButton: document.getElementById('readClipboardButton'),
    renderButton: document.getElementById('renderButton'),
    copyButton: document.getElementById('copyButton'),
    downloadButton: document.getElementById('downloadButton')
  };

  const captureCss = `
    * {
      box-sizing: border-box;
    }
    .capture-surface {
      width: 880px;
      padding: 28px;
      border-radius: 24px;
      color: #f5f7fb;
      background:
        radial-gradient(circle at top left, rgba(120, 173, 255, 0.18), transparent 28%),
        radial-gradient(circle at bottom right, rgba(255, 177, 115, 0.18), transparent 26%),
        linear-gradient(180deg, #111723, #1a2231 62%, #0f1620);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.38);
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    }
    .capture-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }
    .capture-kicker {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 11px;
      font-weight: 700;
      color: rgba(143, 196, 255, 0.95);
    }
    .capture-header h3 {
      margin: 0;
      line-height: 1.2;
      font-size: 28px;
      color: #ffffff;
    }
    .capture-timestamp {
      color: rgba(245, 247, 251, 0.72);
      font-size: 12px;
    }
    .capture-content {
      display: grid;
      gap: 14px;
    }
    .response-card {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 18px;
      padding: 18px;
      background: rgba(255, 255, 255, 0.05);
    }
    .response-card > :first-child {
      margin-top: 0;
    }
    .response-card > :last-child {
      margin-bottom: 0;
    }
    .response-card p,
    .response-card li,
    .response-card blockquote {
      font-size: 15px;
      line-height: 1.75;
    }
    .response-card h1,
    .response-card h2,
    .response-card h3,
    .response-card h4,
    .response-card h5,
    .response-card h6 {
      margin: 1.1em 0 0.55em;
      line-height: 1.2;
      color: #ffffff;
    }
    .response-card ul,
    .response-card ol {
      padding-left: 1.3em;
    }
    .response-card blockquote {
      margin: 0;
      padding: 0.9em 1em;
      border-left: 3px solid rgba(120, 173, 255, 0.88);
      background: rgba(120, 173, 255, 0.1);
      border-radius: 0 12px 12px 0;
      color: rgba(245, 247, 251, 0.92);
    }
    .response-card hr {
      border: none;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      margin: 20px 0;
    }
    .response-card pre {
      margin: 0;
      overflow: auto;
      padding: 16px;
      border-radius: 16px;
      background: rgba(4, 8, 16, 0.76);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #edf2ff;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, monospace);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.55;
    }
    .code-wrapper {
      margin: 18px 0;
    }
    .code-label {
      display: inline-flex;
      margin-bottom: 8px;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(245, 247, 251, 0.75);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .response-card code {
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, monospace);
    }
    .response-card p code,
    .response-card li code,
    .response-card blockquote code {
      padding: 0.2em 0.45em;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: #ffd59a;
    }
    .response-card a {
      color: #8fc4ff;
      text-decoration: none;
    }
    .empty-state {
      padding: 26px;
      border: 1px dashed rgba(255, 255, 255, 0.18);
      border-radius: 18px;
      text-align: center;
      background: rgba(255, 255, 255, 0.03);
    }
  `;

  elements.readClipboardButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'requestClipboardText' });
    setStatus('正在读取系统剪贴板...', 'working');
  });

  elements.renderButton.addEventListener('click', () => {
    renderCapture(false);
  });

  elements.copyButton.addEventListener('click', () => {
    void copyPng(true);
  });

  elements.downloadButton.addEventListener('click', () => {
    void downloadPng();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'setPayload' || message?.type === 'clipboardText') {
      applyPayload(message.payload);
    }
  });

  vscode.postMessage({ type: 'ready' });

  function applyPayload(payload) {
    state.sourceText = payload?.sourceText || '';
    state.filenameBase = payload?.filenameBase || 'codex-chat';
    state.sourceLabel = payload?.sourceLabel || '已更新';
    state.autoCopy = Boolean(payload?.autoCopy);

    elements.sourceInput.value = state.sourceText;
    elements.sourceLabel.textContent = state.sourceLabel;

    renderCapture(state.autoCopy);
  }

  function renderCapture(shouldAutoCopy) {
    const sourceText = elements.sourceInput.value.trim();
    state.sourceText = sourceText;
    state.autoCopy = false;
    elements.captureTimestamp.textContent = formatTimestamp(new Date());

    if (!sourceText) {
      elements.captureContent.innerHTML = `
        <div class="empty-state">
          <strong>还没有可截图的聊天内容</strong>
          <p>复制 Codex 聊天回复后执行命令，或者把文本直接粘贴进上面的输入框。</p>
        </div>
      `;
      setStatus('等待聊天内容', 'idle');
      return;
    }

    elements.captureContent.innerHTML = renderMarkdownToHtml(sourceText);
    setStatus('预览已更新，可以复制 PNG。', 'success');

    if (shouldAutoCopy) {
      void copyPng(false);
    }
  }

  async function copyPng(fromUserAction) {
    if (!state.sourceText.trim()) {
      setStatus('还没有可复制的聊天内容。', 'error');
      vscode.postMessage({
        type: 'notify',
        level: 'warning',
        message: '请先提供聊天内容，再生成 PNG。'
      });
      return;
    }

    setStatus('正在生成 PNG 并写入系统剪贴板...', 'working');

    try {
      if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
        throw new Error('当前环境不支持 ClipboardItem 或 navigator.clipboard.write');
      }

      const blob = await exportCaptureBlob();
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);

      setStatus('PNG 截图已复制到系统剪贴板。', 'success');
      vscode.postMessage({ type: 'copied' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      setStatus('自动复制失败，请改用“复制 PNG”按钮重试或直接下载文件。', 'error');
      if (fromUserAction) {
        vscode.postMessage({ type: 'copyFailed', reason });
      }
    }
  }

  async function downloadPng() {
    if (!state.sourceText.trim()) {
      setStatus('还没有可下载的聊天内容。', 'error');
      return;
    }

    setStatus('正在导出 PNG...', 'working');
    const blob = await exportCaptureBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.filenameBase || 'codex-chat'}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('PNG 已导出，可以从浏览器下载项或系统默认下载目录中查看。', 'success');
  }

  async function exportCaptureBlob() {
    const captureSurface = elements.captureSurface;
    const scale = window.devicePixelRatio >= 2 ? 2 : 1.6;
    const width = Math.ceil(captureSurface.scrollWidth);
    const height = Math.ceil(captureSurface.scrollHeight);

    const serialized = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
        <foreignObject x="0" y="0" width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <style>${captureCss}</style>
            ${captureSurface.outerHTML}
          </div>
        </foreignObject>
      </svg>
    `;

    const image = await svgToImage(serialized);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建画布上下文');
    }

    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
          return;
        }

        reject(new Error('导出 PNG 失败'));
      }, 'image/png');
    });

    return blob;
  }

  function svgToImage(svgText) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('无法把 SVG 渲染为位图'));
      };

      image.src = url;
    });
  }

  function setStatus(message, tone) {
    elements.statusBanner.textContent = message;
    elements.statusBanner.className = `status-banner status-${tone}`;
  }

  function renderMarkdownToHtml(sourceText) {
    const parts = splitBlocks(sourceText);
    const html = parts.map(renderBlock).join('');
    return `<article class="response-card">${html}</article>`;
  }

  function splitBlocks(sourceText) {
    const normalized = sourceText.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const codeMatch = line.match(/^```([\w-]+)?\s*$/);
      if (codeMatch) {
        const language = codeMatch[1] || '';
        const codeLines = [];
        index += 1;

        while (index < lines.length && !/^```/.test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }

        if (index < lines.length && /^```/.test(lines[index])) {
          index += 1;
        }

        blocks.push({
          type: 'code',
          language,
          content: codeLines.join('\n')
        });
        continue;
      }

      if (/^\s*$/.test(line)) {
        index += 1;
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length,
          content: headingMatch[2]
        });
        index += 1;
        continue;
      }

      if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        blocks.push({ type: 'hr' });
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^>\s?/, ''));
          index += 1;
        }
        blocks.push({
          type: 'blockquote',
          content: quoteLines.join('\n')
        });
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const items = [];

        while (
          index < lines.length &&
          (ordered ? /^\s*\d+\.\s+/.test(lines[index]) : /^\s*[-*+]\s+/.test(lines[index]))
        ) {
          items.push(lines[index].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, ''));
          index += 1;
        }

        blocks.push({
          type: ordered ? 'ordered-list' : 'unordered-list',
          items
        });
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        !/^\s*$/.test(lines[index]) &&
        !/^```/.test(lines[index]) &&
        !/^(#{1,6})\s+/.test(lines[index]) &&
        !/^>\s?/.test(lines[index]) &&
        !/^\s*[-*+]\s+/.test(lines[index]) &&
        !/^\s*\d+\.\s+/.test(lines[index]) &&
        !/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[index])
      ) {
        paragraphLines.push(lines[index]);
        index += 1;
      }

      blocks.push({
        type: 'paragraph',
        content: paragraphLines.join('\n')
      });
    }

    return blocks;
  }

  function renderBlock(block) {
    switch (block.type) {
      case 'code':
        return `
          <div class="code-wrapper">
            <div class="code-label">${escapeHtml(block.language || 'text')}</div>
            <pre><code>${escapeHtml(block.content)}</code></pre>
          </div>
        `;
      case 'heading':
        return `<h${block.level}>${renderInline(block.content)}</h${block.level}>`;
      case 'blockquote':
        return `<blockquote>${renderParagraphLines(block.content)}</blockquote>`;
      case 'unordered-list':
        return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
      case 'ordered-list':
        return `<ol>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`;
      case 'hr':
        return '<hr />';
      case 'paragraph':
      default:
        return `<p>${renderParagraphLines(block.content)}</p>`;
    }
  }

  function renderParagraphLines(text) {
    return text
      .split('\n')
      .map((line) => renderInline(line.trim()))
      .join('<br />');
  }

  function renderInline(text) {
    const codeTokens = [];
    let html = String(text);

    html = html.replace(/`([^`]+)`/g, (_, code) => {
      const token = `__CODE_TOKEN_${codeTokens.length}__`;
      codeTokens.push(`<code>${escapeHtml(code)}</code>`);
      return token;
    });

    html = escapeHtml(html);

    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      return `<a href="${escapeAttribute(url)}">${label}</a>`;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return codeTokens.reduce((result, replacement, index) => {
      return result.replace(`__CODE_TOKEN_${index}__`, replacement);
    }, html);
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return String(value).replace(/"/g, '&quot;');
  }

  function formatTimestamp(date) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }
})();
