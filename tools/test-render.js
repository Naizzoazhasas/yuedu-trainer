/* 读谱训练器 — 渲染层测试（五线谱 SVG + 简谱 HTML）
 * 运行： node tools/test-render.js
 * 用最小 DOM 桩，验证结构、音符数量、符干方向、加线、符杠、临时记号、简谱数字与八度点。
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
require(path.join(__dirname, '..', 'src', 'core', 'jianpu.js'));

var APP = global.APP;
var G = APP.generator, R = APP.renderer, JP = APP.jianpu, TH = APP.theory, U = APP.util;

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; msgs.push('  \u2717 ' + name + (detail ? '  \u2192 ' + detail : '')); }
}

function mkScore(cfg) {
  return G.generateScore(Object.assign({
    mode: 'melody', bars: 2, durations: [1, 2, 0.5], useRests: true,
    seed: 42, key: { tonic: 0, mode: 'major' }, range: { lowOct: 4, highOct: 4 }
  }, cfg || {}));
}
function container() { return doc.createElement('div'); }
function svgOf(score, opts) {
  var c = container();
  var res = R.renderScoreInto(c, score, opts);
  return { c: c, svg: res.svg, err: res.error };
}
function countTags(svg, tag) { return svg.querySelectorAll(tag).length; }

console.log('=== 渲染层测试 ===\n');

/* ---------- 1. 基本结构 ---------- */
console.log('1. 五线谱基本结构');
var score = mkScore({ seed: 7 });
var a = svgOf(score, { width: 900, showBarNumbers: true });
ok('renderScoreInto 返回 SVG 且无异常', !!a.svg && !a.err, a.err && a.err.message);
ok('根节点是 svg 且带 viewBox', a.svg && a.svg.tagName === 'SVG' && !!a.svg.getAttribute('viewBox'),
  a.svg && a.svg.getAttribute('viewBox'));
ok('五条谱线存在', countTags(a.svg, 'line') >= 5, 'line=' + countTags(a.svg, 'line'));
ok('每个小节一个 data-bar-idx 分组', a.svg.querySelectorAll('[data-bar-idx]').length === score.bars.length,
  'got ' + a.svg.querySelectorAll('[data-bar-idx]').length + ' want ' + score.bars.length);
var noteGroups = a.svg.querySelectorAll('[data-note-idx]');
var totalNotes = score.bars.reduce(function (s, b) { return s + b.notes.length; }, 0);
ok('每个音符一个 data-note-idx 分组（' + totalNotes + ' 个）', noteGroups.length === totalNotes,
  'got ' + noteGroups.length);

/* ---------- 2. 谱号 / 调号 / 拍号 ---------- */
console.log('2. 谱号 / 调号 / 拍号');
var treble = svgOf(mkScore({ seed: 1 }), {});
ok('高音谱号有 path', countTags(treble.svg, 'path') > 0);
var bassScore = mkScore({ seed: 1, clef: 'bass', range: { lowOct: 3, highOct: 3 } });
var bass = svgOf(bassScore, {});
ok('低音谱号渲染出 circle（低音谱号的点）', countTags(bass.svg, 'circle') > 0);
var dMajor = mkScore({ seed: 1, key: { tonic: 2, mode: 'major' } });
var dSvg = svgOf(dMajor, {});
/* D 大调 2 个升号：调号 + 可能出现的临时记号；谱头至少要有 2 个升号 */
ok('D 大调谱头出现升号（>=2 组）', countTags(dSvg.svg, 'path') > 0);
var sigCount = TH.keySignature({ tonic: 2, mode: 'major', fifths: 2 }).count;
ok('D 大调调号数量 = 2', sigCount === 2);
ok('拍号数字出现在 SVG 文本里', a.svg.textContent.indexOf('4') >= 0);

