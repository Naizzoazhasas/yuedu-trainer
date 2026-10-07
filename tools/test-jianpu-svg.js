/* 读谱训练器 — 简谱 SVG 渲染专项测试
 * 运行： node tools/test-jianpu-svg.js
 *
 * 重点验证「数字不再七上八下」：所有数字的基线必须是同一个 y 值。
 * 用最小 DOM 桩（tools/dom-shim.js）做结构断言，不依赖浏览器。
 */
'use strict';

var path = require('path');
var dom = require(path.join(__dirname, 'dom-shim.js'));
var doc = dom.install();
global.window = global;

require(path.join(__dirname, '..', 'src', 'core', 'util.js'));
require(path.join(__dirname, '..', 'src', 'core', 'theory.js'));
require(path.join(__dirname, '..', 'src', 'core', 'jianpu.js'));

var APP = global.APP;
var JP = APP.jianpu, TH = APP.theory;

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; msgs.push('  \u2717 ' + name + (detail ? '  \u2192 ' + detail : '')); }
}
function container() { return doc.createElement('div'); }
function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
function texts(root, sel) { return all(root, sel).map(function (n) { return n.textContent; }); }
function num(v) { return parseFloat(v); }

console.log('=== 简谱 SVG 渲染测试 ===\n');

/* ---------------- 测试用乐段（D 大调，4/4，4 小节） ----------------
 * 小节 1：D4 四分 / E4 八分 / F#4 十六分 / G4 十六分 / A4 二分
 * 小节 2：C#5 四分 / D5 四分（高八度）/ B3 二分（低八度）
 * 小节 3：D4 全音符（3 条延长线）
 * 小节 4：休止二分 / A4 二分
 * 数字（首调）：1 2 3 4 5 | 7 1 6 | 1 | 0 5
 */
function p(step, acc, oct) { return { step: step, acc: acc, oct: oct }; }
function n(pitch, dur, dotted) {
  return { pitch: pitch, dur: dur, dotted: !!dotted, tie: false, midi: pitch ? TH.midiOf(pitch) : null };
}
var SCORE = {
  key: { tonic: 2, mode: 'major', fifths: 2 },
  time: { num: 4, den: 4 },
  tempo: 60,
  clef: 'treble',
  bars: [
    { notes: [n(p('D', 0, 4), 1), n(p('E', 0, 4), 0.5), n(p('F', 1, 4), 0.25), n(p('G', 0, 4), 0.25), n(p('A', 0, 4), 2)], beats: 4 },
    { notes: [n(p('C', 1, 5), 1), n(p('D', 0, 5), 1), n(p('B', 0, 3), 2)], beats: 4 },
    { notes: [n(p('D', 0, 4), 4)], beats: 4 },
    { notes: [n(null, 2), n(p('A', 0, 4), 2)], beats: 4 }
  ]
};

var root = container();
var svg = JP.renderInto(root, SCORE, {});

/* ---------------- 1. 根节点 ---------------- */
console.log('1. SVG 根节点');
ok('renderInto 默认返回 SVGElement', !!svg && String(svg.tagName).toLowerCase() === 'svg', svg && svg.tagName);
ok('data-renderer = jianpu-svg', svg.getAttribute('data-renderer') === 'jianpu-svg', svg.getAttribute('data-renderer'));
var vb = String(svg.getAttribute('viewBox') || '').split(/\s+/);
ok('有 viewBox="0 0 w h"', vb.length === 4 && vb[0] === '0' && vb[1] === '0' && num(vb[2]) > 300 && num(vb[3]) > 0, svg.getAttribute('viewBox'));
ok('width / height 属性与 viewBox 同步', num(svg.getAttribute('width')) === num(vb[2]) && num(svg.getAttribute('height')) === num(vb[3]),
  svg.getAttribute('width') + ' x ' + svg.getAttribute('height'));
ok('无辅助文字时高度为 52', num(svg.getAttribute('height')) === 52, svg.getAttribute('height'));
ok('根节点统一设置字体', String(svg.getAttribute('font-family')).indexOf('PingFang SC') >= 0, svg.getAttribute('font-family'));

var svgSub = JP.renderSvg(SCORE, { showSolfa: true, showNoteName: true });
ok('需要辅助文字时高度为 66', num(svgSub.getAttribute('height')) === 66, svgSub.getAttribute('height'));

