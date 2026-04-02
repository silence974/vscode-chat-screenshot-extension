(function () {
  const vscode = acquireVsCodeApi();

  const FONT_SANS = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const FONT_MONO = "'Cascadia Mono', Consolas, 'Liberation Mono', monospace";
  const CANVAS_THEME = {
    width: 880,
    outerPadding: 28,
    headerGap: 20,
    cardGap: 14,
    cardPadding: 18,
    cardRadius: 18,
    surfaceRadius: 24,
    surfaceBackgroundTop: '#111723',
    surfaceBackgroundBottom: '#0f1620',
    textPrimary: '#f5f7fb',
    textMuted: 'rgba(245, 247, 251, 0.72)',
    accent: '#8fc4ff',
    codeText: '#edf2ff',
    codeAccent: '#ffd59a',
    surfaceGlowBlue: 'rgba(120, 173, 255, 0.18)',
    surfaceGlowAmber: 'rgba(255, 177, 115, 0.18)',
    cardBackground: 'rgba(255, 255, 255, 0.05)',
    cardBorder: 'rgba(255, 255, 255, 0.08)',
    quoteBackground: 'rgba(120, 173, 255, 0.10)',
    quoteBorder: 'rgba(120, 173, 255, 0.88)',
    codeBackground: 'rgba(4, 8, 16, 0.76)',
    codeBorder: 'rgba(255, 255, 255, 0.08)',
    inlineCodeBackground: 'rgba(255, 255, 255, 0.10)'
  };

  const state = {
    entries: [],
    watcherActive: false,
    pollIntervalMs: 800,
    filenameBase: 'codex-chat',
    autoCopyEnabled: true,
    autoCopyTimer: undefined,
    isCopying: false
  };

  const elements = {
    watcherLabel: document.getElementById('watcherLabel'),
    statusBanner: document.getElementById('statusBanner'),
    entryCountLabel: document.getElementById('entryCountLabel'),
    entryList: document.getElementById('entryList'),
    captureSurface: document.getElementById('captureSurface'),
    captureContent: document.getElementById('captureContent'),
    captureTimestamp: document.getElementById('captureTimestamp'),
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
    renderAll({ triggerAutoCopy: false });
    setStatus('已清空收集内容。', 'idle');
  });

  elements.copyButton.addEventListener('click', () => {
    void copyPng(true);
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
    renderAll({ triggerAutoCopy: state.entries.length > 0 });
    setStatus(state.entries.length ? '已移除一段内容，并刷新 PNG。' : '已移除最后一段内容。', 'success');
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

  renderAll({ triggerAutoCopy: false });
  vscode.postMessage({ type: 'ready' });

  function applyWatcherState(payload) {
    state.watcherActive = Boolean(payload?.active);
    state.pollIntervalMs = payload?.pollIntervalMs || 800;

    elements.watcherLabel.textContent = state.watcherActive
      ? `自动监听中，每 ${state.pollIntervalMs}ms 轮询一次系统剪贴板`
      : '自动监听已暂停';
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
    state.autoCopyEnabled = payload?.autoCopy !== false;
    state.entries.push({
      id: payload?.id || buildLocalId(),
      text,
      blocks: splitBlocks(text),
      source: payload?.source || 'auto',
      capturedAt: payload?.capturedAt || new Date().toISOString()
    });

    renderAll({ triggerAutoCopy: state.autoCopyEnabled });
    setStatus(`已收集第 ${state.entries.length} 段内容，并刷新预览。`, 'success');
  }

  function renderAll(options) {
    elements.entryCountLabel.textContent = `${state.entries.length} 段`;
    elements.captureTimestamp.textContent = formatTimestamp(new Date());
    renderEntryList();
    renderCapturePreview();

    if (!state.entries.length) {
      clearTimeout(state.autoCopyTimer);
      setStatus('等待新的聊天复制内容', 'idle');
      return;
    }

    if (options?.triggerAutoCopy) {
      scheduleAutoCopy();
    }
  }

  function renderEntryList() {
    if (!state.entries.length) {
      elements.entryList.innerHTML = `
        <div class="empty-state empty-state-light">
          <strong>还没有收集到内容</strong>
          <p>保持面板开启，然后在 Codex 里复制回复。这里会自动出现每一段已收集内容。</p>
        </div>
      `;
      return;
    }

    elements.entryList.innerHTML = state.entries
      .map((entry, index) => {
        return `
          <article class="entry-card">
            <div class="entry-row">
              <div>
                <h3 class="entry-title">Reply ${index + 1}</h3>
                <div class="entry-meta">${formatTimestamp(new Date(entry.capturedAt))} · ${entry.source === 'manual' ? '手动抓取' : '自动收集'}</div>
              </div>
              <div class="entry-actions">
                <button class="button button-danger" type="button" data-entry-remove="${entry.id}">去掉</button>
              </div>
            </div>
            <p class="entry-snippet">${escapeHtml(buildSnippet(entry.text))}</p>
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
          <p>在 Codex 中复制需要的内容后，这里会实时渲染最终截图效果。</p>
        </div>
      `;
      return;
    }

    elements.captureContent.innerHTML = state.entries
      .map((entry, index) => {
        return `
          <article class="response-card">
            <div class="response-meta">
              <span>Reply ${index + 1}</span>
              <span>${formatTimestamp(new Date(entry.capturedAt))}</span>
            </div>
            ${entry.blocks.map(renderBlock).join('')}
          </article>
        `;
      })
      .join('');
  }

  function scheduleAutoCopy() {
    if (!state.autoCopyEnabled || !state.entries.length) {
      return;
    }

    clearTimeout(state.autoCopyTimer);
    state.autoCopyTimer = window.setTimeout(() => {
      void copyPng(false);
    }, 140);
  }

  async function copyPng(fromUserAction) {
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
      if (fromUserAction) {
        vscode.postMessage({ type: 'copied' });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      setStatus('自动复制失败，请点击“复制 PNG”重试或直接下载文件。', 'error');
      if (fromUserAction) {
        vscode.postMessage({ type: 'copyFailed', reason });
      }
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
    const timestampLabel = elements.captureTimestamp.textContent || formatTimestamp(new Date());
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    if (!measureContext) {
      throw new Error('无法创建测量画布上下文');
    }

    const model = buildCanvasModel(measureContext, state.entries, timestampLabel);
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

  function buildCanvasModel(ctx, entries, timestampLabel) {
    const width = CANVAS_THEME.width;
    const contentWidth = width - CANVAS_THEME.outerPadding * 2;
    const header = measureCanvasHeader(ctx, contentWidth, timestampLabel);
    let y = CANVAS_THEME.outerPadding + header.height + CANVAS_THEME.headerGap;

    const entryPlans = entries.map((entry, index) => {
      const plan = measureCanvasEntry(ctx, entry, index, contentWidth);
      plan.y = y;
      y += plan.height + CANVAS_THEME.cardGap;
      return plan;
    });

    if (entryPlans.length) {
      y -= CANVAS_THEME.cardGap;
    }

    return {
      width,
      height: y + CANVAS_THEME.outerPadding,
      header,
      entryPlans,
      timestampLabel
    };
  }

  function measureCanvasHeader(ctx, width, timestampLabel) {
    const kickerStyle = { family: FONT_SANS, size: 11, weight: '700', lineHeight: 1.2 };
    const titleStyle = { family: FONT_SANS, size: 28, weight: '700', lineHeight: 1.15 };
    const timestampStyle = { family: FONT_SANS, size: 12, weight: '500', lineHeight: 1.2 };

    return {
      width,
      height: lineHeight(kickerStyle) + 8 + lineHeight(titleStyle),
      kickerStyle,
      titleStyle,
      timestampStyle,
      title: 'Conversation Snapshot',
      kicker: 'Codex Chat',
      timestampLabel
    };
  }

  function measureCanvasEntry(ctx, entry, index, width) {
    const innerWidth = width - CANVAS_THEME.cardPadding * 2;
    const metaStyle = { family: FONT_SANS, size: 11, weight: '600', lineHeight: 1.2 };
    const blockPlans = measureCanvasBlocks(ctx, entry.blocks, innerWidth);

    return {
      entry,
      index,
      width,
      innerWidth,
      metaStyle,
      metaHeight: lineHeight(metaStyle),
      metaGap: 14,
      blockPlans,
      height: CANVAS_THEME.cardPadding + lineHeight(metaStyle) + 14 + blockPlans.height + CANVAS_THEME.cardPadding
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
    const lines = wrapText(ctx, normalizeInlineText(block.content), width, style);
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
    const lines = wrapText(ctx, normalizeInlineText(block.content), width, style);
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
    const lines = wrapText(ctx, normalizeInlineText(block.content), width - paddingX * 2 - 6, style);
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
      const lines = wrapText(ctx, `${prefix}${normalizeInlineText(item)}`, width, style);
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
    const gradient = ctx.createLinearGradient(0, 0, 0, model.height);
    gradient.addColorStop(0, CANVAS_THEME.surfaceBackgroundTop);
    gradient.addColorStop(1, CANVAS_THEME.surfaceBackgroundBottom);

    drawRoundedRect(ctx, 0, 0, model.width, model.height, CANVAS_THEME.surfaceRadius);
    ctx.fillStyle = gradient;
    ctx.fill();

    const glowBlue = ctx.createRadialGradient(120, 80, 0, 120, 80, 260);
    glowBlue.addColorStop(0, CANVAS_THEME.surfaceGlowBlue);
    glowBlue.addColorStop(1, 'rgba(120, 173, 255, 0)');
    ctx.fillStyle = glowBlue;
    ctx.fillRect(0, 0, model.width, model.height);

    const glowAmber = ctx.createRadialGradient(model.width - 110, model.height - 110, 0, model.width - 110, model.height - 110, 240);
    glowAmber.addColorStop(0, CANVAS_THEME.surfaceGlowAmber);
    glowAmber.addColorStop(1, 'rgba(255, 177, 115, 0)');
    ctx.fillStyle = glowAmber;
    ctx.fillRect(0, 0, model.width, model.height);

    drawCanvasHeader(ctx, model.header);
    model.entryPlans.forEach((plan) => {
      drawCanvasEntry(ctx, plan);
    });
  }

  function drawCanvasHeader(ctx, header) {
    const x = CANVAS_THEME.outerPadding;
    const y = CANVAS_THEME.outerPadding;

    setCanvasFont(ctx, header.kickerStyle);
    ctx.fillStyle = CANVAS_THEME.accent;
    ctx.fillText(header.kicker, x, y + lineHeight(header.kickerStyle));

    setCanvasFont(ctx, header.titleStyle);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(header.title, x, y + lineHeight(header.kickerStyle) + 8 + lineHeight(header.titleStyle));

    setCanvasFont(ctx, header.timestampStyle);
    ctx.fillStyle = CANVAS_THEME.textMuted;
    const timestampWidth = ctx.measureText(header.timestampLabel).width;
    ctx.fillText(
      header.timestampLabel,
      CANVAS_THEME.width - CANVAS_THEME.outerPadding - timestampWidth,
      y + lineHeight(header.kickerStyle) + 8 + lineHeight(header.titleStyle)
    );
  }

  function drawCanvasEntry(ctx, plan) {
    const x = CANVAS_THEME.outerPadding;
    const y = plan.y;
    const metaY = y + CANVAS_THEME.cardPadding + lineHeight(plan.metaStyle);

    drawRoundedRect(ctx, x, y, plan.width, plan.height, CANVAS_THEME.cardRadius);
    ctx.fillStyle = CANVAS_THEME.cardBackground;
    ctx.fill();
    ctx.strokeStyle = CANVAS_THEME.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    setCanvasFont(ctx, plan.metaStyle);
    ctx.fillStyle = CANVAS_THEME.textMuted;
    ctx.fillText(`Reply ${plan.index + 1}`, x + CANVAS_THEME.cardPadding, metaY);

    const timeLabel = formatTimestamp(new Date(plan.entry.capturedAt));
    const timeWidth = ctx.measureText(timeLabel).width;
    ctx.fillText(timeLabel, x + plan.width - CANVAS_THEME.cardPadding - timeWidth, metaY);

    const blockX = x + CANVAS_THEME.cardPadding;
    const blockY = metaY + plan.metaGap;
    plan.blockPlans.plans.forEach((blockPlan) => {
      drawCanvasBlock(ctx, blockPlan, blockX, blockY + blockPlan.y);
    });
  }

  function drawCanvasBlock(ctx, plan, x, y) {
    switch (plan.type) {
      case 'heading':
        drawTextLines(ctx, plan.lines, x, y, plan.style, '#ffffff');
        return;
      case 'paragraph':
        drawTextLines(ctx, plan.lines, x, y, plan.style, CANVAS_THEME.textPrimary);
        return;
      case 'blockquote':
        drawRoundedRect(ctx, x, y, plan.width, plan.height, 12);
        ctx.fillStyle = CANVAS_THEME.quoteBackground;
        ctx.fill();
        ctx.fillStyle = CANVAS_THEME.quoteBorder;
        ctx.fillRect(x, y, 3, plan.height);
        drawTextLines(
          ctx,
          plan.lines,
          x + plan.paddingX,
          y + plan.paddingY,
          plan.style,
          CANVAS_THEME.textPrimary
        );
        return;
      case 'unordered-list':
      case 'ordered-list': {
        let currentY = y;
        plan.itemPlans.forEach((itemPlan, index) => {
          drawTextLines(ctx, itemPlan.lines, x, currentY, plan.style, CANVAS_THEME.textPrimary);
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
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();

        setCanvasFont(ctx, plan.labelStyle);
        ctx.fillStyle = CANVAS_THEME.textMuted;
        ctx.fillText(plan.language, x + 10, y + lineHeight(plan.labelStyle) + 2);

        const codeY = y + plan.labelHeight;
        drawRoundedRect(ctx, x, codeY, plan.width, plan.height - plan.labelHeight, 16);
        ctx.fillStyle = CANVAS_THEME.codeBackground;
        ctx.fill();
        ctx.strokeStyle = CANVAS_THEME.codeBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        drawTextLines(
          ctx,
          plan.lines,
          x + plan.codePadding,
          codeY + plan.codePadding,
          plan.codeStyle,
          CANVAS_THEME.codeText
        );
        return;
      }
      case 'hr':
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
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

  function normalizeInlineText(text) {
    return String(text)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1');
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
    ctx.font = `${style.weight} ${style.size}px ${style.family}`;
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

  function formatTimestamp(date) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
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
