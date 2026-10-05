/* 生成谱面预览 SVG（用于人工验收五线谱与简谱渲染效果）
 * 运行： node tools/preview.js
 * 产出： tools/_out/preview-*.svg
 */
'use strict';

var fs = require('fs');
var path = require('path');
var dom = require(path.join(__dirname, 'dom-shim.js'));
dom.install();
global.window = global;

require(path.join(__dirname, '..', 'src', 'core', 'util.js'));
require(path.join(__dirname, '..', 'src', 'core', 'theory.js'));
require(path.join(__dirname, '..', 'src', 'core', 'generator.js'));
require(path.join(__dirname, '..', 'src', 'core', 'renderer.js'));
require(path.join(__dirname, '..', 'src', 'core', 'jianpu.js'));

var APP = global.APP;
var G = APP.generator, R = APP.renderer, JP = APP.jianpu, TH = APP.theory, U = APP.util;

var OUT = path.join(__dirname, '_out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* VexFlow 在 node 下无法运行（需要真实 DOM + Canvas），所以这里的 SVG 预览用内置渲染器；
 * VexFlow 的渲染效果由 tools/_vf-all.html + tools/_vf-integ.html 在无头浏览器里验证。 */
var HAS_VEX = false;
function writeSvg(name, svg) {
  var xml = dom.serialize(svg, true, 0);
  var p = path.join(OUT, name);
  fs.writeFileSync(p, '<?xml version="1.0" encoding="UTF-8"?>\n' + xml, 'utf8');
  console.log('  ' + name + '  ' + Math.round(fs.statSync(p).size / 1024) + ' KB');
}

function sheetOf(score, opts) {
  var c = document.createElement('div');
  R.renderScoreInto(c, score, opts);
  return c.querySelector('svg');
}

console.log('生成预览 SVG …');

/* 1. 入门档：C 大调 4/4，只有二分与四分，无休止符 */
writeSvg('preview-beginner.svg', sheetOf(G.generateScore({
  mode: 'melody', bars: 4, durations: [1, 2], useRests: false, seed: 2026,
  key: { tonic: 0, mode: 'major' }, range: { lowOct: 4, highOct: 4 },
  degrees: [1, 2, 3, 4], time: { num: 4, den: 4 }, tempo: 60
}), { width: 940, showBarNumbers: true, showSubText: 'both' }));

/* 2. D 大调，附点与八分，含休止符 */
writeSvg('preview-dmajor.svg', sheetOf(G.generateScore({
  mode: 'melody', bars: 4, durations: [1, 2, 0.5], useDotted: true, useRests: true,
  seed: 77, key: { tonic: 2, mode: 'major' }, range: { lowOct: 4, highOct: 5 },
  time: { num: 4, den: 4 }, tempo: 84
}), { width: 940, showBarNumbers: true, showSubText: 'solfa' }));

/* 3. 低音谱 3/4 */
writeSvg('preview-bass.svg', sheetOf(G.generateScore({
  mode: 'melody', bars: 3, durations: [1, 2, 0.5], useRests: true, seed: 9,
  clef: 'bass', key: { tonic: 5, mode: 'major' }, range: { lowOct: 3, highOct: 3 },
  time: { num: 3, den: 4 }, tempo: 72
}), { width: 820, showBarNumbers: true, showSubText: 'name' }));

/* 4. 6/8 十六分音符与符杠 */
writeSvg('preview-68.svg', sheetOf(G.generateScore({
  mode: 'melody', bars: 2, durations: [0.5, 0.25, 1], useRests: true, useDotted: true, seed: 5,
  key: { tonic: 7, mode: 'major' }, range: { lowOct: 4, highOct: 4 },
  time: { num: 6, den: 8 }, tempo: 96
}), { width: 700, showBarNumbers: true, showSubText: 'both' }));

/* 5. 纯节奏（单音） */
writeSvg('preview-rhythm.svg', sheetOf(G.generateScore({
  mode: 'rhythm', bars: 4, durations: [1, 2, 0.5], useRests: true, seed: 31,
  key: { tonic: 0, mode: 'major' }, time: { num: 4, den: 4 }, tempo: 60
}), { width: 940, showBarNumbers: true }));

/* 6. 简谱单独导出一份（HTML 片段，方便肉眼检查） */
(function () {
  var score = G.generateScore({
    mode: 'melody', bars: 4, durations: [1, 2, 0.5], useDotted: true, useRests: true, seed: 77,
    key: { tonic: 2, mode: 'major' }, range: { lowOct: 4, highOct: 5 }, time: { num: 4, den: 4 }, tempo: 84
  });
  var c = document.createElement('div');
  JP.renderInto(c, score, { mode: 'relative', showSolfa: true, showNoteName: true });
  var html = '<!doctype html><meta charset="utf-8"><title>简谱预览</title>' +
    '<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#fff;color:#131a26;padding:24px}' +
    '.jp-wrap{display:flex;flex-wrap:wrap;gap:4px 0}.jp-bar{display:flex;align-items:flex-end;padding:0 10px 0 2px;position:relative}' +
    '.jp-bar+.jp-bar{border-left:1.5px solid #4a5568;padding-left:12px}' +
    '.jp-note{display:flex;flex-direction:column;align-items:center;min-width:22px;padding:0 3px;position:relative}' +
    '.jp-digit{font-size:22px;font-weight:600;line-height:1.2}.jp-note.rest .jp-digit{color:#8b95a8}' +
    '.jp-acc{font-size:15px;vertical-align:super}.jp-dot-above,.jp-dot-below{font-size:20px;line-height:.4;height:8px}' +
    '.jp-underline{height:1.6px;background:currentColor;margin-top:1px;align-self:stretch}.jp-underline.d2{height:1.6px;margin-bottom:3px}' +
    '.jp--{font-size:20px;padding:0 2px;color:#4a5568}.jp-sub{font-size:9.5px;color:#7a8699;margin-top:2px}' +
    '.jp-bar-num{position:absolute;top:-14px;left:2px;font-size:10px;color:#9aa5b8}</style>' +
    dom.serialize(c, false, 0);
  var p = path.join(OUT, 'preview-jianpu.html');
  fs.writeFileSync(p, html, 'utf8');
  console.log('  preview-jianpu.html  ' + Math.round(fs.statSync(p).size / 1024) + ' KB');
  console.log('  简谱纯文本:\n' + JP.toText(score, { mode: 'relative' }));
})();

console.log('\n完成，输出目录：tools/_out/');
