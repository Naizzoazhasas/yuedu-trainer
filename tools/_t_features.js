/* 读谱训练器 — 功能模块自测（音型库 library.js + 练习模式 practice.js）
 * 运行： node tools/_t_features.js
 * 依赖 tools/dom-shim.js 提供的最小 DOM + localStorage。
 */
'use strict';

var path = require('path');
var dom = require(path.join(__dirname, 'dom-shim.js'));
dom.install();                                  /* 必须先装 DOM 桩，模块里会用到 document */

var ROOT = path.join(__dirname, '..');
var LIB_PATH = path.join(ROOT, 'src', 'features', 'library.js');
var PRAC_PATH = path.join(ROOT, 'src', 'features', 'practice.js');

require(path.join(ROOT, 'src', 'core', 'util.js'));
require(path.join(ROOT, 'src', 'core', 'theory.js'));
var G = require(path.join(ROOT, 'src', 'core', 'generator.js'));
require(LIB_PATH);
require(PRAC_PATH);

var APP = global.APP;
var library = APP.library;
var practice = APP.practice;

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; msgs.push('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

console.log('=== 功能模块测试（音型库 / 练习模式）===');

/* ---------------- 1. 注册与 API ---------------- */
section('1. 模块注册与 API 完整性');

ok('APP.library 已注册', !!(library && typeof library === 'object'));
ok('APP.practice 已注册', !!(practice && typeof practice === 'object'));

var LIB_API = ['all', 'builtins', 'custom', 'add', 'remove', 'rename', 'clear',
  'onChange', 'getActive', 'setActive', 'toggleActive', 'mount'];
LIB_API.forEach(function (k) {
  ok('library.' + k + ' 是函数', typeof library[k] === 'function');
});
ok("library.storageKey === 'yuedu.customPatterns'", library.storageKey === 'yuedu.customPatterns', String(library.storageKey));

var PRAC_API = ['mount', 'mountStats', 'record', 'stats', 'clearRecords'];
PRAC_API.forEach(function (k) {
  ok('practice.' + k + ' 是函数', typeof practice[k] === 'function');
});
ok("practice.storageKey === 'yuedu.practiceLog'", practice.storageKey === 'yuedu.practiceLog', String(practice.storageKey));

/* ---------------- 2. 内置节奏型拍数精确 ---------------- */
section('2. 内置节奏型：拍数必须精确等于拍号');

library.clear();
var bs = library.builtins();
ok('内置节奏型 ≥ 10 条', bs.length >= 10, '实际 ' + bs.length);

var meters = {};
var bad = [];
bs.forEach(function (p) {
  var want = p.time.num * (4 / p.time.den);
  var got = G.patternBeats(p.items);
  meters[p.time.num + '/' + p.time.den] = (meters[p.time.num + '/' + p.time.den] || 0) + 1;
  if (Math.abs(got - want) > 1e-9) bad.push(p.id + ' got=' + got + ' want=' + want);
  ok('内置拍数精确 ' + p.id, Math.abs(got - want) < 1e-9, 'got=' + got + ' want=' + want);
  ok('内置结构合法 ' + p.id, typeof p.id === 'string' && typeof p.name === 'string' &&
    p.time && typeof p.time.num === 'number' && typeof p.time.den === 'number' &&
    Array.isArray(p.items) && p.items.length > 0, JSON.stringify(p).slice(0, 80));
});
['4/4', '3/4', '2/4', '6/8'].forEach(function (m) {
  ok('覆盖拍号 ' + m, meters[m] > 0, JSON.stringify(meters));
});

console.log('  内置节奏型清单：');
bs.forEach(function (p) {
  console.log('   · ' + p.name + '  ' + p.time.num + '/' + p.time.den +
    '  拍数=' + G.patternBeats(p.items));
});

/* ---------------- 3. 自定义增删改 + 持久化 ---------------- */
section('3. 自定义节奏型：add / remove / rename / clear / onChange / 持久化');

var changes = 0;
var off = library.onChange(function () { changes++; });

var added = library.add({
  name: '测试节奏型', time: { num: 3, den: 4 },
  items: [{ dur: 2, dotted: false, rest: false }, { dur: 1, dotted: false, rest: false }]
});
ok('add 返回 Pattern', !!(added && added.id && added.name === '测试节奏型' && added.time.num === 3 &&
  added.items.length === 2), JSON.stringify(added));
ok('add 后 custom() 有 1 条', library.custom().length === 1);
ok('add 后 all() = 内置 + 1', library.all().length === bs.length + 1);
ok('add 触发了 onChange', changes >= 1, 'changes=' + changes);
ok('add 写入了 localStorage', String(localStorage.getItem(library.storageKey)).indexOf('测试节奏型') >= 0);

var changesBefore = changes;
ok('rename 成功', library.rename(added.id, '改名后的节奏型') === true);
ok('rename 生效', library.get(added.id).name === '改名后的节奏型');
ok('rename 触发 onChange', changes === changesBefore + 1);
ok('rename 空名被拒绝', library.rename(added.id, '   ') === false);
ok('rename 不存在的 id 返回 false', library.rename('no-such-id', 'x') === false);

ok('内置节奏型不可删除', library.remove(bs[0].id) === false);
ok('内置节奏型不可重命名', library.rename(bs[0].id, 'x') === false);

/* setActive / toggleActive */
library.setActive([bs[0].id]);
ok('setActive 后 getActive 只有 1 条', library.getActive().length === 1);
ok('setActive 持久化', String(localStorage.getItem('yuedu.activePatterns')).indexOf(bs[0].id) >= 0);
ok('toggleActive 取消勾选返回 false', library.toggleActive(bs[0].id) === false);
ok('toggleActive 后 getActive 为空', library.getActive().length === 0);
ok('toggleActive 勾选返回 true', library.toggleActive(bs[1].id) === true);
ok('toggleActive 后 getActive 有 1 条', library.getActive().length === 1);
library.setActive(bs.map(function (p) { return p.id; }));
ok('setActive 全选', library.getActive().length === bs.length);
library.setActive([]);
ok('setActive 全不选', library.getActive().length === 0);

/* 取消订阅后不再回调 */
off();
var frozen = changes;
library.add({ name: '第二型', time: { num: 2, den: 4 }, items: [{ dur: 1 }, { dur: 1 }] });
ok('unsubscribe 后不再回调', changes === frozen, 'changes=' + changes + ' frozen=' + frozen);

/* 持久化：清掉 require 缓存后重新加载模块，仍能读到 */
(function () {
  library.setActive([bs[0].id]);
  delete require.cache[require.resolve(LIB_PATH)];
  require(LIB_PATH);
  library = APP.library;
  var names = library.custom().map(function (p) { return p.name; });
  ok('重新安装模块后自定义仍在（持久化）', names.indexOf('改名后的节奏型') >= 0 && names.length === 2, names.join(','));
  ok('重新安装模块后 active 仍在', library.getActive().length === 1 &&
    library.getActive()[0].id === bs[0].id, JSON.stringify(library.getActive().map(function (p) { return p.id; })));
})();

ok('clear 只清自定义', (function () {
  library.clear();
  return library.custom().length === 0 && library.builtins().length === bs.length;
})());
ok('clear 后 localStorage 里没有自定义', JSON.parse(localStorage.getItem(library.storageKey) || '[]').length === 0);

/* ---------------- 4. library.mount ---------------- */
section('4. library.mount 在 DOM 桩上构建 UI');

library.clear();
var libHost = document.createElement('div');
var libCtl = null;
var mountErr = null;
try {
  libCtl = library.mount(libHost, {
    getCurrentBar: function () {
      return { notes: [{ dur: 1, dotted: false, pitch: { step: 'C', acc: 0, oct: 4 } }, { dur: 1, dotted: false, pitch: null }] };
    },
    getTempo: function () { return 90; },
    onChange: function () { /* 容错：回调存在即可 */ }
  });
} catch (e) { mountErr = e; }
ok('library.mount 不抛异常', !mountErr, mountErr && mountErr.stack);
ok('mount 返回 refresh()', !!(libCtl && typeof libCtl.refresh === 'function'));
ok('mount 建出 .lib-root', !!libHost.querySelector('.lib-root'));
ok('mount 建出 ≥10 个 .lib-item', libHost.querySelectorAll('.lib-item').length >= 10,
  'n=' + libHost.querySelectorAll('.lib-item').length);
ok('每个音型都有 .lib-preview', libHost.querySelectorAll('.lib-preview').length ===
  libHost.querySelectorAll('.lib-item').length);
ok('预览按拍分组（.lib-beat-group）', libHost.querySelectorAll('.lib-beat-group').length > 0);
ok('预览有图形方块（.lib-cell）', libHost.querySelectorAll('.lib-cell').length > 0);
ok('有「参用生成」勾选（.lib-active）', libHost.querySelectorAll('.lib-active').length >= 10);
ok('有编辑器时间轴（.lib-timeline）', !!libHost.querySelector('.lib-timeline'));
ok('有填充状态（.lib-fill-status）', !!libHost.querySelector('.lib-fill-status'));
ok('有时值按钮（.lib-dur-btn）', libHost.querySelectorAll('.lib-dur-btn').length === G.DURATION_LIST.length,
  'n=' + libHost.querySelectorAll('.lib-dur-btn').length);
ok('有采集按钮（.lib-collect-btn）', !!libHost.querySelector('.lib-collect-btn'));
ok('有保存按钮（.lib-save-btn）', !!libHost.querySelector('.lib-save-btn'));

/* 全音符 → 图形块为 '█'；休止 → '0' */
var cell0 = libHost.querySelector('.lib-cell');
ok('图形符号可用（首个方块非空）', !!cell0 && cell0.textContent.length > 0, cell0 && cell0.textContent);

/* 编辑器交互：加二分音符 → 已填 2 拍 → 保存 */
var beatsInput = libHost.querySelector('.lib-editor-beats');
beatsInput.value = '2';
beatsInput.dispatch('change');
libHost.querySelectorAll('.lib-dur-btn')[1].click();          /* DURATION_LIST[1] = 二分音符 */
var fillText = libHost.querySelector('.lib-fill-status').textContent;
ok('填充状态显示「已填 2 / 共 2 拍」', fillText.indexOf('已填') >= 0 && fillText.indexOf('正好填满') >= 0, fillText);
ok('正好填满时高亮 is-exact', String(libHost.querySelector('.lib-fill-status').className).indexOf('is-exact') >= 0);
libHost.querySelector('.lib-save-btn').click();
ok('编辑器保存写入音型库', library.custom().length === 1, 'n=' + library.custom().length);
ok('保存的节奏型拍数为 2', Math.abs(G.patternBeats(library.custom()[0].items) - 2) < 1e-9);

/* 采集当前小节 */
var beforeCollect = library.custom().length;
libHost.querySelector('.lib-collect-btn').click();
ok('从当前乐段采集新增一条', library.custom().length === beforeCollect + 1,
  beforeCollect + ' → ' + library.custom().length);
ok('采集出的节奏型拍数为 2', Math.abs(G.patternBeats(library.custom()[library.custom().length - 1].items) - 2) < 1e-9);

/* 试听：无 engine 时按钮禁用；有桩 engine 时调用 playScore */
ok('无引擎时试听按钮禁用', libHost.querySelector('.lib-audition-btn').disabled === true ||
  libHost.querySelector('.lib-audition-btn').getAttribute('disabled') !== null);
var libAuditionCalls = [];
var libStubEngine = {
  init: function () {},
  playScore: function (score, opts) {
    libAuditionCalls.push({ score: score, opts: opts });
    return { stop: function () {}, on: function () { return function () {}; } };
  }
};
var libHost2 = document.createElement('div');
library.mount(libHost2, { engine: libStubEngine, getTempo: function () { return 100; } });
libHost2.querySelectorAll('.lib-dur-btn')[0].click();          /* 全音符：4 拍 */
libHost2.querySelector('.lib-audition-btn').click();
ok('试听调用 engine.playScore', libAuditionCalls.length === 1, 'n=' + libAuditionCalls.length);
ok('试听 score 只含一个小节且 mode=rhythm', (function () {
  var s = libAuditionCalls[0] && libAuditionCalls[0].score;
  return !!s && s.bars.length === 1 && s.mode === 'rhythm' && Math.abs(s.bars[0].beats - G.patternBeats(bs[0].items)) < 1e-9;
})());
ok('试听使用 getTempo 的速度', libAuditionCalls[0] && libAuditionCalls[0].score.tempo === 100);

/* 预览分数检查：patternToScore 生成的 score 小节拍数与原节奏型一致 */
ok('patternToScore 小节拍数一致', (function () {
  var p = bs[5];
  var s = library.patternToScore(p, 90);
  return s.bars.length === 1 && Math.abs(s.bars[0].beats - G.patternBeats(p.items)) < 1e-9 &&
    s.bars[0].notes.length === p.items.length && s.mode === 'rhythm';
})());

/* ---------------- 5. practice.mount ---------------- */
section('5. practice.mount：无引擎 / 桩引擎');

var score = G.generateRhythm({ bars: 2, time: { num: 4, den: 4 }, tempo: 60, seed: 7 });

/* 5a. 没有 engine 时不抛异常、start 安全失败 */
var oldEngine = APP.engine;
try { delete APP.engine; } catch (e) { APP.engine = undefined; }
var pHost0 = document.createElement('div');
var pCtl0 = null;
var pErr0 = null;
try { pCtl0 = practice.mount(pHost0, {}); } catch (e) { pErr0 = e; }
ok('无引擎时 practice.mount 不抛异常', !pErr0, pErr0 && pErr0.stack);
ok('无引擎时建出 .prac-root', !!pHost0.querySelector('.prac-root'));
ok('无引擎时 start() 不抛异常', (function () {
  try { pCtl0.start(); return true; } catch (e) { return false; }
})());
ok('无引擎时状态仍为 idle', pCtl0.getState().status === 'idle');

/* 5b. 桩 engine：验证 start / onNote / setTempo / stop */
var calls = { playScore: [], stop: 0, pause: 0, resume: 0, setTempo: [] };
var stubTransport = {
  stop: function () { calls.stop++; },
  pause: function () { calls.pause++; },
  resume: function () { calls.resume++; },
  setTempo: function (b) { calls.setTempo.push(b); },
  on: function () { return function () {}; }
};
var stubEngine = {
  init: function () {},
  playScore: function (s, o) { calls.playScore.push({ score: s, opts: o }); return stubTransport; }
};

var pHost = document.createElement('div');
var requested = [], highlighted = [];
var pCtl = null;
var pErr = null;
try {
  pCtl = practice.mount(pHost, {
    engine: stubEngine,
    getScore: function () { return score; },
    onRequestNew: function (o) { requested.push(o); },
    onHighlight: function (bar, note) { highlighted.push([bar, note]); }
  });
} catch (e) { pErr = e; }
ok('桩引擎下 practice.mount 不抛异常', !pErr, pErr && pErr.stack);
ok('controller 有全部方法', !!(pCtl && typeof pCtl.start === 'function' && typeof pCtl.stop === 'function' &&
  typeof pCtl.pause === 'function' && typeof pCtl.destroy === 'function' &&
  typeof pCtl.setTempo === 'function' && typeof pCtl.getState === 'function'));
ok('桩引擎下 UI 类名 .prac- 存在', pHost.querySelectorAll('.prac-countdown').length === 1 &&
  pHost.querySelectorAll('.prac-chart').length === 0 && !!pHost.querySelector('.prac-progress-bar'));

pCtl.start();
ok('start() 调用 engine.playScore', calls.playScore.length === 1, 'n=' + calls.playScore.length);
var call = calls.playScore[0] || { opts: {} };
ok('playScore 带 onNote 回调', typeof call.opts.onNote === 'function');
ok('playScore 带 onBar 回调', typeof call.opts.onBar === 'function');
ok('playScore 带 onEnd 回调', typeof call.opts.onEnd === 'function');
ok('预备拍默认 4（status=counting）', pCtl.getState().status === 'counting', pCtl.getState().status);
ok('start 时启动倒计时显示', pHost.querySelector('.prac-countdown').textContent.length > 0);

call.opts.onNote(0, 1, score.bars[1].notes[0], { index: 2 });
ok('onNote 更新状态 bar/note', pCtl.getState().bar === 1 && pCtl.getState().note === 2,
  JSON.stringify(pCtl.getState()));
ok('onNote 调用 opts.onHighlight', highlighted.length === 1 && highlighted[0][0] === 1 && highlighted[0][1] === 2,
  JSON.stringify(highlighted));
ok('onNote 后状态转为 playing', pCtl.getState().status === 'playing');
call.opts.onBar(0);
ok('onBar 更新当前小节', pCtl.getState().bar === 0);

pCtl.setTempo(90);
ok('setTempo 传给 transport', calls.setTempo.indexOf(90) >= 0, JSON.stringify(calls.setTempo));
ok('setTempo 更新状态', pCtl.getState().tempo === 90);

pCtl.pause();
ok('pause() 调用 transport.pause 且状态 paused', calls.pause === 1 && pCtl.getState().status === 'paused');
pCtl.pause();
ok('再次 pause() 恢复播放', calls.resume === 1 && pCtl.getState().status === 'playing');

pCtl.stop();
ok('stop() 调用 transport.stop', calls.stop === 1, 'n=' + calls.stop);
ok('stop() 后状态 idle', pCtl.getState().status === 'idle');
ok('scrollToBar 在无 .score-sheet 时安全跳过', (function () {
  try { pCtl.scrollToBar(0); return true; } catch (e) { return false; }
})());

/* 预备拍可选 0；循环 / 节拍器开关可切换 */
var countInSel = pHost.querySelector('.prac-countin');
countInSel.value = '0';
countInSel.dispatch('change');
pCtl.start();
ok('预备拍 0 时直接 playing', pCtl.getState().status === 'playing', pCtl.getState().status);
pCtl.stop();

/* 速度渐变：onEnd 后请求新乐段（onRequestNew） */
var gradualHost = document.createElement('div');
var gradualReq = [];
var newScore = G.generateRhythm({ bars: 2, time: { num: 4, den: 4 }, tempo: 80, seed: 9 });
var currentScore = score;
var gCtl = practice.mount(gradualHost, {
  engine: stubEngine,
  getScore: function () { return currentScore; },
  onRequestNew: function (o) { gradualReq.push(o); currentScore = newScore; }
});
gradualHost.querySelector('.prac-gradual').checked = true;
gradualHost.querySelector('.prac-gradual').dispatch('change');
gradualHost.querySelector('.prac-start-tempo').value = '60';
gradualHost.querySelector('.prac-target-tempo').value = '80';
gradualHost.querySelector('.prac-step').value = '10';
gradualHost.querySelector('.prac-repeat').value = '1';
gCtl.start();
var gCall = calls.playScore[calls.playScore.length - 1];
gCall.opts.onNote(0, 0, score.bars[0].notes[0], { index: 0 });
gCall.opts.onEnd();
ok('onEnd 触发 onRequestNew（速度渐变）', gradualReq.length === 1, JSON.stringify(gradualReq));
ok('onRequestNew 带新的 tempo', gradualReq[0] && gradualReq[0].tempo === 70, JSON.stringify(gradualReq));
ok('onEnd 后状态为 between', gCtl.getState().status === 'between', gCtl.getState().status);
setTimeout(function () {
  ok('拿到新乐段后自动继续播放', calls.playScore.length >= 3 && gCtl.getState().tempo === 70,
    'playScore=' + calls.playScore.length + ' tempo=' + gCtl.getState().tempo);
  gCtl.stop();

  /* ---------------- 6. 记录与统计 ---------------- */
  section('6. practice.record / stats / clearRecords');

  practice.clearRecords();
  ok('清空后 totalSessions = 0', practice.stats().totalSessions === 0);

  var r1 = practice.record({ score: score, tempo: 60, accuracy: null, seconds: 30 });
  var r2 = practice.record({ score: newScore, tempo: 90, accuracy: 0.8, seconds: 90 });
  var r3 = practice.record({ score: score, tempo: 120, seconds: 60 });
  ok('record 返回结构完整', !!(r1 && r1.id && r1.at && r1.bars === 2 && r1.tempo === 60 &&
    typeof r1.seconds === 'number' && r1.mode === 'rhythm' && 'accuracy' in r1), JSON.stringify(r1));
  ok('record 保留 accuracy（无真实输入时为 null）', r1.accuracy === null && r2.accuracy === 0.8);
  ok('record 写入 localStorage', JSON.parse(localStorage.getItem(practice.storageKey)).length === 3);
  ok('record 记录调名', typeof r1.keyName === 'string');

  var s = practice.stats();
  ok('总练习次数 = 3', s.totalSessions === 3, String(s.totalSessions));
  ok('总时长正确（180 秒 = 3 分钟）', Math.abs(s.totalSeconds - 180) < 1e-9 && Math.abs(s.totalMinutes - 3) < 1e-9,
    JSON.stringify({ sec: s.totalSeconds, min: s.totalMinutes }));
  ok('sessions 按时间倒序且长度 3', s.sessions.length === 3 && s.sessions[0].at >= s.sessions[2].at);
  ok('byDate 存在且今天的分钟数为 3', typeof s.byDate === 'object' &&
    Math.abs(s.byDate[dayKey(new Date())] - 3) < 1e-9, JSON.stringify(s.byDate));
  ok('连续练习天数 ≥ 1', s.streakDays >= 1, String(s.streakDays));
  ok('总共 1 条天数记录', s.days.length === 1, JSON.stringify(s.days));

  /* 构造跨日期数据，验证按日期分组与连续天数 */
  function isoAt(daysAgo) {
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12, 0, 0);
    return d.toISOString();
  }
  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  var crafted = [
    { id: 'a', at: isoAt(0), bars: 4, tempo: 60, keyName: 'C 大调', seconds: 60, mode: 'rhythm', accuracy: null },
    { id: 'b', at: isoAt(1), bars: 4, tempo: 70, keyName: 'C 大调', seconds: 120, mode: 'rhythm', accuracy: null },
    { id: 'c', at: isoAt(2), bars: 2, tempo: 80, keyName: 'G 大调', seconds: 60, mode: 'melody', accuracy: null },
    { id: 'd', at: isoAt(10), bars: 8, tempo: 90, keyName: 'F 大调', seconds: 300, mode: 'rhythm', accuracy: null }
  ];
  localStorage.setItem(practice.storageKey, JSON.stringify(crafted));
  var s2 = practice.stats();
  ok('跨日期：totalSessions = 4', s2.totalSessions === 4, String(s2.totalSessions));
  ok('跨日期：总时长 9 分钟', Math.abs(s2.totalMinutes - 9) < 1e-9, String(s2.totalMinutes));
  ok('跨日期：byDate 分组 4 天', Object.keys(s2.byDate).length === 4, JSON.stringify(s2.byDate));
  ok('跨日期：今天 1 分钟', Math.abs(s2.byDate[dayKey(new Date())] - 1) < 1e-9, JSON.stringify(s2.byDate));
  ok('跨日期：昨天 2 分钟', Math.abs(s2.byDate[dayKey(new Date(new Date().setDate(new Date().getDate() - 1)))] - 2) < 1e-9,
    JSON.stringify(s2.byDate));
  ok('跨日期：连续天数 = 3', s2.streakDays === 3, String(s2.streakDays));
  ok('跨日期：days 升序 4 条', s2.days.length === 4 && s2.days[0].date < s2.days[3].date);

  /* 统计面板 */
  var statsHost = document.createElement('div');
  var sCtl = null;
  var sErr = null;
  try { sCtl = practice.mountStats(statsHost); } catch (e) { sErr = e; }
  ok('mountStats 不抛异常', !sErr, sErr && sErr.stack);
  ok('mountStats 建出 .prac-stats', !!statsHost.querySelector('.prac-stats'));
  ok('统计面板有总次数 / 总时长 / 连续天数', statsHost.textContent.indexOf('总练习次数') >= 0 &&
    statsHost.textContent.indexOf('总时长') >= 0 && statsHost.textContent.indexOf('连续练习') >= 0,
    statsHost.textContent.slice(0, 120));
  ok('最近 7 天柱状图 = 7 根柱子', statsHost.querySelectorAll('.prac-chart-col').length === 7,
    'n=' + statsHost.querySelectorAll('.prac-chart-col').length);
  ok('柱状图有高度样式', statsHost.querySelectorAll('.prac-chart-bar').length === 7);
  ok('有清空按钮', !!statsHost.querySelector('.prac-clear-btn'));
  ok('mountStats 返回 refresh()', typeof sCtl.refresh === 'function');
  ok('refresh() 可重复调用', (function () {
    try { sCtl.refresh(); return true; } catch (e) { return false; }
  })());

  practice.clearRecords();
  ok('clearRecords 后 localStorage 为空数组', JSON.parse(localStorage.getItem(practice.storageKey)).length === 0);
  ok('clearRecords 后 totalSessions = 0', practice.stats().totalSessions === 0);

  /* 清理 */
  libCtl.refresh();
  pCtl.destroy();
  gCtl.destroy();
  sCtl.destroy();
  library.clear();

  if (oldEngine === undefined) { try { delete APP.engine; } catch (e) { /* 忽略 */ } } else { APP.engine = oldEngine; }

  /* ---------------- 汇总 ---------------- */
  console.log('\n=== 结果 ===');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (msgs.length) {
    console.log('\n失败明细：');
    msgs.forEach(function (m) { console.log(m); });
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✓');
  }
}, 200);
