/* 音频引擎模块自测脚本（node 环境，无浏览器 / 无声卡）
 * 运行：node tools/_t_engine.js
 *
 * 用一个人工实现的最小 AudioContext 桩来验证：
 *   1. 模块注册与 API 完整性；
 *   2. 无 Web Audio 时的安全降级（no-op、不抛异常）；
 *   3. playScore 的时间轴：拍数守恒、每个音的调度时间、延音线只触发一次起音、休止符不发声；
 *   4. look-ahead 预调度窗口（音符在下一次轮询前就被排进时间轴）；
 *   5. pause / resume 的播放位置保持；
 *   6. setTempo 播放中变速；
 *   7. Metronome 的 tick 间隔 / 重音 / 细分 / 复合拍分组 / 变速；
 *   8. score 对象不被修改（深冻结后依然可播）。
 *
 * 时值换算遵循契约第 1 节的权威实现 APP.util.beatsOf（查表）：
 *   dur=1 四分音符 = 1 拍，dur=4 全音符 = 4 拍，附点 ×1.5。
 * 调度窗口 engine.config.lookaheadSec 可覆盖，本脚本会临时调大它，
 * 以便在一次轮询里把整段乐谱排完再做断言。
 */
'use strict';

global.APP = {};
const path = require('path');
const ROOT = path.join(__dirname, '..');

require(path.join(ROOT, 'src', 'core', 'util.js'));
require(path.join(ROOT, 'src', 'core', 'theory.js'));
const engine = require(path.join(ROOT, 'src', 'audio', 'engine.js'));
const util = global.APP.util;
const theory = global.APP.theory;

let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  [ok]   ' + name);
  } else {
    failed++;
    console.log('  [FAIL] ' + name + (extra !== undefined ? ('  => ' + extra) : ''));
  }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps); }

/* ==================== AudioContext 桩 ==================== */

function makeParam(v) {
  const p = {
    value: v,
    events: [],
    setValueAtTime(x, t) { p.events.push(['set', x, t]); p.value = x; return p; },
    linearRampToValueAtTime(x, t) { p.events.push(['lin', x, t]); p.value = x; return p; },
    exponentialRampToValueAtTime(x, t) { p.events.push(['exp', x, t]); p.value = x; return p; },
    setTargetAtTime(x, t, c) { p.events.push(['tgt', x, t, c]); p.value = x; return p; },
    cancelScheduledValues(t) { p.events.push(['cancel', t]); return p; }
  };
  return p;
}

function makeCtx() {
  const reg = { osc: [], gain: [], analyser: [] };
  const ctx = {
    currentTime: 0,
    state: 'running',
    sampleRate: 44100,
    destination: { _isDestination: true },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    close() { ctx.state = 'closed'; return Promise.resolve(); },
    createGain() {
      const g = {
        gain: makeParam(1), _dest: null, disconnected: false,
        connect(d) { g._dest = d; return d; },
        disconnect() { g.disconnected = true; }
      };
      reg.gain.push(g);
      return g;
    },
    createOscillator() {
      const o = {
        type: 'sine', frequency: makeParam(440), detune: makeParam(0),
        _dest: null, _start: null, _stop: null, onended: null, disconnected: false,
        connect(d) { o._dest = d; return d; },
        disconnect() { o.disconnected = true; },
        start(t) {
          if (o._start !== null) throw new Error('osc.start 被调用了两次');
          o._start = (t === undefined ? ctx.currentTime : t);
        },
        stop(t) {
          if (o._start === null) throw new Error('stop 早于 start');
          o._stop = (t === undefined ? ctx.currentTime : t);
        }
      };
      reg.osc.push(o);
      return o;
    },
    createAnalyser() {
      const a = {
        fftSize: 1024, frequencyBinCount: 512,
        connect() {}, disconnect() {},
        getByteTimeDomainData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = 128; }
      };
      reg.analyser.push(a);
      return a;
    }
  };
  return { ctx, reg };
}

/* 从桩里提取「起音事件」：每个振荡器的起始时间 + 频率 */
function attacks(reg) {
  return reg.osc.map((o) => ({ t: o._start, f: o.frequency.value, stop: o._stop }));
}
function hasAttack(reg, t, freq, eps) {
  return attacks(reg).filter((a) => near(a.t, t, eps || 1e-9) && near(a.f, freq, 0.02)).length;
}
function uniqueStartTimes(reg) {
  const out = [];
  attacks(reg).forEach((a) => { if (!out.some((x) => near(x, a.t, 1e-9))) out.push(a.t); });
  return out.sort((a, b) => a - b);
}

/* ==================== 手工构造的 4 小节 4/4 乐谱 ==================== */
/* 拍数按契约：dur=1 四分=1 拍，dur=0.5 八分=0.5 拍，dur=1+dotted=1.5 拍，dur=4 全音符=4 拍 */