/* ---------------- 2. 小节 / 音符结构 ---------------- */
console.log('2. 小节与音符结构');
var barGs = all(root, '[data-bar-idx]');
ok('每个小节一个 [data-bar-idx]（4 个）', barGs.length === 4, 'got ' + barGs.length);
var noteGs = all(root, '[data-note-idx]');
ok('每个音符一个 [data-note-idx]（11 个）', noteGs.length === 11, 'got ' + noteGs.length);
ok('音符组带 data-bar', all(root, '[data-note-idx]').every(function (g) { return g.getAttribute('data-bar') !== null; }));
var bgFirst = true;
barGs.forEach(function (g) {
  var cls = g.childNodes.filter(function (c) { return c.nodeType === 1; })[0];
  if (!cls || String(cls.getAttribute('class')).indexOf('jp-svg-bar-bg') < 0) bgFirst = false;
});
ok('小节高亮底 rect 是 [data-bar-idx] 里最前面的元素', bgFirst);
ok('小节高亮底 class = jp-svg-bar-bg', all(root, '.jp-svg-bar-bg').length === 4, 'got ' + all(root, '.jp-svg-bar-bg').length);

/* ---------------- 3. 小节线 ---------------- */
console.log('3. 小节线');
var bls = all(root, '.jp-svg-barline');
/* 依据：段首 1 条 + 每小节末尾 1 条（最后一条是「细线 + 粗线」的终止线，整体算 1 条） = 小节数 + 1 */
ok('小节线条数 = 小节数 + 1（段首 1 + 每小节末尾 1，终止线算 1）', bls.length === SCORE.bars.length + 1,
  'got ' + bls.length);
var lineLike = [];
bls.forEach(function (b) {
  if (String(b.tagName).toLowerCase() === 'line') lineLike.push(b);
  else all(b, 'line').forEach(function (l) { lineLike.push(l); });
});
ok('每条小节线都从 y=4 画到 y=44', lineLike.every(function (l) {
  return num(l.getAttribute('y1')) === 4 && num(l.getAttribute('y2')) === 44;
}), lineLike.map(function (l) { return l.getAttribute('y1') + '~' + l.getAttribute('y2'); }).join(','));
var lastBl = bls[bls.length - 1];
ok('最后一条是终止线（细线 + 粗 rect）',
  String(lastBl.tagName).toLowerCase() === 'g' && all(lastBl, 'line').length === 1 && all(lastBl, 'rect').length === 1);
ok('小节内部不画小节线（音符组里没有 barline）',
  all(root, '.jp-svg-note').every(function (g) { return all(g, '.jp-svg-barline').length === 0; }));

/* 小节号 */
var withNums = JP.renderSvg(SCORE, { showBarNumbers: true });
ok('showBarNumbers 时每小节一个号', all(withNums, '.jp-svg-barnum').length === 4, 'got ' + all(withNums, '.jp-svg-barnum').length);
ok('默认不画小节号', all(root, '.jp-svg-barnum').length === 0);

/* ---------------- 4. 核心：所有数字基线相同 ---------------- */
console.log('4. 数字基线（本次修复的核心）');
var digitNodes = all(root, '.jp-svg-digit');
var ys = digitNodes.map(function (t) { return t.getAttribute('y'); });
var ySet = ys.filter(function (v, i) { return ys.indexOf(v) === i; });
ok('数字元素数 = 音符数（11 个）', digitNodes.length === 11, 'got ' + digitNodes.length);
ok('所有数字的 y 完全相同（只有 1 个取值）', ySet.length === 1, '取值集合 = {' + ySet.join(', ') + '}');
ok('该唯一基线是 y=30', ySet[0] === '30', 'y=' + ySet[0]);
ok('所有数字水平居中（text-anchor=middle）',
  digitNodes.every(function (t) { return t.getAttribute('text-anchor') === 'middle'; }));
ok('数字字号统一 21px', digitNodes.every(function (t) { return num(t.getAttribute('font-size')) === 21; }));
ok('数字字重统一 500', digitNodes.every(function (t) { return String(t.getAttribute('font-weight')) === '500'; }));
ok('数字颜色 #131a26（休止符更浅）',
  all(root, '.jp-svg-note').filter(function (g) { return all(g, '.jp-svg-digit')[0].getAttribute('fill') === '#131a26'; }).length === 10 &&
  all(root, '.jp-svg-note').filter(function (g) { return all(g, '.jp-svg-digit')[0].getAttribute('fill') === '#8b95a8'; }).length === 1);

