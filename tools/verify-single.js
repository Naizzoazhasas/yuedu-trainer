/* 读谱训练器 — 单文件离线版浏览器验证
 * 运行： node tools/verify-single.js
 *
 * 用无头 Edge 打开 dist/yuedu-trainer.html（file:// 协议），等待应用启动后把
 * 检查结果写进 <title> 与页面里的 <pre id="__probe">，再 dump DOM 解析。
 * 这样可以确认「双击即用」这条路径真的成立。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var SINGLE = path.join(ROOT, 'dist', 'yuedu-trainer.html');
var TMP = path.join(ROOT, 'tools', '_out');

function findBrowser() {
  var cands = [
    process.env['ProgramFiles'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['ProgramFiles'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (var i = 0; i < cands.length; i++) {
    try { if (fs.statSync(cands[i]).isFile()) return cands[i]; } catch (e) { /* 继续 */ }
  }
  return null;
}

console.log('=== 单文件离线版浏览器验证 ===\n');

if (!fs.existsSync(SINGLE)) {
  console.log('[失败] 找不到 ' + SINGLE + '，请先运行 node tools/build.js');
  process.exit(1);
}
var browser = findBrowser();
if (!browser) {
  console.log('[跳过] 本机没有找到 Edge / Chrome，无法做浏览器验证。');
  process.exit(0);
}
console.log('浏览器： ' + browser);
console.log('产物：   ' + SINGLE + '  (' + (fs.statSync(SINGLE).size / 1024).toFixed(0) + ' KB)\n');

/* ---- 构造一个「注入探针」的临时副本：把检查脚本塞进 </body> 之前 ---- */
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
var probePath = path.join(TMP, '_single-probe.html');
var html = fs.readFileSync(SINGLE, 'utf8');

