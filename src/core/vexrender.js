/* 读谱训练器 — VexFlow 专业渲染后端
 * 全局命名空间：window.APP.vexrender
 * 依赖：APP.util、APP.theory、全局 Vex（vendor/vexflow.js）
 *
 * 设计要点：
 *   - 这是**可选后端**：vendor/vexflow.js 没加载时全部 API 安全降级，
 *     调用方（app.js）会自动退回 APP.renderer 的自绘实现。
 *   - 输出仍是 SVG 元素，因此 APP.export 的 PNG 导出一行代码都不用改。
 *   - 小节之间用「一个 Stave 管一个 System 行」的方式排布：每行放若干小节，
 *     行宽按每小节的「音符权重」按比例分配，保证密集小节不会挤爆。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;

  /* ---------------- 可用性 ---------------- */

  function isAvailable() {
    try {
      return !!(typeof Vex !== 'undefined' && Vex.Flow && Vex.Flow.Stave && Vex.Flow.StaveNote);
    } catch (e) { return false; }
  }

  function version() {
    if (!isAvailable()) return null;
    try { return Vex.BUILD || Vex.VERSION || Vex.version || 'vexflow'; } catch (e) { return 'vexflow'; }
  }

  /* ---------------- 数据转换 ---------------- */

  /* dur（时值倒数标记）-> VexFlow 时值码 */
  function durCode(dur) {
    if (dur >= 4) return 'w';
    if (dur >= 2) return 'h';
    if (dur >= 1) return 'q';
    if (dur >= 0.5) return '8';
    if (dur >= 0.25) return '16';
    if (dur >= 0.125) return '32';
    return '64';
  }

  /* Pitch -> VexFlow 的 keys 字符串，例如 { step:'F', acc:1, oct:5 } -> 'f#/5' */
  function pitchKey(p) {
    var acc = '';
    if (p.acc === 1) acc = '#';
    else if (p.acc === -1) acc = 'b';
    else if (p.acc === 2) acc = '##';
    else if (p.acc === -2) acc = 'bb';
    return p.step.toLowerCase() + acc + '/' + p.oct;
  }

  /* 变音记号 -> VexFlow Accidental 的类型参数 */
  function accidentalType(glyph) {
    if (glyph === '#') return '#';
    if (glyph === 'b') return 'b';
    if (glyph === '##') return '##';
    if (glyph === 'bb') return 'bb';
    if (glyph === 'natural') return 'n';
    return null;
  }

  /* 调号：把 key 转成 VexFlow 的调号字符串。
   * VexFlow 只认识标准调号名（C, G, D, A, E, B, F#, C#, F, Bb, Eb, Ab, Db, Gb, Cb）。
   * 小调用关系大调的名字（fifths 相同，谱面完全一致）。
   * 见 keySpec 内的说明。 */
  function keySpec(key) {
    var k = TH.normalizeKey(key);
    /* 用五度圈直接算出「同一调号对应的标准大调名」。
     * 小调用关系大调的名字（fifths 相同，谱面完全一致）：
     *   a 小调 -> C，e 小调 -> G，d 小调 -> F，g# 小调 -> B ...
     * VexFlow 的调号表只包含标准写法，所以 D#/G#/A# 这类要换成等音写法。 */
    var SHARPS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
    var FLATS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
    var f = k.fifths;
    var name;
    if (f >= 0) name = SHARPS[Math.min(f, 7)];
    else name = FLATS[Math.min(-f, 7)];
    if (!name) name = 'C';
    return name;
  }

  /* 每个音符给一个「宽度权重」，用于按比例分配小节宽度 */
  function noteWeight(note) {
    var beats = U.beatsOf(note.dur, note.dotted);
    var w = 1 + beats * 0.55;
    if (!note.pitch) w += 0.25;                 // 休止符略宽
    if (note.pitch) {
      var pos = TH.staffPos(note.pitch, 'treble');
      if (pos < 0 || pos > 8) w += 0.5;         // 带加线的音需要更多留白
    }
    return w;
  }

  function barWeight(bar) {
    var w = 0;
    (bar.notes || []).forEach(function (n) { w += noteWeight(n); });
    return Math.max(1.6, w);
  }

  /* ---------------- 构建一个音符 ---------------- */

  function buildNote(note, clef, key, stemDirection) {
    var keys, dur = durCode(note.dur);

    if (!note.pitch) {
      /* 休止符：VexFlow 需要给一个 keys 占位 */
      keys = [clef === 'bass' ? 'd/3' : 'b/4'];
      dur += 'r';
    } else {
      keys = [pitchKey(note.pitch)];
    }

    var opts = { keys: keys, duration: dur, clef: clef };
    if (stemDirection) opts.stem_direction = stemDirection;

    var vn = new Vex.Flow.StaveNote(opts);

    if (note.dotted) {
      vn.addModifier(new Vex.Flow.Dot(), 0);
    }
    if (note.pitch) {
      var glyph = TH.accidentalGlyph(note.pitch, key);
      var type = accidentalType(glyph);
      if (type) vn.addModifier(new Vex.Flow.Accidental(type), 0);
    }
    return vn;
  }

  /* ---------------- 主渲染 ---------------- */

  /**
   * 把乐段渲染成 SVG（VexFlow 后端）。
   * @param {Object} score
   * @param {Object} opts { width, showBarNumbers, showSubText, perRow }
   * @returns {SVGElement}
   */
  function renderStaff(score, opts) {
    opts = opts || {};
    if (!isAvailable()) throw new Error('VexFlow 未加载');

    var key = TH.normalizeKey(score.key || { tonic: 0, mode: 'major' });
    var time = score.time || { num: 4, den: 4 };
    var clef = opts.clef || score.clef || 'treble';
    var totalWidth = Math.max(420, opts.width || 940);
    var bars = score.bars || [];

    /* ---- 分行：把小节按权重铺到每行，尽量填满 ---------------- */
    var perRow = opts.perRow || 0;              // 0 = 自动
    var PAD_L = 12;                             // 左留白
    var PAD_R = 12;                             // 右留白
    var usable = totalWidth - PAD_L - PAD_R;
    /* 第 1 小节要额外留出谱号+调号+拍号的位置 */
    var HEAD_ROOM = 96;

    var rows = [];
    var cur = [], curW = 0, curCap = usable - HEAD_ROOM;
    bars.forEach(function (bar, i) {
      var w = barWeight(bar);
      var cap = (rows.length === 0) ? usable - HEAD_ROOM : usable;
      if (perRow) {
        if (cur.length >= perRow) { rows.push({ bars: cur, weights: curW, first: rows.length === 0 }); cur = []; curW = 0; }
      } else if (cur.length && (curW + w > cap)) {
        rows.push({ bars: cur, weights: curW, first: rows.length === 0 });
        cur = []; curW = 0;
      }
      cur.push({ bar: bar, index: i, weight: w });
      curW += w;
      if (perRow && cur.length >= perRow) {
        rows.push({ bars: cur, weights: curW, first: rows.length === 0 });
        cur = []; curW = 0;
      }
    });
    if (cur.length) rows.push({ bars: cur, weights: curW, first: rows.length === 0 });
    if (!rows.length) rows = [{ bars: [], weights: 1, first: true }];

    /* ---- 尺寸 ---- */
    var ROW_H = 120;
    var TOP = 14;
    var height = TOP + rows.length * ROW_H + (opts.showSubText ? 20 : 8);

    var host = document.createElement('div');
    var renderer = new Vex.Flow.Renderer(host, Vex.Flow.Renderer.Backends.SVG);
    renderer.resize(Math.round(totalWidth), Math.round(height));
    var ctx = renderer.getContext();
    ctx.setFont && ctx.setFont('Arial', 10);

    /* ---- 逐行绘制 ---- */
    var barPositions = [];        // 供高亮使用：{ index, x, y, w }

    rows.forEach(function (row, rowIdx) {
      var y = TOP + rowIdx * ROW_H;
      var x0 = PAD_L;
      var totalRowW = usable;
      var headW = row.first ? HEAD_ROOM : 0;
      var bodyW = totalRowW - headW;

      /* 按权重分配每个小节的宽度 */
      var sumW = row.bars.reduce(function (a, b) { return a + b.weight; }, 0) || 1;
      var xs = [];
      var curX = x0 + headW;
      row.bars.forEach(function (b) {
        var w = Math.max(40, bodyW * (b.weight / sumW));
        xs.push({ x: curX, w: w, info: b });
        curX += w;
      });
      /* 归一化，让最后一个小节正好落到右边界 */
      if (xs.length) {
        var last = xs[xs.length - 1];
        last.w += (x0 + totalRowW) - (last.x + last.w);
      }

      /* 谱首信息（谱号/调号/拍号）只画在每行的第一个小节上 */
      var headStaveW = headW;
      if (headW > 0) {
        var head = new Vex.Flow.Stave(x0, y, headW + 4);
        head.addClef(clef);
        head.addKeySignature(keySpec(key));
        head.addTimeSignature(time.num + '/' + time.den);
        head.setContext(ctx).draw();
      }

      row.bars.forEach(function (b, bi) {
        var pos = xs[bi];
        var stave = new Vex.Flow.Stave(pos.x, y, pos.w);
        if (bi === row.bars.length - 1 && rowIdx === rows.length - 1) {
          stave.setEndBarType(Vex.Flow.Barline.type.END);
        }
        stave.setContext(ctx).draw();

        barPositions.push({ index: b.index, x: pos.x, y: y, w: pos.w });

        /* 转成 VexFlow 音符 */
        var vfNotes = [];
        var tiePairs = [];
        (b.bar.notes || []).forEach(function (n, ni) {
          vfNotes.push(buildNote(n, clef, key));
          if (n.tie && ni + 1 < b.bar.notes.length) {
            var next = b.bar.notes[ni + 1];
            if (next.pitch && n.pitch && TH.midiOf(next.pitch) === TH.midiOf(n.pitch)) {
              tiePairs.push([ni, ni + 1]);
            }
          }
        });

        if (!vfNotes.length) return;

        /* 用 tickable 总量决定 voice 容量，允许不严格对齐（生成器已保证拍数精确） */
        var totalBeats = 0;
        (b.bar.notes || []).forEach(function (n) { totalBeats += U.beatsOf(n.dur, n.dotted); });
        var voice = new Vex.Flow.Voice({
          num_beats: Math.max(1, Math.round(totalBeats * 4)) / 4,
          beat_value: 4,
          resolution: Vex.Flow.RESOLUTION
        });
        voice.setStrict(false);
        voice.setMode(Vex.Flow.Voice.Mode.SOFT);
        voice.addTickables(vfNotes);

        /* 符杠：同一拍内的八分及更短音符连起来 */
        var beams = [];
        var group = [];
        var beatCursor = 0;
        (b.bar.notes || []).forEach(function (n, ni) {
          var beats = U.beatsOf(n.dur, n.dotted);
          var beatIdx = Math.floor(beatCursor + 1e-6);
          var short = n.pitch && n.dur <= 0.5 && !n.dotted;
          if (short) {
            if (group.length && group.beat === beatIdx) group.notes.push(vfNotes[ni]);
            else {
              if (group.notes && group.notes.length > 1) beams.push(group.notes);
              group = { beat: beatIdx, notes: [vfNotes[ni]] };
            }
          } else if (group.notes && group.notes.length > 1) {
            beams.push(group.notes);
            group = [];
          } else group = [];
          beatCursor += beats;
        });
        if (group.notes && group.notes.length > 1) beams.push(group.notes);

        try {
          new Vex.Flow.Formatter().joinVoices([voice]).format([voice], pos.w - 30);
        } catch (e) {
          /* 格式化失败也不至于整页白屏：退化成不格式化直接画 */
          try { voice.setStrict(false); } catch (e2) { /* 忽略 */ }
        }
        voice.draw(ctx, stave);
        beams.forEach(function (notes) {
          try { new Vex.Flow.Beam(notes).setContext(ctx).draw(); } catch (e) { /* 忽略 */ }
        });
        tiePairs.forEach(function (pair) {
          try {
            new Vex.Flow.Tie({ first_note: vfNotes[pair[0]], last_note: vfNotes[pair[1]] }).setContext(ctx).draw();
          } catch (e) { /* 忽略 */ }
        });

        /* 谱下辅助文字（音名 / 唱名）——用普通 SVG 文本，避免依赖 VexFlow 的字体度量 */
        if (opts.showSubText) {
          var svgEl = host.querySelector('svg');
          var per = pos.w / ((b.bar.notes || []).length + 0.6);
          (b.bar.notes || []).forEach(function (n, ni) {
            if (!n.pitch) return;
            var label = '';
            if (opts.showSubText === 'name') label = TH.pitchName(n.pitch, { octave: true });
            else if (opts.showSubText === 'solfa') label = TH.solfeggio(n.pitch, key);
            else label = TH.pitchName(n.pitch, { octave: true }) + ' ' + TH.solfeggio(n.pitch, key);
            if (!label) return;
            var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', pos.x + 16 + per * (ni + 0.4));
            t.setAttribute('y', y + 118);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('font-size', '9.5');
            t.setAttribute('fill', '#6b7280');
            t.setAttribute('font-family', '"Microsoft YaHei",system-ui,sans-serif');
            t.textContent = label;
            if (svgEl) svgEl.appendChild(t);
          });
        }
      });
    });

    var svg = host.querySelector('svg');
    if (!svg) throw new Error('VexFlow 未产出 SVG');
    svg.setAttribute('viewBox', '0 0 ' + Math.round(totalWidth) + ' ' + Math.round(height));
    svg.setAttribute('width', Math.round(totalWidth));
    svg.setAttribute('height', Math.round(height));
    svg.style.background = '#ffffff';
    svg.style.display = 'block';
    svg.style.maxWidth = '100%';
    svg.style.height = 'auto';
    svg.setAttribute('data-renderer', 'vexflow');

    /* 把小节位置挂到 SVG 上，供高亮/自动滚动使用 */
    svg._barPositions = barPositions;
    return svg;
  }

  /* ---------------- 渲染进容器 ---------------- */

  function renderScoreInto(container, score, opts) {
    if (!container) return { svg: null, error: null };
    U.clear(container);
    if (!isAvailable()) {
      container.appendChild(U.el('div', {
        class: 'jp-render-err',
        text: 'VexFlow 未加载，已自动切换到内置渲染器。'
      }));
      return { svg: null, error: new Error('VexFlow 未加载') };
    }
    var svg = null, err = null;
    try {
      svg = renderStaff(score, opts);
      container.appendChild(svg);
    } catch (e) {
      err = e;
      container.appendChild(U.el('div', {
        class: 'jp-render-err',
        text: 'VexFlow 渲染失败：' + (e && e.message ? e.message : e)
      }));
    }
    return { svg: svg, error: err };
  }

  /* ---------------- 高亮 ---------------- */

  function clearHighlight(container) {
    if (!container) return;
    U.queryAll('[data-vf-bar]', container).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function highlightBar(container, barIndex) {
    if (!container) return;
    clearHighlight(container);
    var svg = container.querySelector('svg[data-renderer="vexflow"]');
    if (!svg || !svg._barPositions) return;
    var pos = null;
    svg._barPositions.forEach(function (p) { if (p.index === barIndex) pos = p; });
    if (!pos) return;
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', pos.x + 1);
    rect.setAttribute('y', pos.y - 2);
    rect.setAttribute('width', Math.max(10, pos.w - 2));
    rect.setAttribute('height', 92);
    rect.setAttribute('fill', 'rgba(77,141,255,.14)');
    rect.setAttribute('data-vf-bar', String(barIndex));
    /* 插到最前面，避免盖住音符 */
    if (svg.firstChild) svg.insertBefore(rect, svg.firstChild);
    else svg.appendChild(rect);
  }

  function highlightNote() { /* VexFlow 后端暂不做单音符高亮，避免误标 */ }

  APP.vexrender = {
    isAvailable: isAvailable,
    version: version,
    renderStaff: renderStaff,
    renderScoreInto: renderScoreInto,
    highlightBar: highlightBar,
    highlightNote: highlightNote,
    clearHighlight: clearHighlight,
    durCode: durCode,
    pitchKey: pitchKey,
    keySpec: keySpec
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.vexrender;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