function P(step, oct, acc) { return { step, acc: acc || 0, oct }; }
function N(step, oct, dur, opts) {
  opts = opts || {};
  const p = opts.rest ? null : P(step, oct);
  return {
    pitch: p,
    dur,
    dotted: !!opts.dotted,
    tie: !!opts.tie,
    midi: p ? theory.midiOf(p) : null,
    pos: p ? theory.staffPos(p, 'treble') : 0
  };
}

function makeScore() {
  return {
    key: { tonic: 0, mode: 'major', fifths: 0 },
    time: { num: 4, den: 4 },
    tempo: 120,
    clef: 'treble',
    title: '自测乐段',
    bars: [
      { notes: [N('C', 4, 1), N(null, 4, 0.5, { rest: true }), N('D', 4, 0.5),
        N('E', 4, 1, { dotted: true }), N('F', 4, 0.5)], beats: 4 },
      { notes: [N('G', 4, 2), N('A', 4, 1, { tie: true }), N('A', 4, 1)], beats: 4 },
      { notes: [N(null, 4, 1, { rest: true }), N('B', 4, 1), N('C', 5, 1),
        N(null, 4, 1, { rest: true })], beats: 4 },
      { notes: [N('C', 4, 4)], beats: 4 }
    ]
  };
}

/* 期望时间轴：按契约公式累计拍数，t = 0.05(起播缓冲) + 拍数 × (60/tempo) */
function expectedTimeline(score, tempo) {
  const spb = 60 / tempo;
  let acc = 0;
  const out = [];
  score.bars.forEach((bar, bi) => {
    bar.notes.forEach((n, ni) => {
      out.push({ bar: bi, ni, beats: util.beatsOf(n.dur, n.dotted), start: 0.05 + acc * spb });
      acc += util.beatsOf(n.dur, n.dotted);
    });
  });
  return { events: out, totalBeats: acc, span: acc * spb };
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.keys(o).forEach((k) => deepFreeze(o[k]));
    Object.freeze(o);
  }
  return o;
}

function freshCtx() {
  const { ctx, reg } = makeCtx();
  engine._useContext(ctx);
  engine.config.lookaheadSec = 0.1;
  engine.config.maxEventsPerPump = 1024;
  return { ctx, reg };
}

/* ==================== 1. 模块注册 ==================== */

console.log('== 1. 模块注册 ==');
check('require 返回对象', engine && typeof engine === 'object');
check('已注册到 global.APP.engine', global.APP.engine === engine);
['init', 'state', 'warmup', 'playScore', 'playNote', 'playChord', 'beep'].forEach((k) => {
  check('typeof ' + k + ' === "function"', typeof engine[k] === 'function');
});
check('Metronome 是构造函数', typeof engine.Metronome === 'function');
check('mountMeter 是函数', typeof engine.mountMeter === 'function');

/* ==================== 2. 无 AudioContext 时安全降级 ==================== */

console.log('== 2. 无 Web Audio 时安全降级（no-op） ==');
engine._useContext(null);
let e2 = null;
try {
  check('state() === "uninitialized"', engine.state() === 'uninitialized', engine.state());
  check('init() 返回 null 且不抛', engine.init() === null);
  const t0 = engine.playScore(makeScore(), { onNote() {}, onBar() {}, onEnd() {} });
  check('playScore 返回 transport', t0 && typeof t0.stop === 'function');
  t0.stop(); t0.pause(); t0.resume(); t0.setTempo(90);
  check('transport 方法在降级下可调用', typeof t0.state() === 'string' && t0.isPlaying() === false, t0.state());
  check('transport.on 返回退订函数', typeof t0.on('note', () => {}) === 'function');
  engine.playNote(60, 0.5, 'piano');
  engine.playChord([60, 64, 67], 0.5, 'sine');
  engine.beep(880, 0.1);
  engine.stopAll();
  const m = new engine.Metronome();
  m.start({ tempo: 120, time: { num: 4, den: 4 }, onTick() {} });
  check('Metronome.start 降级后 isRunning() === false', m.isRunning() === false);
  m.setTempo(90); m.stop();
  check('mountMeter(null) 返回安全句柄', engine.mountMeter(null) && typeof engine.mountMeter(null).destroy === 'function');
  check('playScore(null) / playScore({}) 不抛', typeof engine.playScore(null).stop === 'function' &&
    typeof engine.playScore({}).stop === 'function');
} catch (e) { e2 = e; }
check('降级路径全部不抛异常', e2 === null, e2 && e2.stack);

/* ==================== 3. init / state / warmup ==================== */

