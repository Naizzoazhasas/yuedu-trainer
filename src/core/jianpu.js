/* 读谱训练器 — 简谱渲染
 * 全局命名空间：window.APP.jianpu
 * 依赖：APP.util、APP.theory
 *
 * 两套渲染实现：
 *   1) renderSvg —— 默认实现。纯 SVG 专业排版：列宽分配、统一基线、小节线、终止线、八度点、减时线。
 *   2) renderHtmlInto —— 旧的 HTML + flexbox 实现（保留作为降级与回归测试对象）。
 *
 * 规则（首调，默认）：
 *   主音 = 1，音级 1-7；变音在数字前加 # / b；高八度数字上方加点，低八度下方加点；
 *   八分音符画一条减时线，十六分两条；延长用横线「—」；附点用「·」；休止符用 0。
 * 固定调模式：C 才是 1，其余按实际音高记。
 *
 * 坐标系（SVG）：x 向右、y 向下；数字一律用 text-anchor="middle" 居中在列中心，
 * 且**所有数字的基线固定为 y = 30**（八度只加点、不移动数字，这是「七上八下」的根治办法）。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------------- 排版常量 ---------------- */

  var DIGIT_Y = 30;                              // 数字基线（全曲唯一）
  var DIGIT_SIZE = 21;                           // 数字字号
  var DOT_R = 2.1;                               // 八度点半径
  var DOT_UP_Y = DIGIT_Y - 16;                   // 高八度第一个点的 y
  var DOT_DOWN_Y = DIGIT_Y + 12;                 // 低八度第一个点的 y
  var DOT_STEP = 4;                              // 同侧多点之间的间距
  var ACC_SIZE = 14;                             // 变音记号字号
  var ACC_X = -9, ACC_Y = DIGIT_Y - 9;           // 变音记号相对列中心的位置
  var DOT_DOT_R = 1.9;                           // 附点半径
  var DOT_DOT_X = 8.5, DOT_DOT_Y = DIGIT_Y - 6;  // 附点相对列中心的位置
  var UNDER_Y = 40, UNDER_Y2 = 44;               // 两条减时线的 y
  var UNDER_W = 1.5;                             // 减时线线宽
  var DASH_SIZE = 20;                            // 延长线字号
  var SUB_Y = 58, SUB_SIZE = 9.5;                // 辅助文字（唱名/音名）
  var BAR_TOP = 4, BAR_BOTTOM = 44;              // 小节线上下端
  var BAR_W = 1.4;                               // 小节线线宽
  var FINAL_THIN_DX = -5.5, FINAL_THICK_DX = -2; // 终止线相对小节右边界的位置
  var FINAL_THICK_W = 4;
  var BARNUM_Y = 14, BARNUM_SIZE = 9.5;          // 小节号
  var H_NO_SUB = 52, H_SUB = 66;                 // 画布高度
  var PAD_LEFT = 24, PAD_RIGHT = 26;             // 左右留白（给第一根小节线与终止线）
  var BAR_GAP = 10;                              // 小节之间的额外空白（放小节号）
  var MIN_COL = 16;                              // 最小列宽，防止压得过窄
  var GROUP_GAP = 6;                             // 复合拍的视觉分组间隙
  var EMPTY_BAR_MIN = 40;                        // 空小节的最小宽度

  var INK = '#131a26';          // 数字/减时线/点
  var INK_REST = '#8b95a8';     // 休止符（浅一档）
  var INK_DASH = '#4a5568';     // 延长线
  var BARLINE = '#2b3444';      // 小节线
  var SUB_INK = '#7a8699';      // 辅助文字
  var BARNUM_INK = '#9aa5b8';   // 小节号
  var PLAYING_INK = '#e05d1f';  // 播放中的音符
  var BAR_HL = 'rgba(255,138,76,.16)';  // 播放中的小节底色

  var FONT = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';

  /* ---------------- 纯函数 ---------------- */

  function pitchToJianpu(pitch, key, mode) {
    return TH.jianpuOf(pitch, key, mode || 'relative');
  }

  function accGlyph(a) {
    if (a === '#') return '\u266F';
    if (a === 'b') return '\u266D';
    if (a === '##') return '\u266F\u266F';
    if (a === 'bb') return '\u266D\u266D';
    return a || '';
  }
  function repeat(s, n) { var o = ''; for (var i = 0; i < n; i++) o += s; return o; }

  /* 一个音符的「音符主体」文本（不含减时线/延长线） */
  function nib(j, opts) {
    if (!j || j.rest) return '0';
    return accGlyph(j.accidental) + String(j.digit);
  }

  /* ---------------- 旧的 HTML 实现（保留：降级 + 回归测试） ---------------- */

  /* 单个音符的 HTML（数字 + 八度点 + 减时线 + 附点） */
  function noteHTML(note, key, opts) {
    opts = opts || {};
    var mode = opts.mode || 'relative';
    var beats = U.beatsOf(note.dur, note.dotted);
    var j = note.pitch ? pitchToJianpu(note.pitch, key, mode) : { rest: true, digit: 0, accidental: '', octave: 0 };

    var wrap = U.el('span', { class: 'jp-note' + (j.rest ? ' rest' : '') });

    /* 上加点 */
    if (!j.rest && j.octave > 0) {
      wrap.appendChild(U.el('span', { class: 'jp-dot-above', text: repeat('\u00B7', Math.min(3, j.octave)) }));
    } else {
      wrap.appendChild(U.el('span', { class: 'jp-dot-above', text: '' }));
    }

    var digit = U.el('span', { class: 'jp-digit' });
    if (!j.rest && j.accidental) {
      digit.appendChild(U.el('span', { class: 'jp-acc', text: accGlyph(j.accidental) }));
    }
    digit.appendChild(document.createTextNode(j.rest ? '0' : String(j.digit)));
    if (!j.rest && note.dotted) {
      digit.appendChild(U.el('span', { class: 'jp-acc', text: '\u00B7' }));
    }
    wrap.appendChild(digit);

    /* 下加点 */
    if (!j.rest && j.octave < 0) {
      wrap.appendChild(U.el('span', { class: 'jp-dot-below', text: repeat('\u00B7', Math.min(3, -j.octave)) }));
    } else {
      wrap.appendChild(U.el('span', { class: 'jp-dot-below', text: '' }));
    }

    /* 减时线：八分一条、十六分两条… */
    var under = 0;
    if (beats <= 0.25 + 1e-9) under = 2;
    else if (beats <= 0.5 + 1e-9) under = 1;
    if (under >= 1) {
      wrap.appendChild(U.el('span', { class: 'jp-underline' + (under >= 2 ? ' d2' : '') }));
    } else {
      wrap.appendChild(U.el('span', { class: 'jp-underline', style: { visibility: 'hidden' } }));
    }

    /* 辅助文字：音名 / 唱名 */
    if (opts.showNoteName || opts.showSolfa) {
      var parts = [];
      if (opts.showNoteName && note.pitch) parts.push(TH.pitchName(note.pitch, { octave: true }));
      if (opts.showSolfa && note.pitch) parts.push(TH.solfeggio(note.pitch, key));
      wrap.appendChild(U.el('span', {
        class: 'jp-sub',
        text: parts.length ? parts.join(' ') : (j.rest ? '休' : '')
      }));
    }
    return wrap;
  }

  /**
   * 旧版 HTML 渲染（flexbox）。默认渲染器已换成 SVG，这里只作为降级路径与回归基线。
   * @param {HTMLElement} container
   * @param {Object} score
   * @param {Object} opts { mode:'relative'|'fixed', showSolfa, showNoteName, showBarNumbers, showDash }
   */
  function renderHtmlInto(container, score, opts) {
    opts = opts || {};
    if (!container) return null;
    U.clear(container);
    var key = TH.normalizeKey((score && score.key) || { tonic: 0, mode: 'major', fifths: 0 });

    var wrap = U.el('div', { class: 'jp-wrap' });
    var bars = (score && score.bars) || [];

    bars.forEach(function (bar, bi) {
      if (bi > 0) wrap.appendChild(U.el('span', { class: 'jp-tail', text: '' }));
      var barEl = U.el('div', { class: 'jp-bar', data: { barIdx: bi } });
      if (opts.showBarNumbers) {
        barEl.appendChild(U.el('span', { class: 'jp-bar-num', text: String(bi + 1) }));
      }

      var notes = bar.notes || [];
      notes.forEach(function (note, ni) {
        var beats = U.beatsOf(note.dur, note.dotted);
        var isRest = !note.pitch;

        /* 二分及以上：用延长线补足（首拍记数字，其余用 -） */
        var units = Math.round(beats / 1);        // 以四分音符为单位
        if (units >= 2) {
          var first = U.el('span', { class: 'jp-note' + (isRest ? ' rest' : ''), data: { noteIdx: ni } });
          var j = isRest ? { rest: true, octave: 0, digit: 0 } : pitchToJianpu(note.pitch, key, opts.mode);
          first.appendChild(U.el('span', { class: 'jp-digit', text: isRest ? '0' : accGlyph(j.accidental || '') + j.digit }));
          if (opts.showNoteName || opts.showSolfa) {
            first.appendChild(U.el('span', {
              class: 'jp-sub',
              text: isRest ? '休' : [
                opts.showNoteName ? TH.pitchName(note.pitch, { octave: true }) : '',
                opts.showSolfa ? TH.solfeggio(note.pitch, key) : ''
              ].filter(Boolean).join(' ')
            }));
          }
          barEl.appendChild(first);
          if (opts.showDash !== false) {
            for (var d = 1; d < units; d++) {
              barEl.appendChild(U.el('span', { class: 'jp--', text: '\u2014' }));
            }
          }
        } else {
          var el = noteHTML(note, key, opts);
          el.setAttribute('data-note-idx', String(ni));
          barEl.appendChild(el);
        }

        /* 延音线提示 */
        if (note.tie) {
          barEl.appendChild(U.el('span', { class: 'jp-tie', text: '\u2318' }));
        }
      });
      wrap.appendChild(barEl);
    });

    container.appendChild(wrap);
    return wrap;
  }

  /* ---------------- SVG 小工具 ---------------- */

  function r2(v) { return Math.round(v * 100) / 100; }

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined) return;
        n.setAttribute(k, attrs[k]);
      });
    }
    return n;
  }

  function svgText(x, y, text, o) {
    o = o || {};
    var t = svgEl('text', {
      x: r2(x), y: r2(y),
      'text-anchor': o.anchor || 'middle',
      'font-family': o.font || FONT,
      'font-size': o.size || DIGIT_SIZE,
      'font-weight': o.weight || 400,
      fill: o.fill || INK,
      class: o.class || null
    });
    t.textContent = text;
    return t;
  }

  function svgLine(x1, y1, x2, y2, stroke, w) {
    return svgEl('line', {
      x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2),
      stroke: stroke, 'stroke-width': w
    });
  }

  /* 标记「墨色元素」：播放高亮时需要改它的 fill，clearHighlight 时按 data-ink 还原 */
  function ink(node, color) {
    var c = node.getAttribute('class');
    node.setAttribute('class', (c ? c + ' ' : '') + 'jp-svg-ink');
    node.setAttribute('data-ink', color || INK);
    return node;
  }

  /* ---------------- SVG 排版核心 ---------------- */

  /* 列宽基准：四分 28、八分/十六分 22、二分/全音符 34 */
  function baseColWidth(beats) {
    if (beats >= 2) return 34;
    if (beats >= 1) return 28;
    return 22;
  }

  /* 把一个小节拆成「列」：每个音符占一列，>=2 拍的音后面每拍再占一列延长线 */
  function buildSlots(bar, key, opts, time) {
    var slots = [];
    var notes = (bar && bar.notes) || [];
    var compound = !!(time && time.den === 8 && (time.num % 3 === 0));

    notes.forEach(function (note, ni) {
      var isRest = !note.pitch;
      var j = isRest ? { rest: true, digit: 0, accidental: '', octave: 0 }
        : pitchToJianpu(note.pitch, key, opts.mode || 'relative');
      var beats = U.beatsOf(note.dur, note.dotted);

      var w = baseColWidth(beats);
      if (!isRest && j.accidental) w += 6;     // 变音记号要占位
      if (!isRest && note.dotted) w += 5;      // 附点要占位

      var sustained = beats >= 2;
      var firstSpan = sustained ? 1 : beats;
      var dashes = sustained ? Math.max(0, Math.round(beats) - 1) : 0;

      slots.push({ kind: 'digit', noteIdx: ni, note: note, j: j, w: w, min: MIN_COL, span: firstSpan });
      for (var d = 0; d < dashes; d++) {
        slots.push({ kind: 'dash', noteIdx: ni, note: note, j: j, w: 28, min: MIN_COL, span: 1 });
      }
    });

    /* 复合拍（6/8、9/8、12/8）：每 3 个八分（1.5 拍）之后留 6px 视觉间隙 */
    if (compound && slots.length) {
      var out = [], acc = 0;
      slots.forEach(function (s, i) {
        out.push(s);
        acc += Math.round(s.span * 2);
        if (acc > 0 && acc % 3 === 0 && i < slots.length - 1) {
          out.push({ kind: 'gap', noteIdx: -1, note: null, j: null, w: GROUP_GAP, min: GROUP_GAP, span: 0 });
        }
      });
      slots = out;
    }
    return slots;
  }

  function sumW(slots) {
    var s = 0;
    for (var i = 0; i < slots.length; i++) s += slots[i].w;
    return s;
  }

  /* 画一个音符的数字列（数字 + 八度点 + 变音 + 附点 + 减时线 + 辅助文字） */
  function drawDigit(g, x, slot, ctx) {
    var note = slot.note, key = ctx.key, opts = ctx.opts;
    var w = slot.w;
    var cx = x + w / 2;
    var isRest = !note.pitch;
    var j = slot.j;
    var fill = isRest ? INK_REST : INK;
    var beats = U.beatsOf(note.dur, note.dotted);

    /* 高八度：数字正上方的小圆点（数字不动，只加点） */
    if (!isRest && j.octave > 0) {
      var up = Math.min(3, j.octave);
      for (var a = 0; a < up; a++) {
        g.appendChild(ink(svgEl('circle', {
          cx: r2(cx), cy: r2(DOT_UP_Y - a * DOT_STEP), r: DOT_R, fill: fill, class: 'jp-svg-dot'
        }), fill));
      }
    }
    /* 低八度：数字正下方的小圆点 */
    if (!isRest && j.octave < 0) {
      var down = Math.min(3, -j.octave);
      for (var b = 0; b < down; b++) {
        g.appendChild(ink(svgEl('circle', {
          cx: r2(cx), cy: r2(DOT_DOWN_Y + b * DOT_STEP), r: DOT_R, fill: fill, class: 'jp-svg-dot'
        }), fill));
      }
    }
    /* 变音记号：数字左上角 */
    if (!isRest && j.accidental) {
      g.appendChild(ink(svgText(cx + ACC_X, ACC_Y, accGlyph(j.accidental), {
        size: ACC_SIZE, fill: fill, class: 'jp-svg-acc'
      }), fill));
    }
    /* 数字本体：基线恒为 DIGIT_Y */
    g.appendChild(ink(svgText(cx, DIGIT_Y, isRest ? '0' : String(j.digit), {
      size: DIGIT_SIZE, weight: 500, fill: fill, class: 'jp-svg-digit'
    }), fill));
    /* 附点：数字右侧 */
    if (!isRest && note.dotted) {
      g.appendChild(ink(svgEl('circle', {
        cx: r2(cx + DOT_DOT_X), cy: r2(DOT_DOT_Y), r: DOT_DOT_R, fill: fill, class: 'jp-svg-dot'
      }), fill));
    }
    /* 减时线：八分 1 条、十六分 2 条，长度 = 列宽 × 0.72 */
    var under = 0;
    if (beats <= 0.25 + 1e-9) under = 2;
    else if (beats <= 0.5 + 1e-9) under = 1;
    if (under >= 1) {
      var len = Math.max(8, w * 0.72);
      for (var u = 0; u < under; u++) {
        var uy = u === 0 ? UNDER_Y : UNDER_Y2;
        var ul = svgLine(cx - len / 2, uy, cx + len / 2, uy, fill, UNDER_W);
        ul.setAttribute('class', 'jp-svg-underline');
        g.appendChild(ink(ul, fill));
      }
    }
    /* 辅助文字：音名 / 唱名（在减时线下面） */
    if (opts.showSolfa || opts.showNoteName) {
      var label = subLabel(note, j, key, opts);
      if (label) {
        g.appendChild(svgText(cx, SUB_Y, label, { size: SUB_SIZE, fill: SUB_INK, class: 'jp-svg-sub' }));
      }
    }
  }

  function subLabel(note, j, key, opts) {
    var parts = [];
    if (note.pitch) {
      if (opts.showNoteName) parts.push(TH.pitchName(note.pitch, { octave: true }));
      if (opts.showSolfa) parts.push(TH.solfeggio(note.pitch, key));
    }
    if (parts.length) return parts.join(' ');
    return j.rest ? '休' : '';
  }

  /* 延长线：单独占一列，画在数字基线上 */
  function drawDash(g, x, w) {
    g.appendChild(svgText(x + w / 2, DIGIT_Y, '\u2014', {
      size: DASH_SIZE, fill: INK_DASH, class: 'jp-svg-dash'
    }));
  }

  function barline(x) {
    return svgEl('line', {
      x1: r2(x), y1: BAR_TOP, x2: r2(x), y2: BAR_BOTTOM,
      stroke: BARLINE, 'stroke-width': BAR_W, class: 'jp-svg-barline'
    });
  }

  /* 终止线：细 + 粗，包在一个 <g class="jp-svg-barline"> 里，便于按「小节线根数」计数 */
  function finalBarline(x) {
    var g = svgEl('g', { class: 'jp-svg-barline' });
    g.appendChild(svgEl('line', {
      x1: r2(x + FINAL_THIN_DX), y1: BAR_TOP, x2: r2(x + FINAL_THIN_DX), y2: BAR_BOTTOM,
      stroke: BARLINE, 'stroke-width': BAR_W
    }));
    g.appendChild(svgEl('rect', {
      x: r2(x + FINAL_THICK_DX), y: BAR_TOP, width: FINAL_THICK_W,
      height: BAR_BOTTOM - BAR_TOP, fill: BARLINE
    }));
    return g;
  }

  /**
   * 把乐段渲染成简谱 SVG。
   * @param {Object} score Score 对象
   * @param {Object} opts  { width, mode, showSolfa, showNoteName, showBarNumbers, showDash, highlightBar }
   * @returns {SVGElement}
   */
  function renderSvg(score, opts) {
    opts = opts || {};
    score = score || {};
    var key = TH.normalizeKey(score.key || { tonic: 0, mode: 'major', fifths: 0 });
    var time = score.time || { num: 4, den: 4 };
    var bars = (score.bars || []).slice();
    var showSub = !!(opts.showSolfa || opts.showNoteName);
    var height = showSub ? H_SUB : H_NO_SUB;
    var widthLimit = opts.width || 900;
    var n = bars.length;

    /* 1) 每小节建列，并算「自然宽度」 */
    var barSlots = bars.map(function (bar) { return buildSlots(bar, key, opts, time); });
    var naturals = barSlots.map(function (slots) { return Math.max(EMPTY_BAR_MIN, sumW(slots)); });

    /* 2) 全局等比缩放：内容超出 opts.width 就压缩，否则拉伸填满（小节线位置由列宽和决定） */
    var availBars = widthLimit - PAD_LEFT - PAD_RIGHT - BAR_GAP * Math.max(0, n - 1);
    var totalNatural = naturals.reduce(function (a, b) { return a + b; }, 0);
    var scale = totalNatural > 0 ? (availBars / totalNatural) : 1;
    if (!isFinite(scale) || scale <= 0) scale = 1;

    /* 3) 压缩时保证最小列宽 16px（间隙最小 6px） */
    var barWidths = barSlots.map(function (slots) {
      var w = 0;
      slots.forEach(function (s) {
        s.w = Math.max(s.min, s.w * scale);
        w += s.w;
      });
      return w;
    });

    var totalBars = barWidths.reduce(function (a, b) { return a + b; }, 0);
    var width = n === 0 ? widthLimit : PAD_LEFT + totalBars + BAR_GAP * (n - 1) + PAD_RIGHT;
    if (!isFinite(width) || width < 80) width = Math.max(80, widthLimit);

    /* 根节点 */
    var root = svgEl('svg', {
      xmlns: SVGNS,
      viewBox: '0 0 ' + r2(width) + ' ' + height,
      width: r2(width),
      height: height,
      'data-renderer': 'jianpu-svg',
      'font-family': FONT
    });
    root.style.background = '#ffffff';
    root.style.display = 'block';
    root.style.maxWidth = '100%';
    root.style.height = 'auto';

    /* 4) 逐小节：背景 → 小节号 → 音符组 */
    var x = PAD_LEFT;
    bars.forEach(function (bar, bi) {
      var barW = barWidths[bi];
      var gBar = svgEl('g', { 'data-bar-idx': bi, class: 'jp-svg-bar' });

      /* 小节高亮底：必须是 [data-bar-idx] 里的第一个元素 */
      gBar.appendChild(svgEl('rect', {
        x: r2(x), y: 0, width: r2(barW), height: height,
        fill: 'transparent', class: 'jp-svg-bar-bg', 'data-bar-bg': bi
      }));

      /* 小节号：小节线左上方 */
      if (opts.showBarNumbers) {
        gBar.appendChild(svgText(x - 2, BARNUM_Y, String(bi + 1), {
          size: BARNUM_SIZE, fill: BARNUM_INK, anchor: 'end', class: 'jp-svg-barnum'
        }));
      }

      /* 音符：同一音符的「数字列 + 延长线列」放进同一个 <g data-note-idx> */
      var cx = x;
      var cur = null;
      barSlots[bi].forEach(function (slot) {
        if (slot.kind === 'gap') { cx += slot.w; return; }
        if (!cur || cur.idx !== slot.noteIdx) {
          cur = {
            idx: slot.noteIdx,
            node: svgEl('g', {
              'data-note-idx': slot.noteIdx, 'data-bar': bi, class: 'jp-svg-note'
            })
          };
          gBar.appendChild(cur.node);
        }
        if (slot.kind === 'dash') drawDash(cur.node, cx, slot.w);
        else drawDigit(cur.node, cx, slot, { key: key, opts: opts });
        cx += slot.w;
      });

      root.appendChild(gBar);
      x += barW + BAR_GAP;
    });

    /* 5) 小节线：段首 1 条 + 每小节末尾 1 条（最后一条是终止线） = 小节数 + 1 */
    root.appendChild(barline(PAD_LEFT));
    var bx = PAD_LEFT;
    bars.forEach(function (bar, bi) {
      bx += barWidths[bi];
      root.appendChild(bi === n - 1 ? finalBarline(bx) : barline(bx));
      bx += BAR_GAP;
    });

    return root;
  }

  /* ---------------- 对外渲染入口 ---------------- */

  /**
   * 渲染简谱到容器。默认走 SVG；opts.renderer === 'html' 走旧 HTML 实现；
   * SVG 抛异常时自动降级到 HTML，绝不让页面白掉。
   * @returns {SVGElement|HTMLElement|null}
   */
  function renderInto(container, score, opts) {
    opts = opts || {};
    if (!container) return null;
    U.clear(container);

    if (opts.renderer === 'html') return renderHtmlInto(container, score, opts);

    try {
      var svg = API.renderSvg(score, opts);
      container.appendChild(svg);
      return svg;
    } catch (e) {
      /* 兜底：清掉可能残留的半成品，退回 HTML 实现 */
      try { U.clear(container); } catch (e2) { /* 忽略 */ }
      return renderHtmlInto(container, score, opts);
    }
  }

  /* ---------------- 高亮 ---------------- */

  function highlightBar(container, barIndex) {
    if (!container) return;
    U.queryAll('[data-bar-idx]', container).forEach(function (g) {
      var idx = parseInt(g.getAttribute('data-bar-idx'), 10);
      var bg = U.query('.jp-svg-bar-bg', g);
      if (bg) bg.setAttribute('fill', idx === barIndex ? BAR_HL : 'transparent');
    });
  }

  function highlightNote(container, barIndex, noteIndex) {
    if (!container) return;
    U.queryAll('[data-note-idx]', container).forEach(function (g) {
      var on = parseInt(g.getAttribute('data-bar'), 10) === barIndex &&
        parseInt(g.getAttribute('data-note-idx'), 10) === noteIndex;
      g.classList.toggle('playing', on);
      U.queryAll('.jp-svg-ink', g).forEach(function (el) {
        var base = el.getAttribute('data-ink');
        el.setAttribute('fill', on ? PLAYING_INK : (base || INK));
      });
    });
  }

  function clearHighlight(container) {
    if (!container) return;
    U.queryAll('.jp-svg-bar-bg', container).forEach(function (r) {
      r.setAttribute('fill', 'transparent');
    });
    U.queryAll('.playing', container).forEach(function (g) { g.classList.remove('playing'); });
    U.queryAll('.jp-svg-ink', container).forEach(function (el) {
      var base = el.getAttribute('data-ink');
      if (base) el.setAttribute('fill', base);
    });
  }

  /* ---------------- 纯文本（供复制/导出） ---------------- */

  function toText(score, opts) {
    opts = opts || {};
    var key = TH.normalizeKey(score.key || { tonic: 0, mode: 'major', fifths: 0 });
    var mode = opts.mode || 'relative';
    var time = score.time || { num: 4, den: 4 };
    var head = TH.keyName(key) + '  ' + time.num + '/' + time.den + '  \u266A=' + score.tempo;
    var lines = [];
    var buf = '';
    (score.bars || []).forEach(function (bar) {
      var seg = [];
      (bar.notes || []).forEach(function (note) {
        var beats = U.beatsOf(note.dur, note.dotted);
        if (!note.pitch) {
          seg.push('0');
          return;
        }
        var j = pitchToJianpu(note.pitch, key, mode);
        var s = (j.accidental ? accGlyph(j.accidental) : '') + j.digit;
        if (j.octave < 0) s += repeat(',', -j.octave);
        if (j.octave > 0) s += repeat("'", j.octave);
        if (beats <= 0.25 + 1e-9) s = s + '=';       // 十六分：= 表示双下划线
        else if (beats <= 0.5 + 1e-9) s = s + '_';   // 八分：_ 表示下划线
        if (note.dotted) s += '\u00B7';
        seg.push(s);
        var extra = Math.round(beats) - 1;
        for (var i = 0; i < extra; i++) seg.push('-');
      });
      buf += '| ' + seg.join(' ');
      if (buf.length > 64) { lines.push(buf.trim()); buf = ''; }
    });
    if (buf) lines.push(buf.trim());
    return head + '\n' + lines.join('\n');
  }

  /* ---------------- 注册 ---------------- */

  var API = {
    renderInto: renderInto,           // 默认 SVG，可回退
    renderSvg: renderSvg,             // 新的专业排版实现
    renderHtmlInto: renderHtmlInto,   // 旧的 HTML 实现（降级 / 回归）
    highlightBar: highlightBar,
    highlightNote: highlightNote,
    clearHighlight: clearHighlight,
    toText: toText,
    pitchToJianpu: pitchToJianpu,
    noteHTML: noteHTML
  };

  APP.jianpu = API;

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.jianpu;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
