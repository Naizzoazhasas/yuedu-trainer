/* 调音器模块临时自测脚本（node 环境，无 DOM / 无麦克风）
 * 运行：node tools/_t_tuner.js
 * 验证：模块注册、isSupported 返回 false 且不抛异常、unsupportedReason 返回非空中文。
 */
'use strict';

global.APP = {};
const path = require('path');
const tuner = require(path.join(__dirname, '..', 'src', 'audio', 'tuner.js'));

let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  [ok]   ' + name);
  } else {
    failed++;
    console.log('  [FAIL] ' + name + (extra !== undefined ? ('  => ' + extra) : ''));
  }
}

console.log('== 1. 模块注册 ==');
check('require 返回对象', tuner && typeof tuner === 'object');
check('已注册到 global.APP.tuner', global.APP.tuner === tuner);
check('typeof isSupported === "function"', typeof tuner.isSupported === 'function');
check('typeof unsupportedReason === "function"', typeof tuner.unsupportedReason === 'function');
check('typeof open === "function"', typeof tuner.open === 'function');

console.log('== 2. isSupported() 在 node 环境 ==');
let sup, supErr = null;
try { sup = tuner.isSupported(); } catch (e) { supErr = e; }
check('不抛异常', supErr === null, supErr && supErr.stack);
check('返回 false', sup === false, String(sup));
check('返回类型为 boolean', typeof sup === 'boolean');

console.log('== 3. unsupportedReason() ==');
let reason, rErr = null;
try { reason = tuner.unsupportedReason(); } catch (e) { rErr = e; }
check('不抛异常', rErr === null, rErr && rErr.stack);
check('返回非空字符串', typeof reason === 'string' && reason.length > 0, JSON.stringify(reason));
check('包含中文', /[\u4e00-\u9fa5]/.test(reason), JSON.stringify(reason));
console.log('  reason = ' + reason);

console.log('== 4. open() 在无 DOM 环境下不抛异常 ==');
let sess, oErr = null;
try { sess = tuner.open(null, { stdPitch: 442, mode: 'guitar' }); } catch (e) { oErr = e; }
check('open(null) 不抛异常', oErr === null, oErr && oErr.stack);
check('返回 session 对象', sess && typeof sess === 'object');
check('session.start/stop/close/isRunning 都是函数',
  sess && typeof sess.start === 'function' && typeof sess.stop === 'function' &&
  typeof sess.close === 'function' && typeof sess.isRunning === 'function');
if (sess) {
  let sErr = null;
  try {
    const p = sess.start();
    check('start() 返回 Promise', p && typeof p.then === 'function');
    if (p && typeof p.then === 'function') p.then((v) => check('start() resolve 为 false', v === false, String(v)));
  } catch (e) { sErr = e; }
  check('start() 不抛异常', sErr === null, sErr && sErr.stack);
  let cErr = null;
  try { sess.stop(); sess.stop(); sess.close(); sess.close(); } catch (e) { cErr = e; }
  check('stop()/close() 重复调用安全', cErr === null, cErr && cErr.stack);
  check('close() 后 isRunning() === false', sess.isRunning() === false);
}