console.log('== 3. init / state / warmup ==');
{
  const { ctx } = freshCtx();
  check('注入上下文后 state() === "running"', engine.state() === 'running', engine.state());
  check('init() 幂等（返回同一上下文）', engine.init() === ctx);
  ctx.state = 'suspended';
  check('挂起时 state() === "suspended"', engine.state() === 'suspended', engine.state());
  const p = engine.warmup();
  check('warmup() 返回 Promise', p && typeof p.then === 'function');
  p.catch(() => {});      // resume 的断言放到最后的异步段（见 == 12 ==）
}

/* ==================== 4. 不修改 score ==================== */

console.log('== 4. playScore 不修改 score 对象 ==');
{
  const { ctx } = freshCtx();
  const score = deepFreeze(makeScore());
  const before = JSON.stringify(score);
  let e4 = null;
  let tr = null;
  try {
    engine.config.lookaheadSec = 1000;
    tr = engine.playScore(score, { onNote() {} });
  } catch (e) { e4 = e; }
  check('深冻结的 score 仍可播放且不抛异常', e4 === null, e4 && e4.stack);
  check('score 内容未被修改', JSON.stringify(score) === before);
  if (tr) tr.stop();
}

/* ==================== 5. playScore 时间轴 ==================== */

console.log('== 5. playScore 时间轴（拍数守恒 / 调度时间 / 延音线 / 休止符） ==');
{
  const score = makeScore();
  const exp = expectedTimeline(score, 120);
  const { ctx, reg } = freshCtx();
  engine.config.lookaheadSec = 1000;        // 一次排完整段，便于断言时间轴
  engine.config.maxEventsPerPump = 100000;
  ctx.currentTime = 0;

  const notes = [];
  const bars = [];
  const events = [];
  let optEndCalls = 0;
  let evtEndCalls = 0;
  engine.config.lookaheadSec = 0;           // 先不排程，注册好监听器后再一次性排完
  const tr = engine.playScore(score, {
    tempo: 120,
    metronome: false,
    onNote(i, bar, note, info) { notes.push({ i, bar, note, info }); },
    onBar(b) { bars.push(b); },
    onEnd() { optEndCalls++; }
  });
  tr.on('note', (i, bar, note, info) => events.push({ i, bar, note, info }));
  tr.on('bar', (b) => bars.push('evt:' + b));
  tr.on('end', () => evtEndCalls++);
  engine.config.lookaheadSec = 1000;        // 一次排完整段，便于断言时间轴
  engine.config.maxEventsPerPump = 100000;
  ctx.currentTime = 0;
  tr._pump();

  check('transport 处于 playing', tr.state() === 'playing', tr.state());
  check('onNote 与 transport.on("note") 都触发', notes.length === 12 && events.length === 12,
    notes.length + '/' + events.length);
  check('onBar 覆盖 4 个小节', bars.filter((b) => typeof b === 'number').join(',') === '0,1,2,3',
    bars.join(','));

  /* 5a. 拍数守恒：每个回调的 beats 之和 == 小节规定拍数 */
  const perBar = {};
  notes.forEach((n) => { perBar[n.info.bar] = (perBar[n.info.bar] || 0) + n.info.beats; });
  let ok = true, detail = [];
  for (let b = 0; b < score.bars.length; b++) {
    const sum = perBar[b];
    if (!near(sum, 4) || !near(sum, score.bars[b].beats)) { ok = false; detail.push('bar' + b + '=' + sum); }
  }
  check('每小节回调拍数之和 == 规定拍数(4)', ok, detail.join(' '));
  const totalBeats = notes.reduce((s, n) => s + n.info.beats, 0);
  check('全曲回调拍数总和 == 16 拍', near(totalBeats, 16), totalBeats);

  /* 5b. 调度时间：第 k 个音起始时间 == 前面时值累计 × 60/tempo + 起播缓冲 */
  const spb = 60 / 120;
  let acc = 0, timeOk = true, timeDetail = [];
  notes.forEach((n, k) => {
    const want = 0.05 + acc * spb;
    if (!near(n.info.when, want, 1e-9) || !near(n.info.startBeat, acc, 1e-9)) {
      timeOk = false;
      timeDetail.push('#' + k + '=' + n.info.when + '≠' + want);
    }
    acc += n.info.beats;
  });
  check('每个 onNote 的调度时间 == 累计时值 × 60/tempo', timeOk, timeDetail.join(' '));
  check('累计总拍数 == 16', near(acc, 16), acc);

  /* 5c. 真实发声（振荡器 start 时间）与时间轴一致 */
  const pitched = notes.filter((n) => !n.info.isRest);
  check('起音数量 == 有声音符数（9 个）', pitched.length === 9, pitched.length);
  let atkOk = true, atkDetail = [];
  pitched.forEach((n) => {
    const f = theory.midiToFreq(n.info.midi);
    const c = hasAttack(reg, n.info.when, f);
    if (c !== 1) { atkOk = false; atkDetail.push('midi' + n.info.midi + '@' + n.info.when + ' x' + c); }
  });
  check('每个有声音符恰好在预期时间以预期频率起音（piano 基频）', atkOk, atkDetail.join(' '));
  check('piano 音色 = 每音 3 个泛音振荡器（9×3=27）', reg.osc.length === 27, reg.osc.length);

  const restTimes = notes.filter((n) => n.info.isRest).map((n) => n.info.when);
  check('休止符处没有任何振荡器起音', restTimes.length === 3 &&
    uniqueStartTimes(reg).every((t) => !restTimes.some((rt) => near(t, rt, 1e-9))), restTimes.join(','));

  /* 5d. 延音线：第 2 小节的 A4（1 拍 + 1 拍）只触发一次起音，合并成 2 拍 */
  const ties = notes.filter((n) => n.info.bar === 1 && n.info.midi === theory.midiOf(P('A', 4)));
  check('延音线合并后只回调一次', ties.length === 1, ties.length);
  check('延音线合并后时值 = 2 拍', ties.length === 1 && near(ties[0].info.beats, 2), ties[0] && ties[0].info.beats);
  check('延音线合并后只有一次起音',
    hasAttack(reg, 0.05 + 6 * spb, theory.midiToFreq(69)) === 1);

  /* 5e. 节点回收：所有振荡器都有 stop 时间；onended 触发后全部断开 */
  check('所有振荡器都设置了 stop（无节点泄漏）', reg.osc.every((o) => typeof o._stop === 'number' && o._stop > o._start));
  reg.osc.forEach((o) => { if (typeof o.onended === 'function') o.onended(); });
  check('onended 后振荡器全部 disconnect', reg.osc.every((o) => o.disconnected === true));

  /* 5f. onEnd 不会提前触发；推进时钟后自然结束 */
  check('推进时钟前不触发 onEnd', optEndCalls === 0, optEndCalls);
  ctx.currentTime = exp.span + 0.2;
  tr._pump();
  check('乐段结束后 onEnd 触发一次', optEndCalls === 1, optEndCalls);
  check('乐段结束后 transport.on("end") 触发一次', evtEndCalls === 1, evtEndCalls);
  check('结束后 state === "stopped"', tr.state() === 'stopped', tr.state());
}