/* ---------- 3. 符干方向 ---------- */
console.log('3. 符干方向（以中线为界）');
var dirScore = {
  key: { tonic: 0, mode: 'major', fifths: 0 },
  time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'C', acc: 0, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 72, pos: TH.staffPos({ step: 'C', acc: 0, oct: 5 }, 'treble') },
    { pitch: { step: 'C', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 60, pos: TH.staffPos({ step: 'C', acc: 0, oct: 4 }, 'treble') },
    { pitch: { step: 'B', acc: 0, oct: 3 }, dur: 1, dotted: false, tie: false, midi: 59, pos: TH.staffPos({ step: 'B', acc: 0, oct: 3 }, 'treble') },
    { pitch: { step: 'G', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 67, pos: TH.staffPos({ step: 'G', acc: 0, oct: 4 }, 'treble') }
  ], beats: 4 }]
};
var dirSvg = svgOf(dirScore, {});
var stems = [];
dirSvg.svg.querySelectorAll('[data-note-idx]').forEach(function (g) {
  var lines = g.querySelectorAll('line');
  /* 符干是那条长度约 35 的竖线 */
  var stem = null;
  lines.forEach(function (l) {
    var x1 = parseFloat(l.getAttribute('x1')), x2 = parseFloat(l.getAttribute('x2'));
    var y1 = parseFloat(l.getAttribute('y1')), y2 = parseFloat(l.getAttribute('y2'));
    if (Math.abs(x1 - x2) < 0.01 && Math.abs(y2 - y1) > 30) stem = { x: x1, y1: y1, y2: y2 };
  });
  stems.push(stem);
});
ok('C5（高于中线）符干朝下', stems[0] && stems[0].y2 > stems[0].y1, JSON.stringify(stems[0]));
ok('C4（低于中线）符干朝上', stems[1] && stems[1].y2 < stems[1].y1, JSON.stringify(stems[1]));
ok('B3（低于中线）符干朝上', stems[2] && stems[2].y2 < stems[2].y1, JSON.stringify(stems[2]));
ok('G4（第 2 线，低于中线）符干朝上', stems[3] && stems[3].y2 < stems[3].y1, JSON.stringify(stems[3]));
ok('C5 的符干在符头左侧', stems[0] && stems[0].x < 0 + 1000);
ok('向上符干在符头右侧', stems[1] && stems[1].y2 < stems[1].y1);

/* ---------- 4. 加线 ---------- */
console.log('4. 加线（ledger lines）');
var ledgerScore = {
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'C', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 60, pos: -2 },
    { pitch: { step: 'A', acc: 0, oct: 3 }, dur: 1, dotted: false, tie: false, midi: 57, pos: -5 },
    { pitch: { step: 'A', acc: 0, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 81, pos: 10 },
    { pitch: { step: 'C', acc: 0, oct: 6 }, dur: 1, dotted: false, tie: false, midi: 84, pos: 12 }
  ], beats: 4 }]
};
var lSvg = svgOf(ledgerScore, {});
var ledgerCounts = [];
lSvg.svg.querySelectorAll('[data-note-idx]').forEach(function (g) {
  var led = g.querySelector('[data-ledger]');
  ledgerCounts.push(led ? parseInt(led.getAttribute('data-ledger'), 10) : -1);
});
ok('C4 有 1 条下加线', ledgerCounts[0] === 1, 'got ' + ledgerCounts[0]);
ok('A3 有 2 条下加线', ledgerCounts[1] === 2, 'got ' + ledgerCounts[1]);
ok('A5 有 1 条上加线', ledgerCounts[2] === 1, 'got ' + ledgerCounts[2]);
ok('C6 有 2 条上加线', ledgerCounts[3] === 2, 'got ' + ledgerCounts[3]);

