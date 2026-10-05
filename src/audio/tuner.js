/* 读谱训练器 — 调音器模块
 * 全局命名空间：window.APP.tuner
 * 依赖：APP.util（可选，有兜底实现）；APP.theory（可选，仅用于频率换算，缺失时用本地等价实现）
 * 依赖：navigator.mediaDevices.getUserMedia + AudioContext + AnalyserNode
 *
 * 算法：归一化自相关（ACF，含抛物线插值 + 次谐波/八度纠正），
 *       RMS 门限静音过滤，最近 N 次结果取中位数做时间平滑。
 */
(function (APP) {
  'use strict';

  APP = APP || (window.APP = {});

  /* ==================== 常量 ==================== */

  var MIN_FREQ = 50;          // 有效检测下限（Hz）
  var MAX_FREQ = 1200;        // 有效检测上限（Hz，口琴高音）
  var DEFAULT_RMS_GATE = 0.01; // 默认静音门限
  var STD_PITCH_MIN = 415;    // A4 基准下限
  var STD_PITCH_MAX = 466;    // A4 基准上限
  var SMOOTH_WINDOW = 5;      // 平滑窗口（最近 N 次）
  var FAST_WINDOW = 3;        // 音名刚跳变时的快速跟随窗口
  var CHANGE_SEMITONES = 0.62; // 超过该音程视为换音，加快跟随

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /* 吉他标准调弦（6 弦 → 1 弦） */
  var GUITAR_STRINGS = [
    { midi: 40, name: 'E2', label: '6 弦 E2' },
    { midi: 45, name: 'A2', label: '5 弦 A2' },
    { midi: 50, name: 'D3', label: '4 弦 D3' },
    { midi: 55, name: 'G3', label: '3 弦 G3' },
    { midi: 59, name: 'B3', label: '2 弦 B3' },
    { midi: 64, name: 'E4', label: '1 弦 E4' }
  ];

  /* 尤克里里标准调弦（4 弦 → 1 弦，re-entrant 高音 G） */
  var UKULELE_STRINGS = [
    { midi: 67, name: 'G4', label: '4 弦 G4' },
    { midi: 60, name: 'C4', label: '3 弦 C4' },
    { midi: 64, name: 'E4', label: '2 弦 E4' },
    { midi: 69, name: 'A4', label: '1 弦 A4' }
  ];

  /* 检测失败提示（中文） */
  var ERR_TEXT = {
    'NotAllowedError': '麦克风权限被拒绝。请在浏览器地址栏允许麦克风后重试。',
    'PermissionDeniedError': '麦克风权限被拒绝。请在浏览器设置中允许后重试。',
    'NotFoundError': '没有检测到可用的麦克风设备，请检查设备连接。',
    'DevicesNotFoundError': '没有检测到可用的麦克风设备，请检查设备连接。',
    'NotReadableError': '麦克风被其它程序占用，请关闭后重试。',
    'TrackStartError': '麦克风被其它程序占用，请关闭后重试。',
    'OverconstrainedError': '当前麦克风不支持所需参数（已关闭回声消除/降噪）。',
    'SecurityError': '浏览器安全策略阻止了麦克风访问。',
    'AbortError': '麦克风启动被中断，请重试。'
  };

  /* ==================== 小工具（不依赖 APP.util） ==================== */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 取工具函数：优先用 APP.util，缺失时本地兜底 */
  function utilFn(name, fallback) {
    var u = APP.util;
    return (u && typeof u[name] === 'function') ? u[name] : fallback;
  }

  var el = function (tag, attrs) {
    return utilFn('el', function (t, a) {
      var n = document.createElement(t);
      if (a) Object.keys(a).forEach(function (k) {
        if (k === 'class') n.className = a[k];
        else if (k === 'text') n.textContent = a[k];
        else if (a[k] !== null && a[k] !== undefined) n.setAttribute(k, a[k]);
      });
      return n;
    }).apply(null, arguments);
  };

  function clearNode(node) {
    utilFn('clear', function (n) { while (n && n.firstChild) n.removeChild(n.firstChild); })(node);
  }

  function toast(msg, type) {
    var u = APP.util;
    if (u && typeof u.toast === 'function') { u.toast(msg, type); return; }
    if (typeof console !== 'undefined') console.log('[调音器] ' + msg);
  }

  /* ==================== 环境检测 ==================== */

  function isSecureContextish() {
    try {
      if (typeof location === 'undefined' || !location) return false;
      var proto = String(location.protocol || '');
      if (proto === 'file:') return false;
      if (proto === 'https:') return true;
      var host = String(location.hostname || '');
      if (proto === 'http:') return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
      /* 其它协议（如 chrome-extension:）交给浏览器判断 */
      return !!(typeof window !== 'undefined' && window.isSecureContext);
    } catch (e) { return false; }
  }

  function hasGetUserMedia() {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
      return typeof navigator.mediaDevices.getUserMedia === 'function';
    } catch (e) { return false; }
  }

  function hasAudioContext() {
    try {
      return !!(typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
    } catch (e) { return false; }
  }

  function isSupported() {
    return hasGetUserMedia() && isSecureContextish() && hasAudioContext();
  }

  /* 同步判断失败原因；无原因时返回空字符串 */
  function unsupportedReason() {
    if (!hasGetUserMedia()) {
      return '当前浏览器不支持麦克风采集（navigator.mediaDevices.getUserMedia 不可用）。' +
        '请改用最新版 Chrome、Edge、Firefox 或 Safari。';
    }
    if (!isSecureContextish()) {
      var proto = '';
      try { proto = String(location.protocol || ''); } catch (e) { proto = ''; }
      if (proto === 'file:') {
        return '调音器需要麦克风权限；请通过 https 或 localhost 打开（GitHub Pages 可用），' +
          '直接双击本地文件（file://）无法使用麦克风。';
      }
      return '当前页面不是安全上下文（需要 https 或 localhost），浏览器会禁止麦克风。' +
        '请通过 https 或 localhost 打开。';
    }
    if (!hasAudioContext()) {
      return '当前浏览器不支持 Web Audio API（AudioContext 不可用），无法进行音高检测。';
    }
    return '';
  }

  /* 异步判断是否有可用麦克风设备（可选使用） */
  function probeDevices() {
    return new Promise(function (resolve) {
      try {
        if (!hasGetUserMedia() || !navigator.mediaDevices.enumerateDevices) {
          resolve({ ok: false, reason: unsupportedReason() || '无法枚举音频设备。' });
          return;
        }
        navigator.mediaDevices.enumerateDevices().then(function (list) {
          var inputs = (list || []).filter(function (d) { return d && d.kind === 'audioinput'; });
          if (!inputs.length) {
            resolve({ ok: false, reason: '没有检测到麦克风设备，请连接麦克风后重试。' });
          } else {
            resolve({ ok: true, reason: '', devices: inputs });
          }
        }, function () {
          resolve({ ok: true, reason: '' }); // 枚举失败不代表不可用，交给 getUserMedia 报错
        });
      } catch (e) {
        resolve({ ok: false, reason: '设备枚举失败：' + (e && e.message ? e.message : String(e)) });
      }
    });
  }

  /* ==================== 数学：自相关基频检测 ==================== */

  /* 抛物线顶点偏移：三点 (x-1,y0) (x,y1) (x+1,y2)，返回相对 x 的偏移（-0.5..0.5） */
  function parabolicOffset(y0, y1, y2) {
    var denom = (y0 - 2 * y1 + y2);
    if (Math.abs(denom) < 1e-12) return 0;
    var off = 0.5 * (y0 - y2) / denom;
    if (!isFinite(off)) return 0;
    return clamp(off, -0.5, 0.5);
  }

  /* 归一化自相关：返回 acf[lag]（0..1），acf[0]=1 */
  function normalizedACF(buf, minLag, maxLag) {
    var n = buf.length;
    var acf = new Float32Array(maxLag + 2);
    var lag, i, s, e, winLen, sum, sumA, sumB;
    for (lag = minLag; lag <= maxLag; lag++) {
      winLen = n - lag;
      if (winLen < 8) break;
      sum = 0; sumA = 0; sumB = 0;
      e = winLen; // 只比较同一段窗，减少幅度变化带来的误差
      for (i = 0; i < e; i++) {
        var a = buf[i], b = buf[i + lag];
        sum += a * b;
        sumA += a * a;
        sumB += b * b;
      }
      var denom = Math.sqrt(sumA * sumB);
      acf[lag] = denom > 1e-12 ? (sum / denom) : 0;
    }
    return acf;
  }

  /* 在 [lo,hi] 内找局部极大值候选（按相关值降序） */
  function peakCandidates(acf, lo, hi, limit) {
    var out = [], lag;
    var a = Math.max(2, lo), b = Math.min(hi, acf.length - 2);
    for (lag = a; lag <= b; lag++) {
      var v = acf[lag];
      if (!(v > 0)) continue;
      var prev = acf[lag - 1] || 0, next = acf[lag + 1] || 0;
      if (v >= prev && v >= next) out.push({ lag: lag, value: v });
    }
    out.sort(function (x, y) { return y.value - x.value; });
    return out.slice(0, limit || 12);
  }

  /**
   * 从时域数据检测基频。
   * 策略：取最大相关值 vmax，在「接近 vmax」的峰里选最小延迟作为基频周期
   * （纯周期信号的各次谐波峰几乎等高等值，必须靠最小延迟锁定基频），
   * 再做次谐波纠正 + 抛物线插值。
   * @returns {{freq:number, clarity:number}|null}
   */
  function detectPitch(buf, sampleRate, minFreq, maxFreq) {
    if (!buf || !buf.length) return null;
    var minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
    var maxLag = Math.min(buf.length - 8, Math.ceil(sampleRate / minFreq));
    if (maxLag <= minLag + 2) return null;

    var acf = normalizedACF(buf, minLag, maxLag);
    var cands = peakCandidates(acf, minLag, maxLag, 24);
    if (!cands.length) return null;

    var vmax = cands[0].value;
    if (vmax < 0.3) return null;  // 相关性太差，视为噪声/无声
    var nearMax = vmax * 0.94;    // 允许 6% 的相关值损失，锁定更短的周期

    /* 在合格峰（相关值接近 vmax）里取最小延迟 = 真正的基频周期 */
    var best = cands[0], pick = null, i;
    for (i = 0; i < cands.length; i++) {
      if (cands[i].value >= nearMax) {
        if (!pick || cands[i].lag < pick.lag) pick = cands[i];
      }
    }
    if (pick) best = pick;

    /* 次谐波/八度纠正：周期成 1.5~2.5 倍关系且相关值仅略优（<0.15）时不切换。
       只有更长的周期明显更相关（>0.15）才认为是真正的基频周期。 */
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      var ratio = c.lag / best.lag;
      if (ratio > 1.45 && ratio < 2.6 && c.value > best.value + 0.15 && c.lag <= maxLag - 2) {
        best = c;
        break;
      }
    }

    /* 抛物线插值提高精度 */
    var L = best.lag;
    var y0 = acf[L - 1], y1 = acf[L], y2 = acf[L + 1];
    if (y0 === undefined) y0 = y1;
    if (y2 === undefined) y2 = y1;
    var refLag = L + parabolicOffset(y0, y1, y2);
    if (!(refLag > 0)) return null;

    var freq = sampleRate / refLag;
    if (!isFinite(freq) || freq < minFreq || freq > maxFreq) {
      /* 插值越界时退回整数 lag */
      freq = sampleRate / L;
      if (!isFinite(freq) || freq < minFreq || freq > maxFreq) return null;
    }
    return { freq: freq, clarity: best.value };
  }

  /* 中位数（不修改入参） */
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* ==================== 频率 / 音名换算（不依赖 theory） ==================== */

  var theory = {
    midiToFreq: function (midi, stdPitch) { return (stdPitch || 440) * Math.pow(2, (midi - 69) / 12); },
    freqToMidiFloat: function (freq, stdPitch) { return 69 + 12 * Math.log(freq / (stdPitch || 440)) / Math.LN2; },
    centsBetween: function (freq, targetFreq) { return 1200 * Math.log(freq / targetFreq) / Math.LN2; }
  };

  /* 换算优先走 APP.theory，其次本地实现（stdPitch 与 440 不同时用半音偏移补偿） */
  function midiToFreq(midi, stdPitch) {
    var T = APP.theory;
    if (T && typeof T.midiToFreq === 'function') {
      try { return T.midiToFreq(midi) * (stdPitch / 440); } catch (e) { /* 落到兜底 */ }
    }
    return theory.midiToFreq(midi, stdPitch);
  }

  function freqToMidiFloat(freq, stdPitch) {
    var T = APP.theory;
    if (T && typeof T.freqToMidiFloat === 'function') {
      try { return T.freqToMidiFloat(freq * (440 / stdPitch)); } catch (e) { /* 落到兜底 */ }
    }
    return theory.freqToMidiFloat(freq, stdPitch);
  }

  function centsBetween(freq, targetFreq) {
    var T = APP.theory;
    if (T && typeof T.centsBetween === 'function') {
      try { return T.centsBetween(freq, targetFreq); } catch (e) { /* 落到兜底 */ }
    }
    return theory.centsBetween(freq, targetFreq);
  }

  /* midi -> 音名/八度（科学音高记号，C4 = 中央 C） */
  function noteNameOf(midi) {
    var m = ((midi % 12) + 12) % 12;
    var oct = Math.floor(midi / 12) - 1;
    return { note: NOTE_NAMES[m], octave: oct, name: NOTE_NAMES[m] + oct };
  }

  /* 频率 -> 检测结果对象 d */
  function makeDetection(freq, stdPitch) {
    var midiFloat = freqToMidiFloat(freq, stdPitch);
    var midi = Math.round(midiFloat);
    var info = noteNameOf(midi);
    var target = midiToFreq(midi, stdPitch);
    var cents = centsBetween(freq, target);
    /* 兜底：极端情况下 cents 越界则重新归到最近半音 */
    if (!isFinite(cents) || cents < -50 || cents > 50) {
      cents = ((cents % 100) + 150) % 100 - 50;
    }
    return {
      freq: freq,
      midiFloat: midiFloat,
      midi: midi,
      cents: cents,
      note: info.note,
      octave: info.octave,
      name: info.name
    };
  }

  /* ==================== 表盘绘制（Canvas 半圆刻度） ==================== */

  var DIAL_VB_W = 200;
  var DIAL_VB_H = 132;
  var DIAL_CX = 100;
  var DIAL_CY = 100;
  var DIAL_R = 78;
  var SWEEP_MIN = Math.PI * 0.95;   // 180° - 9°（左侧起点，对应 -50 cents）
  var SWEEP_MAX = Math.PI * 0.05;   // 9°（右侧终点，对应 +50 cents）

  /* cents(-50..+50) -> 弧度：-50 在左侧 171°，+50 在右侧 9°（屏幕坐标 y 向下） */
  function centsToAngle(cents) {
    var t = (clamp(cents, -50, 50) + 50) / 100;
    return SWEEP_MIN + (SWEEP_MAX - SWEEP_MIN) * t;
  }

  function drawDial(ctx, size, opts) {
    var w = size.w, h = size.h;
    ctx.clearRect(0, 0, w, h);
    ctx.save();

    /* 等比缩放并居中（小尺寸下不会溢出） */
    var pad = 4;
    var scale = Math.min((w - pad * 2) / DIAL_VB_W, (h - pad * 2 - 10) / DIAL_VB_H);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    ctx.translate((w - DIAL_VB_W * scale) / 2, (h - DIAL_VB_H * scale) / 2);
    ctx.scale(scale, scale);

    var ang = centsToAngle;

    /* 背景弧（-50..-5 / +5..+50 用暖色，安全区用绿色） */
    function stroke(c0, c1, color, lineWidth, radius) {
      ctx.beginPath();
      ctx.arc(DIAL_CX, DIAL_CY, radius, ang(c0), ang(c1), true);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
    stroke(-50, -15, '#94a3b8', 8, DIAL_R);
    stroke(-15, -5, '#f0b429', 8, DIAL_R);
    stroke(-5, 5, '#22c55e', 10, DIAL_R);
    stroke(5, 15, '#f0b429', 8, DIAL_R);
    stroke(15, 50, '#94a3b8', 8, DIAL_R);

    /* 刻度 */
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var c = -50; c <= 50; c += 10) {
      var a = ang(c);
      var major = (c % 20 === 0);
      var r1 = DIAL_R - 12, r2 = DIAL_R - (major ? 20 : 17);
      ctx.beginPath();
      ctx.moveTo(DIAL_CX + Math.cos(a) * r1, DIAL_CY - Math.sin(a) * r1);
      ctx.lineTo(DIAL_CX + Math.cos(a) * r2, DIAL_CY - Math.sin(a) * r2);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
      if (major) {
        var lr = DIAL_R - 29;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText((c > 0 ? '+' : '') + c, DIAL_CX + Math.cos(a) * lr, DIAL_CY - Math.sin(a) * lr);
      }
    }

    /* 指针 */
    var na = ang(opts.cents);
    var len = DIAL_R - 24;
    var tipX = DIAL_CX + Math.cos(na) * len;
    var tipY = DIAL_CY - Math.sin(na) * len;
    ctx.beginPath();
    ctx.moveTo(DIAL_CX, DIAL_CY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = opts.inTune ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    /* 圆心 */
    ctx.beginPath();
    ctx.arc(DIAL_CX, DIAL_CY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#334155';
    ctx.fill();

    /* 底部文字：方向提示 */
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = opts.inTune ? '#22c55e' : '#64748b';
    ctx.fillText(opts.hint || '', DIAL_CX, DIAL_CY - 26);

    ctx.restore();

    /* 电平条（独立于缩放，画在底部） */
    var barH = 6;
    var barY = h - barH - 2;
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.fillRect(6, barY, w - 12, barH);
    var lv = clamp(opts.level || 0, 0, 1);
    ctx.fillStyle = lv >= (opts.gate || 0) ? '#22c55e' : '#94a3b8';
    ctx.fillRect(6, barY, (w - 12) * lv, barH);
    /* 门限标记 */
    var gx = 6 + (w - 12) * clamp(opts.gate || 0, 0, 1);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(gx - 1, barY - 2, 2, barH + 4);
  }

  /* ==================== 会话（open 返回） ==================== */

  function open(container, opts) {
    opts = opts || {};

    /* 解析容器 */
    var root = container;
    if (typeof container === 'string') {
      try { root = document.querySelector(container); } catch (e) { root = null; }
    }
    if (!root || !root.nodeType) {
      if (typeof console !== 'undefined') console.warn('[调音器] open() 需要一个有效的容器元素');
    }

    var state = {
      running: false,
      starting: false,
      closed: false,
      mode: normalMode(opts.mode),
      stdPitch: clamp(num(opts.stdPitch, 440), STD_PITCH_MIN, STD_PITCH_MAX),
      gate: clamp(num(opts.threshold, DEFAULT_RMS_GATE), 0.001, 0.5),
      onDetection: typeof opts.onDetection === 'function' ? opts.onDetection : null,
      onLevel: typeof opts.onLevel === 'function' ? opts.onLevel : null,
      selectedString: -1,
      lastDetection: null,
      lastNote: null,
      smooth: [],
      level: 0,
      levelSmooth: 0,
      displayCents: 0,
      targetCents: 0,
      hasSignal: false,
      hint: '—'
    };

    var audioCtx = null;
    var stream = null;
    var sourceNode = null;
    var analyser = null;
    var timeBuf = null;
    var detectTimer = 0;
    var rafId = 0;
    var lastFrame = 0;
    var refNodes = [];
    var els = {};
    var supported = isSupported();

    function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
    function normalMode(m) { return (m === 'guitar' || m === 'ukulele') ? m : 'chromatic'; }

    /* ---------------- UI 构建 ---------------- */

    function buildUnsupported() {
      var card = el('div', { class: 'tuner-wrap tuner-unsupported' },
        el('div', { class: 'card tuner-card' },
          el('div', { class: 'card-title', text: '调音器不可用' }),
          el('p', { class: 'hint', text: unsupportedReason() }),
          el('p', { class: 'hint', text: '建议：使用最新版 Chrome / Edge / Firefox，通过 https 或 localhost 打开本页；GitHub Pages 部署可以直接使用。' }),
          el('p', { class: 'hint', text: '仍然可以手动调音：用「参考音」按钮或乐器对照表定音。' })
        )
      );
      return card;
    }

    function buildUI() {
      var wrap = el('div', { class: 'tuner-wrap' });

      /* 顶部：标题 + 状态 */
      var head = el('div', { class: 'tuner-head' },
        el('div', { class: 'tuner-title', text: '调音器' }),
        el('span', { class: 'tuner-status is-off', text: '已停止' })
      );
      els.status = head.querySelector('.tuner-status');

      /* 表盘 */
      var dialBox = el('div', { class: 'tuner-dial' });
      els.canvas = el('canvas', { class: 'tuner-canvas', width: 600, height: 396 });
      dialBox.appendChild(els.canvas);

      /* 读数 */
      var readout = el('div', { class: 'tuner-readout' },
        el('div', { class: 'tuner-note', text: '--' }),
        el('div', { class: 'tuner-sub' },
          el('span', { class: 'tuner-freq', text: '-- Hz' }),
          el('span', { class: 'tuner-sep', text: '·' }),
          el('span', { class: 'tuner-cents', text: '-- cents' })
        ),
        el('div', { class: 'tuner-dir', text: '点击「开始」并对着麦克风演奏' })
      );
      els.note = readout.querySelector('.tuner-note');
      els.freq = readout.querySelector('.tuner-freq');
      els.cents = readout.querySelector('.tuner-cents');
      els.dir = readout.querySelector('.tuner-dir');

      /* 目标弦 */
      var strings = el('div', { class: 'tuner-strings tuner-hidden' });
      els.strings = strings;

      /* 控件 */
      var controls = el('div', { class: 'tuner-controls' });

      /* 模式切换 */
      var modeRow = el('div', { class: 'tuner-row' },
        el('span', { class: 'tuner-row-label', text: '模式' })
      );
      var modeChips = el('div', { class: 'chip-row tuner-chip-row' });
      [['chromatic', '半音阶'], ['guitar', '吉他'], ['ukulele', '尤克里里']].forEach(function (m) {
        var chip = el('button', {
          class: 'chip' + (state.mode === m[0] ? ' active' : ''),
          type: 'button',
          text: m[1],
          'data-mode': m[0],
          on: { click: function () { setMode(m[0]); } }
        });
        modeChips.appendChild(chip);
      });
      els.modeChips = modeChips;
      modeRow.appendChild(modeChips);
      controls.appendChild(modeRow);

      /* 麦克风开关 + 参考音 */
      var btnRow = el('div', { class: 'tuner-row tuner-actions' });
      els.micBtn = el('button', {
        class: 'btn primary tuner-mic', type: 'button', text: '开始检测',
        on: { click: function () { toggleMic(); } }
      });
      els.refBtn = el('button', {
        class: 'btn ghost tuner-ref', type: 'button', text: '参考音：--',
        on: { click: function () { playReference(); } }
      });
      btnRow.appendChild(els.micBtn);
      btnRow.appendChild(els.refBtn);
      controls.appendChild(btnRow);

      /* A4 基准 */
      var stdRow = el('div', { class: 'tuner-row' },
        el('span', { class: 'tuner-row-label', text: 'A4 基准' })
      );
      els.stdSlider = el('input', {
        class: 'tuner-slider', type: 'range', min: STD_PITCH_MIN, max: STD_PITCH_MAX,
        step: 1, value: state.stdPitch
      });
      els.stdVal = el('span', { class: 'tuner-val', text: state.stdPitch + ' Hz' });
      els.stdSlider.addEventListener('input', function () {
        state.stdPitch = clamp(num(els.stdSlider.value, 440), STD_PITCH_MIN, STD_PITCH_MAX);
        els.stdVal.textContent = state.stdPitch + ' Hz';
        resetSmooth();
      });
      stdRow.appendChild(els.stdSlider);
      stdRow.appendChild(els.stdVal);
      controls.appendChild(stdRow);

      /* 灵敏度门限 */
      var gateRow = el('div', { class: 'tuner-row' },
        el('span', { class: 'tuner-row-label', text: '灵敏度门限' })
      );
      els.gateSlider = el('input', {
        class: 'tuner-slider', type: 'range', min: 1, max: 200,
        step: 1, value: Math.round(state.gate * 1000)
      });
      els.gateVal = el('span', { class: 'tuner-val', text: state.gate.toFixed(3) });
      els.gateSlider.addEventListener('input', function () {
        state.gate = clamp(num(els.gateSlider.value, 10) / 1000, 0.001, 0.5);
        els.gateVal.textContent = state.gate.toFixed(3);
      });
      gateRow.appendChild(els.gateSlider);
      gateRow.appendChild(els.gateVal);
      controls.appendChild(gateRow);

      els.hint = el('div', { class: 'hint tuner-hint', text: '提示：环境越安静越准；先弹响单根弦，等指针稳定。' });

      wrap.appendChild(head);
      wrap.appendChild(dialBox);
      wrap.appendChild(readout);
      wrap.appendChild(strings);
      wrap.appendChild(controls);
      wrap.appendChild(els.hint);
      return wrap;
    }

    /* ---------------- 目标弦 ---------------- */

    function stringsOfMode() {
      if (state.mode === 'guitar') return GUITAR_STRINGS;
      if (state.mode === 'ukulele') return UKULELE_STRINGS;
      return null;
    }

    function renderStrings() {
      var list = stringsOfMode();
      if (!els.strings) return;
      clearNode(els.strings);
      if (!list) { els.strings.classList.add('tuner-hidden'); return; }
      els.strings.classList.remove('tuner-hidden');
      list.forEach(function (s, i) {
        var btn = el('button', {
          class: 'chip tuner-str' + (state.selectedString === i ? ' active' : ''),
          type: 'button',
          text: s.name,
          title: s.label,
          on: { click: function () { selectString(i, true); } }
        });
        els.strings.appendChild(btn);
      });
      updateRefLabel();
    }

    function selectString(index, play) {
      var list = stringsOfMode();
      if (!list || index < 0 || index >= list.length) return;
      state.selectedString = index;
      if (els.strings) {
        var kids = els.strings.children;
        for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('active', i === index);
      }
      updateRefLabel();
      if (play) playReference();
    }

    function updateRefLabel() {
      if (!els.refBtn) return;
      var list = stringsOfMode();
      var s = list ? list[state.selectedString] : null;
      els.refBtn.textContent = s ? ('参考音：' + s.name) : '参考音：A4';
    }

    /* 高亮最接近当前检测音的弦（自动跟随，不播放） */
    function autoHighlightString(d) {
      var list = stringsOfMode();
      if (!list || !d) return;
      var best = -1, bestDist = Infinity;
      for (var i = 0; i < list.length; i++) {
        var dist = Math.abs(list[i].midi - d.midiFloat);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      /* 距离超过 3 个半音就不高亮 */
      if (bestDist > 3) best = -1;
      if (best !== state.selectedString) {
        state.selectedString = best;
        if (els.strings) {
          var kids = els.strings.children;
          for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('active', k === best);
        }
        updateRefLabel();
      }
    }

    /* ---------------- 参考音播放 ---------------- */

    function playReference() {
      if (state.closed) return;
      var list = stringsOfMode();
      var midi = list && list[state.selectedString] ? list[state.selectedString].midi : 69; // 默认 A4
      var freq = midiToFreq(midi, state.stdPitch);

      var eng = APP.engine;
      if (eng && typeof eng.playNote === 'function') {
        try { eng.playNote(midi, 1.6, 'sine', 0.7); return; } catch (e) { /* 落到自建振荡器 */ }
      }
      playFallbackTone(freq);
    }

    function playFallbackTone(freq) {
      try {
        var ctx = ensureCtx();
        if (!ctx) { toast('当前环境无法播放参考音', 'warn'); return; }
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        var now = ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
        gain.gain.setValueAtTime(0.22, now + 1.1);
        gain.gain.linearRampToValueAtTime(0, now + 1.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.55);
        refNodes.push({ osc: osc, gain: gain });
        osc.onended = function () {
          try { osc.disconnect(); gain.disconnect(); } catch (e) { /* 忽略 */ }
          refNodes = refNodes.filter(function (n) { return n.osc !== osc; });
        };
      } catch (e) {
        toast('播放参考音失败：' + (e && e.message ? e.message : String(e)), 'err');
      }
    }

    function stopRefNodes() {
      refNodes.slice().forEach(function (n) {
        try { n.osc.stop(); } catch (e) { /* 忽略 */ }
        try { n.osc.disconnect(); n.gain.disconnect(); } catch (e) { /* 忽略 */ }
      });
      refNodes = [];
    }

    /* ---------------- 音频上下文 / 采集 ---------------- */

    function Ctor() {
      if (typeof window === 'undefined') return null;
      return window.AudioContext || window.webkitAudioContext || null;
    }

    function ensureCtx() {
      /* 已关闭的 AudioContext 不可复用，需要重建 */
      if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
      var C = Ctor();
      if (!C) return null;
      try {
        audioCtx = new C();
      } catch (e) {
        audioCtx = null;
        return null;
      }
      return audioCtx;
    }

    function getUserMedia(constraints) {
      var md = navigator.mediaDevices;
      return new Promise(function (resolve, reject) {
        var ret;
        try { ret = md.getUserMedia(constraints); } catch (e) { reject(e); return; }
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
        else resolve(ret);
      });
    }

    function start() {
      if (state.closed || state.starting) return Promise.resolve(false);
      if (state.running) return Promise.resolve(true);

      var reason = unsupportedReason();
      if (reason) {
        setStatus('error', reason);
        state.hint = reason;
        if (els.dir) els.dir.textContent = reason;
        return Promise.resolve(false);
      }

      state.starting = true;
      setStatus('pending', '正在请求麦克风…');

      var ctx = ensureCtx();
      if (!ctx) {
        state.starting = false;
        var msg = '当前环境不支持 Web Audio API。';
        setStatus('error', msg);
        if (els.dir) els.dir.textContent = msg;
        return Promise.resolve(false);
      }

      return getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      }).then(function (s) {
        stream = s;
        if (state.closed) { releaseStream(); state.starting = false; return false; }

        try {
          sourceNode = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 4096;
          analyser.smoothingTimeConstant = 0;
          sourceNode.connect(analyser);
        } catch (e) {
          state.starting = false;
          releaseStream();
          setStatus('error', '音频图创建失败：' + (e && e.message ? e.message : String(e)));
          return false;
        }

        state.running = true;
        state.starting = false;
        setStatus('running', '检测中');
        if (els.micBtn) els.micBtn.textContent = '停止检测';
        resetSmooth();

        /* 用户手势：恢复被挂起的上下文 */
        if (ctx.state === 'suspended' && ctx.resume) {
          try { ctx.resume(); } catch (e) { /* 忽略 */ }
        }

        startDetectLoop();
        startAnimLoop();
        return true;
      }, function (err) {
        state.starting = false;
        var name = (err && (err.name || err.code)) || '';
        var msg = ERR_TEXT[name] || ('麦克风启动失败：' + (err && err.message ? err.message : '未知错误'));
        setStatus('error', msg);
        if (els.dir) els.dir.textContent = msg;
        return false;
      });
    }

    function stop() {
      if (!state.running && !state.starting) {
        /* 幂等：仍然清理可能残留的资源 */
        releaseStream();
        stopLoops();
        return;
      }
      stopLoops();
      releaseStream();
      state.running = false;
      state.starting = false;
      state.level = 0;
      state.levelSmooth = 0;
      state.hasSignal = false;
      resetSmooth();
      if (els.micBtn) els.micBtn.textContent = '开始检测';
      if (state.closed) return;
      setStatus('off', '已停止');
      if (els.cents) els.cents.textContent = '-- cents';
      if (els.freq) els.freq.textContent = '-- Hz';
      if (els.note) els.note.textContent = '--';
      if (els.dir) els.dir.textContent = '点击「开始检测」并对着麦克风演奏';
      state.hint = '已停止';
    }

    function close() {
      if (state.closed) return;
      state.closed = true;
      stopLoops();
      releaseStream();
      stopRefNodes();
      state.running = false;
      state.starting = false;
      closeCtx();
      if (root && root.nodeType) clearNode(root);
      els = {};
    }

    function releaseStream() {
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch (e) { /* 忽略 */ }
        sourceNode = null;
      }
      if (analyser) {
        try { analyser.disconnect(); } catch (e) { /* 忽略 */ }
        analyser = null;
      }
      if (stream) {
        try {
          var tracks = stream.getTracks ? stream.getTracks() : [];
          tracks.forEach(function (t) { try { t.stop(); } catch (e) { /* 忽略 */ } });
        } catch (e) { /* 忽略 */ }
        stream = null;
      }
      timeBuf = null;
    }

    function closeCtx() {
      if (!audioCtx) return;
      var ctx = audioCtx;
      audioCtx = null;
      try {
        if (ctx.state !== 'closed' && ctx.close) {
          var p = ctx.close();
          if (p && typeof p.catch === 'function') p.catch(function () { /* 忽略 */ });
        }
      } catch (e) { /* 忽略 */ }
    }

    function stopLoops() {
      if (detectTimer) { clearInterval(detectTimer); detectTimer = 0; }
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    /* ---------------- 检测循环 ---------------- */

    function startDetectLoop() {
      if (detectTimer) return;
      detectTimer = setInterval(tick, 50);
    }

    function tick() {
      if (!state.running || state.closed || !analyser || !audioCtx) return;
      try {
        if (!timeBuf || timeBuf.length !== analyser.fftSize) {
          timeBuf = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(timeBuf);

        /* RMS 门限 */
        var sum = 0;
        for (var i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i];
        var rms = Math.sqrt(sum / timeBuf.length);
        state.level = clamp(rms * 6, 0, 1); // 显示用归一化电平
        if (state.onLevel) {
          try { state.onLevel(rms); } catch (e) { /* 忽略回调异常 */ }
        }

        if (rms < state.gate) {
          state.hasSignal = false;
          return; // 静音时不上报
        }

        var res = detectPitch(timeBuf, audioCtx.sampleRate, MIN_FREQ, MAX_FREQ);
        if (!res) { state.hasSignal = false; return; }

        smoothAndEmit(res.freq);
      } catch (e) {
        /* 检测循环内任何异常都不得中断应用 */
        if (typeof console !== 'undefined') console.warn('[调音器] 检测异常', e);
      }
    }

    function resetSmooth() {
      state.smooth = [];
      state.lastNote = null;
      state.displayCents = 0;
      state.targetCents = 0;
    }

    function smoothAndEmit(rawFreq) {
      var raw = makeDetection(rawFreq, state.stdPitch);

      /* 换音检测：与上一次音名不同则清空窗口，快速跟随 */
      if (state.lastNote && state.lastNote !== raw.name) {
        state.smooth = [];
      }

      state.smooth.push(raw.freq);
      var win = state.smooth.length > 1 && state.lastNote && state.lastNote !== raw.name ? FAST_WINDOW : SMOOTH_WINDOW;
      if (state.smooth.length > win) state.smooth.splice(0, state.smooth.length - win);

      var fFreq = state.smooth.length >= 3 ? median(state.smooth) : raw.freq;
      var d = makeDetection(fFreq, state.stdPitch);

      state.lastDetection = d;
      state.lastNote = d.name;
      state.hasSignal = true;
      state.targetCents = clamp(d.cents, -50, 50);
      state.hint = d.cents <= -5 ? '偏低 ↑ 调紧' : (d.cents >= 5 ? '偏高 ↓ 调松' : '准了 ✓');

      /* 弦自动高亮 */
      if (state.mode !== 'chromatic') autoHighlightString(d);

      /* 文本读数（限频，避免每 50ms 重排） */
      updateReadout(d);

      if (state.onDetection) {
        try { state.onDetection(d); } catch (e) { /* 忽略回调异常 */ }
      }
    }

    var lastReadout = 0;
    function updateReadout(d) {
      var now = Date.now();
      if (now - lastReadout < 80) return;
      lastReadout = now;
      if (els.note) els.note.textContent = d.name;
      if (els.freq) els.freq.textContent = d.freq.toFixed(1) + ' Hz';
      if (els.cents) els.cents.textContent = (d.cents > 0 ? '+' : '') + d.cents.toFixed(1) + ' cents';
      if (els.dir) {
        els.dir.textContent = state.hint;
        els.dir.classList.toggle('is-ok', Math.abs(d.cents) < 5);
        els.dir.classList.toggle('is-off', Math.abs(d.cents) >= 5);
      }
    }

    /* ---------------- 绘制循环（指针平滑过渡） ---------------- */

    function startAnimLoop() {
      if (rafId) return;
      lastFrame = 0;
      rafId = requestAnimationFrame(frame);
    }

    function frame(ts) {
      rafId = 0;
      if (!state.running) return;
      if (!lastFrame) lastFrame = ts;
      var dt = Math.min(64, ts - lastFrame);
      lastFrame = ts;

      /* 指数缓动，指针不突变 */
      var k = 1 - Math.pow(0.001, dt / 260);
      if (!state.hasSignal) {
        state.targetCents = state.displayCents > 0 ? 0 : 0;
        /* 无信号时缓慢回中 */
        state.displayCents += (0 - state.displayCents) * k * 0.6;
      } else {
        state.displayCents += (state.targetCents - state.displayCents) * k;
      }
      state.levelSmooth += (state.level - state.levelSmooth) * (1 - Math.pow(0.001, dt / 160));

      renderCanvas();
      rafId = requestAnimationFrame(frame);
    }

    function renderCanvas() {
      var cv = els.canvas;
      if (!cv || !cv.getContext) return;
      var ctx2d = cv.getContext('2d');
      if (!ctx2d) return;

      /* 按 DPR 适配清晰度 */
      var cssW = cv.clientWidth || 300;
      var cssH = Math.round(cssW * DIAL_VB_H / DIAL_VB_W);
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      dpr = clamp(dpr, 1, 3);
      var pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      if (cssH && cv.style && !cv.style.height) cv.style.height = cssH + 'px';

      drawDial(ctx2d, { w: pw, h: ph }, {
        cents: state.displayCents,
        level: state.levelSmooth,
        gate: clamp(state.gate * 6, 0, 1),
        inTune: state.hasSignal && Math.abs(state.lastDetection ? state.lastDetection.cents : 99) < 5,
        hint: state.hasSignal ? state.hint : ''
      });
    }

    /* ---------------- 状态 ---------------- */

    function setStatus(kind, text) {
      if (!els.status) return;
      els.status.textContent = text;
      els.status.className = 'tuner-status is-' + kind;
    }

    function setMode(mode) {
      state.mode = normalMode(mode);
      state.selectedString = -1;
      resetSmooth();
      if (els.modeChips) {
        var chips = els.modeChips.children;
        for (var i = 0; i < chips.length; i++) {
          chips[i].classList.toggle('active', chips[i].getAttribute('data-mode') === state.mode);
        }
      }
      renderStrings();
      var names = { chromatic: '半音阶', guitar: '吉他', ukulele: '尤克里里' };
      if (els.hint) {
        els.hint.textContent = state.mode === 'chromatic'
          ? '半音阶模式：显示最近的十二平均律音名，适合人声与任意乐器。'
          : '已切换到' + names[state.mode] + '调弦模式：点击音名按钮可试听该弦空弦音。';
      }
    }

    function toggleMic() {
      if (state.running) stop();
      else start();
    }

    /* ---------------- 挂载 ---------------- */

    if (root && root.nodeType) {
      clearNode(root);
      if (!supported) {
        root.appendChild(buildUnsupported());
        els = {};
      } else {
        try {
          root.appendChild(buildUI());
          renderStrings();
          setMode(state.mode);
          setStatus('off', '已停止');
          /* 首帧绘制表盘 */
          requestAnimationFrame(function () {
            if (!state.closed) renderCanvas();
          });
        } catch (e) {
          /* UI 构建失败也不能抛异常 */
          els = {};
          clearNode(root);
          root.appendChild(buildUnsupported());
        }
      }
    }

    /* ---------------- session ---------------- */

    var session = {
      start: start,
      stop: stop,
      close: close,
      isRunning: function () { return !!state.running; },
      /* 额外便利接口（契约之外，向后兼容） */
      isSupported: isSupported,
      unsupportedReason: unsupportedReason,
      setMode: setMode,
      setStdPitch: function (v) {
        state.stdPitch = clamp(num(v, 440), STD_PITCH_MIN, STD_PITCH_MAX);
        if (els.stdSlider) els.stdSlider.value = state.stdPitch;
        if (els.stdVal) els.stdVal.textContent = state.stdPitch + ' Hz';
        resetSmooth();
      },
      getStdPitch: function () { return state.stdPitch; },
      setThreshold: function (v) {
        state.gate = clamp(num(v, DEFAULT_RMS_GATE), 0.001, 0.5);
        if (els.gateSlider) els.gateSlider.value = Math.round(state.gate * 1000);
        if (els.gateVal) els.gateVal.textContent = state.gate.toFixed(3);
      },
      playReference: playReference,
      element: root,
      _private: {
        state: state,
        detectPitch: detectPitch,
        normalizedACF: normalizedACF,
        peakCandidates: peakCandidates,
        parabolicOffset: parabolicOffset,
        makeDetection: makeDetection,
        midiToFreq: midiToFreq,
        freqToMidiFloat: freqToMidiFloat,
        centsBetween: centsBetween,
        median: median
      }
    };
    return session;
  }

  /* ==================== 导出 ==================== */

  APP.tuner = {
    isSupported: isSupported,
    unsupportedReason: unsupportedReason,
    open: open,
    /* 附加：异步设备检测、常量，方便 UI 复用 */
    probeDevices: probeDevices,
    MIN_FREQ: MIN_FREQ,
    MAX_FREQ: MAX_FREQ,
    STD_PITCH_MIN: STD_PITCH_MIN,
    STD_PITCH_MAX: STD_PITCH_MAX,
    DEFAULT_RMS_GATE: DEFAULT_RMS_GATE,
    GUITAR_STRINGS: GUITAR_STRINGS,
    UKULELE_STRINGS: UKULELE_STRINGS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.tuner;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
