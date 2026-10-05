/* 读谱训练器 — VexFlow 渲染后端验证（无头浏览器）
 * 运行： node tools/verify-vexflow.js
 *
 * 打开 tools/_vf-all.html（内含 48 个渲染用例：15 个调号、8 种拍号、加线、十六分、
 * 附点、休止、延音线、1/8/16 小节自动分行、低音谱、纯节奏），逐例检查是否渲染成功，
 * 并解析页面写入的汇总结果。
 *
 * 没有 Edge / Chrome 时优雅跳过（退出码 0），避免在 CI 环境里误判失败。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var PAGE = path.join(__dirname, '_vf-all.html');
var TMP = path.join(__dirname, '_out');

function findBrowser() {
  var cands = [
    (process.env['ProgramFiles'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
    (process.env['ProgramFiles(x86)'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
    (process.env['ProgramFiles'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['ProgramFiles(x86)'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['LOCALAPPDATA'] || '') + '\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (var i = 0; i < cands.length; i++) {
    try { if (fs.statSync(cands[i]).isFile()) return cands[i]; } catch (e) { /* 继续 */ }
  }
  return null;
}

console.log('=== VexFlow 渲染后端验证 ===\n');

if (!fs.existsSync(PAGE)) { console.log('[跳过] 找不到 ' + PAGE); process.exit(0); }
var vf = path.join(ROOT, 'vendor', 'vexflow.js');
if (!fs.existsSync(vf)) { console.log('[失败] 缺少 vendor/vexflow.js'); process.exit(1); }
console.log('VexFlow： ' + (fs.statSync(vf).size / 1024).toFixed(0) + ' KB');

var browser = findBrowser();
if (!browser) {
  console.log('[跳过] 本机没有找到 Edge / Chrome，无法做浏览器验证。');
  process.exit(0);
}
console.log('浏览器： ' + browser + '\n');

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
var dump = path.join(TMP, '_vf-all-dump.html');
var url = 'file:///' + PAGE.split(path.sep).join('/');

var r = cp.spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=25000', '--window-size=1400,1000',
  '--dump-dom', url
], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true });

var dom = r.stdout || '';
fs.writeFileSync(dump, dom, 'utf8');

var title = (dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '(无标题)';
var m = dom.match(/<div id="summary">([\s\S]*?)<\/div>/);
var text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : '';

console.log('页面标题： ' + title);
if (text) {
  console.log('--- 用例汇总 ---');
  console.log(text);
} else {
  console.log('未拿到汇总输出（页面可能没跑起来），DOM 长度 ' + dom.length);
}

var svgCount = (dom.match(/data-renderer="vexflow"/g) || []).length;
console.log('\n渲染出的 VexFlow SVG 数： ' + svgCount);

var okMatch = dom.match(/用例数:\s*(\d+)\s*成功:\s*(\d+)\s*失败:\s*(\d+)/);
if (okMatch) {
  console.log('用例数 ' + okMatch[1] + ' / 成功 ' + okMatch[2] + ' / 失败 ' + okMatch[3]);
}

if (title === 'VF-ALL-PASS-48') {
  console.log('\n结论：VexFlow 后端 48 个用例全部通过 ✓');
  process.exit(0);
}
if (title.indexOf('VF-ALL-PASS') === 0) {
  console.log('\n结论：VexFlow 后端用例全部通过（' + title + '）✓');
  process.exit(0);
}
console.log('\n结论：VexFlow 后端验证失败 ✗  ' + title);
process.exit(1);