/* ==================== 6. look-ahead 预调度窗口 ==================== */

console.log('== 6. look-ahead 预调度（默认 100ms 窗口） ==');
{
  const { ctx, reg } = freshCtx();      // lookaheadSec = 0.1
  ctx.currentTime = 0;
  const tr = engine.playScore(makeScore(), { tempo: 120 });
  check('只排入窗口内的音符（第 1 个音 @0.05）', uniqueStartTimes(reg).length === 1 &&
    near(uniqueStartTimes(reg)[0], 0.05), uniqueStartTimes(reg).join(','));
  check('已排入的音符都在 currentTime + 100ms 之内',
    uniqueStartTimes(reg).every((t) => t < ctx.currentTime + 0.1 + 1e-9));

  ctx.currentTime = 0.5;
  tr._pump();
  check('窗口外的音符不会被提前排入', uniqueStartTimes(reg).length === 1, uniqueStartTimes(reg).join(','));

  ctx.currentTime = 0.75;               // 下一个音在 0.8
  tr._pump();
  const times = uniqueStartTimes(reg);
  check('达到窗口时下一个音在发声前被排入', times.length === 2 && near(times[1], 0.8),
    times.join(','));
  check('排入时间早于实际发声时间（真正的预调度）', times[1] > ctx.currentTime);
  tr.stop();
}

/* ==================== 7. pause / resume ==================== */

