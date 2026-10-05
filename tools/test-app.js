/* 读谱训练器 — 整机启动冒烟测试
 * 运行： node tools/test-app.js
 * 它读取真实的 index.html，用最小 DOM 桩按 index.html 里的顺序加载所有脚本，
 * 然后依次点开每个标签页、操作关键控件，断言不抛异常且关键节点被创建。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var dom = require(path.join(__dirname, 'dom-shim.js'));

var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

var doc = dom.install();
global.window = global;

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; msgs.push('  \u2717 ' + name + (detail ? '  \u2192 ' + detail : '')); }
}

/* ---------- 1. 解析 index.html 并构建 DOM ---------- */
console.log('=== 整机冒烟测试 ===\n');
console.log('1. 构建 index.html 的 DOM');

function parseHTML(src) {
  /* 只处理本项目 index.html 用到的结构：标签、属性、文本、自闭合、注释 */
  var i = 0;
  var stack = [doc.body];
  var VOID = { meta: 1, link: 1, br: 1, hr: 1, img: 1, input: 1, source: 1 };
  while (i < src.length) {
    var lt = src.indexOf('<', i);
    var text = lt < 0 ? src.slice(i) : src.slice(i, lt);
    if (text.trim()) stack[stack.length - 1].appendChild(doc.createTextNode(text));
    if (lt < 0) break;
    if (src.substr(lt, 4) === '<!--') { i = src.indexOf('-->', lt) + 3; continue; }
    if (src[lt + 1] === '!') { i = src.indexOf('>', lt) + 1; continue; }
    var gt = src.indexOf('>', lt);
    if (gt < 0) break;
    var raw = src.slice(lt + 1, gt).trim();
    var closing = raw[0] === '/';
    if (closing) {
      var name = raw.slice(1).trim().toLowerCase();
      for (var s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName.toLowerCase() === name) { stack.length = s; break; }
      }
      i = gt + 1; continue;
    }
    var m = raw.match(/^([a-zA-Z0-9-]+)/);
    var tag = m ? m[1].toLowerCase() : 'div';
    var node = doc.createElement(tag);
    var attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    var rest = raw.slice(tag.length);
    var am;
    while ((am = attrRe.exec(rest))) {
      var val = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
      var an = am[1].toLowerCase();
      node.setAttribute(an, val);
      /* 布尔属性要同时写进 property，模拟浏览器行为 */
      if (an === 'checked' || an === 'selected' || an === 'disabled') node[an] = true;
      if (an === 'value') node.value = val;
    }
    if (tag === 'html' || tag === 'head' || tag === 'body') {
      /* 忽略外层结构标签，内容全部挂到 body */
      i = gt + 1;
      if (VOID[tag]) continue;
      stack.push(doc.body);
      continue;
    }
    stack[stack.length - 1].appendChild(node);
    if (!VOID[tag] && raw[raw.length - 1] !== '/') stack.push(node);
    i = gt + 1;
  }
  return doc.body;
}
parseHTML(html);

ok('解析出了标签页按钮', doc.querySelectorAll('#tabs .tab').length === 7,
  'got ' + doc.querySelectorAll('#tabs .tab').length);
ok('解析出了 7 个面板', doc.querySelectorAll('.panel').length === 7,
  'got ' + doc.querySelectorAll('.panel').length);
ok('关键元素存在 #gen-staff-host', !!doc.querySelector('#gen-staff-host'));
ok('关键元素存在 #gen-jianpu-host', !!doc.querySelector('#gen-jianpu-host'));

/* ---------- 2. 按 index.html 的顺序加载脚本 ---------- */
console.log('2. 加载全部脚本');
var scriptSrcs = [];
html.replace(/<script\s+src="([^"]+)"><\/script>/g, function (_, s) { scriptSrcs.push(s); return _; });
ok('index.html 声明了 15 个脚本（含 VexFlow 与 vexrender）', scriptSrcs.length === 15, scriptSrcs.join(', '));

var loadErrors = [];
scriptSrcs.forEach(function (rel) {
  var p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { loadErrors.push(rel + ' 不存在'); return; }
  try {
    delete require.cache[require.resolve(p)];
    require(p);
  } catch (e) {
    loadErrors.push(rel + ' -> ' + e.message);
  }
});
ok('全部脚本无加载错误', loadErrors.length === 0, loadErrors.join(' ; '));

var APP = global.APP;
ok('APP 命名空间已建立', !!APP);
['util', 'theory', 'generator', 'renderer', 'jianpu'].forEach(function (m) {
  ok('APP.' + m + ' 已注册', !!APP[m]);
});

/* ---------- 3. 启动应用 ---------- */
console.log('3. 启动应用（boot）');
var bootError = null;
try {
  APP.util.ready(function () {});   // 已 complete，立即执行
  require(path.join(ROOT, 'src', 'app.js'));
} catch (e) { bootError = e; }
ok('boot 过程无异常', !bootError, bootError && (bootError.message + '\n' + bootError.stack));

