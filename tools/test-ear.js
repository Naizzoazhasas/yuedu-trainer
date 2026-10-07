/* 读谱训练器 — 听辨练习测试（重点覆盖「作答后公布答案」）
 * 运行： node tools/test-ear.js
 */
'use strict';

var path = require('path');
var dom = require(path.join(__dirname, 'dom-shim.js'));
var doc = dom.install();
global.window = global;

require(path.join(__dirname, '..', 'src', 'core', 'util.js'));
require(path.join(__dirname, '..', 'src', 'core', 'theory.js'));
require(path.join(__dirname, '..', 'src', 'core', 'generator.js'));
require(path.join(__dirname, '..', 'src', 'core', 'renderer.js'));
require(path.join(__dirname, '..', 'src', 'features', 'ear.js'));

var APP = global.APP;
var U = APP.util, TH = APP.theory, Ear = APP.ear;

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; msgs.push('  \u2717 ' + name + (detail ? '  \u2192 ' + detail : '')); }
}

console.log('=== 听辨练习测试 ===\n');

/* ---------- 1. 打分函数（已有逻辑，回归保护） ---------- */
console.log('1. 节奏打分');
var perfect = [0, 0.5, 1.0, 1.5, 2.0];
var r1 = Ear.scoreTaps(perfect, perfect);
ok('完全吻合应该满分', r1.score === 100, 'score=' + r1.score);

var shifted = perfect.map(function (t) { return t * 1.5; });   // 整体慢 50%
ok('整体放慢（只改速度）不影响分数', Ear.scoreTaps(shifted, perfect).score === 100,
  'score=' + Ear.scoreTaps(shifted, perfect).score);

var wrong = [0, 0.2, 1.4, 1.5, 2.6];                          // 时值错乱
ok('时值错乱会扣分', Ear.scoreTaps(wrong, perfect).score < 80, 'score=' + Ear.scoreTaps(wrong, perfect).score);
ok('敲太少给 0 分并不抛异常', Ear.scoreTaps([0.1], perfect).score === 0);

/* ---------- 2. 出题与公布答案 ---------- */
console.log('2. 出题与公布答案');

function mountEar() {
  var host = doc.createElement('div');
  doc.body.appendChild(host);
  var session = Ear.mount(host, {
    getEngine: function () { return null; },      // 无音频引擎，避免依赖
    getKey: function () { return { tonic: 2, mode: 'major' }; },
    getTempo: function () { return 72; },
    onRecord: function () {}
  });
  return { host: host, session: session };
}

/* --- 音程模式：点选项后必须出现谱面答案 --- */
(function () {
  var m = mountEar();
  var host = m.host;
  /* 切到音程模式：模式按钮 data-mode="interval" */
  var modeBtns = U.queryAll('.chip', host);
  var intervalBtn = null;
  modeBtns.forEach(function (b) { if (b.getAttribute('data-mode') === 'interval') intervalBtn = b; });
  ok('音程模式按钮存在', !!intervalBtn);
  if (intervalBtn) intervalBtn.dispatch('click');

  var choiceBtns = U.queryAll('.ear-choices .chip', host);
  ok('音程模式有若干选项按钮', choiceBtns.length >= 6, 'got ' + choiceBtns.length);
  ok('选项按钮带 data-value', choiceBtns.length > 0 && choiceBtns[0].getAttribute('data-value') !== null,
    'value=' + (choiceBtns[0] && choiceBtns[0].getAttribute('data-value')));

  /* 随便点一个（对或错都应该公布答案） */
  if (choiceBtns.length) choiceBtns[0].dispatch('click');

  var answerBox = host.querySelector('.ear-answer-box');
  ok('作答后出现答案区（.ear-answer-box）', !!answerBox);
  ok('答案区有标题', !!host.querySelector('.ear-answer-title'));
  ok('答案区显示了正确谱面或文字说明',
    !!host.querySelector('.ear-answer-sheet svg') || !!host.querySelector('.ear-answer-text'),
    'sheet=' + host.querySelectorAll('.ear-answer-sheet svg').length);
  var right = host.querySelectorAll('.ear-choices .chip.right').length;
  var wrongMark = host.querySelectorAll('.ear-choices .chip.wrong').length;
  ok('选项被标注对错（right=' + right + ' wrong=' + wrongMark + '）', right + wrongMark > 0);
  ok('「再听一遍」按钮存在', !!U.queryAll('.ear-answer-box .btn', host).length);
})();

/* --- 节奏模式：做完题后必须出现谱面答案 --- */
(function () {
  var m = mountEar();
  var host = m.host;
  /* 已经在默认的 rhythm 模式 */
  var answerBtn = host.querySelector('.ear-actions .btn.accent') ||
    U.queryAll('.btn', host).filter(function (b) { return b.textContent.indexOf('开始作答') >= 0; })[0];
  ok('节奏模式有「开始作答」按钮', !!answerBtn);
  if (answerBtn) answerBtn.dispatch('click');

  /* 连点敲拍按钮足够多次 */
  var tap = host.querySelector('.ear-tap');
  ok('敲拍按钮存在', !!tap);
  if (tap) {
    for (var i = 0; i < 12; i++) {
      tap.dispatch('click');
    }
  }
  var answerBox2 = host.querySelector('.ear-answer-box');
  ok('节奏作答后出现答案区', !!answerBox2);
  ok('节奏答案区有标题「正确答案」', (function () {
    var t = host.querySelector('.ear-answer-title');
    return !!t && t.textContent.indexOf('正确答案') >= 0;
  })(), (host.querySelector('.ear-answer-title') || {}).textContent);
  ok('节奏答案给出了谱面', !!host.querySelector('.ear-answer-sheet svg'),
    'svg=' + host.querySelectorAll('.ear-answer-sheet svg').length);
  ok('公布答案时收起敲拍键盘', (function () {
    var pad = host.querySelector('.ear-pad');
    return !!pad && pad.style.display === 'none';
  })());
})();

/* ---------- 3. 鲁棒性 ---------- */
console.log('3. 鲁棒性');
ok('mount(null) 不抛异常', (function () {
  try { Ear.mount(null, {}); return true; } catch (e) { return false; }
})());
ok('没有 getEngine 也能出题', (function () {
  try {
    var host = doc.createElement('div');
    doc.body.appendChild(host);
    Ear.mount(host, {});
    return !!host.querySelector('.ear-tap');
  } catch (e) { return false; }
})());
ok('onsetsOf 对空小节返回空数组', (function () {
  try { return Ear.onsetsOf({ bars: [] }, 0).length === 0; } catch (e) { return false; }
})());

console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (msgs.length) console.log(msgs.join('\n'));
process.exit(fail ? 1 : 0);
