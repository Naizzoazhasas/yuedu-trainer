/* 用新的简谱 SVG 渲染器生成预览（HTML 包装，便于无头浏览器截图目视验收）
 * 运行： node tools/preview-jianpu.js
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
require(path.join(__dirname, '..', 'src', 'core', 'jianpu.js'));

var APP = global.APP;
var G = APP.generator, JP = APP.jianpu, TH = APP.theory;

var OUT = path.join(__dirname, '_out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

var CASES = [
  {
    file: 'jp-1-beginner',
    title: '入门：C 大调 4/4，只有二分与四分音符，无休止符',
    score: function () {
      return G.generateScore({
        mode: 'melody', bars: 4, durations: [1, 2], useRests: false, seed: 2026,
        key: { tonic: 0, mode: 'major' }, range: { lowOct: 4, highOct: 4 },
        degrees: [1, 2, 3, 4], time: { num: 4, den: 4 }, tempo: 60
      });
    },
    opts: { width: 900, mode: 'relative', showSolfa: true }
  },
  {
    file: 'jp-2-dmajor',
    title: 'D 大调 4/4：附点、八分、休止符（首调简谱）',
    score: function () {
      return G.generateScore({
        mode: 'melody', bars: 4, durations: [1, 2, 0.5], useDotted: true, useRests: true,
        seed: 77, key: { tonic: 2, mode: 'major' }, range: { lowOct: 4, highOct: 5 },
        time: { num: 4, den: 4 }, tempo: 84
      });
    },
    opts: { width: 900, mode: 'relative', showSolfa: true, showNoteName: true }
  },
  {
    file: 'jp-3-octaves',
    title: '高低八度与十六分音符（检查八度点与减时线）',
    score: function () {
      return G.generateScore({
        mode: 'melody', bars: 2, durations: [0.5, 0.25, 1], useRests: true, seed: 5,
        key: { tonic: 7, mode: 'major' }, range: { lowOct: 4, highOct: 5 },
        time: { num: 4, den: 4 }, tempo: 96
      });
    },
    opts: { width: 700, mode: 'relative', showSolfa: true }
  },
  {
    file: 'jp-4-68',
    title: '6/8 拍：复合拍分组',
    score: function () {
      return G.generateScore({
        mode: 'melody', bars: 2, durations: [0.5, 1, 0.25], useRests: true, seed: 11,
        key: { tonic: 9, mode: 'minor' }, range: { lowOct: 4, highOct: 5 },
        time: { num: 6, den: 8 }, tempo: 100
      });
    },
    opts: { width: 700, mode: 'relative', showSolfa: true }
  }
];

var blocks = [];
CASES.forEach(function (c) {
  var score = c.score();
  var host = document.createElement('div');
  var svg = JP.renderSvg(score, c.opts);
  host.appendChild(svg);
  var xml = dom.serialize(svg, false, 0);
  blocks.push('<h2>' + c.title + '</h2>' +
    '<div class="row">' + xml + '</div>' +
    '<div class="meta">' + TH.keyName(score.key) + ' · ' + score.time.num + '/' + score.time.den +
    ' · 小节 ' + score.bars.length + ' · viewBox=' + svg.getAttribute('viewBox') + '</div>');
  console.log('  ' + c.file + '  viewBox=' + svg.getAttribute('viewBox'));
});

var page = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>简谱 SVG 预览</title>' +
  '<style>body{margin:0;background:#fff;color:#111;padding:18px 22px;' +
  'font-family:"Microsoft YaHei",system-ui,sans-serif}' +
  'h2{font-size:14px;margin:18px 0 6px;color:#23507a}' +
  '.row{border:1px solid #dde3ec;border-radius:6px;padding:6px 8px;overflow:hidden}' +
  '.meta{font-size:11px;color:#667085;font-family:Consolas,monospace;margin:4px 0 12px}' +
  'svg{display:block;max-width:100%;height:auto}</style></head><body>' +
  blocks.join('\n') + '</body></html>';

var out = path.join(OUT, 'jianpu-preview.html');
fs.writeFileSync(out, page, 'utf8');
console.log('\n已生成 ' + out + '（' + Math.round(fs.statSync(out).size / 1024) + ' KB）');