console.log('== 5. 频率换算与检测算法（内部实现） ==');
if (sess && sess._private) {
  const P = sess._private;
  check('midiToFreq(69, 440) ≈ 440', Math.abs(P.midiToFreq(69, 440) - 440) < 1e-6, P.midiToFreq(69, 440));
  check('midiToFreq(69, 442) ≈ 442', Math.abs(P.midiToFreq(69, 442) - 442) < 1e-6, P.midiToFreq(69, 442));
  check('midiToFreq(40, 440) ≈ 82.41 (吉他 6 弦 E2)',
    Math.abs(P.midiToFreq(40, 440) - 82.4069) < 0.01, P.midiToFreq(40, 440));
  check('freqToMidiFloat(440, 440) ≈ 69', Math.abs(P.freqToMidiFloat(440, 440) - 69) < 1e-6);
  check('centsBetween(443, 440) ≈ +11.8', Math.abs(P.centsBetween(443, 440) - 11.766) < 0.05,
    P.centsBetween(443, 440));

  const d = P.makeDetection(P.midiToFreq(57, 440), 440); // A3
  check('makeDetection(A3) 音名为 A3', d.name === 'A3', d.name);
  check('makeDetection(A3) cents ≈ 0', Math.abs(d.cents) < 0.01, d.cents);
  check('makeDetection 输出契约字段',
    ['freq', 'midiFloat', 'midi', 'cents', 'note', 'octave', 'name'].every((k) => k in d),
    Object.keys(d).join(','));

  // 合成正弦波（220Hz / 440Hz）验证自相关检测
  const sr = 44100, N = 4096;
  function sine(freq) {
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++) b[i] = 0.4 * Math.sin(2 * Math.PI * freq * i / sr);
    return b;
  }
  [[220, 'A3'], [440, 'A4'], [82.41, 'E2'], [987.77, 'B5']].forEach(([f, label]) => {
    const r = P.detectPitch(sine(f), sr, 50, 1200);
    const ok = r && Math.abs(r.freq - f) < f * 0.005; // 误差 < 0.5%
    check('detectPitch(' + f + 'Hz / ' + label + ') 误差 < 0.5%',
      ok, r ? r.freq.toFixed(3) + 'Hz clarity=' + r.clarity.toFixed(3) : 'null');
  });
  check('detectPitch(静音) 返回 null',
    P.detectPitch(new Float32Array(N), sr, 50, 1200) === null);
}

console.log('== 6. 常量 ==');
check('MIN_FREQ = 50', tuner.MIN_FREQ === 50);
check('MAX_FREQ = 1200', tuner.MAX_FREQ === 1200);
check('吉他 6 根弦', tuner.GUITAR_STRINGS.length === 6, tuner.GUITAR_STRINGS.length);
check('尤克里里 4 根弦', tuner.UKULELE_STRINGS.length === 4, tuner.UKULELE_STRINGS.length);

/* ---------- 7. 用极简 DOM 桩验证 UI 构建与事件绑定（无浏览器也能跑） ---------- */
console.log('== 7. UI 构建（DOM 桩，安全上下文 + 有麦克风） ==');

function makeStub() {
  const node = {
    nodeType: 1,
    tagName: '',
    childNodes: [],
    parentNode: null,
    className: '',
    textContent: '',
    _attrs: {},
    _listeners: {},
    style: { setProperty(k, v) { this[k] = v; } },
    classList: {
      add(c) { if (!node.className.split(/\s+/).includes(c)) node.className = (node.className + ' ' + c).trim(); },
      remove(c) { node.className = node.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return node.className.split(/\s+/).includes(c); }
    },
    get children() { return node.childNodes.filter(n => n.nodeType === 1); },
    get firstChild() { return node.childNodes[0] || null; },
    appendChild(c) { c.parentNode = node; node.childNodes.push(c); return c; },
    removeChild(c) { node.childNodes = node.childNodes.filter(x => x !== c); c.parentNode = null; return c; },
    querySelector(sel) {
      const find = (n) => {
        for (const k of n.childNodes) {
          if (k.nodeType !== 1) continue;
          if (sel.startsWith('.') && k.classList.contains(sel.slice(1))) return k;
          const r = find(k); if (r) return r;
        }
        return null;
      };
      return find(node);
    },
    setAttribute(k, v) { node._attrs[k] = String(v); if (k === 'class') node.className = String(v); },
    getAttribute(k) { return node._attrs[k] !== undefined ? node._attrs[k] : null; },
    addEventListener(ev, fn) { (node._listeners[ev] = node._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    getContext() { return null; },
    clientWidth: 320,
    fire(ev) { (node._listeners[ev] || []).forEach(fn => fn({ target: node })); }
  };
  return node;
}

global.document = {
  createElement: (tag) => { const n = makeStub(); n.tagName = tag.toUpperCase(); return n; },
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t), parentNode: null }),
  querySelector: () => null,
  readyState: 'complete',
  body: makeStub()
};
global.window = {
  APP: global.APP,
  AudioContext: function () { /* 桩 */
    this.state = 'running';
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.destination = {};
    this.createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
    this.createAnalyser = () => ({ fftSize: 2048, connect() {}, disconnect() {}, getFloatTimeDomainData() {} });
    this.createOscillator = () => ({ type: 'sine', frequency: { value: 440 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null });
    this.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} });
    this.close = () => Promise.resolve();
    this.resume = () => Promise.resolve();
  },
  devicePixelRatio: 2,
  isSecureContext: true
};
/* node 里 navigator/location 是只读 getter，用 defineProperty 覆盖 */
function setGlobal(name, value) {
  Object.defineProperty(global, name, { value, writable: true, configurable: true, enumerable: true });
}

