/* 读谱训练器 — 五线谱 SVG 渲染器
 * 全局命名空间：window.APP.renderer
 * 依赖：APP.util、APP.theory
 *
 * 自己画 SVG，不依赖任何第三方库（离线单文件、file:// 打开都要能用）。
 * 坐标约定：五线谱每条线间距 LINE_GAP = 10px；staffPos 0 = 最下面那条线。
 *   y(pos) = TOP_LINE_Y - pos * (LINE_GAP/2)
 *   TOP_LINE_Y = 60（第 5 线），因此第 1 线 = 100，中线(pos=4) = 80。
 * 高音谱：E4=0，C4=-2（下加一线）。低音谱：G2=0，C4=10（上加二线）。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------------- 几何常量 ---------------- */

  var LINE_GAP = 10;
  var TOP_LINE_Y = 60;
  var STAFF_BOTTOM_Y = TOP_LINE_Y + LINE_GAP * 4;   // 100
  var MID_LINE_Y = TOP_LINE_Y + LINE_GAP * 2;       // 80
  var LEDGER_SPAN = 8;                              // 加线左右各伸出多少

  var STEM_LEN = 35;
  var HEAD_RX = 6.4;
  var HEAD_RY = 4.9;

  /* 常用颜色（导出 PNG 时是白底，所以用深墨色） */
  var INK = '#131a26';
  var DIM = '#6b7280';
  var ACCENT = '#e05d1f';

  function yOf(pos) { return TOP_LINE_Y - pos * (LINE_GAP / 2); }
  function isLinePos(pos) { return ((pos % 2) + 2) % 2 === 0; }

  /* ---------------- SVG 小工具 ---------------- */

  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined) return;
        n.setAttribute(k, attrs[k]);
      });
    }
    return n;
  }
  function txt(x, y, text, opts) {
    opts = opts || {};
    var t = svg('text', {
      x: x, y: y, 'text-anchor': opts.anchor || 'middle',
      'font-family': opts.font || '"Segoe UI Symbol","Noto Music","Bravura",serif',
      'font-size': opts.size || 18,
      'font-weight': opts.weight || 400,
      fill: opts.fill || INK,
      'dominant-baseline': opts.baseline || 'middle'
    });
    t.textContent = text;
    return t;
  }
  function line(x1, y1, x2, y2, opts) {
    opts = opts || {};
    return svg('line', {
      x1: x1, y1: y1, x2: x2, y2: y2,
      stroke: opts.stroke || INK, 'stroke-width': opts.w || 1.3,
      'stroke-linecap': opts.cap || 'butt'
    });
  }

  /* ---------------- 谱号 ---------------- */

  /* 高音谱号：用贝塞尔曲线手工绘制。中心落在 G4（staffPos = 2，第 2 线）。
   * 用一个「围成 G 字样的旋涡 + 上下竖钩」的路径近似，视觉上与传统谱号一致。 */
  function drawTrebleClef(g, x) {
    var cx = x + 9;          // 旋涡中心 x
    var gy = yOf(2);         // G4 线
    var d = [
      /* 上半：从旋涡中心向上，绕一个大弯再回到中心（外圈） */
      'M ' + (cx - 1) + ' ' + (gy - 2),
      'C ' + (cx - 11) + ' ' + (gy - 6) + ', ' + (cx - 13) + ' ' + (gy + 12) + ', ' + (cx - 3) + ' ' + (gy + 14),
      'C ' + (cx + 5) + ' ' + (gy + 15) + ', ' + (cx + 11) + ' ' + (gy + 7) + ', ' + (cx + 9) + ' ' + (gy - 1),
      /* 内圈：绕回中心，形成旋涡 */
      'C ' + (cx + 7) + ' ' + (gy - 9) + ', ' + (cx - 4) + ' ' + (gy - 10) + ', ' + (cx - 6) + ' ' + (gy + 1),
      /* 向下走成竖线，末端小勾 */
      'C ' + (cx - 8) + ' ' + (gy + 12) + ', ' + (cx - 6) + ' ' + (gy + 24) + ', ' + (cx + 1) + ' ' + (gy + 30),
      'C ' + (cx + 5) + ' ' + (gy + 33) + ', ' + (cx + 6) + ' ' + (gy + 27) + ', ' + (cx + 4) + ' ' + (gy + 24),
      'C ' + (cx + 2) + ' ' + (gy + 21) + ', ' + (cx - 1) + ' ' + (gy + 22) + ', ' + (cx - 2) + ' ' + (gy + 25)
    ].join(' ');
    g.appendChild(svg('path', {
      d: d, fill: 'none', stroke: INK, 'stroke-width': 2.1,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));
    /* 中心竖线（贯穿谱表） */
    g.appendChild(line(cx - 1.5, yOf(9), cx - 1.5, yOf(-2), { w: 1.5, cap: 'round' }));
  }

  /* 低音谱号：起点在 F3 线（staffPos = 6），右侧一个大圆点 + 左侧小圆点 */
  function drawBassClef(g, x) {
    var fy = yOf(6);
    var cx = x + 8;
    var d = [
      'M ' + (cx + 4) + ' ' + (fy - 6),
      'C ' + (cx + 15) + ' ' + (fy - 4) + ', ' + (cx + 15) + ' ' + (fy + 14) + ', ' + (cx + 4) + ' ' + (fy + 16),
      'C ' + (cx - 3) + ' ' + (fy + 17) + ', ' + (cx - 5) + ' ' + (fy + 10) + ', ' + (cx - 5) + ' ' + (fy + 5),
      'C ' + (cx - 5) + ' ' + (fy + 1) + ', ' + (cx - 3) + ' ' + (fy - 4) + ', ' + (cx + 4) + ' ' + (fy - 6)
    ].join(' ');
    g.appendChild(svg('path', {
      d: d, fill: 'none', stroke: INK, 'stroke-width': 2.4,
      'stroke-linecap': 'round'
    }));
    /* 右侧大圆点 */
    g.appendChild(svg('circle', { cx: cx + 19, cy: fy + 5, r: 3.4, fill: INK }));
    /* 左侧小圆点 */
    g.appendChild(svg('circle', { cx: cx - 9, cy: fy + 5, r: 2.2, fill: INK }));
    /* F 线两侧的小竖点 */
    g.appendChild(svg('circle', { cx: cx + 21, cy: fy - 8, r: 1.5, fill: INK }));
    g.appendChild(svg('circle', { cx: cx + 21, cy: fy + 2, r: 1.5, fill: INK }));
  }

  /* ---------------- 拍号 ---------------- */

  function drawTimeSignature(g, x, time) {
    var upperY = yOf(6);
    var lowerY = yOf(2);
    var u = txt(x, upperY, String(time.num), { size: 23, weight: 700, font: '"Times New Roman",serif' });
    var l = txt(x, lowerY, String(time.den), { size: 23, weight: 700, font: '"Times New Roman",serif' });
    g.appendChild(u);
    g.appendChild(l);
  }

  /* ---------------- 调号 ---------------- */

  function drawKeySignature(g, x, key) {
    var sig = TH.keySignature(key);
    if (!sig.count) return x;
    var i, pos, gx;
    for (i = 0; i < sig.count; i++) {
      pos = sig.positions[i];
      gx = x + i * 7.5;
      var yy = yOf(pos);
      if (sig.accidental === 'sharp') {
        g.appendChild(sharpGlyph(gx, yy));
      } else {
        g.appendChild(flatGlyph(gx, yy));
      }
    }
    return x + sig.count * 7.5 + 3;
  }

  /* 手工绘制的升号（五线谱里更清晰，不依赖字体） */
  function sharpGlyph(cx, cy) {
    var g = svg('g', {});
    var s = 0.95;
    /* 两条竖线 */
    g.appendChild(line(cx - 2.1 * s, cy - 6.6 * s, cx - 2.1 * s, cy + 6.6 * s, { w: 1.1 }));
    g.appendChild(line(cx + 2.1 * s, cy - 7.0 * s, cx + 2.1 * s, cy + 6.2 * s, { w: 1.1 }));
    /* 两条横线（略带倾斜） */
    g.appendChild(svg('path', {
      d: 'M ' + (cx - 5.4 * s) + ' ' + (cy - 1.9 * s) + ' L ' + (cx + 4.6 * s) + ' ' + (cy - 3.5 * s),
      stroke: INK, 'stroke-width': 1.9, fill: 'none'
    }));
    g.appendChild(svg('path', {
      d: 'M ' + (cx - 5.4 * s) + ' ' + (cy + 2.6 * s) + ' L ' + (cx + 4.6 * s) + ' ' + (cy + 1.0 * s),
      stroke: INK, 'stroke-width': 1.9, fill: 'none'
    }));
    return g;
  }

  /* 降号：一根竖线 + 右侧的圆肚 */
  function flatGlyph(cx, cy) {
    var g = svg('g', {});
    g.appendChild(line(cx - 2.6, cy - 8.4, cx - 2.6, cy + 6.2, { w: 1.2 }));
    g.appendChild(svg('path', {
      d: 'M ' + (cx - 2.6) + ' ' + (cy - 0.6) +
        ' C ' + (cx + 1.4) + ' ' + (cy - 2.2) + ', ' + (cx + 5.0) + ' ' + (cy + 0.4) + ', ' + (cx + 2.6) + ' ' + (cy + 3.4) +
        ' C ' + (cx + 1.4) + ' ' + (cy + 5.0) + ', ' + (cx - 0.6) + ' ' + (cy + 5.6) + ', ' + (cx - 2.6) + ' ' + (cy + 4.6) +
        ' Z',
      fill: INK, stroke: INK, 'stroke-width': 0.6
    }));
    return g;
  }

  function naturalGlyph(cx, cy) {
    var g = svg('g', {});
    g.appendChild(line(cx - 2.2, cy - 7.0, cx - 2.2, cy + 4.6, { w: 1.1 }));
    g.appendChild(line(cx + 2.2, cy - 4.6, cx + 2.2, cy + 7.0, { w: 1.1 }));
    g.appendChild(line(cx - 2.2, cy - 1.4, cx + 2.2, cy - 3.0, { w: 2.0 }));
    g.appendChild(line(cx - 2.2, cy + 3.0, cx + 2.2, cy + 1.4, { w: 2.0 }));
    return g;
  }

  function accidentalGlyph(kind, cx, cy) {
    var g;
    if (kind === '#') g = sharpGlyph(cx, cy);
    else if (kind === 'b') g = flatGlyph(cx, cy);
    else if (kind === 'natural') g = naturalGlyph(cx, cy);
    else if (kind === '##') {
      g = svg('g', {});
      g.appendChild(sharpGlyph(cx - 3.4, cy));
      g.appendChild(sharpGlyph(cx + 3.4, cy));
    } else if (kind === 'bb') {
      g = svg('g', {});
      g.appendChild(flatGlyph(cx - 3.2, cy));
      g.appendChild(flatGlyph(cx + 3.2, cy));
    } else {
      g = svg('g', {});
    }
    g.setAttribute('data-acc', kind || 'none');
    return g;
  }

  /* ---------------- 符头 / 符干 / 符尾 ---------------- */

  function noteHead(cx, cy, hollow) {
    var e = svg('ellipse', {
      cx: cx, cy: cy, rx: HEAD_RX, ry: HEAD_RY,
      transform: 'rotate(-20 ' + cx + ' ' + cy + ')',
      fill: hollow ? 'none' : INK,
      stroke: INK, 'stroke-width': hollow ? 1.9 : 0
    });
    return e;
  }

  function stemUp(cx, cy) { return { x: cx + HEAD_RX - 0.7, y1: cy - 1.2, y2: cy - STEM_LEN }; }
  function stemDown(cx, cy) { return { x: cx - HEAD_RX + 0.7, y1: cy + 1.2, y2: cy + STEM_LEN }; }

  /* 符尾（八分/十六分…）：挂在符干末端 */
  function flag(x, y, up, count) {
    var g = svg('g', {});
    var dir = up ? 1 : -1;      // up: 符干向上，旗子往右下
    for (var i = 0; i < count; i++) {
      var oy = y + dir * i * 7;
      var d;
      if (up) {
        d = 'M ' + x + ' ' + oy +
          ' C ' + (x + 9) + ' ' + (oy + 4) + ', ' + (x + 10) + ' ' + (oy + 8) + ', ' + (x + 4) + ' ' + (oy + 13) +
          ' C ' + (x + 8) + ' ' + (oy + 7) + ', ' + (x + 5) + ' ' + (oy + 4) + ', ' + x + ' ' + (oy + 5.5) + ' Z';
      } else {
        d = 'M ' + x + ' ' + oy +
          ' C ' + (x - 9) + ' ' + (oy - 4) + ', ' + (x - 10) + ' ' + (oy - 8) + ', ' + (x - 4) + ' ' + (oy - 13) +
          ' C ' + (x - 8) + ' ' + (oy - 7) + ', ' + (x - 5) + ' ' + (oy - 4) + ', ' + x + ' ' + (oy - 5.5) + ' Z';
      }
      g.appendChild(svg('path', { d: d, fill: INK, stroke: INK, 'stroke-width': 0.5 }));
    }
    return g;
  }

  /* 休止符 */
  function restGlyph(cx, cyTop, dur, dotted) {
    /* cyTop：休止符所覆盖区域的「中间」y，按小节省略 vertical centering 的复杂度 */
    var g = svg('g', {});
    var y = cyTop;
    if (dur >= 4) {
      /* 全休止符：吊在第 4 线下方 */
      g.appendChild(svg('rect', { x: cx - 8, y: yOf(6) - 5, width: 16, height: 5, fill: INK }));
    } else if (dur >= 2) {
      /* 二分休止符：坐在第 3 线上方 */
      g.appendChild(svg('rect', { x: cx - 8, y: yOf(4) - 5.5, width: 16, height: 5, fill: INK }));
    } else if (dur >= 1) {
      /* 四分休止符：手绘闪电形 */
      g.appendChild(svg('path', {
        d: 'M ' + (cx + 3) + ' ' + (y - 15) +
          ' C ' + (cx - 3) + ' ' + (y - 10) + ', ' + (cx + 2) + ' ' + (y - 6) + ', ' + (cx - 3) + ' ' + (y - 2) +
          ' C ' + (cx - 6) + ' ' + (y + 0.5) + ', ' + (cx - 1) + ' ' + (y + 3) + ', ' + (cx + 1) + ' ' + (y + 5) +
          ' C ' + (cx - 5) + ' ' + (y + 1) + ', ' + (cx - 9) + ' ' + (y + 6) + ', ' + (cx - 3) + ' ' + (y + 9) +
          ' C ' + (cx - 1) + ' ' + (y + 6) + ', ' + (cx + 2) + ' ' + (y + 3) + ', ' + (cx + 5) + ' ' + (y + 6),
        fill: 'none', stroke: INK, 'stroke-width': 2.6, 'stroke-linecap': 'round'
      }));
    } else {
      /* 八分 / 十六分休止符：斜杆 + 圆点 */
      var n = dur <= 0.0625 ? 4 : (dur <= 0.125 ? 3 : (dur <= 0.25 ? 2 : 1));
      g.appendChild(line(cx + 4, y - 12, cx - 4, y + 9, { w: 1.9, cap: 'round' }));
      for (var i = 0; i < n; i++) {
        g.appendChild(svg('circle', { cx: cx + 1.2 - i * 3.4, cy: y - 9 + i * 4.6, r: 2.1, fill: INK }));
      }
    }
    if (dotted) g.appendChild(svg('circle', { cx: cx + 13, cy: y, r: 1.9, fill: INK }));
    return g;
  }

  /* 附点 */
  function dot(cx, cy) { return svg('circle', { cx: cx, cy: cy, r: 1.9, fill: INK }); }

  /* 加线 */
  function ledgerLines(cx, pos) {
    var g = svg('g', { 'data-ledger': '0' });
    var i, n = 0;
    if (pos < 0) {
      for (i = -2; i >= pos; i -= 2) {
        g.appendChild(line(cx - LEDGER_SPAN, yOf(i), cx + LEDGER_SPAN, yOf(i), { w: 1.3 }));
        n++;
      }
    } else if (pos > 8) {
      for (i = 10; i <= pos; i += 2) {
        g.appendChild(line(cx - LEDGER_SPAN, yOf(i), cx + LEDGER_SPAN, yOf(i), { w: 1.3 }));
        n++;
      }
    }
    g.setAttribute('data-ledger', String(n));
    return g;
  }

  /* ---------------- 主渲染 ---------------- */

  /**
   * 把乐段渲染成 SVG。
   * @param {Object} score  Score 对象
   * @param {Object} opts   { width, noteScale, showBarNumbers, highlightBar, clef, showSubText, showScaleText }
   * @returns {SVGElement}
   */
  function renderStaff(score, opts) {
    opts = opts || {};
    var k = TH.normalizeKey(score.key || { tonic: 0, mode: 'major', fifths: 0 });
    var time = score.time || { num: 4, den: 4 };
    var clef = opts.clef || score.clef || 'treble';
    var bars = (score.bars || []).slice();

    var padLeft = 84;
    var padRight = 22;
    var padTop = 30;
    var padBottom = opts.showSubText ? 34 : 16;
    var avail = Math.max(360, opts.width || 900);

    /* 每个小节按「事件数 + 固定余量」分配宽度，保证密集小节也放得下 */
    var weights = bars.map(function (b) {
      var effective = 0;
      b.notes.forEach(function (n) {
        var beats = U.beatsOf(n.dur, n.dotted);
        /* 一个音符至少需要 ~18px，二分音符以上的占更多 */
        effective += 1 + (n.pitch ? 0 : 0.4) + Math.max(0, beats - 0.5) * 0.6;
      });
      return Math.max(2.2, effective);
    });
    var totalW = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var contentW = avail - padLeft - padRight;
    var barWidths = weights.map(function (w) { return Math.max(58, contentW * (w / totalW)); });
    /* 重新归一化，让总宽正好等于 contentW */
    var bwSum = barWidths.reduce(function (a, b) { return a + b; }, 0);
    var scale = contentW / bwSum;
    barWidths = barWidths.map(function (w) { return w * scale; });

    var width = padLeft + barWidths.reduce(function (a, b) { return a + b; }, 0) + padRight;
    var height = padTop + (STAFF_BOTTOM_Y - TOP_LINE_Y) + (TOP_LINE_Y - 20) + padBottom + 20;

    var root = svg('svg', {
      xmlns: SVGNS,
      viewBox: '0 0 ' + Math.round(width) + ' ' + Math.round(height),
      width: Math.round(width), height: Math.round(height),
      'font-family': '"PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    });
    root.style.background = '#ffffff';
    root.style.display = 'block';
    root.style.maxWidth = '100%';
    root.style.height = 'auto';

    /* 谱表五线 */
    for (var L = 0; L < 5; L++) {
      var yy = TOP_LINE_Y + L * LINE_GAP;
      root.appendChild(line(padLeft - 12, yy, width - padRight + 8, yy, { w: 1.15, stroke: '#2b3444' }));
    }

    /* 谱号 */
    if (clef === 'bass') drawBassClef(root, padLeft - 34);
    else drawTrebleClef(root, padLeft - 36);

    /* 调号 */
    var sigStart = padLeft - 14;
    var afterSig = drawKeySignature(root, sigStart, k);

    /* 拍号 */
    var tsX = afterSig + 12;
    drawTimeSignature(root, tsX, time);
    var musicStart = Math.max(padLeft, tsX + 22);

    /* 内容起点重新分配宽度（把谱号/调号/拍号占掉的宽度算进去） */
    var contentLeft = musicStart + 6;
    var contentRight = width - padRight;
    var usable = contentRight - contentLeft;
    var bwSum2 = barWidths.reduce(function (a, b) { return a + b; }, 0);
    var sx = usable / bwSum2;
    barWidths = barWidths.map(function (w) { return w * sx; });

    var barX = contentLeft;
    var caretEnd = contentRight + 6;

    /* 用来收集所有需要参与符杠分组的音符（按小节 + 拍组） */
    bars.forEach(function (bar, bi) {
      var w = barWidths[bi];
      var gBar = svg('g', { 'data-bar-idx': bi, class: 'bar' });
      /* 小节高亮底（透明矩形，播放时改 fill） */
      gBar.appendChild(svg('rect', {
        x: barX, y: TOP_LINE_Y - 20, width: w, height: STAFF_BOTTOM_Y - TOP_LINE_Y + 40,
        fill: 'transparent', 'data-bar-bg': bi
      }));
      root.appendChild(gBar);

      /* 小节号 */
      if (opts.showBarNumbers !== false && bi % 1 === 0) {
        gBar.appendChild(txt(barX + 3, TOP_LINE_Y - 16, String(bi + 1), {
          size: 10.5, fill: '#9aa5b8', anchor: 'start', font: '"PingFang SC",sans-serif'
        }));
      }

      layoutBar(gBar, bar, {
        x0: barX, w: w,
        clef: clef, key: k, opts: opts,
        barIndex: bi
      });

      /* 小节线 */
      var isLast = bi === bars.length - 1;
      if (isLast) {
        /* 终止线：细 + 粗 */
        gBar.appendChild(line(barX + w - 8, TOP_LINE_Y, barX + w - 8, STAFF_BOTTOM_Y, { w: 1.5 }));
        gBar.appendChild(svg('rect', {
          x: barX + w - 4, y: TOP_LINE_Y, width: 4.5,
          height: STAFF_BOTTOM_Y - TOP_LINE_Y, fill: INK
        }));
      } else {
        gBar.appendChild(line(barX + w, TOP_LINE_Y, barX + w, STAFF_BOTTOM_Y, { w: 1.3 }));
      }
      barX += w;
    });

    /* 兜底小节线（防止最后一小节宽度溢出） */
    if (barX < caretEnd) {
      root.appendChild(line(barX, TOP_LINE_Y, barX, STAFF_BOTTOM_Y, { w: 1.3 }));
    }

    return root;
  }

  /* 在给定的小节区域内排布音符 */
  function layoutBar(g, bar, ctx) {
    var x0 = ctx.x0, w = ctx.w, clef = ctx.clef, key = ctx.key, opts = ctx.opts || {};
    var notes = bar.notes || [];
    var n = notes.length;
    if (!n) return;

    /* 可用宽度：左右各留一点 */
    var innerL = x0 + 10;
    var innerW = Math.max(30, w - 20);
    var step = innerW / (n + 0.4);
    var x = innerL + step * 0.5;

    /* 预先算好每个音符的 y 与 x，便于符杠分组 */
    var items = [];
    var i;
    for (i = 0; i < n; i++) {
      var note = notes[i];
      var pos = note.pitch ? TH.staffPos(note.pitch, clef) : 0;
      var yBase = note.pitch ? yOf(pos) : yOf(4);   // 休止符默认居中
      items.push({
        note: note, x: x + i * step, pos: pos, y: yBase,
        dur: note.dur, dotted: !!note.dotted
      });
    }

    /* 按拍分组做符杠：同一个「主拍」内的连续八分及更短音符连起来 */
    var groups = [];
    var cur = null;
    var beatCursor = 0;
    var prevNote = null;
    for (i = 0; i < n; i++) {
      var it = items[i];
      var beats = U.beatsOf(it.note.dur, it.note.dotted);
      var isShort = it.note.pitch && it.note.dur <= 0.5 && !it.note.dotted;
      var beatIdx = Math.floor(beatCursor + 1e-6);
      /* 同音高延音线不参与连杠 */
      var tieContinue = prevNote && prevNote.tie && it.note.pitch &&
        prevNote.pitch && TH.midiOf(prevNote.pitch) === TH.midiOf(it.note.pitch);
      if (isShort && !tieContinue && cur && cur.beat === beatIdx) {
        cur.items.push(it);
      } else {
        cur = { beat: beatIdx, items: isShort && !tieContinue ? [it] : [] };
        groups.push(cur);
      }
      beatCursor += beats;
      prevNote = it.note;
    }

    var beamed = {};
    groups.forEach(function (grp) {
      if (grp.items.length >= 2) {
        grp.items.forEach(function (t) { beamed[t.x] = grp; });
      }
    });

    /* 逐音符绘制 */
    prevNote = null;
    for (i = 0; i < n; i++) {
      var t = items[i];
      var note = t.note;
      var gNote = svg('g', { 'data-note-idx': i, 'data-bar': ctx.barIndex });
      var cx = t.x;
      var cy = t.y;
      var beats = U.beatsOf(note.dur, note.dotted);

      var tieContinue2 = prevNote && prevNote.tie && note.pitch &&
        prevNote.pitch && TH.midiOf(prevNote.pitch) === TH.midiOf(note.pitch);

      if (!note.pitch) {
        /* 休止符 */
        gNote.appendChild(restGlyph(cx, cy, note.dur, note.dotted));
        gNote.appendChild(txt(cx, cy + 24, '休', {
          size: 8.5, fill: DIM, font: '"PingFang SC",sans-serif'
        }));
      } else {
        /* 加线 */
        gNote.appendChild(ledgerLines(cx, t.pos));

        /* 变音记号 */
        var acc = TH.accidentalGlyph(note.pitch, key);
        if (acc && !tieContinue2) {
          gNote.appendChild(accidentalGlyph(acc, cx - 15, cy));
        }

        /* 符头（全音符空心且无符干，二分音符空心） */
        var hollow = note.dur >= 2 || note.dotted && note.dur >= 1 && note.dur >= 2;
        hollow = (note.dur >= 2);
        gNote.appendChild(noteHead(cx, cy, hollow));

        var grp = beamed[t.x];
        /* 方向：以中线为准；参与符杠时按组内多数 */
        var up = t.pos < 4;
        if (grp) {
          var sum = grp.items.reduce(function (a, q) { return a + (q.pos < 4 ? 1 : 0); }, 0);
          up = sum * 2 >= grp.items.length;
        }

        if (note.dur < 4) {
          var st = up ? stemUp(cx, cy) : stemDown(cx, cy);
          if (!tieContinue2 || true) {
            gNote.appendChild(line(st.x, st.y1, st.x, st.y2, { w: 1.5 }));
          }
          /* 符尾：不参与符杠且时值 <= 八分 */
          if (!grp && note.dur <= 0.5 && !tieContinue2) {
            var nFlags = note.dur >= 0.5 ? 1 : (note.dur >= 0.25 ? 2 : (note.dur >= 0.125 ? 3 : 4));
            gNote.appendChild(flag(st.x, st.y2, up, nFlags));
          }
          /* 延音线：从本音符画一条弧到下一个同音 */
          if (note.tie && i + 1 < n && notes[i + 1].pitch &&
            TH.midiOf(notes[i + 1].pitch) === TH.midiOf(note.pitch)) {
            var nx = items[i + 1].x;
            var arcY = cy + (up ? 14 : -14);
            gNote.appendChild(svg('path', {
              d: 'M ' + (cx + 5) + ' ' + (cy + 2) + ' Q ' + ((cx + nx) / 2) + ' ' + arcY + ' ' + (nx - 5) + ' ' + (cy + 2),
              fill: 'none', stroke: INK, 'stroke-width': 1.4
            }));
          }
        } else {
          /* 全音符无符干 */
        }

        /* 附点 */
        if (note.dotted) {
          var dpos = isLinePos(t.pos) ? t.pos + 1 : t.pos;
          gNote.appendChild(dot(cx + HEAD_RX + 6, yOf(dpos)));
        }

        /* 辅助文字：音名 / 首调简谱 */
        if (opts.showSubText) {
          var label = '';
          if (opts.showSubText === 'name') label = TH.pitchName(note.pitch, { octave: true });
          else if (opts.showSubText === 'solfa') label = TH.solfeggio(note.pitch, key);
          else label = TH.pitchName(note.pitch, { octave: true }) + ' ' + TH.solfeggio(note.pitch, key);
          if (label) {
            gNote.appendChild(txt(cx, STAFF_BOTTOM_Y + 15, label, {
              size: 9.5, fill: DIM, font: '"PingFang SC",sans-serif'
            }));
          }
        }
      }

      g.appendChild(gNote);
      prevNote = note;
    }

    /* 符杠：画在符干末端之间 */
    var done = {};
    groups.forEach(function (grp) {
      if (grp.items.length < 2) return;
      var key2 = grp.items[0].x;
      if (done[key2]) return;
      done[key2] = 1;

      var ups = grp.items.filter(function (q) { return q.pos < 4; }).length;
      var beamUp = ups * 2 >= grp.items.length;
      var stemEnds = grp.items.map(function (q) {
        return { x: q.x + (beamUp ? (HEAD_RX - 0.7) : (-HEAD_RX + 0.7)), y: beamUp ? q.y - STEM_LEN : q.y + STEM_LEN };
      });
      var minY = Math.min.apply(null, stemEnds.map(function (s) { return s.y; }));
      var maxY = Math.max.apply(null, stemEnds.map(function (s) { return s.y; }));

      /* 符杠通常水平；跨度大时给一点斜率 */
      var y1 = beamUp ? minY : maxY;
      var y2 = beamUp ? minY : maxY;
      if (Math.abs(maxY - minY) > 12) {
        y2 = beamUp ? minY + Math.min(8, (maxY - minY) * 0.28) : maxY - Math.min(8, (maxY - minY) * 0.28);
      }
      var x1 = stemEnds[0].x;
      var x2 = stemEnds[stemEnds.length - 1].x;

      var gBeam = svg('g', {});
      gBeam.appendChild(line(x1, y1, x2, y2, { w: 4.6, cap: 'butt' }));
      /* 二级符杠（十六分） */
      var minDur = Math.min.apply(null, grp.items.map(function (q) { return q.dur; }));
      var extra = minDur <= 0.125 ? 3 : (minDur <= 0.25 ? 1 : 0);
      for (var e = 0; e < extra; e++) {
        var off = (beamUp ? 1 : -1) * (6.5 + e * 6.5);
        gBeam.appendChild(line(x1, y1 + off, x2, y2 + off, { w: 4.2, cap: 'butt' }));
      }
      g.appendChild(gBeam);
    });
  }

  /* ---------------- 对外 API ---------------- */

  function renderScoreInto(container, score, opts) {
    if (!container) return { svg: null, layout: null };
    U.clear(container);
    var s = null, err = null;
    try {
      s = renderStaff(score, opts);
      container.appendChild(s);
    } catch (e) {
      err = e;
      container.appendChild(U.el('div', {
        class: 'jp-render-err',
        text: '五线谱渲染失败：' + (e && e.message ? e.message : e)
      }));
    }
    return { svg: s, layout: { bars: (score.bars || []).length }, error: err };
  }

  function highlightBar(container, barIndex) {
    if (!container) return;
    U.queryAll('[data-bar-idx]', container).forEach(function (g) {
      var idx = parseInt(g.getAttribute('data-bar-idx'), 10);
      var bg = U.query('[data-bar-bg]', g);
      if (bg) bg.setAttribute('fill', idx === barIndex ? 'rgba(77,141,255,.16)' : 'transparent');
    });
  }

  function highlightNote(container, barIndex, noteIndex) {
    if (!container) return;
    U.queryAll('[data-note-idx]', container).forEach(function (g) {
      g.classList.toggle('playing-note',
        parseInt(g.getAttribute('data-bar'), 10) === barIndex &&
        parseInt(g.getAttribute('data-note-idx'), 10) === noteIndex);
    });
  }

  function clearHighlight(container) {
    if (!container) return;
    U.queryAll('[data-bar-idx]', container).forEach(function (g) {
      var bg = U.query('[data-bar-bg]', g);
      if (bg) bg.setAttribute('fill', 'transparent');
    });
    U.queryAll('.playing-note', container).forEach(function (g) { g.classList.remove('playing-note'); });
  }

  APP.renderer = {
    renderStaff: renderStaff,
    renderScoreInto: renderScoreInto,
    highlightBar: highlightBar,
    highlightNote: highlightNote,
    clearHighlight: clearHighlight,
    yOf: yOf,
    LINE_GAP: LINE_GAP,
    TOP_LINE_Y: TOP_LINE_Y,
    STAFF_BOTTOM_Y: STAFF_BOTTOM_Y
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.renderer;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