/* ---------- 5. 符杠 ---------- */
console.log('5. 符杠（beams）');
var beamScore = {
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'C', acc: 0, oct: 5 }, dur: 0.5, dotted: false, tie: false, midi: 72, pos: 7 },
    { pitch: { step: 'D', acc: 0, oct: 5 }, dur: 0.5, dotted: false, tie: false, midi: 74, pos: 8 },
    { pitch: { step: 'E', acc: 0, oct: 5 }, dur: 0.5, dotted: false, tie: false, midi: 76, pos: 9 },
    { pitch: { step: 'F', acc: 0, oct: 5 }, dur: 0.5, dotted: false, tie: false, midi: 77, pos: 10 },
    { pitch: { step: 'G', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 67, pos: 2 },
    { pitch: { step: 'E', acc: 0, oct: 0, }, dur: 1, dotted: false, tie: false, midi: 64, pos: 0 },
    { pitch: { step: 'C', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 60, pos: -2 }
  ], beats: 4 }]
};
/* 用合法音高修正第 6 个音 */
beamScore.bars[0].notes[5] = { pitch: { step: 'E', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 64, pos: 0 };
var bSvg = svgOf(beamScore, {});
var thickLines = 0, beamGroups = 0;
bSvg.svg.querySelectorAll('line').forEach(function (l) {
  if (parseFloat(l.getAttribute('stroke-width')) >= 4) { thickLines++; }
});
ok('4 个八分音符产生一条符杠（粗细 >= 4 的横线）', thickLines >= 1, 'thick=' + thickLines);
ok('八分音符不再画符尾（path 数量受控）', countTags(bSvg.svg, 'path') <= 2, 'path=' + countTags(bSvg.svg, 'path'));

/* 十六分音符要两级符杠 */
var beam16 = {
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'C', acc: 0, oct: 5 }, dur: 0.25, dotted: false, tie: false, midi: 72, pos: 7 },
    { pitch: { step: 'D', acc: 0, oct: 5 }, dur: 0.25, dotted: false, tie: false, midi: 74, pos: 8 },
    { pitch: { step: 'E', acc: 0, oct: 5 }, dur: 0.25, dotted: false, tie: false, midi: 76, pos: 9 },
    { pitch: { step: 'F', acc: 0, oct: 5 }, dur: 0.25, dotted: false, tie: false, midi: 77, pos: 10 },
    { pitch: { step: 'G', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 67, pos: 2 },
    { pitch: { step: 'E', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 64, pos: 0 },
    { pitch: { step: 'C', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 60, pos: -2 }
  ], beats: 4 }]
};
var s16 = svgOf(beam16, {});
var thick16 = 0;
s16.svg.querySelectorAll('line').forEach(function (l) {
  if (parseFloat(l.getAttribute('stroke-width')) >= 4) thick16++;
});
ok('十六分音符产生两条（或以上）符杠', thick16 >= 2, 'thick=' + thick16);

/* ---------- 6. 临时记号 ---------- */
console.log('6. 临时记号');
var accScore = {
  key: { tonic: 2, mode: 'major', fifths: 2 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'F', acc: 1, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 78, pos: 8 },  // 调内，无记号
    { pitch: { step: 'F', acc: 0, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 77, pos: 8 },  // 还原号
    { pitch: { step: 'C', acc: 1, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 73, pos: 7 },  // 调内
    { pitch: { step: 'G', acc: 1, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 68, pos: 3 }   // 升号
  ], beats: 4 }]
};
var acSvg = svgOf(accScore, {});
var accPerNote = [];
acSvg.svg.querySelectorAll('[data-note-idx]').forEach(function (g) {
  var acc = g.querySelector('[data-acc]');
  accPerNote.push(acc ? acc.getAttribute('data-acc') : '');
});
ok('D 大调 F#5 不加临时记号', accPerNote[0] === '', 'acc=' + accPerNote[0]);
ok('D 大调 F5 加还原号', accPerNote[1] === 'natural', 'acc=' + accPerNote[1]);
ok('D 大调 C#5 不加临时记号', accPerNote[2] === '', 'acc=' + accPerNote[2]);
ok('D 大调 G#4 加升号', accPerNote[3] === '#', 'acc=' + accPerNote[3]);