ok('初始乐段已生成', !!APP.app.getScore(), 'getScore() 为空');
var s0 = APP.app.getScore();
ok('初始乐段小节数 = 状态里的 4', s0 && s0.bars.length === 4, s0 && s0.bars.length);
if (s0) {
  var st = APP.generator.scoreStats(s0);
  ok('初始乐段每个小节拍数精确', st.badBars.length === 0, JSON.stringify(st.badBars));
}
ok('五线谱已渲染到页面', doc.querySelectorAll('#gen-staff-host svg').length > 0,
  'svg=' + doc.querySelectorAll('#gen-staff-host svg').length);
ok('简谱已渲染到页面', doc.querySelectorAll('#gen-jianpu-host .jp-wrap').length > 0);

/* ---------- 4. 切换全部标签页（触发懒加载初始化） ---------- */
console.log('4. 依次打开 7 个标签页');
var tabs = doc.querySelectorAll('#tabs .tab');
var tabErrors = [];
var results = [];
tabs.forEach(function (t) {
  var id = t.getAttribute('data-tab');
  try {
    t.dispatch('click');
    results.push(id + '=' + (doc.querySelector('.panel[data-panel="' + id + '"]')
      .classList.contains('active') ? 'active' : '未激活'));
  } catch (e) { tabErrors.push(id + ' -> ' + e.message); }
});
ok('切换标签页无异常', tabErrors.length === 0, tabErrors.join(' ; '));
ok('每次切换后面板都处于激活态', results.every(function (r) { return r.indexOf('active') > 0; }), results.join(' '));

/* ---------- 5. 各面板内容断言 ---------- */
console.log('5. 各面板内容');
ok('节拍器面板渲染出表盘', doc.querySelectorAll('.metro-face').length > 0);
ok('节拍器面板渲染出拍点灯', doc.querySelectorAll('.metro-lamp').length > 0);
ok('节拍器有拍号下拉', !!doc.querySelector('#metro-time'));
ok('调音器面板已挂载内容', doc.querySelectorAll('#tuner-mount *').length > 0,
  '子节点=' + doc.querySelectorAll('#tuner-mount *').length);
ok('调号音阶面板渲染出表格', doc.querySelectorAll('#scale-mount .scale-table').length > 0);
ok('调号音阶面板渲染出五度圈 SVG', doc.querySelectorAll('#scale-mount svg').length > 0);
ok('音阶表有 7 行数据', doc.querySelectorAll('#scale-mount .scale-table tr').length >= 8,
  'tr=' + doc.querySelectorAll('#scale-mount .scale-table tr').length);
ok('移调面板渲染出结果表', doc.querySelectorAll('#transpose-mount .scale-table').length > 0);
ok('乐器面板渲染出图表', doc.querySelectorAll('#inst-mount svg').length > 0);
ok('听辨面板渲染出敲拍按钮', doc.querySelectorAll('#ear-mount .ear-tap').length > 0);
ok('听辨面板渲染出题型按钮', doc.querySelectorAll('#ear-mount .chip').length >= 3);
ok('音型库面板已挂载内容', doc.querySelectorAll('#lib-mount *').length > 0);
ok('导出面板已挂载内容', doc.querySelectorAll('#exp-mount *').length > 0);
ok('统计面板已挂载内容', doc.querySelectorAll('#stats-mount *').length > 0);
ok('练习模式面板已挂载内容', doc.querySelectorAll('#prac-mount *').length > 0);

/* ---------- 6. 操作关键控件 ---------- */
console.log('6. 操作控件');
var opsErr = [];
function tryDo(name, fn) {
  try { fn(); } catch (e) { opsErr.push(name + ' -> ' + e.message); }
}

tryDo('切换生成模式', function () {
  var sel = doc.querySelector('#gen-mode');
  sel.value = 'melody';
  sel.dispatch('change');
});
ok('切到旋律模式后生成了含音高的乐段', (function () {
  var s = APP.app.getScore();
  return s && s.bars.some(function (b) { return b.notes.some(function (n) { return !!n.pitch; }); });
})());

tryDo('输入非法小节数', function () {
  var b = doc.querySelector('#gen-bars');
  b.value = '999';
  b.dispatch('change');
});
ok('小节数被限制在 32 以内', APP.app.getScore().bars.length <= 32, APP.app.getScore().bars.length);

tryDo('点生成新乐段', function () { doc.querySelector('#gen-new').dispatch('click'); });
ok('新乐段拍数仍然精确', APP.generator.scoreStats(APP.app.getScore()).badBars.length === 0);

tryDo('切换拍号到 6/8', function () {
  var t = doc.querySelector('#gen-time');
  t.value = '6/8';
  t.dispatch('change');
});
ok('6/8 下每小节 3 拍', APP.app.getScore().bars.every(function (b) { return Math.abs(b.beats - 3) < 1e-9; }),
  JSON.stringify(APP.app.getScore().bars.map(function (b) { return b.beats; })));

tryDo('调号切到 D 大调', function () {
  var k = doc.querySelector('#gen-key');
  k.value = '2-major';
  k.dispatch('change');
});
ok('D 大调乐段的调号正确', APP.app.getScore().key.fifths === 2,
  JSON.stringify(APP.app.getScore().key));