setGlobal('navigator', {
  mediaDevices: {
    getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }),
    enumerateDevices: () => Promise.resolve([{ kind: 'audioinput' }])
  }
});
setGlobal('location', { protocol: 'https:', hostname: 'example.github.io' });
global.requestAnimationFrame = (fn) => { setTimeout(() => fn(0), 0); return 1; };
global.cancelAnimationFrame = () => {};

check('安全上下文下 isSupported() === true', tuner.isSupported() === true);
check('安全上下文下 unsupportedReason() === ""', tuner.unsupportedReason() === '');

const host = makeStub();
let uiHost = null, uiErr = null;
try {
  const t2 = require(path.join(__dirname, '..', 'src', 'audio', 'tuner.js'));
  uiHost = t2.open(host, { mode: 'guitar', stdPitch: 442, onDetection() {}, onLevel() {} });
} catch (e) { uiErr = e; }
check('open(元素) 构建 UI 不抛异常', uiErr === null, uiErr && uiErr.stack);
check('容器内已插入 .tuner-wrap', !!(host.querySelector ? findClass(host, 'tuner-wrap') : null));

function findClass(n, cls) {
  for (const k of n.childNodes) {
    if (k.nodeType !== 1) continue;
    if (k.classList && k.classList.contains(cls)) return k;
    const r = findClass(k, cls); if (r) return r;
  }
  return null;
}

if (uiHost) {
  check('session.isRunning() 初始为 false', uiHost.isRunning() === false);
  const mic = findClass(host, 'tuner-mic');
  check('存在麦克风开关按钮', !!mic);
  check('吉他模式渲染出 6 个弦按钮', host.childNodes.length > 0 && (function () {
    const s = findClass(host, 'tuner-strings');
    return s && s.children.length === 6;
  })());
  if (mic) {
    let e2 = null;
    try { mic.fire('click'); mic.fire('click'); } catch (e) { e2 = e; }
    check('点击麦克风开关不抛异常', e2 === null, e2 && e2.stack);
  }
  let e3 = null;
  try {
    uiHost.setMode('ukulele');
    uiHost.setMode('chromatic');
    uiHost.playReference();
  } catch (e) { e3 = e; }
  check('模式切换/参考音调用不抛异常', e3 === null, e3 && e3.stack);

  uiHost.setStdPitch(415);
  check('setStdPitch(415) 生效', uiHost.getStdPitch() === 415, uiHost.getStdPitch());
  uiHost.setStdPitch(466);
  check('setStdPitch(466) 生效', uiHost.getStdPitch() === 466, uiHost.getStdPitch());
  uiHost.setStdPitch(9999);
  check('setStdPitch 超范围被夹到 466', uiHost.getStdPitch() === 466, uiHost.getStdPitch());
  uiHost.setStdPitch(1);
  check('setStdPitch 低于范围被夹到 415', uiHost.getStdPitch() === 415, uiHost.getStdPitch());
  let e5 = null;
  try { uiHost.setThreshold(0.02); } catch (e) { e5 = e; }
  check('setThreshold 不抛异常', e5 === null, e5 && e5.stack);
  check('尤克里里 4 根弦', (function () {
    uiHost.setMode('ukulele');
    const s = findClass(host, 'tuner-strings');
    return s && s.children.length === 4;
  })());
  let e4 = null;
  try { uiHost.stop(); uiHost.stop(); uiHost.close(); uiHost.close(); } catch (e) { e4 = e; }
  check('UI 模式下 stop/close 幂等安全', e4 === null, e4 && e4.stack);
}

console.log('');
if (failed) {
  console.log('结果：' + failed + ' 项失败');
  process.exit(1);
} else {
  console.log('结果：全部通过');
}