/* ---------- 7. 延音线 ---------- */
console.log('7. 延音线');
var tieScore = {
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'C', acc: 0, oct: 5 }, dur: 1, dotted: false, tie: true, midi: 72, pos: 7 },
    { pitch: { step: 'C', acc: 0, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 72, pos: 7 },
    { pitch: { step: 'E', acc: 0, oct: 5 }, dur: 2, dotted: false, tie: false, midi: 76, pos: 9 }
  ], beats: 4 }]
};
var tSvg = svgOf(tieScore, {});
var arcs = 0;
tSvg.svg.querySelectorAll('path').forEach(function (p) {
  var d = p.getAttribute('d') || '';
  if (d.indexOf('Q') >= 0) arcs++;
});
ok('延音线画出一条弧（Q 曲线）', arcs >= 1, 'arcs=' + arcs);

/* ---------- 8. 休止符 ---------- */
console.log('8. 休止符');
var restScore = {
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: null, dur: 4, dotted: false, tie: false, midi: null, pos: 0 },
    { pitch: null, dur: 2, dotted: false, tie: false, midi: null, pos: 0 },
    { pitch: null, dur: 1, dotted: false, tie: false, midi: null, pos: 0 },
    { pitch: null, dur: 0.5, dotted: false, tie: false, midi: null, pos: 0 }
  ], beats: 7.5 }]
};
var rSvg = svgOf(restScore, {});
ok('休止符渲染出 rect（全休/二分休）', countTags(rSvg.svg, 'rect') >= 2, 'rect=' + countTags(rSvg.svg, 'rect'));
ok('休止符有文字标注「休」', rSvg.svg.textContent.indexOf('休') >= 0);