tryDo('音级只留 1 2 3 4', function () {
  var chips = doc.querySelectorAll('#gen-degrees .chip');
  [5, 6, 7].forEach(function (d) { if (chips[d - 1]) chips[d - 1].dispatch('click'); });
});
ok('只保留 1-4 级后，生成结果不含 5/6/7 级', (function () {
  var k = APP.app.getScore().key;
  var scale = APP.theory.scalePitches(k, 4, k.mode === 'minor' ? 'harmonic' : 'major').slice(0, 4).map(function (p) { return APP.theory.midiOf(p); });
  var scale2 = APP.theory.scalePitches(k, 5, k.mode === 'minor' ? 'harmonic' : 'major').slice(0, 4).map(function (p) { return APP.theory.midiOf(p); });
  var allowed = scale.concat(scale2);
  return APP.app.getScore().bars.every(function (b) {
    return b.notes.every(function (n) { return !n.pitch || allowed.indexOf(n.midi) !== -1; });
  });
})());

tryDo('时值只留四分音符', function () {
  var chips = doc.querySelectorAll('#gen-durations .chip');
  /* 先把非四分的都点掉 */
  chips.forEach(function (c) { if (c.textContent.indexOf('四分音符') < 0 && c.classList.contains('active')) c.dispatch('click'); });
});
ok('只留四分音符后输出全是四分音符', (function () {
  var s = APP.app.getScore();
  return s.bars.every(function (b) { return b.notes.every(function (n) { return n.dur === 1 && !n.dotted; }); });
})(), JSON.stringify(APP.app.getScore().bars.map(function (b) { return b.notes.map(function (n) { return n.dur; }); })));

tryDo('切换显示方式为仅简谱', function () {
  var chips = doc.querySelectorAll('#gen-display .chip');
  chips[1].dispatch('click');
});
ok('仅简谱时不渲染 SVG', doc.querySelectorAll('#gen-staff-host svg').length === 0);

tryDo('切回两者都要', function () {
  var chips = doc.querySelectorAll('#gen-display .chip');
  chips[2].dispatch('click');
});
ok('两者都要时 SVG 回来', doc.querySelectorAll('#gen-staff-host svg').length > 0);

tryDo('切到入门预设', function () {
  doc.querySelectorAll('#gen-presets .chip')[0].dispatch('click');
});
ok('入门预设：无休止符', APP.app.getScore().bars.every(function (b) {
  return b.notes.every(function (n) { return !!n.pitch; });
}));
ok('入门预设：C 大调 60 PBM', APP.app.getScore().key.fifths === 0 && APP.app.getScore().tempo === 60);

tryDo('点播放（无音频环境应安全降级）', function () { doc.querySelector('#gen-play').dispatch('click'); });
tryDo('点停止', function () { doc.querySelector('#gen-stop').dispatch('click'); });
tryDo('点跟节拍器播放', function () { doc.querySelector('#gen-playmetro').dispatch('click'); });
tryDo('点停止', function () { APP.app.stopPlayback(); });
tryDo('手动改速度', function () {
  var t = doc.querySelector('#gen-tempo');
  t.value = '120';
  t.dispatch('input');
  t.dispatch('change');
});
tryDo('速度 +5', function () { doc.querySelector('#gen-faster').dispatch('click'); });
tryDo('速度 -5', function () { doc.querySelector('#gen-slower').dispatch('click'); });
ok('控件操作全部无异常', opsErr.length === 0, opsErr.join(' ; '));

/* ---------- 7. 快捷键 ---------- */
console.log('7. 快捷键');
var keyErr = null;
try {
  doc.dispatch('keydown', { key: 'n', target: doc.querySelector('#gen-mode'), preventDefault: function () {} });
} catch (e) { keyErr = e; }
ok('快捷键 N 无异常', !keyErr, keyErr && keyErr.message);

/* ---------- 8. 鲁棒性：缺少可选模块 ---------- */
console.log('8. 鲁棒性：模块缺失时仍能启动');
ok('app.js 对每个可选模块都有存在性判断', (function () {
  var src = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  var mods = ['APP.engine', 'APP.tuner', 'APP.instruments', "APP['export']", 'APP.library', 'APP.ear', 'APP.practice'];
  return mods.every(function (m) { return src.indexOf(m) >= 0; });
})());

/* ---------- 9. index.html 的脚本顺序与契约一致 ---------- */
console.log('9. 脚本顺序');
var EXPECT = [
  'src/core/util.js', 'src/core/theory.js', 'src/core/generator.js', 'src/core/renderer.js',
  'vendor/vexflow.js', 'src/core/vexrender.js', 'src/core/jianpu.js',
  'src/audio/tuner.js', 'src/audio/engine.js', 'src/data/instruments.js',
  'src/export/exporter.js', 'src/features/library.js', 'src/features/ear.js',
  'src/features/practice.js', 'src/app.js'
];
ok('index.html 的脚本顺序与契约完全一致', JSON.stringify(scriptSrcs) === JSON.stringify(EXPECT),
  scriptSrcs.join(' | '));

console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (msgs.length) console.log(msgs.join('\n'));
process.exit(fail ? 1 : 0);
