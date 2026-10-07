/* 读谱训练器 — 钢琴键盘可视化
 * 全局命名空间：window.APP.piano
 * 依赖：APP.util（可选）
 *
 * 用途：「调号与音阶」面板里把音阶音在键盘上点亮（如附图所示），
 * 也可以被乐器音阶表复用。纯 SVG，不依赖任何第三方库。
 *
 * 坐标约定：
 *   - 白键宽 WHITE_W、高 WHITE_H；黑键宽为白键的 0.62、高为白键的 0.62。
 *   - 只画有意义的范围（默认 A0–C8 太长，通常给 2–3 个八度即可）。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* 每个八度内白键的 12 个半音里哪些是白键（音级序号） */
  var WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];        // C D E F G A B
  var BLACK_PCS = [1, 3, 6, 8, 10];              // C# D# F# G# A#
  /* 黑键相对前一个白键的偏移（以白键宽为单位） */
  var BLACK_OFFSET = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };

  /** 某个 MIDI 是不是黑键 */
  function isBlack(midi) {
    var pc = ((midi % 12) + 12) % 12;
    return BLACK_PCS.indexOf(pc) >= 0;
  }

  /**
   * 生成钢琴键盘 SVG。
   * @param {Object} opts
   *   lowMidi      最低音（默认 60 = C4）
   *   highMidi     最高音（默认 84 = C6）
   *   whiteW       白键宽（默认 26）
   *   whiteH       白键高（默认 110）
   *   highlight    [midi, ...] 要高亮的音
   *   labels       'none' | 'c-only' | 'all'  —— 在键上写音名
   *   showFingerHint 是否在键下方留出手指编号的位置（本模块只留白，不画内容）
   * @returns {SVGElement}
   */
  function build(opts) {
    opts = opts || {};
    var low = opts.lowMidi === undefined ? 60 : opts.lowMidi;
    var high = opts.highMidi === undefined ? 84 : opts.highMidi;
    if (high < low) { var t = low; low = high; high = t; }

    var whiteW = opts.whiteW || 26;
    var whiteH = opts.whiteH || 110;
    var blackW = Math.max(8, Math.round(whiteW * 0.62));
    var blackH = Math.round(whiteH * 0.62);
    var labels = opts.labels || 'none';
    var highlight = opts.highlight || [];
    var hlSet = {};
    highlight.forEach(function (m) { hlSet[Math.round(m)] = 1; });

    /* ---- 先排出所有白键的位置 ---- */
    var whites = [];
    var x = 0;
    for (var m = low; m <= high; m++) {
      if (!isBlack(m)) {
        whites.push({ midi: m, x: x });
        x += whiteW;
      }
    }
    var width = whites.length * whiteW;
    var height = whiteH + 16;                   // 下面留一点给音名

    var root = document.createElementNS(SVGNS, 'svg');
    root.setAttribute('xmlns', SVGNS);
    root.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    root.setAttribute('width', width);
    root.setAttribute('height', height);
    root.setAttribute('data-piano', '1');
    root.style.background = '#ffffff';
    root.style.display = 'block';

    var font = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';

    /* ---- 分三趟画，保证层次正确 ----
     * 第一趟：所有白键矩形
     * 第二趟：所有黑键矩形（压在白键之上）
     * 第三趟：所有音名文字（压在最上层）
     * 这样即使某个琴键被高亮填色，它的音名也不会被后画的矩形盖住。 */

    /* 第一趟：白键 */
    whites.forEach(function (w) {
      var on = hlSet[w.midi];
      var rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('x', w.x + 0.5);
      rect.setAttribute('y', 0.5);
      rect.setAttribute('width', whiteW - 1);
      rect.setAttribute('height', whiteH);
      rect.setAttribute('rx', 2);
      rect.setAttribute('fill', on ? '#28a745' : '#ffffff');
      rect.setAttribute('stroke', '#9aa5b8');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('data-white-midi', String(w.midi));
      if (on) { rect.setAttribute('data-key-on', '1'); }
      root.appendChild(rect);
    });

    /* 第二趟：黑键（位置取前一个白键的右边界） */
    var blacks = [];
    whites.forEach(function (w) {
      var pc = ((w.midi % 12) + 12) % 12;
      /* 这个白键右边是否跟着黑键 */
      if (pc === 0 || pc === 2 || pc === 5 || pc === 7 || pc === 9) {
        var bm = w.midi + 1;
        if (bm > high) { return; }
        var bpc = ((bm % 12) + 12) % 12;
        if (BLACK_PCS.indexOf(bpc) < 0) { return; }
        blacks.push({ midi: bm, x: w.x + whiteW - blackW / 2 });
      }
    });
    blacks.forEach(function (b) {
      var on2 = hlSet[b.midi];
      var rect2 = document.createElementNS(SVGNS, 'rect');
      rect2.setAttribute('x', b.x);
      rect2.setAttribute('y', 0);
      rect2.setAttribute('width', blackW);
      rect2.setAttribute('height', blackH);
      rect2.setAttribute('rx', 2);
      rect2.setAttribute('fill', on2 ? '#1e7e34' : '#1f2430');
      rect2.setAttribute('stroke', '#1f2430');
      rect2.setAttribute('stroke-width', '1');
      rect2.setAttribute('data-black-midi', String(b.midi));
      if (on2) { rect2.setAttribute('data-key-on', '1'); }
      root.appendChild(rect2);
    });

    /* 第三趟：音名标签（放最后 = 画在最上层） */
    if (labels !== 'none') {
      whites.forEach(function (w) {
        var pc = ((w.midi % 12) + 12) % 12;
        var showLabel = (labels === 'all') || (labels === 'c-only' && pc === 0);
        if (!showLabel) { return; }
        var on3 = hlSet[w.midi];
        var t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', w.x + whiteW / 2);
        t.setAttribute('y', whiteH - 8);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', String(Math.max(8, Math.round(whiteW * 0.42))));
        t.setAttribute('font-family', font);
        /* 高亮键上文字用对比色，未高亮用灰；再给个描边，任何底色上都看得清 */
        t.setAttribute('fill', on3 ? '#ffffff' : '#6b7280');
        t.setAttribute('stroke', on3 ? 'rgba(0,0,0,.45)' : 'none');
        t.setAttribute('stroke-width', on3 ? '2.6' : '0');
        t.setAttribute('paint-order', 'stroke');
        t.setAttribute('data-key-label', '1');
        t.textContent = NOTE_NAMES[pc] + (Math.floor(w.midi / 12) - 1);
        root.appendChild(t);
      });
    }

    root._pianoLow = low;
    root._pianoHigh = high;
    root._whiteW = whiteW;
    return root;
  }

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /**
   * 根据音阶音高自动挑一个合适的显示范围（覆盖音阶 + 上下各留一点）。
   * @param {Array} pitches  Pitch 数组（APP.theory 的 Pitch 对象）
   * @returns {{lowMidi:number, highMidi:number}}
   */
  function rangeForPitches(pitches) {
    var mids = (pitches || []).map(function (p) {
      return APP.theory ? APP.theory.midiOf(p) : null;
    }).filter(function (m) { return m !== null && m !== undefined; });
    if (!mids.length) { return { lowMidi: 60, highMidi: 84 }; }
    var lo = Math.min.apply(null, mids);
    var hi = Math.max.apply(null, mids);
    /* 对齐到 C，并向上补到完整八度，看起来更自然 */
    lo = Math.floor(lo / 12) * 12;
    hi = Math.ceil((hi + 1) / 12) * 12;
    if (hi - lo < 24) { hi = lo + 24; }          // 至少两个八度
    if (hi - lo > 48) { hi = lo + 48; }          // 最多四个八度
    return { lowMidi: lo, highMidi: hi - 1 };
  }

  APP.piano = {
    build: build,
    rangeForPitches: rangeForPitches,
    isBlack: isBlack,
    NOTE_NAMES: NOTE_NAMES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.piano;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
