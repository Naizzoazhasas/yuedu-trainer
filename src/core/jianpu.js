/* 读谱训练器 — 简谱渲染
 * 全局命名空间：window.APP.jianpu
 * 依赖：APP.util、APP.theory
 *
 * 规则（首调，默认）：
 *   主音 = 1，音级 1-7；变音在数字前加 # / b；高八度数字上方加点，低八度下方加点；
 *   八分音符画一条减时线，十六分两条；延长用横线「-」；附点用「·」；休止符用 0。
 * 固定调模式：C 才是 1，其余按实际音高记。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;

  var DOT_UP = '\u0307';      // 组合上点（备用）

  /* ---------------- 纯函数 ---------------- */

  function pitchToJianpu(pitch, key, mode) {
    return TH.jianpuOf(pitch, key, mode || 'relative');
  }

  /* 一个音符的「音符主体」文本（不含减时线/延长线） */
  function nib(j, opts) {
    if (!j || j.rest) return '0';
    var acc = '';
    if (j.accidental === '#') acc = '\u266F';       // ♯
    else if (j.accidental === 'b') acc = '\u266D';  // ♭
    else if (j.accidental === '##') acc = '\u266F\u266F';
    else if (j.accidental === 'bb') acc = '\u266D\u266D';
    else if (j.accidental) acc = j.accidental;
    return acc + String(j.digit);
  }

  /* 单个音符的 HTML（数字 + 八度点 + 减时线 + 附点） */
  function noteHTML(note, key, opts) {
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

  function accGlyph(a) {
    if (a === '#') return '\u266F';
    if (a === 'b') return '\u266D';
    if (a === '##') return '\u266F\u266F';
    if (a === 'bb') return '\u266D\u266D';
    return a;
  }
  function repeat(s, n) { var o = ''; for (var i = 0; i < n; i++) o += s; return o; }

  /* ---------------- 整段 HTML 渲染 ---------------- */

  /**
   * @param {HTMLElement} container
   * @param {Object} score
   * @param {Object} opts { mode:'relative'|'fixed', showSolfa, showNoteName, showBarNumbers, showDash }
   */
  function renderInto(container, score, opts) {
    opts = opts || {};
    if (!container) return null;
    U.clear(container);
    var key = TH.normalizeKey(score.key || { tonic: 0, mode: 'major', fifths: 0 });

    var wrap = U.el('div', { class: 'jp-wrap' });
    var bars = score.bars || [];

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

  /* ---------------- 纯文本（供复制/导出） ---------------- */

  function toText(score, opts) {
    opts = opts || {};
    var key = TH.normalizeKey(score.key || { tonic: 0, mode: 'major', fifths: 0 });
    var mode = opts.mode || 'relative';
    var head = TH.keyName(key) + '  ' + score.time.num + '/' + score.time.den + '  \u266A=' + score.tempo;
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

  APP.jianpu = {
    renderInto: renderInto,
    toText: toText,
    pitchToJianpu: pitchToJianpu,
    noteHTML: noteHTML
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.jianpu;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
