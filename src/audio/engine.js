/* 读谱训练器 — 音频引擎（播放 + 节拍器）
 * 全局命名空间：window.APP.engine
 *
 * 依赖：
 *   APP.theory —— 音高 → 频率换算（midiToFreq）。本模块不自行实现任何音高换算。
 *   APP.util   —— 可选；beatsOf() 时值换算，缺失时用契约里的等价公式兜底。
 *
 * ── 调度策略（本模块最关键的一点）──
 * 所有声音都通过 Web Audio 的「预调度」发声：setInterval 每 tickMs(默认 25ms) 醒来一次，
 * 把 (currentTime, currentTime + lookaheadSec(默认 100ms)] 区间内的音符 / 节拍器咔哒
 * 一次性排进 AudioContext 的时间轴（osc.start(t) 与增益包络全部使用绝对时间）。
 * setInterval / setTimeout 只负责「唤醒调度器」，绝不直接用它们发声，
 * 因此节奏完全由音频硬件时钟决定，不受主线程卡顿影响。
 * lookaheadSec / tickMs 等参数可通过 engine.config 覆盖（自测脚本会临时放大窗口，
 * 以便在一个 tick 内把整段乐谱排完再做断言）。
 *
 * ── 其它约定 ──
 * · 播放全程只读 score（bars[].notes[]、tempo、time、clef、key），绝不修改传入对象。
 * · 时值换算：`dur` 是「时值倒数标记」，拍数（四分音符为一拍）一律走
 *   APP.util.beatsOf(dur, dotted)（契约第 1 节的权威实现：查表 {4:4,2:2,1:1,0.5:0.5,0.25:0.25}，
 *   附点再 ×1.5）。即 dur=1 四分音符 = 1 拍、dur=4 全音符 = 4 拍。
 *   本模块**不自行做除法换算**；每拍秒数 = 60/tempo。
 * · note.pitch === null（休止符）只推进时间，不发声。
 * · note.tie === true 与后一个同音高音符合并成一个长音，只触发一次起音。
 * · 没有 Web Audio / 没有 APP.theory 时全部 API 安全降级为 no-op，且不抛异常。
 */