console.log('== 7. pause / resume 保留播放位置 ==');
{
  const { ctx, reg } = freshCtx();
  ctx.currentTime = 0;
  const notes = [];
  const tr = engine.playScore(makeScore(), {
    tempo: 120,
    onNote(i, bar, note, info) { notes.push(info); }
  });
  ctx.currentTime = 1.0;                // 已播 1 秒 = 1.9 拍
  tr.pause();
  check('pause 后 state === "paused"', tr.state() === 'paused', tr.state());
  const c4 = reg.osc.filter((o) => near(o.frequency.value, theory.midiToFreq(60)));
  check('pause 会立刻掐掉正在发声的音', c4.length > 0 && c4.every((o) => near(o._stop, 1.03, 1e-9)),
    c4.map((o) => o._stop).join(','));
  const pausedBeat = tr.position().beat;
  check('记录已播放拍数 ≈ 1.9', near(pausedBeat, 1.9, 1e-9), pausedBeat);

  const before = reg.osc.length;
  tr.resume();
  check('resume 后 state === "playing"', tr.state() === 'playing', tr.state());
  const added = reg.osc.slice(before);
  check('resume 只补发被打断的那个音（D4 余下 0.1 拍）', added.length === 3 &&
    near(added[0]._start, 1.05) && near(added[0].frequency.value, theory.midiToFreq(62), 0.02),
    added.map((o) => o._start + '@' + o.frequency.value.toFixed(1)).join(' '));
  const last = notes[notes.length - 1];
  check('补发的音的剩余时值 = 0.1 拍', near(last.beats, 0.1), last.beats);

  ctx.currentTime = 1.06;
  tr._pump();
  const after = uniqueStartTimes(reg).filter((t) => t > 1.04);
  check('resume 后后续音符按原速度继续（E4 @1.10）',
    after.length === 2 && near(after[1], 1.05 + 0.1 * 0.5), after.join(','));
  check('resume 不会重放已经过去的音符', uniqueStartTimes(reg).filter((t) => t < 0.06).length === 1);
  tr.stop();
  tr.pause(); tr.resume();
  check('stop 之后 pause/resume 是安全的', tr.state() === 'stopped', tr.state());
}

/* ==================== 8. setTempo 播放中变速 ==================== */

console.log('== 8. setTempo 播放中实时变速 ==');
{
  const { ctx, reg } = freshCtx();
  ctx.currentTime = 0;
  const tr = engine.playScore(makeScore(), { tempo: 120 });
  check('初始速度 120', tr.tempo() === 120 && near(reg.osc[0]._start, 0.05));

  ctx.currentTime = 0.06;
  tr.setTempo(240);
  check('setTempo 后 tempo() === 240', tr.tempo() === 240);
  check('变速不影响已排入音符的时间', near(reg.osc[0]._start, 0.05));

  ctx.currentTime = 0.55;               // 地平线 1 拍（原速 0.55）之后按新速度
  tr._pump();
  ctx.currentTime = 0.68;
  tr._pump();
  const d4 = reg.osc.filter((o) => Math.abs(o.frequency.value - theory.midiToFreq(62)) < 1e-6);
  check('变速后 D4 按新速度排布（0.55 + 0.5×0.25 = 0.675）',
    d4.length === 1 && near(d4[0]._start, 0.675), d4.length ? d4[0]._start : 'none');

  ctx.currentTime = 0.79;
  tr._pump();
  const e4 = reg.osc.filter((o) => Math.abs(o.frequency.value - theory.midiToFreq(64)) < 1e-6);
  check('变速后 E4 与 D4 的间隔 = 0.5 拍 × 240bpm = 0.125s',
    e4.length === 1 && near(e4[0]._start - d4[0]._start, 0.125), e4.length ? (e4[0]._start - d4[0]._start) : 'none');
  check('变速后 D4/E4 的调度时间与锚点公式一致',
    near(d4[0]._start, 0.55 + 0.5 * 0.25) && near(e4[0]._start, 0.55 + 1.0 * 0.25),
    d4[0]._start + ',' + e4[0]._start);
  tr.stop();
}

/* ==================== 9. Metronome ==================== */