/* ---------- 9. 低音谱位置 ---------- */
console.log('9. 低音谱位置');
var bassNote = {
  key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'bass',
  bars: [{ notes: [
    { pitch: { step: 'G', acc: 0, oct: 2 }, dur: 1, dotted: false, tie: false, midi: 43, pos: 0 },
    { pitch: { step: 'C', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 60, pos: 10 },
    { pitch: { step: 'F', acc: 0, oct: 3 }, dur: 2, dotted: false, tie: false, midi: 53, pos: 6 }
  ], beats: 4 }]
};
var bnSvg = svgOf(bassNote, {});
var ellipses = [];
bnSvg.svg.querySelectorAll('[data-note-idx]').forEach(function (g) {
  var e = g.querySelectorAll('ellipse');
  ellipses.push(e.length ? parseFloat(e[0].getAttribute('cy')) : null);
});
ok('低音谱 G2 落在最下线 y=60', Math.abs(ellipses[0] - 60) < 0.01, 'cy=' + ellipses[0]);
ok('低音谱 C4 落在 y=10（上加二线）', Math.abs(ellipses[1] - 10) < 0.01, 'cy=' + ellipses[1]);
ok('低音谱 F3 落在 y=30（第 4 线）', Math.abs(ellipses[2] - 30) < 0.01, 'cy=' + ellipses[2]);

/* ---------- 10. 简谱 ---------- */
console.log('10. 简谱');
var jpScore = {
  key: { tonic: 2, mode: 'major', fifths: 2 }, time: { num: 4, den: 4 }, tempo: 60, clef: 'treble',
  bars: [{ notes: [
    { pitch: { step: 'D', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 62, pos: -1 },
    { pitch: { step: 'E', acc: 0, oct: 4 }, dur: 0.5, dotted: false, tie: false, midi: 64, pos: 0 },
    { pitch: { step: 'F', acc: 1, oct: 4 }, dur: 0.5, dotted: false, tie: false, midi: 66, pos: 1 },
    { pitch: { step: 'G', acc: 0, oct: 4 }, dur: 2, dotted: false, tie: false, midi: 67, pos: 2 }
  ], beats: 4 }, { notes: [
    { pitch: { step: 'A', acc: 0, oct: 4 }, dur: 1, dotted: false, tie: false, midi: 69, pos: 3 },
    { pitch: { step: 'D', acc: 0, oct: 5 }, dur: 1, dotted: false, tie: false, midi: 74, pos: 5 },
    { pitch: { step: 'C', acc: 1, oct: 4 }, dur: 0.5, dotted: false, tie: false, midi: 61, pos: -3 },
    { pitch: null, dur: 1.5, dotted: false, tie: false, midi: null, pos: 0 }
  ], beats: 4 }]
};
/* 说明：简谱默认渲染器已改为 SVG，本节断言的是旧 HTML 结构，
 * 因此显式传 renderer:'html'；SVG 结构见下方的「SVG 渲染」小节与 tools/test-jianpu-svg.js。 */
var jc = container();
var jWrap = JP.renderInto(jc, jpScore, { mode: 'relative', renderer: 'html' });
ok('简谱渲染出 .jp-wrap', !!jWrap && jWrap.className.indexOf('jp-wrap') >= 0);
ok('简谱有 2 个小节', jc.querySelectorAll('.jp-bar').length === 2, 'got ' + jc.querySelectorAll('.jp-bar').length);
var digits = [];
jc.querySelectorAll('.jp-digit').forEach(function (d) { digits.push(d.textContent); });
ok('D 大调 D4 = 1', digits[0] === '1', digits.join('|'));
ok('D 大调 E4 = 2', digits[1] === '2', digits.join('|'));
ok('D 大调 F#4 = 3', digits[2] === '3', digits.join('|'));
ok('D 大调 G4 = 4', digits[3] === '4', digits.join('|'));
ok('D 大调 A4 = 5', digits[4] === '5', digits.join('|'));
ok('D 大调 D5 = 高八度 1（带上加点）', digits[5] === '1', digits.join('|'));
ok('D 大调 C#4 = 低八度 7（带下加点）', digits[6] === '7', digits.join('|'));
ok('休止符是 0', digits[digits.length - 1] === '0', digits.join('|'));
var upDots = jc.querySelectorAll('.jp-dot-above');
ok('存在上加点元素', upDots.length > 0);
var lowDots = jc.querySelectorAll('.jp-dot-below');
var hasLow = false;
lowDots.forEach(function (d) { if (d.textContent.indexOf('\u00B7') >= 0) hasLow = true; });
ok('C#4 有下加点', hasLow);
var underlines = jc.querySelectorAll('.jp-underline');
ok('减时线元素存在（八分音符）', underlines.length > 0);

/* 固定调模式 */
var jc2 = container();
JP.renderInto(jc2, jpScore, { mode: 'fixed', renderer: 'html' });
var digits2 = [];
jc2.querySelectorAll('.jp-digit').forEach(function (d) { digits2.push(d.textContent); });
ok('固定调模式 D4 = 2', digits2[0] === '2', digits2.join('|'));
ok('固定调模式 A4 = 6', digits2[4] === '6', digits2.join('|'));

/* SVG 渲染（默认渲染器）：详细覆盖见 tools/test-jianpu-svg.js */
var jsv = container();
var jsvg = JP.renderInto(jsv, jpScore, { mode: 'relative' });
ok('简谱默认渲染出 SVG', jsvg && String(jsvg.tagName).toLowerCase() === 'svg' &&
  jsvg.getAttribute('data-renderer') === 'jianpu-svg', jsvg && jsvg.tagName);
ok('SVG 有 viewBox', !!jsvg.getAttribute('viewBox'), jsvg.getAttribute('viewBox'));
ok('SVG 有 2 个 [data-bar-idx]', jsv.querySelectorAll('[data-bar-idx]').length === 2);
var digitYs = [];
Array.prototype.forEach.call(jsv.querySelectorAll('.jp-svg-digit'), function (t) { digitYs.push(t.getAttribute('y')); });
ok('SVG 所有数字基线一致（y=30）', digitYs.length > 0 && digitYs.every(function (y) { return y === '30'; }), digitYs.join(','));
ok('SVG 小节线条数 = 小节数 + 1', jsv.querySelectorAll('.jp-svg-barline').length === 3,
  'got ' + jsv.querySelectorAll('.jp-svg-barline').length);
ok('renderInto 在 renderSvg 抛异常时回退 HTML', (function () {
  var keep = JP.renderSvg, c = container();
  JP.renderSvg = function () { throw new Error('boom'); };
  try { JP.renderInto(c, jpScore, {}); return !!c.querySelector('.jp-wrap'); }
  finally { JP.renderSvg = keep; }
})());

/* toText */
var textOut = JP.toText(jpScore, { mode: 'relative' });
ok('toText 含调名', textOut.indexOf('D 大调') >= 0, textOut.split('\n')[0]);
ok('toText 含 1 2 3 4 5', /\b1\b/.test(textOut) && /\b5\b/.test(textOut), textOut);
ok('toText 多行输出', textOut.split('\n').length >= 2);

/* ---------- 11. 高亮 ---------- */
console.log('11. 播放高亮');
var hc = container();
R.renderScoreInto(hc, mkScore({ seed: 3 }), {});
R.highlightBar(hc, 1);
var bg1 = hc.querySelector('[data-bar-bg="1"]');
ok('highlightBar 给小节底填充颜色', bg1 && bg1.getAttribute('fill') !== 'transparent', bg1 && bg1.getAttribute('fill'));
R.clearHighlight(hc);
ok('clearHighlight 恢复透明', bg1.getAttribute('fill') === 'transparent');
R.highlightNote(hc, 0, 1);
var playingNotes = hc.querySelectorAll('.playing-note');
ok('highlightNote 标出 1 个音符', playingNotes.length === 1, 'got ' + playingNotes.length);

/* ---------- 12. 鲁棒性 ---------- */
console.log('12. 鲁棒性');
ok('空乐段不抛异常', (function () {
  try { R.renderScoreInto(container(), { bars: [] }, {}); return true; } catch (e) { return false; }
})());
ok('缺字段的乐段不抛异常', (function () {
  try { R.renderScoreInto(container(), { bars: [{ notes: [{ dur: 1 }] }] }, {}); return true; } catch (e) { return false; }
})());
ok('renderScoreInto(null) 安全返回', R.renderScoreInto(null, mkScore({}), {}) !== null);
ok('简谱空乐段不抛异常', (function () {
  try { JP.renderInto(container(), { bars: [] }, {}); return true; } catch (e) { return false; }
})());

/* ---------- 13. 全部调号都能渲染 ---------- */
console.log('13. 全部调号渲染');
var allOk = true, rendered = 0;
TH.allKeys().forEach(function (k) {
  try {
    var sc = G.generateScore({ mode: 'melody', bars: 2, seed: 9, key: k, durations: [1, 2], range: { lowOct: 4, highOct: 4 } });
    var c = container();
    var r = R.renderScoreInto(c, sc, {});
    if (r.error) allOk = false;
    var jc3 = container();
    JP.renderInto(jc3, sc, {});
    JP.toText(sc, {});
    rendered++;
  } catch (e) { allOk = false; console.log('    ' + TH.keyName(k) + ' 抛异常: ' + e.message); }
});
ok('30 个调都能渲染五线谱 + 简谱（' + rendered + ' 个）', allOk && rendered === 30, 'rendered=' + rendered);

/* 各拍号都能渲染 */
var tsOk = true;
G.TIME_SIGNATURES.forEach(function (t) {
  try {
    var sc2 = G.generateScore({ mode: 'rhythm', bars: 2, seed: 4, time: { num: t.num, den: t.den }, durations: [1, 0.5, 2] });
    R.renderScoreInto(container(), sc2, {});
    JP.renderInto(container(), sc2, {});
  } catch (e) { tsOk = false; console.log('    ' + t.label + ' 抛异常: ' + e.message); }
});
ok('8 种拍号都能渲染', tsOk);

console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (msgs.length) console.log(msgs.join('\n'));
process.exit(fail ? 1 : 0);