/* ---------------- 5. 首调 / 固定调数字 ---------------- */
console.log('5. 首调与固定调');
var digits = texts(root, '.jp-svg-digit');
ok('首调：全部数字 = 1 2 3 4 5 7 1 6 1 0 5', digits.join('') === '12345716105', digits.join(' '));
ok('首调：D 大调 D4 = 1', digits[0] === '1', digits[0]);
ok('首调：D 大调 C#5 = 7', digits[5] === '7', digits[5]);
ok('首调：休止符 = 0', digits[9] === '0', digits[9]);
var fixedRoot = container();
JP.renderInto(fixedRoot, SCORE, { mode: 'fixed' });
var fixedDigits = texts(fixedRoot, '.jp-svg-digit');
ok('固定调：D4 = 2', fixedDigits[0] === '2', fixedDigits[0]);
ok('固定调：A4 = 6', fixedDigits[4] === '6', fixedDigits[4]);

/* ---------------- 6. 八度点 ---------------- */
console.log('6. 八度点');
function noteGroup(barIdx, noteIdx) { return root.querySelector('[data-bar="' + barIdx + '"][data-note-idx="' + noteIdx + '"]'); }
var d5 = noteGroup(1, 1);   // 小节 2 第 2 个音：D5（高八度）
var d5Digits = all(d5, '.jp-svg-digit');
var d5Dots = all(d5, '.jp-svg-dot');
ok('D5 组内有圆点', d5Dots.length >= 1, 'got ' + d5Dots.length);
ok('D5 的圆点在数字上方（cy < 30）', d5Dots.some(function (c) { return num(c.getAttribute('cy')) < 30; }),
  d5Dots.map(function (c) { return c.getAttribute('cy'); }).join(','));
ok('D5 的圆点在数字水平中心（cx 与数字 x 相同）',
  d5Dots.every(function (c) { return c.getAttribute('cx') === d5Digits[0].getAttribute('x'); }),
  d5Dots[0].getAttribute('cx') + ' vs ' + d5Digits[0].getAttribute('x'));
ok('D5 数字本身仍在 y=30', d5Digits[0].getAttribute('y') === '30', d5Digits[0].getAttribute('y'));

var b3 = noteGroup(1, 2);   // B3（低八度）
var b3Dots = all(b3, '.jp-svg-dot');
ok('B3 的圆点在数字下方（cy > 30）', b3Dots.length >= 1 && b3Dots.some(function (c) { return num(c.getAttribute('cy')) > 30; }),
  b3Dots.map(function (c) { return c.getAttribute('cy'); }).join(','));

var plain = noteGroup(0, 0);  // D4 无八度点
ok('同八度的 D4 没有八度点', all(plain, '.jp-svg-dot').length === 0);

/* ---------------- 7. 减时线 ---------------- */
console.log('7. 减时线');
ok('八分音符 1 条减时线', all(noteGroup(0, 1), '.jp-svg-underline').length === 1,
  'got ' + all(noteGroup(0, 1), '.jp-svg-underline').length);
ok('十六分音符 2 条减时线', all(noteGroup(0, 2), '.jp-svg-underline').length === 2,
  'got ' + all(noteGroup(0, 2), '.jp-svg-underline').length);
ok('四分音符没有减时线', all(noteGroup(0, 0), '.jp-svg-underline').length === 0);
var uLines = all(noteGroup(0, 2), '.jp-svg-underline');
ok('两条减时线分别在 y=40 与 y=44',
  num(uLines[0].getAttribute('y1')) === 40 && num(uLines[1].getAttribute('y1')) === 44,
  uLines[0].getAttribute('y1') + ',' + uLines[1].getAttribute('y1'));
ok('减时线在数字下方（y > 30）', uLines.every(function (l) { return num(l.getAttribute('y1')) > 30; }));
ok('减时线线宽 1.5', uLines.every(function (l) { return num(l.getAttribute('stroke-width')) === 1.5; }));

/* ---------------- 8. 延长线 ---------------- */
console.log('8. 延长线');
ok('二分音符 1 个 —', all(noteGroup(0, 4), '.jp-svg-dash').length === 1,
  'got ' + all(noteGroup(0, 4), '.jp-svg-dash').length);