console.log('== 9. Metronome（tick 间隔 / 重音 / 细分 / 复合拍 / 变速） ==');
{
  /* 9a. 4/4 120bpm，interval = 60/tempo = 0.5s，每 4 拍一次重音 */
  const { ctx, reg } = freshCtx();
  ctx.currentTime = 0;
  const ticks = [];
  const m = new engine.Metronome();
  m.start({
    tempo: 120, time: { num: 4, den: 4 }, accent: true, subdivision: 1,
    onTick(beat, bar, isAccent, info) { ticks.push({ beat, bar, isAccent, info }); }
  });
  check('start 后 isRunning() === true', m.isRunning() === true);
  check('首个 tick 的 beat 从 1 开始', ticks.length >= 1 && ticks[0].beat === 1 && ticks[0].bar === 0);
  check('首个 tick 是重音', ticks[0].isAccent === true);
  check('onTick 第 4 个参数带细分信息', ticks[0].info && ticks[0].info.sub === 0 && ticks[0].info.isSub === false);

  engine.config.lookaheadSec = 4;       // 放大窗口，一次排出 8 个 tick
  ctx.currentTime = 0;
  m._pump();
  check('4/4 共排出 8 个 tick', ticks.length === 8, ticks.length);
  let intOk = true, intDetail = [];
  for (let i = 1; i < ticks.length; i++) {
    if (!near(ticks[i].info.time - ticks[i - 1].info.time, 60 / 120, 1e-9)) {
      intOk = false; intDetail.push((ticks[i].info.time - ticks[i - 1].info.time).toFixed(6));
    }
  }
  check('tick 间隔 == 60/tempo == 0.5s', intOk, intDetail.join(','));
  check('每 4 拍出现一次重音（下标 0/4 为重音）',
    ticks.map((t, i) => (t.isAccent ? i : -1)).filter((i) => i >= 0).join(',') === '0,4');
  check('重音与弱拍音色不同（1000Hz vs 800Hz）',
    reg.osc.some((o) => near(o.frequency.value, 1000)) && reg.osc.some((o) => near(o.frequency.value, 800)));
  check('beat 每小节 1..4 循环，bar 递增', ticks.slice(0, 8).map((t) => t.beat).join('') === '12341234' &&
    ticks[0].bar === 0 && ticks[4].bar === 1, ticks.map((t) => t.beat).join(''));
  m.stop();
  check('stop 后 isRunning() === false', m.isRunning() === false);
  const n0 = reg.osc.length;
  m._pump();
  check('stop 后不再排程', reg.osc.length === n0);

  /* 9b. subdivision = 3：每拍 3 个 tick，细分音更轻 */
  const t2 = freshCtx();
  t2.ctx.currentTime = 0;
  engine.config.lookaheadSec = 2;
  const subTicks = [];
  const m2 = new engine.Metronome();
  m2.start({
    tempo: 120, time: { num: 4, den: 4 }, subdivision: 3,
    onTick(beat, bar, isAccent, info) { subTicks.push({ beat, bar, isAccent, info }); }
  });
  m2._pump();
  const subTimes = subTicks.map((t) => t.info.time);
  let subOk = subTimes.length >= 12;
  for (let i = 1; i < subTimes.length; i++) if (!near(subTimes[i] - subTimes[i - 1], 0.5 / 3, 1e-9)) subOk = false;
  check('subdivision=3 时细分间隔 == 0.5/3', subOk, subTimes.slice(0, 4).join(','));
  check('细分音带 isSub 标记且不占重音', subTicks.some((t) => t.info.isSub) &&
    subTicks.filter((t) => t.isAccent).length === 1);
  check('细分 tick 复用同一拍号（beat 仍 1..4）', subTicks[3].beat === 2, subTicks[3].beat);
  m2.stop();

  /* 9c. 6/8 复合拍：脉冲 = 八分音符（0.25s），每小节 6 拍，1/4 拍为重音 */
  const t3 = freshCtx();
  t3.ctx.currentTime = 0;
  engine.config.lookaheadSec = 1.6;
  const c68 = [];
  const m3 = new engine.Metronome();
  m3.start({
    tempo: 120, time: { num: 6, den: 8 }, subdivision: 1,
    onTick(beat, bar, isAccent, info) { c68.push({ beat, bar, isAccent, info }); }
  });
  m3._pump();
  check('6/8 脉冲间隔 == 0.25s（八分音符）',
    c68.length >= 7 && near(c68[1].info.time - c68[0].info.time, 0.25, 1e-9),
    c68.length >= 2 ? (c68[1].info.time - c68[0].info.time) : 'n/a');
  check('6/8 每小节 6 拍并正确分组（重音在下标 0 与 3）',
    c68.slice(0, 7).map((t) => t.beat).join('') === '1234561' &&
    c68.map((t, i) => (t.isAccent ? i : -1)).filter((i) => i >= 0).slice(0, 2).join(',') === '0,3',
    c68.slice(0, 7).map((t) => t.beat + (t.isAccent ? '*' : '')).join(' '));
  m3.stop();

  /* 9d. 运行中 setTempo */
  const t4 = freshCtx();
  t4.ctx.currentTime = 0;
  const tempoTicks = [];
  const m4 = new engine.Metronome();
  m4.start({
    tempo: 120, time: { num: 4, den: 4 }, subdivision: 1,
    onTick(beat, bar, isAccent, info) { tempoTicks.push(info.time); }
  });
  t4.ctx.currentTime = 0.06;
  m4.setTempo(60);
  t4.ctx.currentTime = 0.55;
  engine.config.lookaheadSec = 1.1;
  m4._pump();
  const lastTwo = tempoTicks.slice(-2);
  check('节拍器变速后间隔 == 60/60 == 1s', lastTwo.length === 2 && near(lastTwo[1] - lastTwo[0], 1.0, 1e-9),
    lastTwo.join(','));
  m4.stop();
}

/* ==================== 10. playNote / playChord / beep ==================== */