(function (APP) {
  'use strict';

  APP = APP || (typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));

  /* ==================== 可覆盖配置 ==================== */

  var config = {
    lookaheadSec: 0.1,        // 预调度窗口（秒）：只排「未来 100ms 内」的事件
    tickMs: 25,               // 调度器轮询间隔（毫秒）
    startDelaySec: 0.05,      // 起播缓冲：第 0 拍 = currentTime + 该值 + 预备拍
    resumeDelaySec: 0.05,     // 恢复播放缓冲
    masterGain: 0.85,         // 总音量
    maxEventsPerPump: 1024,   // 单次轮询最多排多少事件（防御性上限，防止 loop 死循环）
    maxLoopIterations: 4096   // 单次轮询最多跨多少轮循环
  };

  var TIMBRES = { piano: true, sine: true, clave: true };
  var SUBS = [1, 2, 3, 4];

  /* 各音色的泛音结构：m = 相对基频倍数，g = 相对音量 */
  var HARMONICS = {
    piano: [
      { m: 1, g: 1.00, type: 'sine' },
      { m: 2, g: 0.28, type: 'sine' },
      { m: 3.01, g: 0.12, type: 'triangle' }
    ],
    sine: [
      { m: 1, g: 1.00, type: 'sine' }
    ],
    clave: [
      { m: 1, g: 1.00, type: 'triangle' },
      { m: 2.7, g: 0.35, type: 'square' }
    ]
  };

  /* ==================== 小工具 ==================== */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function normalizeTempo(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) n = 120;
    return clamp(n, 20, 400);
  }

  function normalizeTime(t) {
    t = t || {};
    var num = Math.round(Number(t.num));
    if (!isFinite(num) || num <= 0) num = 4;
    num = clamp(num, 1, 32);
    var den = Number(t.den);
    if ([1, 2, 4, 8, 16].indexOf(den) < 0) den = 4;
    return { num: num, den: den };
  }

  function normalizeSub(v) {
    var n = Math.round(Number(v));
    return SUBS.indexOf(n) >= 0 ? n : 1;
  }

  /* 拍数查表（契约第 1 节的权威实现，避开不可靠的除法） */
  var BEATS_TABLE = { '4': 4, '2': 2, '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125, '0.0625': 0.0625 };
  /* 拍号分母 -> 该分母音符相当于几拍：den=4 → 1 拍，den=8 → 0.5 拍 */
  var DEN_RECIP = { '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125 };

  /* 时值 -> 拍数；统一复用 APP.util.beatsOf（契约要求所有模块统一用它） */
  function beatsOf(dur, dotted) {
    var u = APP.util;
    if (u && typeof u.beatsOf === 'function') return u.beatsOf(dur, dotted);
    /* 兜底：与 APP.util.beatsOf 完全一致的查表实现（dur=1 四分 = 1 拍） */
    var base = BEATS_TABLE[String(dur)];
    if (base === undefined) {
      if (!dur && dur !== 0) return 0;
      base = 4 / dur;
    }
    return dotted ? base * 1.5 : base;
  }

  /* 拍号分母 -> 每单位拍数（同样查表） */
  function denRecip(den) {
    var r = DEN_RECIP[String(den)];
    return r !== undefined ? r : 4 / den;
  }

  /* midi -> 频率；严格走 APP.theory，缺依赖时返回 null（不自行换算） */
  function midiToFreq(midi) {
    var th = APP.theory;
    if (!th || typeof th.midiToFreq !== 'function') return null;
    if (midi === null || midi === undefined || midi === '') return null;
    var m = Number(midi);
    if (!isFinite(m)) return null;
    var f = th.midiToFreq(m);
    return (isFinite(f) && f > 0) ? f : null;
  }

  function getAudioContextCtor() {
    try {
      if (typeof window !== 'undefined' && window) {
        if (window.AudioContext) return window.AudioContext;
        if (window.webkitAudioContext) return window.webkitAudioContext;
      }
    } catch (e) { /* 忽略 */ }
    try {
      /* eslint-disable no-undef */
      if (typeof AudioContext !== 'undefined' && AudioContext) return AudioContext;
      if (typeof webkitAudioContext !== 'undefined' && webkitAudioContext) return webkitAudioContext;
      /* eslint-enable no-undef */
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /* ==================== AudioContext 生命周期 ==================== */

  var ctx = null;
  var master = null;
  var activeVoices = [];
  var beatWatchers = [];

  /* 测试注入用：直接接管一个 AudioContext（不传则清空） */
  function useContext(c) {
    try {
      if (ctx && ctx !== c) { /* 旧上下文交给调用方处理，这里只切引用 */ }
      ctx = c || null;
      master = null;
      activeVoices = [];
      if (ctx && typeof ctx.createGain === 'function') {
        master = ctx.createGain();
        try { master.gain.value = config.masterGain; } catch (e) { /* 忽略 */ }
        try { master.connect(ctx.destination); } catch (e) { /* 忽略 */ }
      }
    } catch (e) { master = null; }
    return ctx;
  }

  function init() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          try { var p = ctx.resume(); if (p && typeof p.catch === 'function') p.catch(function () {}); } catch (e) { /* 忽略 */ }
        }
        return ctx;
      }
      var Ctor = getAudioContextCtor();
      if (!Ctor) return null;                 // 浏览器不支持 Web Audio：安全降级
      var c = new Ctor();
      return useContext(c);
    } catch (e) {
      ctx = null; master = null;
      return null;
    }
  }

  function state() {
    if (!ctx) return 'uninitialized';
    try { return ctx.state === 'running' ? 'running' : 'suspended'; }
    catch (e) { return 'suspended'; }
  }

  function warmup() {
    return new Promise(function (resolve) {
      try {
        if (!ctx) init();
        if (!ctx) { resolve(false); return; }
        if (ctx.state === 'running') { resolve(true); return; }
        if (typeof ctx.resume !== 'function') { resolve(state() === 'running'); return; }
        var p = ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(function () { resolve(state() === 'running'); }, function () { resolve(false); });
        } else {
          resolve(state() === 'running');
        }
      } catch (e) { resolve(false); }
    });
  }

  /* 播放类 API 的统一入口：确保上下文可用；拿不到就返回 null（静默 no-op） */
  function ensure() {
    if (!ctx) init();
    if (!ctx) return null;
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        var p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* 忽略 */ }
    return ctx;
  }

  function nowTime() { return ctx ? ctx.currentTime : 0; }

  /* ==================== 音色合成 ==================== */

  function rampFromZero(param, peak, t0, attack) {
    var a = Math.max(0.001, attack);
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
  }

  function cleanupVoice(v) {
    if (!v || v.done) return;
    v.done = true;
    for (var i = 0; i < v.parts.length; i++) {
      try { v.parts[i].osc.disconnect(); } catch (e) { /* 忽略 */ }
      try { v.parts[i].gain.disconnect(); } catch (e) { /* 忽略 */ }
    }
    try { v.env.disconnect(); } catch (e) { /* 忽略 */ }
  }

  function pruneVoices() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var i = activeVoices.length - 1; i >= 0; i--) {
      var v = activeVoices[i];
      if (v.done || v.stopAt + 0.1 < t) { cleanupVoice(v); activeVoices.splice(i, 1); }
    }
  }

  /* 立即静音一批 voice（停止播放 / 暂停时用） */
  function cancelVoices(list, t) {
    if (!list || !list.length) return;
    var when = isFinite(t) ? t : nowTime();
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || v.done) continue;
      try {
        var g = v.env.gain;
        if (typeof g.cancelScheduledValues === 'function') g.cancelScheduledValues(when);
        g.setValueAtTime(g.value === undefined ? 0.0001 : g.value, when);
        g.exponentialRampToValueAtTime(0.0001, when + 0.02);
      } catch (e) { /* 忽略 */ }
      for (var k = 0; k < v.parts.length; k++) {
        try { v.parts[k].osc.stop(Math.max(when, v.when) + 0.03); } catch (e) { /* 忽略 */ }
      }
    }
  }

  /* 生成一个音。返回 voice 对象（含 env / parts / stopAt），失败返回 null。
   * when 为 AudioContext 绝对时间；省略或已过时则立即发声。 */
  function playTone(freq, durSec, timbre, velocity, when, dest, midiHint) {
    if (!ctx) return null;
    var f = Number(freq);
    if (!isFinite(f) || f <= 0) return null;
    var kind = TIMBRES[timbre] ? timbre : 'piano';

    var t0 = Number(when);
    /* 只保证有合法时间；不把「已到点」的预调度事件往后推——预调度必须保持时间轴精确，
     * 早于 currentTime 的 start() 由 AudioContext 自己按「立即发声」处理。 */
    if (!isFinite(t0)) t0 = ctx.currentTime + 0.005;

    var dur = Number(durSec);
    if (!isFinite(dur) || dur <= 0) dur = 0.3;
    dur = Math.max(0.02, dur);

    var vel = Number(velocity);
    if (!isFinite(vel)) vel = 0.8;
    vel = clamp(vel, 0, 1);

    var out = dest || master || ctx.destination;
    var env = ctx.createGain();
    try { env.gain.value = 0.0001; } catch (e) { /* 忽略 */ }
    try { env.connect(out); } catch (e) { /* 忽略 */ }

    var g = env.gain;
    var peak = vel * (kind === 'piano' ? 0.22 : (kind === 'clave' ? 0.30 : 0.26));
    var stopAt;

    if (kind === 'sine') {
      /* 纯正弦：软起音、软收尾，适合听音高 */
      var attack = 0.02, release = 0.09;
      var holdEnd = t0 + Math.max(attack, dur - release);
      var end = Math.max(holdEnd + release, t0 + dur + 0.02);
      rampFromZero(g, peak, t0, attack);
      g.setValueAtTime(peak, holdEnd);
      g.exponentialRampToValueAtTime(0.0001, end);
      g.setValueAtTime(0, end + 0.005);
      stopAt = end + 0.02;
    } else if (kind === 'clave') {
      /* 短促点击：用于节奏型试听 */
      var d = clamp(dur * 0.6, 0.04, 0.09);
      g.setValueAtTime(peak, t0);
      g.exponentialRampToValueAtTime(0.0001, t0 + d);
      g.setValueAtTime(0, t0 + d + 0.005);
      stopAt = t0 + d + 0.02;
    } else {
      /* 钢琴：快起音（琴槌感）+ 指数衰减；衰减时间随音高变化，低音更长 */
      var bass = (typeof midiHint === 'number' && isFinite(midiHint)) ? clamp((72 - midiHint) / 36, 0, 1) : 0.35;
      var decay = clamp(dur * 1.6, 0.22, 3.0) * (0.7 + bass * 1.3);
      rampFromZero(g, peak, t0, 0.005);
      g.exponentialRampToValueAtTime(0.0001, t0 + 0.005 + decay);
      g.setValueAtTime(0, t0 + decay + 0.01);
      stopAt = t0 + decay + 0.03;
    }

    var specs = HARMONICS[kind];
    var parts = [];
    var voice = { when: t0, stopAt: stopAt, env: env, parts: parts, timbre: kind, done: false };

    for (var i = 0; i < specs.length; i++) {
      var sp = specs[i];
      var hf = f * sp.m;
      if (hf > 14000) continue;                 // 超过实用高频的泛音不生成
      var osc = ctx.createOscillator();
      try { osc.type = sp.type; } catch (e) { /* 忽略 */ }
      try { osc.frequency.value = hf; } catch (e) { /* 忽略 */ }
      var hg = ctx.createGain();
      try { hg.gain.value = sp.g; } catch (e) { /* 忽略 */ }
      try { osc.connect(hg); hg.connect(env); } catch (e) { /* 忽略 */ }
      try { osc.start(t0); } catch (e) { /* 忽略 */ }
      try { osc.stop(stopAt); } catch (e) { /* 忽略 */ }
      parts.push({ osc: osc, gain: hg });
    }

    if (!parts.length) { cleanupVoice(voice); return null; }

    /* 最后一个振荡器结束时统一断开，避免节点泄漏 */
    try {
      parts[parts.length - 1].osc.onended = function () { cleanupVoice(voice); };
    } catch (e) { /* 忽略 */ }

    activeVoices.push(voice);
    if (activeVoices.length > 256) pruneVoices();
    return voice;
  }

  /* 提示音：短促正弦 */
  function beep(freq, durSec) {
    try {
      if (!ensure()) return;
      var f = Number(freq);
      if (!isFinite(f) || f <= 0) f = 880;
      var d = Number(durSec);
      if (!isFinite(d) || d <= 0) d = 0.15;
      playTone(f, clamp(d, 0.03, 4), 'sine', 0.7, ctx.currentTime + 0.005, null, null);
    } catch (e) { /* 安全降级 */ }
  }

  /* 试听单音 */
  function playNote(midi, durSec, timbre, velocity) {
    try {
      if (!ensure()) return;
      var f = midiToFreq(midi);
      if (!f) return;
      playTone(f, durSec, timbre || 'piano', velocity, ctx.currentTime + 0.005, null, Number(midi));
    } catch (e) { /* 安全降级 */ }
  }

  /* 试听和弦（同时发声） */
  function playChord(midis, durSec, timbre) {
    try {
      if (!ensure()) return;
      if (!midis || !midis.length) return;
      var when = ctx.currentTime + 0.005;
      for (var i = 0; i < midis.length; i++) {
        var f = midiToFreq(midis[i]);
        if (f) playTone(f, durSec, timbre || 'piano', 0.75, when, null, Number(midis[i]));
      }
    } catch (e) { /* 安全降级 */ }
  }

  function setVolume(v) {
    var n = Number(v);
    if (!isFinite(n)) return;
    config.masterGain = clamp(n, 0, 1.5);
    if (master && master.gain) { try { master.gain.value = config.masterGain; } catch (e) { /* 忽略 */ } }
  }

  /* 立刻停掉所有正在发声的 voice */
  function stopAll() {
    cancelVoices(activeVoices, nowTime());
    activeVoices = [];
  }

  /* ==================== 流（预调度游标） ==================== */

  /* items 需按 abs（本轮内的拍位）升序；wrapTo = 循环时回到的下标 */
  function Stream(items, wrapTo) {
    this.items = items || [];
    this.wrapTo = wrapTo || 0;
    this.i = 0;
    this.iter = 0;
  }
  Stream.prototype.reset = function () { this.i = 0; this.iter = 0; };

  function nextAbsOf(s, span) {
    if (!s || s.i >= s.items.length) return Infinity;
    return s.iter * span + s.items[s.i].abs;
  }

  /* ==================== playScore / transport ==================== */

  function Transport(score, opts) {
    this.score = score;
    this.opts = opts || {};
    this._listeners = {};
    this._state = 'idle';
    this._timer = null;
    this._voices = [];
    this._partial = null;
    this._finished = false;
    this._pausedAbs = 0;
    this._lastBar = -1;

    this._tempo = normalizeTempo(this.opts.tempo !== undefined ? this.opts.tempo : score.tempo);
    this._spb = 60 / this._tempo;
    this._timbre = TIMBRES[this.opts.timbre] ? this.opts.timbre : 'piano';
    this._loop = !!this.opts.loop;
    this._metronome = !!this.opts.metronome;

    this._build();
  }

  /* —— 只读地展开乐谱 —— */
  Transport.prototype._build = function () {
    var score = this.score || {};
    var bars = score.bars || [];
    if (!bars.length) { this._events = []; this._span = 0; this._beatsPerBar = 4; return; }

    var time = normalizeTime(score.time);
    this._time = time;
    this._pulsesPerBar = time.num;
    this._pulseBeats = denRecip(time.den);            // 一个「脉冲」等于几分音符（以四分音符为 1 拍）
    this._beatsPerBar = time.num * this._pulseBeats;  // 一小节的拍数（四分音符为 1 拍）
    this._countIn = Math.max(0, Math.round(Number(this.opts.countIn) || 0));

    var from = Math.round(Number(this.opts.startBar) || 0);
    from = clamp(from, 0, bars.length - 1);
    this._fromBar = from;

    /* 1) 逐小节累计拍位，展开成事件表（不修改 note 对象） */
    var raw = [];
    var barStarts = [];
    var t = 0;
    for (var b = 0; b < bars.length; b++) {
      barStarts[b] = t;
      var notes = (bars[b] && bars[b].notes) || [];
      var sum = 0;
      for (var n = 0; n < notes.length; n++) {
        var note = notes[n];
        var nb = beatsOf(note.dur, note.dotted);
        if (!isFinite(nb) || nb <= 0) nb = 0;
        var isRest = !note.pitch;
        var midi = isRest ? null : (typeof note.midi === 'number' && isFinite(note.midi) ? note.midi
          : (APP.theory ? APP.theory.midiOf(note.pitch) : null));
        raw.push({
          abs: t, scoreBeat: t, beats: nb, bar: b, ni: n, note: note,
          midi: midi, isRest: isRest || midi === null,
          tie: !isRest && note.tie === true
        });
        t += nb; sum += nb;
      }
      if (!notes.length) {
        /* 空小节兜底：按声明拍数或拍号推进 */
        var fallback = (typeof bars[b].beats === 'number' && bars[b].beats > 0) ? bars[b].beats : this._beatsPerBar;
        t += fallback;
      }
    }

    /* 2) 延音线合并：tie 与后一个同音高音符合成一个长音（只触发一次起音） */
    var merged = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      var last = merged.length ? merged[merged.length - 1] : null;
      if (last && last.tieOpen && !e.isRest && e.midi === last.midi) {
        last.beats += e.beats;
        last.tieOpen = e.tie;
        last.bars.push(e.bar);
        continue;
      }
      e.tieOpen = e.tie;
      e.bars = [e.bar];
      merged.push(e);
    }
    for (var j = 0; j < merged.length; j++) merged[j].idx = j;

    this._baseBeat = barStarts[from];
    this._endBeat = t;
    this._span = Math.max(0, t - this._baseBeat);
    this._events = merged;

    /* 3) 三条并行流：小节线 / 节拍器咔哒 / 音符 */
    var barsItems = [];
    for (var bb = from; bb < bars.length; bb++) barsItems.push({ abs: barStarts[bb] - this._baseBeat, bar: bb });
    this._barStream = new Stream(barsItems, 0);

    var clickItems = [];
    for (var c = -this._countIn; c < 0; c++) {
      clickItems.push({ abs: c * this._pulseBeats, accent: (c % this._pulsesPerBar) === 0, sub: 0, countIn: true });
    }
    var wrapTo = clickItems.length;
    if (this._metronome) {
      var pulseCount = Math.ceil(this._span / this._pulseBeats - 1e-9);
      for (var k = 0; k < pulseCount; k++) {
        clickItems.push({
          abs: k * this._pulseBeats,
          accent: (k % this._pulsesPerBar) === 0,
          sub: 0
        });
      }
    }
    this._clickStream = (clickItems.length && (this._metronome || wrapTo)) ? new Stream(clickItems, wrapTo) : null;
    if (this._clickStream && !this._metronome) this._clickStream.wrapTo = this._clickStream.items.length;

    var noteItems = [];
    for (var m = 0; m < this._events.length; m++) {
      if (this._events[m].bar < from) continue;
      noteItems.push({ abs: this._events[m].abs - this._baseBeat, item: this._events[m] });
    }
    this._noteStream = new Stream(noteItems, 0);

    this._tempoMap = [{ beat: 0, time: 0, spb: this._spb }];
  };

  /* —— 拍位 <-> 音频时间（变速用锚点表串联）—— */
  Transport.prototype._timeAtBeat = function (beat) {
    var map = this._tempoMap;
    if (!map || !map.length) return 0;
    for (var i = map.length - 1; i >= 0; i--) {
      if (beat >= map[i].beat - 1e-9) return map[i].time + (beat - map[i].beat) * map[i].spb;
    }
    return map[0].time + (beat - map[0].beat) * map[0].spb;
  };

  Transport.prototype._beatAtTime = function (time) {
    var map = this._tempoMap;
    if (!map || !map.length) return 0;
    for (var i = map.length - 1; i >= 0; i--) {
      if (time >= map[i].time - 1e-9) return map[i].beat + (time - map[i].time) / map[i].spb;
    }
    return map[0].beat + (time - map[0].time) / map[0].spb;
  };

  /* 下一个尚未排程的事件拍位（变速锚点落在这里） */
  Transport.prototype._horizonBeat = function () {
    if (this._state === 'paused') return this._pausedAbs;
    return Math.min(
      nextAbsOf(this._barStream, this._span),
      nextAbsOf(this._clickStream, this._span),
      nextAbsOf(this._noteStream, this._span)
    );
  };

  /* —— 预调度 —— */
  Transport.prototype._pumpStream = function (s, until, budget, onEvent) {
    if (!s) return;
    var span = this._span;
    var guard = 0;
    for (;;) {
      if (budget.n <= 0 || guard++ > config.maxLoopIterations) return;
      if (s.i >= s.items.length) {
        if (!this._loop || s.wrapTo >= s.items.length) return;
        s.i = s.wrapTo;
        s.iter++;
        continue;
      }
      var item = s.items[s.i];
      var abs = s.iter * span + item.abs;
      var t = this._timeAtBeat(abs);
      if (t >= until) return;
      budget.n--;
      onEvent(item, abs, t);
      s.i++;
    }
  };

  Transport.prototype._pump = function () {
    if (!ctx || this._state !== 'playing') return;
    if (!(this._span > 0)) { this._finish(); return; }
    var until = ctx.currentTime + config.lookaheadSec;
    var self = this;
    var budget = { n: config.maxEventsPerPump };

    /* 小节线先于本小节音符 -> onBar(bar) */
    this._pumpStream(this._barStream, until, budget, function (item) {
      if (item.bar === self._lastBar) return;
      self._lastBar = item.bar;
      self._emit('bar', item.bar);
      if (typeof self.opts.onBar === 'function') { try { self.opts.onBar(item.bar); } catch (e) { /* 忽略 */ } }
    });

    /* 节拍器咔哒 */
    if (this._clickStream) {
      this._pumpStream(this._clickStream, until, budget, function (item, abs, t) {
        self._scheduleClick(t, item.accent, false);
      });
    }

    /* 音符 */
    this._pumpStream(this._noteStream, until, budget, function (item, abs, t) {
      self._scheduleNote(item.item, t);
    });

    pruneVoices();

    /* 结束判定：非循环且所有流都排完，且已经到了乐段末尾 */
    if (!this._loop && this._allDone() && ctx.currentTime >= this._timeAtBeat(this._span) - 0.0005) {
      this._finish();
    }
  };

  Transport.prototype._allDone = function () {
    var s = [this._barStream, this._clickStream, this._noteStream];
    for (var i = 0; i < s.length; i++) if (s[i] && s[i].i < s[i].items.length) return false;
    return true;
  };

  /* 排一个咔哒声（重音 1000Hz / 弱拍 800Hz / 细分更轻） */
  Transport.prototype._scheduleClick = function (t, accent, isSub) {
    var f = accent ? 1000 : 800;
    var vel = accent ? 0.9 : (isSub ? 0.35 : 0.6);
    var v = playTone(f, 0.05, 'clave', vel, t, null, null);
    if (v) this._voices.push(v);
    pingBeat(accent ? 1 : 2);
  };

  /* 排一个音符（休止符只回调不发声；恢复播放时用剩余时值补一个长音） */
  Transport.prototype._scheduleNote = function (item, t) {
    var when = t;
    var beats = item.beats;
    if (this._partial && this._partial.iter === this._noteStream.iter && this._partial.index === this._noteStream.i) {
      when = this._partial.when;
      beats = this._partial.beats;
      this._partial = null;
    }

    if (!item.isRest) {
      var f = midiToFreq(item.midi);
      if (f) {
        var v = playTone(f, beats * this._spb, this._timbre, 0.85, when, null, item.midi);
        if (v) this._voices.push(v);
        pingBeat(3);
      }
    }

    var info = {
      index: item.ni,          // 该音符在小节内的序号（0 基）
      bar: item.bar,           // 小节序号（0 基，与 score.bars 一致）
      note: item.note,         // 原始 Note 对象（只读）
      midi: item.midi,
      isRest: item.isRest,
      beats: beats,            // 本次实际发声的拍数（延音线合并后的值）
      startBeat: item.scoreBeat,
      when: when,              // 音频时钟绝对时间
      timbre: this._timbre
    };
    this._emit('note', item.idx, item.bar, item.note, info);
    if (typeof this.opts.onNote === 'function') {
      try { this.opts.onNote(item.idx, item.bar, item.note, info); } catch (e) { /* 忽略 */ }
    }
  };

  /* —— 游标定位（起始 / 恢复）—— */
  Transport.prototype._seedStreams = function (abs0) {
    var span = this._span, loop = this._loop;
    var streams = [this._barStream, this._clickStream, this._noteStream];
    for (var s = 0; s < streams.length; s++) {
      var st = streams[s];
      if (!st) continue;
      st.i = 0; st.iter = 0;
      if (loop && span > 0) st.iter = Math.max(0, Math.floor(abs0 / span));
      var rel = abs0 - st.iter * span;
      while (st.i < st.items.length && st.items[st.i].abs < rel - 1e-9) st.i++;
    }
    this._lastBar = -1;
    this._partial = null;

    /* 若恢复点落在某个音的中间，把它余下的时值补成一个音 */
    var ns = this._noteStream;
    if (ns && abs0 > 1e-9 && ns.i > 0) {
      var prev = ns.items[ns.i - 1];
      var prevAbs = ns.iter * span + prev.abs;
      var covered = prevAbs + prev.item.beats;
      if (!prev.item.isRest && prevAbs < abs0 - 1e-9 && covered > abs0 + 1e-9) {
        ns.i = ns.i - 1;
        this._partial = { iter: ns.iter, index: ns.i, beats: covered - abs0, when: 0 };
      }
    }
  };

  Transport.prototype._startTimer = function () {
    var self = this;
    this._stopTimer();
    this._timer = setInterval(function () { try { self._pump(); } catch (e) { /* 忽略 */ } }, config.tickMs);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  };

  Transport.prototype._stopTimer = function () {
    if (this._timer) {
      try { clearInterval(this._timer); } catch (e) { /* 忽略 */ }
      this._timer = null;
    }
  };

  Transport.prototype._play = function () {
    var c = ensure();
    if (!c) { this._state = 'idle'; return this; }
    /* 第 0 拍的时间 = currentTime + 起播缓冲 + 预备拍时长 */
    this._tempoMap = [{
      beat: 0,
      time: c.currentTime + config.startDelaySec + this._countIn * this._pulseBeats * this._spb,
      spb: this._spb
    }];
    /* 起点是「预备拍的第一拍」（负数拍），这样 countIn 的咔哒不会被 seek 跳过 */
    this._seedStreams(-this._countIn * this._pulseBeats);
    this._state = 'playing';
    this._startTimer();
    this._pump();
    return this;
  };

  /* —— 公开 transport API —— */

  Transport.prototype.stop = function () {
    try {
      this._stopTimer();
      this._state = 'stopped';
      cancelVoices(this._voices, nowTime());
      this._voices = [];
      this._emit('stop');
    } catch (e) { /* 忽略 */ }
    return this;
  };

  Transport.prototype.pause = function () {
    try {
      if (this._state !== 'playing' || !ctx) return this;
      var now = ctx.currentTime;
      var b = this._beatAtTime(now);
      this._pausedAbs = Math.max(-this._countIn * this._pulseBeats, b);
      this._state = 'paused';
      this._stopTimer();
      cancelVoices(this._voices, now);
      this._voices = [];
      this._emit('pause', this._pausedAbs);
    } catch (e) { /* 忽略 */ }
    return this;
  };

  Transport.prototype.resume = function () {
    try {
      if (this._state !== 'paused') return this;
      var c = ensure();
      if (!c) { this._state = 'stopped'; return this; }
      var abs0 = this._pausedAbs;
      var t0 = c.currentTime + config.resumeDelaySec;
      this._tempoMap = [{ beat: abs0, time: t0, spb: this._spb }];
      this._seedStreams(abs0);
      if (this._partial) this._partial.when = t0;
      this._finished = false;
      this._state = 'playing';
      this._startTimer();
      this._pump();
      this._emit('resume', abs0);
    } catch (e) { /* 忽略 */ }
    return this;
  };

  /* 变速：已排入的音符自然结束；后续音符从「排程地平线」起按新速度排布 */
  Transport.prototype.setTempo = function (bpm) {
    try {
      var v = normalizeTempo(bpm);
      if (!ctx || this._state !== 'playing') { this._tempo = v; this._spb = 60 / v; return this; }
      if (v === this._tempo) return this;
      var h = this._horizonBeat();
      if (isFinite(h)) {
        var t = this._timeAtBeat(h);
        this._tempoMap.push({ beat: h, time: t, spb: 60 / v });
      }
      this._tempo = v;
      this._spb = 60 / v;
    } catch (e) { /* 忽略 */ }
    return this;
  };

  Transport.prototype.on = function (evt, fn) {
    if (typeof fn !== 'function') return function () {};
    var self = this;
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    return function () {
      var a = self._listeners[evt];
      if (!a) return;
      var i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  };

  Transport.prototype._emit = function (evt) {
    var fns = this._listeners[evt];
    if (!fns || !fns.length) return;
    var args = Array.prototype.slice.call(arguments, 1);
    var copy = fns.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i].apply(null, args); } catch (e) { /* 忽略 */ }
    }
  };

  Transport.prototype._finish = function () {
    if (this._finished) return;
    this._finished = true;
    this._state = 'stopped';
    this._stopTimer();
    this._emit('end');
    if (typeof this.opts.onEnd === 'function') { try { this.opts.onEnd(); } catch (e) { /* 忽略 */ } }
  };

  Transport.prototype.state = function () { return this._state; };
  Transport.prototype.isPlaying = function () { return this._state === 'playing'; };
  Transport.prototype.tempo = function () { return this._tempo; };
  Transport.prototype.duration = function () { return this._span * this._spb; };
  Transport.prototype.position = function () {
    var t = nowTime();
    var beat = this._beatAtTime(t);
    var rel = this._span > 0 ? ((beat % this._span) + this._span) % this._span : 0;
    var bar = this._fromBar;
    if (this._beatsPerBar > 0) bar += Math.floor(rel / this._beatsPerBar);
    return { beat: beat, bar: bar, seconds: Math.max(0, t - this._timeAtBeat(-this._countIn * this._pulseBeats)) };
  };

  function noopTransport() {
    var noop = function () { return api; };
    var api = {
      stop: noop, pause: noop, resume: noop, setTempo: noop,
      on: function () { return function () {}; },
      state: function () { return 'idle'; },
      isPlaying: function () { return false; },
      tempo: function () { return 120; },
      duration: function () { return 0; },
      position: function () { return { beat: 0, bar: 0, seconds: 0 }; },
      _pump: function () {}
    };
    return api;
  }

  function playScore(score, opts) {
    try {
      if (!score || !score.bars || !score.bars.length) return noopTransport();
      var tr = new Transport(score, opts || {});
      tr._play();
      return tr;
    } catch (e) {
      return noopTransport();
    }
  }

  /* ==================== 节拍器 ==================== */

  function Metronome() {
    if (!(this instanceof Metronome)) return new Metronome();
    this._tempo = 120;
    this._time = { num: 4, den: 4 };
    this._accent = true;
    this._subdivision = 1;
    this._onTick = null;
    this._running = false;
    this._timer = null;
    this._pulse = 0;
    this._sub = 0;
    this._pulseDur = 0.5;
    this._map = [];
    this._voices = [];
  }

  /* 一个脉冲（= 拍号分母对应的音符）的秒数；4/den 走查表 */
  Metronome.prototype._pulseDuration = function () { return (60 / this._tempo) * denRecip(this._time.den); };

  Metronome.prototype._mapTimeAt = function (beat) {
    var map = this._map;
    if (!map.length) return 0;
    for (var i = map.length - 1; i >= 0; i--) {
      if (beat >= map[i].beat - 1e-9) return map[i].time + (beat - map[i].beat) * map[i].spb;
    }
    return map[0].time + (beat - map[0].beat) * map[0].spb;
  };

  Metronome.prototype._mapSpbAt = function (beat) {
    var map = this._map;
    if (!map.length) return this._pulseDur;
    for (var i = map.length - 1; i >= 0; i--) {
      if (beat >= map[i].beat - 1e-9) return map[i].spb;
    }
    return map[0].spb;
  };

  Metronome.prototype.start = function (opts) {
    try {
      opts = opts || {};
      this.stop();
      if (opts.tempo !== undefined) this._tempo = normalizeTempo(opts.tempo);
      if (opts.time) this._time = normalizeTime(opts.time);
      this._accent = opts.accent !== false;
      this._subdivision = normalizeSub(opts.subdivision === undefined ? 1 : opts.subdivision);
      this._onTick = typeof opts.onTick === 'function' ? opts.onTick : null;
      this._compound = (this._time.den === 8 && this._time.num % 3 === 0 && this._time.num > 3);

      var c = ensure();
      if (!c) return this;                    // 无音频环境：安全 no-op（isRunning 保持 false）

      this._pulse = 0;
      this._sub = 0;
      this._pulseDur = this._pulseDuration();
      this._map = [{ beat: 0, time: c.currentTime + config.startDelaySec, spb: this._pulseDur }];
      this._running = true;
      this._startTimer();
      this._pump();
    } catch (e) { this._running = false; }
    return this;
  };

  Metronome.prototype._pump = function () {
    if (!this._running || !ctx) return;
    var until = ctx.currentTime + config.lookaheadSec;
    var pulsesPerBar = this._time.num;
    var n = 0;
    while (n < config.maxEventsPerPump) {
      var spb = this._mapSpbAt(this._pulse);
      var t = this._mapTimeAt(this._pulse) + this._sub * (spb / this._subdivision);
      if (t >= until) break;

      var inBar = ((this._pulse % pulsesPerBar) + pulsesPerBar) % pulsesPerBar;
      var bar = Math.floor(this._pulse / pulsesPerBar);
      var isSub = this._sub > 0;
      var accent = this._accent && inBar === 0;
      /* 复合拍（6/8、9/8、12/8）：每 3 个脉冲（复附点大拍）一次次级重音 */
      if (this._accent && !accent && this._compound && inBar % 3 === 0) accent = true;

      this._scheduleClick(t, accent && !isSub, isSub);
      if (this._onTick) {
        try {
          this._onTick(inBar + 1, bar, accent && !isSub, {
            isSub: isSub,
            sub: this._sub,
            subdivision: this._subdivision,
            pulse: this._pulse,
            accent: accent && !isSub,
            time: t
          });
        } catch (e) { /* 忽略 */ }
      }

      this._sub++;
      if (this._sub >= this._subdivision) { this._sub = 0; this._pulse++; }
      n++;
    }
    pruneVoices();
  };

  Metronome.prototype._scheduleClick = function (t, accent, isSub) {
    var f = accent ? 1000 : 800;
    var vel = accent ? 0.9 : (isSub ? 0.35 : 0.6);
    var v = playTone(f, 0.05, 'clave', vel, t, null, null);
    if (v) this._voices.push(v);
    pingBeat(accent ? 1 : 2);
  };

  Metronome.prototype._startTimer = function () {
    var self = this;
    this._stopTimer();
    this._timer = setInterval(function () { try { self._pump(); } catch (e) { /* 忽略 */ } }, config.tickMs);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  };

  Metronome.prototype._stopTimer = function () {
    if (this._timer) {
      try { clearInterval(this._timer); } catch (e) { /* 忽略 */ }
      this._timer = null;
    }
  };

  Metronome.prototype.setTempo = function (bpm) {
    try {
      var v = normalizeTempo(bpm);
      if (!ctx || !this._running) { this._tempo = v; this._pulseDur = this._pulseDuration(); return this; }
      if (v === this._tempo) return this;
      var hb = this._pulse + this._sub / this._subdivision;   // 已排到的位置
      var t = this._mapTimeAt(hb);
      this._tempo = v;
      this._pulseDur = this._pulseDuration();
      this._map.push({ beat: hb, time: t, spb: this._pulseDur });
    } catch (e) { /* 忽略 */ }
    return this;
  };

  Metronome.prototype.stop = function () {
    try {
      this._running = false;
      this._stopTimer();
      cancelVoices(this._voices, nowTime());
      this._voices = [];
    } catch (e) { /* 忽略 */ }
    return this;
  };

  Metronome.prototype.isRunning = function () { return !!this._running; };
  Metronome.prototype.tempo = function () { return this._tempo; };

  /* ==================== 装饰性电平表 / 节拍灯（可选） ==================== */

  function pingBeat(kind) {
    for (var i = 0; i < beatWatchers.length; i++) {
      try { beatWatchers[i](kind); } catch (e) { /* 忽略 */ }
    }
  }

  function mountMeter(container) {
    var handle = { el: null, stop: function () {}, destroy: function () {}, supported: false };
    try {
      if (!container || typeof document === 'undefined') return handle;
      var u = APP.util;
      var mk = (u && typeof u.el === 'function') ? u.el : function (tag, attrs, text) {
        var n = document.createElement(tag);
        if (attrs && attrs.class) n.className = attrs.class;
        if (text) n.textContent = text;
        return n;
      };

      var bar = mk('div', { class: 'engine-meter-bar' });
      var fill = mk('i', { class: 'engine-meter-fill' });
      bar.appendChild(fill);
      var dot = mk('div', { class: 'engine-meter-dot' });
      var wrap = mk('div', { class: 'engine-meter' }, bar, dot, mk('span', { class: 'engine-meter-label' }, '电平'));
      container.appendChild(wrap);
      handle.el = wrap;

      var c = ctx || init();
      var analyser = null, data = null;
      if (c && typeof c.createAnalyser === 'function' && master) {
        try {
          analyser = c.createAnalyser();
          analyser.fftSize = 1024;
          data = new Uint8Array(analyser.fftSize);
          master.connect(analyser);
          handle.supported = true;
        } catch (e) { analyser = null; }
      }

      var raf = null, lit = 0, litKind = 0;
      var onBeat = function (kind) { lit = 3; litKind = kind; };
      beatWatchers.push(onBeat);

      function frame() {
        raf = null;
        try {
          if (analyser && data) {
            analyser.getByteTimeDomainData(data);
            var sum = 0;
            for (var i = 0; i < data.length; i++) { var d = (data[i] - 128) / 128; sum += d * d; }
            var rms = Math.sqrt(sum / data.length);
            fill.style.width = Math.round(clamp(rms * 220, 0, 100)) + '%';
          }
          if (lit > 0) {
            lit--;
            dot.className = 'engine-meter-dot ' + (litKind === 1 ? 'is-accent' : (litKind === 2 ? 'is-beat' : 'is-note'));
          } else if (dot.className !== 'engine-meter-dot') {
            dot.className = 'engine-meter-dot';
          }
        } catch (e) { /* 忽略 */ }
        schedule();
      }
      function schedule() {
        if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
      }
      schedule();

      handle.stop = function () { handle.destroy(); };
      handle.destroy = function () {
        if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf = null;
        var i = beatWatchers.indexOf(onBeat);
        if (i >= 0) beatWatchers.splice(i, 1);
        try { if (analyser && master) master.disconnect(analyser); } catch (e) { /* 忽略 */ }
        try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (e) { /* 忽略 */ }
      };
    } catch (e) { /* 装饰性组件，失败不影响主流程 */ }
    return handle;
  }

  /* ==================== 导出 ==================== */

  var engine = {
    /** 首次用户手势时调用，创建 AudioContext（幂等） */
    init: init,
    /** 'uninitialized' | 'running' | 'suspended' */
    state: state,
    /** 浏览器挂起时 resume；始终 resolve，不 reject */
    warmup: warmup,
    /** 播放乐段 -> transport（只读 score） */
    playScore: playScore,
    /** 独立节拍器构造函数 */
    Metronome: Metronome,
    /** 试听单音 */
    playNote: playNote,
    /** 试听和弦 */
    playChord: playChord,
    /** 提示音 */
    beep: beep,
    /** 可选：实时电平 / 节拍指示灯 */
    mountMeter: mountMeter,

    /* 附加工具（非契约必需，UI 可复用） */
    setVolume: setVolume,
    stopAll: stopAll,
    config: config,
    TIMBRE_LIST: ['piano', 'sine', 'clave'],
    _useContext: useContext,
    _activeVoices: function () { return activeVoices; }
  };

  APP.engine = engine;

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.engine;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
