(function () {
  const vscode = acquireVsCodeApi();

  const FONT_SANS = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const FONT_MONO = "'Cascadia Mono', Consolas, 'Liberation Mono', monospace";
  const CANVAS_LAYOUT = {
    width: 880,
    outerPadding: 20,
    headerGap: 14,
    cardGap: 10,
    cardPadding: 14,
    cardRadius: 12,
    surfaceRadius: 14
  };

  let canvasTheme;

  const state = {
    entries: [],
    watcherActive: false,
    pollIntervalMs: 800,
    filenameBase: 'codex-chat',
    isCopying: false
  };

  const elements = {
    watcherLabel: document.getElementById('watcherLabel'),
    statusBanner: document.getElementById('statusBanner'),
    entryCountLabel: document.getElementById('entryCountLabel'),
    entryList: document.getElementById('entryList'),
    captureSurface: document.getElementById('captureSurface'),
    captureContent: document.getElementById('captureContent'),
    captureClipboardButton: document.getElementById('captureClipboardButton'),
    toggleWatcherButton: document.getElementById('toggleWatcherButton'),
    clearButton: document.getElementById('clearButton'),
    copyButton: document.getElementById('copyButton'),
    downloadButton: document.getElementById('downloadButton')
  };

  elements.captureClipboardButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'captureCurrentClipboard' });
    setStatus('正在抓取当前系统剪贴板...', 'working');
  });

  elements.toggleWatcherButton.addEventListener('click', () => {
    const nextActive = !state.watcherActive;
    vscode.postMessage({
      type: 'setWatcherActive',
      active: nextActive
    });
    setStatus(nextActive ? '正在恢复剪贴板监听...' : '已暂停自动监听。', 'working');
  });

  elements.clearButton.addEventListener('click', () => {
    state.entries = [];
    renderAll();
    setStatus('已清空收集内容。', 'idle');
  });

  elements.copyButton.addEventListener('click', () => {
    void copyPng();
  });

  elements.downloadButton.addEventListener('click', () => {
    void downloadPng();
  });

  elements.entryList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-entry-remove]');
    if (!button) {
      return;
    }

    const entryId = button.getAttribute('data-entry-remove');
    state.entries = state.entries.filter((entry) => entry.id !== entryId);
    renderAll();
    setStatus(state.entries.length ? '已移除一段内容，并刷新预览。' : '已移除最后一段内容。', 'success');
  });

  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message?.type) {
      case 'watcherState':
        applyWatcherState(message.payload);
        return;
      case 'appendEntry':
        appendEntry(message.payload);
        return;
      default:
        return;
    }
  });

  renderAll();
  vscode.postMessage({ type: 'ready' });

  function applyWatcherState(payload) {
    state.watcherActive = Boolean(payload?.active);
    state.pollIntervalMs = payload?.pollIntervalMs || 800;

    elements.watcherLabel.textContent = state.watcherActive ? '自动监听中' : '监听已暂停';
    elements.toggleWatcherButton.textContent = state.watcherActive ? '暂停监听' : '恢复监听';
  }

  function appendEntry(payload) {
    const text = String(payload?.text || '').trim();
    if (!text) {
      return;
    }

    if (payload?.source === 'auto') {
      const lastEntry = state.entries[state.entries.length - 1];
      if (lastEntry && lastEntry.text === text) {
        setStatus('检测到重复剪贴板内容，已自动忽略。', 'idle');
        return;
      }
    }

    state.filenameBase = payload?.filenameBase || state.filenameBase;
    state.entries.push({
      id: payload?.id || buildLocalId(),
      text,
      blocks: splitBlocks(text)
    });

    renderAll();
    setStatus(`已收集第 ${state.entries.length} 段内容，并刷新预览。`, 'success');
  }

  function renderAll() {
    elements.entryCountLabel.textContent = `${state.entries.length} 段`;
    renderEntryList();
    renderCapturePreview();

    if (!state.entries.length) {
      setStatus('等待新的复制内容', 'idle');
    }
  }

  function renderEntryList() {
    if (!state.entries.length) {
      elements.entryList.innerHTML = `
        <div class="empty-state empty-state-light">
          <strong>还没有收集到内容</strong>
          <p>保持面板开启，在 Codex 里复制回复。</p>
        </div>
      `;
      return;
    }

    elements.entryList.innerHTML = state.entries
      .map((entry) => {
        return `
          <article class="entry-card">
            <p class="entry-snippet">${escapeHtml(buildSnippet(entry.text))}</p>
            <div class="entry-actions">
              <button
                class="button button-danger entry-remove-button"
                type="button"
                data-entry-remove="${entry.id}"
                aria-label="移除这段内容"
              >
                去掉
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderCapturePreview() {
    if (!state.entries.length) {
      elements.captureContent.innerHTML = `
        <div class="empty-state">
          <strong>等待第一段回复</strong>
          <p>复制内容后，这里会刷新。</p>
        </div>
      `;
      return;
    }

    elements.captureContent.innerHTML = state.entries
      .map((entry) => {
        return `
          <article class="response-card">
            ${entry.blocks.map(renderBlock).join('')}
          </article>
        `;
      })
      .join('');
  }

  async function copyPng() {
    if (!state.entries.length) {
      setStatus('还没有可复制的截图内容。', 'error');
      return;
    }

    if (state.isCopying) {
      return;
    }

    state.isCopying = true;
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

      setStatus('最新 PNG 已复制到系统剪贴板。', 'success');
      vscode.postMessage({ type: 'copied' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      setStatus('复制 PNG 失败，请重试或直接下载文件。', 'error');
      vscode.postMessage({ type: 'copyFailed', reason });
    } finally {
      state.isCopying = false;
    }
  }

  async function downloadPng() {
    if (!state.entries.length) {
      setStatus('还没有可下载的截图内容。', 'error');
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
    setStatus('PNG 已导出，可以从系统默认下载目录中查看。', 'success');
  }

  async function exportCaptureBlob() {
    const scale = window.devicePixelRatio >= 2 ? 2 : 1.8;
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    if (!measureContext) {
      throw new Error('无法创建测量画布上下文');
    }

    canvasTheme = getCanvasTheme();
    const model = buildCanvasModel(measureContext, state.entries);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(model.width * scale);
    canvas.height = Math.ceil(model.height * scale);

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建导出画布上下文');
    }

    context.scale(scale, scale);
    drawCanvasModel(context, model);

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

  function buildCanvasModel(ctx, entries) {
    const width = CANVAS_LAYOUT.width;
    const contentWidth = width - CANVAS_LAYOUT.outerPadding * 2;
    const header = measureCanvasHeader(contentWidth);
    let y = CANVAS_LAYOUT.outerPadding + header.height + CANVAS_LAYOUT.headerGap;

    const entryPlans = entries.map((entry) => {
      const plan = measureCanvasEntry(ctx, entry, contentWidth);
      plan.y = y;
      y += plan.height + CANVAS_LAYOUT.cardGap;
      return plan;
    });

    if (entryPlans.length) {
      y -= CANVAS_LAYOUT.cardGap;
    }

    return {
      width,
      height: y + CANVAS_LAYOUT.outerPadding,
      header,
      entryPlans
    };
  }

  function measureCanvasHeader(width) {
    const kickerStyle = { family: FONT_SANS, size: 11, weight: '700', lineHeight: 1.2 };
    const titleStyle = { family: FONT_SANS, size: 24, weight: '700', lineHeight: 1.15 };

    return {
      width,
      height: lineHeight(kickerStyle) + 6 + lineHeight(titleStyle) + 12,
      kickerStyle,
      titleStyle,
      title: 'Snapshot',
      kicker: 'Codex Chat',
      dividerY: lineHeight(kickerStyle) + 6 + lineHeight(titleStyle) + 12
    };
  }

  function measureCanvasEntry(ctx, entry, width) {
    const innerWidth = width - CANVAS_LAYOUT.cardPadding * 2;
    const blockPlans = measureCanvasBlocks(ctx, entry.blocks, innerWidth);

    return {
      entry,
      width,
      innerWidth,
      blockPlans,
      height: CANVAS_LAYOUT.cardPadding + blockPlans.height + CANVAS_LAYOUT.cardPadding
    };
  }

  function measureCanvasBlocks(ctx, blocks, width) {
    const plans = [];
    let y = 0;

    blocks.forEach((block) => {
      const plan = measureCanvasBlock(ctx, block, width);
      plan.y = y;
      plans.push(plan);
      y += plan.height + 14;
    });

    if (plans.length) {
      y -= 14;
    }

    return {
      height: y,
      plans
    };
  }

  function measureCanvasBlock(ctx, block, width) {
    switch (block.type) {
      case 'code':
        return measureCodeBlock(ctx, block, width);
      case 'heading':
        return measureHeadingBlock(ctx, block, width);
      case 'blockquote':
        return measureQuoteBlock(ctx, block, width);
      case 'unordered-list':
      case 'ordered-list':
        return measureListBlock(ctx, block, width);
      case 'hr':
        return { type: 'hr', height: 24, width };
      case 'paragraph':
      default:
        return measureParagraphBlock(ctx, block, width);
    }
  }

  function measureParagraphBlock(ctx, block, width) {
    const style = { family: FONT_SANS, size: 15, weight: '400', lineHeight: 1.75 };
    const lines = wrapInlineText(ctx, block.content, width, style);
    return {
      type: 'paragraph',
      style,
      lines,
      width,
      height: lines.length * lineHeight(style)
    };
  }

  function measureHeadingBlock(ctx, block, width) {
    const sizes = { 1: 30, 2: 26, 3: 22, 4: 18, 5: 16, 6: 15 };
    const style = {
      family: FONT_SANS,
      size: sizes[block.level] || 18,
      weight: '700',
      lineHeight: 1.25
    };
    const lines = wrapInlineText(ctx, block.content, width, style);
    return {
      type: 'heading',
      style,
      lines,
      width,
      height: lines.length * lineHeight(style)
    };
  }

  function measureQuoteBlock(ctx, block, width) {
    const style = { family: FONT_SANS, size: 15, weight: '400', lineHeight: 1.75 };
    const paddingX = 14;
    const paddingY = 12;
    const lines = wrapInlineText(ctx, block.content, width - paddingX * 2 - 6, style);
    return {
      type: 'blockquote',
      style,
      lines,
      width,
      paddingX,
      paddingY,
      height: paddingY * 2 + lines.length * lineHeight(style)
    };
  }

  function measureListBlock(ctx, block, width) {
    const style = { family: FONT_SANS, size: 15, weight: '400', lineHeight: 1.75 };
    const itemPlans = block.items.map((item, index) => {
      const prefix = block.type === 'ordered-list' ? `${index + 1}. ` : '• ';
      const lines = wrapInlineText(ctx, `${prefix}${item}`, width, style);
      return {
        prefix,
        lines,
        height: lines.length * lineHeight(style)
      };
    });

    const gap = 8;
    const height =
      itemPlans.reduce((sum, itemPlan) => sum + itemPlan.height, 0) + Math.max(0, itemPlans.length - 1) * gap;

    return {
      type: block.type,
      style,
      itemPlans,
      gap,
      width,
      height
    };
  }

  function measureCodeBlock(ctx, block, width) {
    const labelStyle = { family: FONT_SANS, size: 11, weight: '600', lineHeight: 1.2 };
    const codeStyle = { family: FONT_MONO, size: 13, weight: '400', lineHeight: 1.55 };
    const codePadding = 16;
    const labelHeight = lineHeight(labelStyle) + 8;
    const lines = wrapCodeText(ctx, block.content || '', width - codePadding * 2, codeStyle);
    const codeHeight = codePadding * 2 + lines.length * lineHeight(codeStyle);

    return {
      type: 'code',
      labelStyle,
      codeStyle,
      language: block.language || 'text',
      width,
      codePadding,
      lines,
      labelHeight,
      height: labelHeight + codeHeight
    };
  }

  function drawCanvasModel(ctx, model) {
    drawRoundedRect(ctx, 0, 0, model.width, model.height, CANVAS_LAYOUT.surfaceRadius);
    ctx.fillStyle = canvasTheme.surfaceBackground;
    ctx.fill();
    ctx.strokeStyle = canvasTheme.surfaceBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    drawCanvasHeader(ctx, model.header);
    model.entryPlans.forEach((plan) => {
      drawCanvasEntry(ctx, plan);
    });
  }

  function drawCanvasHeader(ctx, header) {
    const x = CANVAS_LAYOUT.outerPadding;
    const y = CANVAS_LAYOUT.outerPadding;

    setCanvasFont(ctx, header.kickerStyle);
    ctx.fillStyle = canvasTheme.accent;
    ctx.fillText(header.kicker, x, y + lineHeight(header.kickerStyle));

    setCanvasFont(ctx, header.titleStyle);
    ctx.fillStyle = canvasTheme.textPrimary;
    ctx.fillText(header.title, x, y + lineHeight(header.kickerStyle) + 8 + lineHeight(header.titleStyle));

    ctx.strokeStyle = canvasTheme.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + header.dividerY);
    ctx.lineTo(CANVAS_LAYOUT.width - CANVAS_LAYOUT.outerPadding, y + header.dividerY);
    ctx.stroke();
  }

  function drawCanvasEntry(ctx, plan) {
    const x = CANVAS_LAYOUT.outerPadding;
    const y = plan.y;

    drawRoundedRect(ctx, x, y, plan.width, plan.height, CANVAS_LAYOUT.cardRadius);
    ctx.fillStyle = canvasTheme.cardBackground;
    ctx.fill();
    ctx.strokeStyle = canvasTheme.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const blockX = x + CANVAS_LAYOUT.cardPadding;
    const blockY = y + CANVAS_LAYOUT.cardPadding;
    plan.blockPlans.plans.forEach((blockPlan) => {
      drawCanvasBlock(ctx, blockPlan, blockX, blockY + blockPlan.y);
    });
  }

  function drawCanvasBlock(ctx, plan, x, y) {
    switch (plan.type) {
      case 'heading':
        drawRichTextLines(ctx, plan.lines, x, y, plan.style);
        return;
      case 'paragraph':
        drawRichTextLines(ctx, plan.lines, x, y, plan.style);
        return;
      case 'blockquote':
        drawRoundedRect(ctx, x, y, plan.width, plan.height, 12);
        ctx.fillStyle = canvasTheme.quoteBackground;
        ctx.fill();
        ctx.fillStyle = canvasTheme.quoteBorder;
        ctx.fillRect(x, y, 3, plan.height);
        drawRichTextLines(ctx, plan.lines, x + plan.paddingX, y + plan.paddingY, plan.style);
        return;
      case 'unordered-list':
      case 'ordered-list': {
        let currentY = y;
        plan.itemPlans.forEach((itemPlan, index) => {
          drawRichTextLines(ctx, itemPlan.lines, x, currentY, plan.style);
          currentY += itemPlan.height;
          if (index < plan.itemPlans.length - 1) {
            currentY += plan.gap;
          }
        });
        return;
      }
      case 'code': {
        const labelWidth = measurePillWidth(ctx, plan.labelStyle, plan.language);
        drawRoundedRect(ctx, x, y, labelWidth, lineHeight(plan.labelStyle) + 10, 999);
        ctx.fillStyle = canvasTheme.badgeBackground;
        ctx.fill();

        setCanvasFont(ctx, plan.labelStyle);
        ctx.fillStyle = canvasTheme.textMuted;
        ctx.fillText(plan.language, x + 10, y + lineHeight(plan.labelStyle) + 2);

        const codeY = y + plan.labelHeight;
        drawRoundedRect(ctx, x, codeY, plan.width, plan.height - plan.labelHeight, 16);
        ctx.fillStyle = canvasTheme.codeBackground;
        ctx.fill();
        ctx.strokeStyle = canvasTheme.codeBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        drawTextLines(
          ctx,
          plan.lines,
          x + plan.codePadding,
          codeY + plan.codePadding,
          plan.codeStyle,
          canvasTheme.codeText
        );
        return;
      }
      case 'hr':
        ctx.strokeStyle = canvasTheme.hr;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + 12);
        ctx.lineTo(x + plan.width, y + 12);
        ctx.stroke();
        return;
      default:
        return;
    }
  }

  function drawTextLines(ctx, lines, x, y, style, color) {
    setCanvasFont(ctx, style);
    ctx.fillStyle = color;
    const height = lineHeight(style);

    lines.forEach((line, index) => {
      ctx.fillText(line || ' ', x, y + height * (index + 1));
    });
  }

  function drawRichTextLines(ctx, lines, x, y, baseStyle) {
    const height = lineHeight(baseStyle);

    lines.forEach((line, index) => {
      const baselineY = y + height * (index + 1);
      if (!line?.segments?.length) {
        return;
      }

      let cursorX = x;

      line.segments.forEach((segment) => {
        const segmentStyle = getInlineCanvasStyle(baseStyle, segment.kind);
        const metrics = measureInlineSegment(ctx, segment, baseStyle);

        if (segment.kind === 'code') {
          const boxHeight = Math.max(20, Math.round(baseStyle.size * 1.12));
          const boxTop = baselineY - boxHeight + 4;
          drawRoundedRect(ctx, cursorX, boxTop, metrics.width, boxHeight, 7);
          ctx.fillStyle = canvasTheme.inlineCodeBackground;
          ctx.fill();
          ctx.strokeStyle = canvasTheme.inlineCodeBorder;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (segment.text.trim()) {
          setCanvasFont(ctx, segmentStyle);
          ctx.fillStyle = getInlineCanvasColor(segment.kind);
          ctx.fillText(segment.text, cursorX + metrics.offsetX, baselineY);

          if (segment.kind === 'link') {
            const underlineY = baselineY + 3;
            ctx.strokeStyle = canvasTheme.linkColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cursorX + metrics.offsetX, underlineY);
            ctx.lineTo(cursorX + metrics.offsetX + metrics.textWidth, underlineY);
            ctx.stroke();
          }

          if (segment.kind === 'del') {
            const strikeY = baselineY - Math.round(height * 0.38);
            ctx.strokeStyle = canvasTheme.textMuted;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cursorX + metrics.offsetX, strikeY);
            ctx.lineTo(cursorX + metrics.offsetX + metrics.textWidth, strikeY);
            ctx.stroke();
          }
        }

        cursorX += metrics.width;
      });
    });
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

  function splitBlocks(sourceText) {
    const normalized = String(sourceText).replace(/\r\n/g, '\n');
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

  function renderParagraphLines(text) {
    return String(text)
      .split('\n')
      .map((line) => renderInline(line.trim()))
      .join('<br />');
  }

  function renderInline(text) {
    return parseInlineSegments(text)
      .map((segment) => {
        const content = escapeHtml(segment.text);
        switch (segment.kind) {
          case 'code':
            return `<code>${content}</code>`;
          case 'link':
            return `<a href="${escapeAttribute(segment.target || '#')}">${content}</a>`;
          case 'strong':
            return `<strong>${content}</strong>`;
          case 'em':
            return `<em>${content}</em>`;
          case 'del':
            return `<del>${content}</del>`;
          case 'text':
          default:
            return content;
        }
      })
      .join('');
  }

  function normalizeInlineText(text) {
    return String(text)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/https?:\/\/[^\s]+/g, (url) => formatLinkLabel(url))
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1');
  }

  function wrapInlineText(ctx, text, maxWidth, style) {
    const paragraphs = String(text).split('\n');
    const lines = [];

    paragraphs.forEach((paragraph, index) => {
      const segmentLines = wrapInlineSegments(ctx, parseInlineSegments(paragraph), maxWidth, style);
      lines.push(...segmentLines);
      if (index < paragraphs.length - 1) {
        lines.push({ segments: [] });
      }
    });

    return lines.length ? lines : [{ segments: [] }];
  }

  function wrapInlineSegments(ctx, segments, maxWidth, baseStyle) {
    const tokens = tokenizeInlineSegments(segments);
    const lines = [];
    let current = [];
    let currentWidth = 0;

    if (!tokens.length) {
      return [{ segments: [] }];
    }

    tokens.forEach((token) => {
      const queue = [token];

      while (queue.length) {
        const nextToken = normalizeLeadingInlineToken(queue.shift(), current.length === 0);
        if (!nextToken || !nextToken.text) {
          continue;
        }

        const metrics = measureInlineSegment(ctx, nextToken, baseStyle);
        if (!current.length) {
          if (metrics.width <= maxWidth) {
            current.push(nextToken);
            currentWidth = metrics.width;
            continue;
          }

          const fragments = splitInlineToken(ctx, nextToken, maxWidth, baseStyle);
          current.push(fragments[0]);
          lines.push(buildInlineLine(current));
          current = [];
          currentWidth = 0;
          queue.unshift(...fragments.slice(1));
          continue;
        }

        if (currentWidth + metrics.width <= maxWidth) {
          current.push(nextToken);
          currentWidth += metrics.width;
          continue;
        }

        lines.push(buildInlineLine(current));
        current = [];
        currentWidth = 0;
        queue.unshift(nextToken);
      }
    });

    if (current.length || !lines.length) {
      lines.push(buildInlineLine(current));
    }

    return lines;
  }

  function buildInlineLine(tokens) {
    const segments = tokens.slice();

    while (segments.length && !segments[segments.length - 1].text.trim()) {
      segments.pop();
    }

    return { segments };
  }

  function tokenizeInlineSegments(segments) {
    const tokens = [];

    segments.forEach((segment) => {
      if (!segment.text) {
        return;
      }

      if (segment.kind === 'code') {
        tokens.push({ text: segment.text, kind: segment.kind, atomic: true });
        return;
      }

      const parts = segment.text.match(/\S+\s*|\s+/g) || [];
      parts.forEach((part) => {
        tokens.push({ text: part, kind: segment.kind, atomic: false });
      });
    });

    return tokens;
  }

  function normalizeLeadingInlineToken(token, isLineStart) {
    if (!token) {
      return null;
    }

    if (!isLineStart) {
      return token;
    }

    const trimmed = token.text.trimStart();
    if (!trimmed) {
      return null;
    }

    return {
      ...token,
      text: trimmed
    };
  }

  function splitInlineToken(ctx, token, maxWidth, baseStyle) {
    const fragments = [];
    let current = '';

    Array.from(token.text).forEach((char) => {
      const candidate = current + char;
      const metrics = measureInlineSegment(ctx, { ...token, text: candidate }, baseStyle);
      if (!current || metrics.width <= maxWidth) {
        current = candidate;
      } else {
        fragments.push({ ...token, text: current });
        current = char;
      }
    });

    if (current) {
      fragments.push({ ...token, text: current });
    }

    return fragments.length ? fragments : [{ ...token, text: token.text }];
  }

  function measureInlineSegment(ctx, segment, baseStyle) {
    const style = getInlineCanvasStyle(baseStyle, segment.kind);
    setCanvasFont(ctx, style);
    const textWidth = ctx.measureText(segment.text).width;

    if (segment.kind === 'code') {
      return {
        width: textWidth + 12,
        textWidth,
        offsetX: 6
      };
    }

    return {
      width: textWidth,
      textWidth,
      offsetX: 0
    };
  }

  function getInlineCanvasStyle(baseStyle, kind) {
    switch (kind) {
      case 'strong':
        return { ...baseStyle, weight: '700' };
      case 'em':
        return { ...baseStyle, fontStyle: 'italic' };
      case 'code':
        return {
          family: FONT_MONO,
          size: Math.max(12, baseStyle.size - 1),
          weight: '600',
          lineHeight: baseStyle.lineHeight
        };
      default:
        return baseStyle;
    }
  }

  function getInlineCanvasColor(kind) {
    switch (kind) {
      case 'code':
        return canvasTheme.inlineCodeText;
      case 'link':
        return canvasTheme.linkColor;
      case 'em':
        return canvasTheme.emphasisText;
      case 'del':
        return canvasTheme.textMuted;
      default:
        return canvasTheme.textPrimary;
    }
  }

  function parseInlineSegments(text) {
    const source = String(text || '');
    const segments = [];
    const pattern =
      /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~|(https?:\/\/[^\s<]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(source))) {
      if (match.index > lastIndex) {
        segments.push({ kind: 'text', text: source.slice(lastIndex, match.index) });
      }

      if (match[1] !== undefined) {
        segments.push({ kind: 'code', text: match[1] });
      } else if (match[2] !== undefined) {
        segments.push({ kind: 'link', text: match[2], target: match[3] });
      } else if (match[4] !== undefined) {
        segments.push({ kind: 'strong', text: match[4] });
      } else if (match[5] !== undefined) {
        segments.push({ kind: 'em', text: match[5] });
      } else if (match[6] !== undefined) {
        segments.push({ kind: 'del', text: match[6] });
      } else if (match[7] !== undefined) {
        const { clean, trailing } = splitTrailingPunctuation(match[7]);
        segments.push({ kind: 'link', text: formatLinkLabel(clean), target: clean });
        if (trailing) {
          segments.push({ kind: 'text', text: trailing });
        }
      }

      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < source.length) {
      segments.push({ kind: 'text', text: source.slice(lastIndex) });
    }

    return segments;
  }

  function splitTrailingPunctuation(url) {
    const match = String(url).match(/^(.*?)([),.;!?]+)?$/);
    if (!match) {
      return { clean: String(url), trailing: '' };
    }

    return {
      clean: match[1],
      trailing: match[2] || ''
    };
  }

  function formatLinkLabel(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.host.replace(/^www\./, '');
      const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
      const label = `${host}${path}` || host;
      return label.length > 44 ? `${label.slice(0, 44)}…` : label;
    } catch {
      const compact = String(url).replace(/^https?:\/\//, '');
      return compact.length > 44 ? `${compact.slice(0, 44)}…` : compact;
    }
  }

  function wrapText(ctx, text, maxWidth, style) {
    const paragraphs = String(text).split('\n');
    const lines = [];

    paragraphs.forEach((paragraph, index) => {
      const segmentLines = wrapSingleLine(ctx, paragraph, maxWidth, style);
      lines.push(...segmentLines);
      if (index < paragraphs.length - 1) {
        lines.push('');
      }
    });

    return lines.length ? lines : [''];
  }

  function wrapSingleLine(ctx, text, maxWidth, style) {
    setCanvasFont(ctx, style);
    const tokens = tokenizeText(text);
    const lines = [];
    let current = '';

    if (!tokens.length) {
      return [''];
    }

    tokens.forEach((token) => {
      const cleanedToken = current ? token : token.trimStart();
      const candidate = current + cleanedToken;

      if (!current) {
        if (ctx.measureText(cleanedToken).width <= maxWidth) {
          current = cleanedToken;
        } else {
          const fragments = splitLongToken(ctx, cleanedToken, maxWidth);
          lines.push(...fragments.slice(0, -1));
          current = fragments[fragments.length - 1] || '';
        }
        return;
      }

      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        return;
      }

      lines.push(current.trimEnd());

      if (ctx.measureText(cleanedToken.trimStart()).width <= maxWidth) {
        current = cleanedToken.trimStart();
      } else {
        const fragments = splitLongToken(ctx, cleanedToken.trimStart(), maxWidth);
        lines.push(...fragments.slice(0, -1));
        current = fragments[fragments.length - 1] || '';
      }
    });

    if (current || !lines.length) {
      lines.push(current.trimEnd());
    }

    return lines;
  }

  function wrapCodeText(ctx, text, maxWidth, style) {
    setCanvasFont(ctx, style);
    const sourceLines = String(text).split('\n');
    const lines = [];

    sourceLines.forEach((line, index) => {
      if (!line) {
        lines.push('');
      } else {
        lines.push(...splitLongToken(ctx, line, maxWidth));
      }

      if (index < sourceLines.length - 1 && !line) {
        return;
      }
    });

    return lines.length ? lines : [''];
  }

  function tokenizeText(text) {
    return text.match(/\S+\s*|\s+/g) || [];
  }

  function splitLongToken(ctx, token, maxWidth) {
    const fragments = [];
    let current = '';

    Array.from(token).forEach((char) => {
      const candidate = current + char;
      if (!current || ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        fragments.push(current);
        current = char;
      }
    });

    if (current) {
      fragments.push(current);
    }

    return fragments.length ? fragments : [''];
  }

  function setStatus(message, tone) {
    elements.statusBanner.textContent = message;
    elements.statusBanner.className = `status-banner status-${tone}`;
  }

  function setCanvasFont(ctx, style) {
    const fontStyle = style.fontStyle ? `${style.fontStyle} ` : '';
    ctx.font = `${fontStyle}${style.weight} ${style.size}px ${style.family}`;
  }

  function lineHeight(style) {
    return Math.round(style.size * style.lineHeight);
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  function measurePillWidth(ctx, style, text) {
    setCanvasFont(ctx, style);
    return ctx.measureText(text).width + 20;
  }

  function buildSnippet(text) {
    const singleLine = String(text).replace(/\s+/g, ' ').trim();
    return singleLine.length > 160 ? `${singleLine.slice(0, 160)}…` : singleLine;
  }

  function buildLocalId() {
    return `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function getCanvasTheme() {
    const styles = getComputedStyle(document.documentElement);
    const editorBackground = readThemeColor(styles, '--vscode-editor-background', '#1e1e1e');
    const surfaceBackground = readThemeColor(styles, '--vscode-editorWidget-background', editorBackground);
    const textPrimary = readThemeColor(
      styles,
      '--vscode-editor-foreground',
      readThemeColor(styles, '--vscode-foreground', '#f3f3f3')
    );
    const accent = readThemeColor(
      styles,
      '--vscode-focusBorder',
      readThemeColor(styles, '--vscode-textLink-foreground', '#3794ff')
    );
    const divider = readThemeColor(
      styles,
      '--vscode-panel-border',
      readThemeColor(
        styles,
        '--vscode-contrastBorder',
        withAlpha(textPrimary, 0.14, 'rgba(127, 127, 127, 0.22)')
      )
    );
    const textMuted = readThemeColor(
      styles,
      '--vscode-descriptionForeground',
      readThemeColor(styles, '--vscode-disabledForeground', mixColors(textPrimary, surfaceBackground, 0.42, textPrimary))
    );
    const codeBackground = readThemeColor(
      styles,
      '--vscode-textCodeBlock-background',
      mixColors(surfaceBackground, editorBackground, 0.38, surfaceBackground)
    );

    return {
      surfaceBackground,
      surfaceBorder: divider,
      divider,
      cardBackground: mixColors(surfaceBackground, editorBackground, 0.28, surfaceBackground),
      cardBorder: divider,
      accent,
      textPrimary,
      textMuted,
      quoteBackground: withAlpha(accent, 0.1, 'rgba(55, 148, 255, 0.1)'),
      quoteBorder: accent,
      codeBackground,
      codeBorder: divider,
      codeText: textPrimary,
      badgeBackground: withAlpha(textPrimary, 0.06, 'rgba(127, 127, 127, 0.08)'),
      hr: divider,
      inlineCodeBackground: mixColors(codeBackground, surfaceBackground, 0.16, codeBackground),
      inlineCodeBorder: divider,
      inlineCodeText: textPrimary,
      linkColor: accent,
      emphasisText: mixColors(textPrimary, accent, 0.18, textPrimary)
    };
  }

  function readThemeColor(styles, propertyName, fallback) {
    const resolved = resolveThemeColor(styles.getPropertyValue(propertyName), styles);
    return resolved || fallback;
  }

  function resolveThemeColor(value, styles, depth = 0) {
    const trimmed = String(value || '').trim();
    if (!trimmed || depth > 4) {
      return '';
    }

    const varMatch = trimmed.match(/^var\((--[^,\s)]+)(?:,\s*(.+))?\)$/);
    if (!varMatch) {
      return trimmed;
    }

    const [, reference, fallback] = varMatch;
    return (
      resolveThemeColor(styles.getPropertyValue(reference), styles, depth + 1) ||
      resolveThemeColor(fallback, styles, depth + 1)
    );
  }

  function mixColors(baseColor, overlayColor, overlayWeight, fallback) {
    const base = parseColor(baseColor);
    const overlay = parseColor(overlayColor);
    if (!base || !overlay) {
      return fallback;
    }

    const baseWeight = 1 - overlayWeight;
    return formatColor({
      r: Math.round(base.r * baseWeight + overlay.r * overlayWeight),
      g: Math.round(base.g * baseWeight + overlay.g * overlayWeight),
      b: Math.round(base.b * baseWeight + overlay.b * overlayWeight),
      a: roundAlpha(base.a * baseWeight + overlay.a * overlayWeight)
    });
  }

  function withAlpha(color, alpha, fallback) {
    const parsed = parseColor(color);
    if (!parsed) {
      return fallback;
    }

    return formatColor({
      r: parsed.r,
      g: parsed.g,
      b: parsed.b,
      a: roundAlpha(alpha)
    });
  }

  function parseColor(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) {
      return null;
    }

    if (text.startsWith('#')) {
      return parseHexColor(text);
    }

    const rgbaMatch = text.match(/^rgba?\(([^)]+)\)$/);
    if (!rgbaMatch) {
      return null;
    }

    const parts = rgbaMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.some((part, index) => Number.isNaN(part) && index < 3)) {
      return null;
    }

    return {
      r: clampChannel(parts[0]),
      g: clampChannel(parts[1]),
      b: clampChannel(parts[2]),
      a: Number.isNaN(parts[3]) ? 1 : clampAlpha(parts[3])
    };
  }

  function parseHexColor(text) {
    const hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const expanded = hex
        .split('')
        .map((char) => char + char)
        .join('');
      return parseHexColor(`#${expanded}`);
    }

    if (hex.length !== 6 && hex.length !== 8) {
      return null;
    }

    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? roundAlpha(Number.parseInt(hex.slice(6, 8), 16) / 255) : 1
    };
  }

  function formatColor(color) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${roundAlpha(color.a)})`;
  }

  function roundAlpha(value) {
    return Math.round(clampAlpha(value) * 1000) / 1000;
  }

  function clampChannel(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function clampAlpha(value) {
    return Math.max(0, Math.min(1, Number(value)));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return String(value).replace(/"/g, '&quot;');
  }
})();