console.log('== 10. playNote / playChord / beep ==');
{
  const { ctx, reg } = freshCtx();
  ctx.currentTime = 0;
  engine.playNote(69, 0.5, 'sine');
  check('playNote(A4) 生成 1 个正弦，频率 = theory.midiToFreq(69) = 440',
    reg.osc.length === 1 && Math.abs(reg.osc[0].frequency.value - theory.midiToFreq(69)) < 1e-6 &&
    Math.abs(reg.osc[0].frequency.value - 440) < 1e-6,
    reg.osc.map((o) => o.frequency.value).join(','));
  check('playNote 起音时间 = currentTime + 5ms', near(reg.osc[0]._start, 0.005, 1e-9), reg.osc[0]._start);

  const n1 = reg.osc.length;
  engine.playChord([60, 64, 67], 0.5, 'sine');
  const chord = reg.osc.slice(n1);
  check('playChord(3 音) 生成 3 个同频正弦', chord.length === 3 &&
    near(chord[0].frequency.value, theory.midiToFreq(60), 1e-6) &&
    near(chord[2].frequency.value, theory.midiToFreq(67), 1e-6));
  check('和弦同时发声', chord.every((o) => near(o._start, chord[0]._start)));

  const n2 = reg.osc.length;
  engine.beep(880, 0.1);
  check('beep(880) 生成 880Hz 正弦', reg.osc.length === n2 + 1 && near(reg.osc[n2].frequency.value, 880));

  const n3 = reg.osc.length;
  engine.playNote(60, 0.5, 'clave');
  check('clave 音色为短促点击（2 个谐波）', reg.osc.length === n3 + 2 &&
    near(reg.osc[n3].frequency.value, theory.midiToFreq(60), 1e-6));
  check('clave 衰减远短于按下的 0.5s', reg.osc[n3]._stop - reg.osc[n3]._start < 0.12,
    reg.osc[n3]._stop - reg.osc[n3]._start);

  const n4 = reg.osc.length;
  engine.playNote('abc', 0.5); engine.playNote(null, 0.5); engine.playNote(undefined, 0.5);
  engine.playChord([], 0.5); engine.playChord(null, 0.5); engine.playNote(NaN, 0.5);
  check('非法音高不生成节点也不抛异常', reg.osc.length === n4, reg.osc.length - n4);
  engine.beep(NaN, 0.1);
  check('非法频率的 beep 回落到 880Hz', near(reg.osc[n4].frequency.value, 880), reg.osc[n4].frequency.value);

  check('piano 低音衰减时间更长（低音 > 高音）', (function () {
    const a = freshCtx();
    a.ctx.currentTime = 0;
    engine.playNote(36, 0.5, 'piano');    // 每个音 3 个泛音：下标 0..2 是低音
    engine.playNote(84, 0.5, 'piano');    // 下标 3..5 是高音
    const low = a.reg.osc[0], high = a.reg.osc[3];
    return (low._stop - low._start) > (high._stop - high._start) &&
      near(a.reg.osc[3].frequency.value, theory.midiToFreq(84), 1e-6);
  })());
}

/* ==================== 11. opts：countIn / metronome / loop / startBar ==================== */