ok('全音符 3 个 —', all(noteGroup(2, 0), '.jp-svg-dash').length === 3,
  'got ' + all(noteGroup(2, 0), '.jp-svg-dash').length);
ok('休止二分也有 1 个 —', all(noteGroup(3, 0), '.jp-svg-dash').length === 1);
var dashNodes = all(noteGroup(2, 0), '.jp-svg-dash');
ok('延长线画在数字基线高度 y=30', dashNodes.every(function (d) { return d.getAttribute('y') === '30'; }),
  dashNodes.map(function (d) { return d.getAttribute('y'); }).join(','));
ok('延长线文字是 —（U+2014）', dashNodes.every(function (d) { return d.textContent === '\u2014'; }));
ok('延长线每个占一列（x 各不相同）',
  dashNodes.map(function (d) { return d.getAttribute('x'); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length === 3,
  dashNodes.map(function (d) { return d.getAttribute('x'); }).join(','));

/* ---------------- 9. 辅助文字 ---------------- */
console.log('9. 辅助文字');
var subs = texts(svgSub, '.jp-svg-sub');
ok('showSolfa + showNoteName 时每音一条辅助文字', subs.length === 11, 'got ' + subs.length);
ok('辅助文字 y 统一为 58', all(svgSub, '.jp-svg-sub').every(function (t) { return t.getAttribute('y') === '58'; }));
ok('辅助文字字号 9.5 / 颜色 #7a8699',
  all(svgSub, '.jp-svg-sub').every(function (t) {
    return num(t.getAttribute('font-size')) === 9.5 && t.getAttribute('fill') === '#7a8699';
  }));
ok('首音辅助文字 = "D4 do"', subs[0] === 'D4 do', subs[0]);
ok('休止符辅助文字 = 休', subs[9] === '休', subs[9]);
var subSolfaOnly = texts(JP.renderSvg(SCORE, { showSolfa: true }), '.jp-svg-sub');
ok('只开 showSolfa 时只有唱名', subSolfaOnly[0] === 'do', subSolfaOnly[0]);

/* ---------------- 10. 宽度自适应 ---------------- */
console.log('10. 宽度自适应');
var wide = JP.renderSvg(SCORE, { width: 900 });
ok('width=900 时画布宽度正好 900', Math.abs(num(wide.getAttribute('width')) - 900) < 0.5, wide.getAttribute('width'));
var narrow = JP.renderSvg(SCORE, { width: 560 });
ok('width=560 时压缩后仍正好 560（未触底）', Math.abs(num(narrow.getAttribute('width')) - 560) < 0.5, narrow.getAttribute('width'));
ok('压缩后列宽不小于 16px（相邻数字 x 间距 >= 16）', (function () {
  var xs = all(narrow, '.jp-svg-digit').map(function (t) { return num(t.getAttribute('x')); }).sort(function (a, b) { return a - b; });
  for (var i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 15.9) return false;
  return true;
})());
/* 极窄时 16px 列宽下限优先于目标宽度：画布会比 opts.width 略宽，
 * 由 CSS maxWidth:100% 在容器里等比缩小，列宽不会被压到 16px 以下。 */
var tiny = JP.renderSvg(SCORE, { width: 420 });
ok('width=420 触底时列宽仍 >= 16px', (function () {
  var xs = all(tiny, '.jp-svg-digit').map(function (t) { return num(t.getAttribute('x')); }).sort(function (a, b) { return a - b; });
  for (var i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 15.9) return false;
  return true;
})());
ok('触底时超出量有界（<= opts.width 的 3%）', num(tiny.getAttribute('width')) <= 420 * 1.03, tiny.getAttribute('width'));

/* ---------------- 11. 高亮 ---------------- */
console.log('11. 播放高亮');
JP.highlightBar(root, 1);
var bgs = all(root, '.jp-svg-bar-bg');
ok('highlightBar 给目标小节上色', bgs[1].getAttribute('fill') === 'rgba(255,138,76,.16)', bgs[1].getAttribute('fill'));
ok('highlightBar 其它小节保持透明', bgs[0].getAttribute('fill') === 'transparent' && bgs[2].getAttribute('fill') === 'transparent');
JP.highlightNote(root, 0, 1);
var playing = all(root, '.playing');
ok('highlightNote 标出 1 个音符', playing.length === 1, 'got ' + playing.length);
ok('高亮音符的数字变色', all(playing[0], '.jp-svg-digit')[0].getAttribute('fill') === '#e05d1f',
  all(playing[0], '.jp-svg-digit')[0].getAttribute('fill'));
JP.clearHighlight(root);
ok('clearHighlight 恢复小节透明', all(root, '.jp-svg-bar-bg').every(function (r) { return r.getAttribute('fill') === 'transparent'; }));
ok('clearHighlight 清掉 playing 类', all(root, '.playing').length === 0);
ok('clearHighlight 恢复数字颜色', all(root, '.jp-svg-digit')[0].getAttribute('fill') === '#131a26');

/* ---------------- 12. 渲染器选择与降级 ---------------- */
console.log('12. 渲染器选择与降级');
var htmlRoot = container();
var htmlOut = JP.renderInto(htmlRoot, SCORE, { renderer: 'html' });
ok('renderer:html 走旧实现（.jp-wrap）', !!htmlRoot.querySelector('.jp-wrap'), htmlOut && htmlOut.className);
ok('renderer:html 不产出 svg', all(htmlRoot, 'svg').length === 0);
ok('renderHtmlInto 已导出到 APP.jianpu', typeof JP.renderHtmlInto === 'function');
ok('renderSvg 已导出到 APP.jianpu', typeof JP.renderSvg === 'function');

var fbRoot = container();
var keepSvg = JP.renderSvg;
JP.renderSvg = function () { throw new Error('模拟 SVG 渲染失败'); };
var fbOut = null;
try { fbOut = JP.renderInto(fbRoot, SCORE, {}); } finally { JP.renderSvg = keepSvg; }
ok('renderSvg 抛异常时回退到 HTML 实现（.jp-wrap）', !!fbRoot.querySelector('.jp-wrap'), fbOut && fbOut.className);
ok('回退后容器里没有半成品 svg', all(fbRoot, 'svg').length === 0);

/* ---------------- 13. 鲁棒性 ---------------- */
console.log('13. 鲁棒性');
ok('空乐段不抛异常', (function () {
  try {
    var s = JP.renderSvg({ bars: [] }, {});
    return String(s.tagName).toLowerCase() === 'svg' && all(s, '.jp-svg-barline').length === 1;
  } catch (e) { return false; }
})());
ok('缺字段的乐段不抛异常', (function () {
  try { JP.renderSvg({ bars: [{ notes: [{ dur: 1 }] }] }, {}); return true; } catch (e) { return false; }
})());
ok('renderInto(null) 安全返回 null', JP.renderInto(null, SCORE, {}) === null);
ok('6/8 复合拍不抛异常且能渲染', (function () {
  try {
    var s = JP.renderSvg({
      key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 6, den: 8 }, tempo: 60,
      bars: [{ notes: [n(p('C', 0, 4), 0.5), n(p('D', 0, 4), 0.5), n(p('E', 0, 4), 0.5), n(p('F', 0, 4), 0.5), n(p('G', 0, 4), 0.5), n(p('A', 0, 4), 0.5)] }]
    }, {});
    return all(s, '.jp-svg-digit').length === 6;
  } catch (e) { return false; }
})());
ok('无 opts.width 时默认 900', Math.abs(num(JP.renderSvg(SCORE, {}).getAttribute('width')) - 900) < 0.5);

/* ---------------- 14. 复合拍分组（6/8） ---------------- */
console.log('14. 复合拍分组（6/8）');
var c68 = JP.renderSvg({
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 6, den: 8 }, tempo: 60,
  bars: [{ notes: [n(p('C', 0, 4), 0.5), n(p('D', 0, 4), 0.5), n(p('E', 0, 4), 0.5), n(p('F', 0, 4), 0.5), n(p('G', 0, 4), 0.5), n(p('A', 0, 4), 0.5)] }]
}, { showBarNumbers: true });
var x68 = all(c68, '.jp-svg-digit').map(function (t) { return num(t.getAttribute('x')); });
ok('6/8 有 6 个数字列', x68.length === 6, 'got ' + x68.length);
ok('每 3 个八分之后留额外间隙（第 3→4 个音间距最大）',
  (x68[3] - x68[2]) > (x68[1] - x68[0]) * 1.15,
  x68.map(function (v, i) { return i ? (v - x68[i - 1]).toFixed(1) : v.toFixed(1); }).join(' | '));

console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (msgs.length) console.log(msgs.join('\n'));
process.exit(fail ? 1 : 0);