var probe = [
  '<script>',
  '(function () {',
  '  function run() {',
  '    var lines = [];',
  '    function chk(name, cond, detail) {',
  '      lines.push((cond ? "[OK] " : "[FAIL] ") + name + (detail ? "  -> " + detail : ""));',
  '    }',
  '    var lines2 = lines;',
  '    try {',
  '      chk("location.protocol 是 file:", location.protocol === "file:", location.protocol);',
  '      chk("APP 命名空间存在", !!window.APP);',
  '      chk("VexFlow 已内联并可用", !!(window.Vex && Vex.Flow && Vex.Flow.Stave));',
  '      chk("APP.vexrender 已注册且可用", !!(APP.vexrender && APP.vexrender.isAvailable()));',
  '      var score = APP.app && APP.app.getScore ? APP.app.getScore() : null;',
  '      chk("应用已生成乐段", !!score, score ? ("小节 " + score.bars.length) : "");',
  '      var svg = document.querySelector("#gen-staff-host svg");',
  '      chk("五线谱已渲染", !!svg);',
  '      chk("用的是 VexFlow 渲染器", svg && svg.getAttribute("data-renderer") === "vexflow",',
  '        svg ? String(svg.getAttribute("data-renderer")) : "");',
  '      chk("简谱已渲染（SVG 或 HTML 后端任一）",',
  '        !!document.querySelector("#gen-jianpu-host svg[data-renderer=\'jianpu-svg\']") ||',
  '        !!document.querySelector("#gen-jianpu-host .jp-wrap"),',
  '        "svg=" + document.querySelectorAll("#gen-jianpu-host svg").length +',
  '        " html=" + document.querySelectorAll("#gen-jianpu-host .jp-wrap").length);',
  '      chk("七个标签页齐全", document.querySelectorAll("#tabs .tab").length === 7,',
  '        document.querySelectorAll("#tabs .tab").length + " 个");',
  '      chk("节拍器面板可初始化", (function () {',
  '        try { var t = document.querySelector(\'#tabs .tab[data-tab="metro"]\'); t.click();',
  '          return !!document.querySelector(".metro-face"); } catch (e) { return false; }',
  '      })());',
  '      chk("调音器面板能给出降级提示（file:// 下预期不可用）", (function () {',
  '        try { var t = document.querySelector(\'#tabs .tab[data-tab="tuner"]\'); t.click();',
  '          return document.querySelectorAll("#tuner-mount *").length > 0; } catch (e) { return false; }',
  '      })());',
  '      chk("音阶面板可初始化", (function () {',
  '        try { var t = document.querySelector(\'#tabs .tab[data-tab="scale"]\'); t.click();',
  '          return document.querySelectorAll("#scale-mount .scale-table").length > 0; } catch (e) { return false; }',
  '      })());',
  '      chk("乐器面板可初始化", (function () {',
  '        try { var t = document.querySelector(\'#tabs .tab[data-tab="inst"]\'); t.click();',
  '          return document.querySelectorAll("#inst-mount svg").length > 0; } catch (e) { return false; }',
  '      })());',
  '      chk("听辨面板可初始化", (function () {',
  '        try { var t = document.querySelector(\'#tabs .tab[data-tab="ear"]\'); t.click();',
  '          return document.querySelectorAll("#ear-mount .ear-tap").length > 0; } catch (e) { return false; }',
  '      })());',
  '      chk("音型库/导出面板可初始化", (function () {',
  '        try { var t = document.querySelector(\'#tabs .tab[data-tab="lib"]\'); t.click();',
  '          return document.querySelectorAll("#lib-mount *").length > 0; } catch (e) { return false; }',
  '      })());',
  '      chk("切回生成页并重新生成乐段", (function () {',
  '        try { document.querySelector(\'#tabs .tab[data-tab="gen"]\').click();',
  '          document.querySelector("#gen-new").click();',
  '          return !!document.querySelector("#gen-staff-host svg"); } catch (e) { return false; }',
  '      })());',
  '      chk("没有任何外部资源引用（file:// 下不应有 404）", (function () {',
  '        /* 扫描真实的 HTML 元素属性，不看 innerHTML 里的字符串（SVG 内联数据里也会出现 src=） */',
  '        var nodes = document.querySelectorAll("[src], [href]");',
  '        var bad = [];',
  '        for (var i = 0; i < nodes.length; i++) {',
  '          var v = nodes[i].getAttribute("src") || nodes[i].getAttribute("href") || "";',
  '          if (/^(data:|blob:|#)/i.test(v)) continue;',
  '          bad.push(nodes[i].tagName.toLowerCase() + "=" + v);',
  '        }',
  '        return bad.length === 0 || bad.join(",");',
  '      })());',
  '    } catch (e) {',
  '      lines2.push("[FAIL] 探针自身异常: " + (e && e.message ? e.message : e));',
  '    }',
  '    var bad = lines.filter(function (l) { return l.indexOf("[FAIL]") === 0; }).length;',
  '    lines.push("");',
  '    lines.push("失败项: " + bad);',
  '    var pre = document.createElement("pre");',
  '    pre.id = "__probe";',
  '    pre.textContent = lines.join("\\n");',
  '    document.body.appendChild(pre);',
  '    document.title = bad === 0 ? "SINGLE-ALL-PASS" : ("SINGLE-FAIL-" + bad);',
  '  }',
  '  if (document.readyState === "complete") setTimeout(run, 500);',
  '  else window.addEventListener("load", function () { setTimeout(run, 500); });',
  '})();',
  '</script>'
].join('\n');

html = html.replace(/<\/body>/i, probe + '\n</body>');
fs.writeFileSync(probePath, html, 'utf8');

/* ---- 用无头浏览器打开并 dump DOM ---- */
var dumpPath = path.join(TMP, '_single-dump.html');
var url = 'file:///' + probePath.split(path.sep).join('/');
var args = [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=20000', '--window-size=1400,1200',
  '--dump-dom', url
];
var r = cp.spawnSync(browser, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
var dom = r.stdout || '';
fs.writeFileSync(dumpPath, dom, 'utf8');

/* ---- 解析结果 ---- */
var title = (dom.match(/<title>([^<]*)<\/title>/) || [])[1] || '(无标题)';
var m = dom.match(/<pre id="__probe">([\s\S]*?)<\/pre>/);
var body = m ? m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null;

console.log('页面标题： ' + title);
if (body) {
  console.log('--- 探针结果 ---');
  console.log(body);
} else {
  console.log('未拿到探针输出（页面可能没跑起来）');
  console.log('DOM 长度： ' + dom.length);
}
console.log('\nDOM 转储： ' + dumpPath);

var failCount = (dom.match(/\[FAIL\]/g) || []).length;
if (title.indexOf('SINGLE-ALL-PASS') >= 0) {
  console.log('\n结论：单文件离线版可用 ✓');
  process.exit(0);
}
console.log('\n结论：单文件离线版存在失败项（' + failCount + '）✗');
process.exit(1);