console.log('== 11. playScore 的 opts：countIn / metronome / loop / startBar ==');
{
  /* 11a. 预备拍：先响 n 拍咔哒，再从第 0 拍开始发音符 */
  const a = freshCtx();
  a.ctx.currentTime = 0;
  engine.config.lookaheadSec = 1000;
  const notesA = [];
  const trA = engine.playScore(makeScore(), {
    tempo: 120, countIn: 4, metronome: false,
    onNote(i, bar, note, info) { notesA.push(info); }
  });
  const clickTimes = uniqueStartTimes(a.reg)
    .filter((t) => a.reg.osc.some((o) => near(o._start, t) && (near(o.frequency.value, 1000) || near(o.frequency.value, 800))));
  check('预备拍排出 4 个咔哒', clickTimes.length === 4, clickTimes.join(','));
  check('预备拍咔哒间隔 == 60/tempo', clickTimes.every((t, i) => i === 0 || near(t - clickTimes[i - 1], 0.5, 1e-9)),
    clickTimes.join(','));
  check('预备拍第一拍是重音（1000Hz）',
    near(a.reg.osc[0].frequency.value, 1000), a.reg.osc[0].frequency.value);
  check('预备拍期间不发音符：第一个音在 0.05 + 4×0.5 = 2.05',
    near(notesA[0].when, 0.05 + 4 * 0.5, 1e-9), notesA[0].when);
  check('预备拍后的音仍按原时间轴继续', near(notesA[1].when, 0.05 + 4 * 0.5 + 0.5, 1e-9), notesA[1].when);
  trA.stop();

  /* 11b. metronome:true 时整段都在打拍子（每拍一个咔哒） */
  const b = freshCtx();
  b.ctx.currentTime = 0;
  engine.config.lookaheadSec = 1000;
  const trB = engine.playScore(makeScore(), { tempo: 120, metronome: true });
  const clickT = uniqueStartTimes(b.reg)
    .filter((t) => b.reg.osc.some((o) => near(o._start, t) && (near(o.frequency.value, 1000) || near(o.frequency.value, 800))));
  check('metronome:true 排满 16 个拍点', clickT.length === 16, clickT.length);
  check('拍点间隔 == 0.5s 且每 4 拍一个重音',
    clickT.every((t, i) => i === 0 || near(t - clickT[i - 1], 0.5, 1e-9)) &&
    clickT.filter((t) => b.reg.osc.some((o) => near(o._start, t) && near(o.frequency.value, 1000))).length === 4,
    clickT.join(','));
  trB.stop();

  /* 11c. loop：循环播放，第二遍时间平移一个 loop 跨度 */
  const small = {
    key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 120,
    clef: 'treble', title: '一小节',
    bars: [{ notes: [N('C', 4, 1), N('E', 4, 1), N('G', 4, 1), N('C', 5, 1)], beats: 4 }]
  };
  const c = freshCtx();
  c.ctx.currentTime = 0;
  engine.config.lookaheadSec = 5;        // 覆盖两轮多的循环
  const trC = engine.playScore(small, { tempo: 120, loop: true });
  const times = uniqueStartTimes(c.reg);
  const want = [0.05, 0.55, 1.05, 1.55, 2.05, 2.55, 3.05, 3.55];
  check('loop 会把乐段原样重复（第 2 轮平移一个跨度 2s）',
    times.length >= 8 && want.every((w, i) => near(times[i], w, 1e-9)), times.join(','));
  trC.stop();
  const nAfterStop = c.reg.osc.length;
  c.ctx.currentTime = 9;
  trC._pump();
  check('loop 停止后不再继续排程', c.reg.osc.length === nAfterStop);

  /* 11d. startBar：从指定小节开始，onBar 从小节处起 */
  const d = freshCtx();
  d.ctx.currentTime = 0;
  engine.config.lookaheadSec = 1000;
  const notesD = [];
  const barsD = [];
  const trD = engine.playScore(makeScore(), {
    tempo: 120, startBar: 2,
    onNote(i, bar, note, info) { notesD.push(info); },
    onBar(b2) { barsD.push(b2); }
  });
  check('startBar:2 时 onBar 从第 3 小节开始', barsD.join(',') === '2,3', barsD.join(','));
  check('startBar:2 的第一个事件是小节首的休止符 @0.05', notesD[0].bar === 2 && near(notesD[0].when, 0.05, 1e-9),
    notesD[0].bar + '@' + notesD[0].when);
  check('startBar:2 的第二个事件是 B4 @0.55', near(notesD[1].when, 0.55, 1e-9) &&
    notesD[1].midi === theory.midiOf(P('B', 4)), notesD[1].when + '/midi' + notesD[1].midi);
  check('startBar:2 只播剩下 8 拍（2 个小节）',
    near(notesD.reduce((s, n) => s + n.beats, 0), 8), notesD.reduce((s, n) => s + n.beats, 0));
  check('startBar:2 不排入前面小节的音',
    !d.reg.osc.some((o) => Math.abs(o.frequency.value - theory.midiToFreq(60)) < 1e-6 && near(o._start, 0.05)),
    'C4@0.05 不应出现');
  trD.stop();
}

/* ==================== 12. 回到降级状态 ==================== */

console.log('== 12. 回到无上下文状态仍然安全 ==');
{
  engine._useContext(null);
  engine.config.lookaheadSec = 0.1;
  check('state() 回到 "uninitialized"', engine.state() === 'uninitialized', engine.state());
  let e11 = null;
  try {
    const tr = engine.playScore(makeScore(), { tempo: 100 });
    tr.setTempo(140); tr.pause(); tr.resume(); tr.stop();
    engine.playNote(60, 0.5); engine.playChord([60, 64], 0.5); engine.beep(440, 0.1);
    engine.warmup();
  } catch (e) { e11 = e; }
  check('全部 API 再次降级不抛异常', e11 === null, e11 && e11.stack);
}

/* ==================== 13. warmup / init 的异步行为 ==================== */

(async function () {
  console.log('== 13. warmup / init ==');
  const { ctx } = freshCtx();
  ctx.state = 'suspended';
  check('挂起状态下 warmup() 前 state() === "suspended"', engine.state() === 'suspended');
  const v = await engine.warmup();
  check('warmup() resume 后 resolve true', v === true, String(v));
  check('warmup() 后 state() === "running"', engine.state() === 'running', engine.state());
  engine._useContext(null);
  const v2 = await engine.warmup();
  check('无上下文时 warmup() resolve false', v2 === false, String(v2));
  check('无上下文时 init() 返回 null', engine.init() === null);

  console.log('');
  if (failed === 0) {
    console.log('全部通过 ✔');
    process.exit(0);
  } else {
    console.log('失败 ' + failed + ' 项 ✘');
    process.exit(1);
  }
})();
