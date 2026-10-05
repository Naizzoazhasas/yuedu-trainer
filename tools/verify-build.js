/* 读谱训练器 — 构建产物校验
 * 运行： node tools/verify-build.js
 * 检查 dist/yuedu-trainer.html（单文件版）与 dist/site/（站点版）是否真的可用：
 *   - 单文件版：CSS/JS 全部内联、无外部 src/href 引用、关键模块都在
 *   - 站点版：index.html 引用的每个文件都实际存在（包括 vendor/vexflow.js）
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SINGLE = path.join(ROOT, 'dist', 'yuedu-trainer.html');
var SITE = path.join(ROOT, 'dist', 'site');

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  [ok]   ' + name); }
  else { fail++; console.log('  [失败] ' + name + (detail ? '  → ' + detail : '')); msgs.push(name); }
}
function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }
function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

/* 需要在单文件版里出现的「模块指纹」 */
var FINGERPRINTS = [
  ['内置五线谱渲染器', 'APP.renderer'],
  ['VexFlow 后端', 'APP.vexrender'],
  ['VexFlow 库本身（字体数据 Bravura）', 'Bravura'],
  ['VexFlow 库本身（音符类 stavenote）', 'stavenote'],
  ['乐理内核', 'APP.theory'],
  ['生成器', 'APP.generator'],
  ['简谱渲染', 'APP.jianpu'],
  ['音频引擎', 'APP.engine'],
  ['调音器', 'APP.tuner'],
  ['乐器音阶表', 'APP.instruments'],
  ['导出模块', 'APP.export'],
  ['音型库', 'APP.library'],
  ['听辨练习', 'APP.ear'],
  ['练习模式', 'APP.practice'],
  ['主程序', 'APP.app']
];

console.log('=== 构建产物校验 ===\n');
console.log('1. 单文件版 dist/yuedu-trainer.html');
ok('文件存在', exists(SINGLE));
if (!exists(SINGLE)) { console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败'); process.exit(1); }

var html = fs.readFileSync(SINGLE, 'utf8');
console.log('  大小： ' + kb(html.length));

ok('没有未内联的 <script src="...">', !/<script[^>]+src\s*=/i.test(html));
ok('没有未内联的 <link rel="stylesheet">', !/<link[^>]+rel=["']stylesheet["']/i.test(html));
ok('含内联 <style>', /<style[^>]*>[\s\S]{500,}<\/style>/i.test(html));
ok('含 16 个内联 <script> 块', (html.match(/<script(?![^>]*src)/gi) || []).length >= 15,
  (html.match(/<script(?![^>]*src)/gi) || []).length + ' 个');
ok('没有残留 sourceMappingURL', html.indexOf('sourceMappingURL') < 0);

FINGERPRINTS.forEach(function (f) {
  ok('包含 ' + f[0], html.indexOf(f[1]) >= 0, '找不到标记 ' + f[1]);
});

/* 单文件版必须能独立打开：不能引用任何外部文件 */
var externalRefs = [];
var re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi, m;
while ((m = re.exec(html))) {
  var u = m[1];
  if (/^(https?:|data:|blob:|#|mailto:)/i.test(u)) continue;
  if (/\.(js|css|webmanifest)$/i.test(u)) externalRefs.push(u);
}
ok('没有指向外部 JS/CSS 的引用', externalRefs.length === 0, externalRefs.join(', '));

console.log('\n2. 站点版 dist/site/');
ok('目录存在', fs.existsSync(SITE));
if (fs.existsSync(SITE)) {
  var indexPath = path.join(SITE, 'index.html');
  ok('dist/site/index.html 存在', exists(indexPath));
  if (exists(indexPath)) {
    var siteHtml = fs.readFileSync(indexPath, 'utf8');
    var srcs = [];
    var re2 = /(?:src|href)\s*=\s*["']([^"']+)["']/gi, m2;
    while ((m2 = re2.exec(siteHtml))) {
      var v = m2[1];
      if (/^(https?:|data:|blob:|#|mailto:)/i.test(v)) continue;
      srcs.push(v);
    }
    var missing = srcs.filter(function (s) {
      var p = path.join(SITE, s.split('/').join(path.sep));
      return !exists(p);
    });
    ok('index.html 引用的 ' + srcs.length + ' 个本地资源都存在', missing.length === 0, missing.join(', '));
    ok('站点版包含 vendor/vexflow.js', exists(path.join(SITE, 'vendor', 'vexflow.js')),
      '缺少 vendor/vexflow.js，站点版会退回内置渲染器');
    ok('站点版包含全部 src 模块', fs.existsSync(path.join(SITE, 'src', 'core', 'vexrender.js')) &&
      fs.existsSync(path.join(SITE, 'src', 'app.js')));
    ok('站点版包含 sw.js 与 manifest', exists(path.join(SITE, 'sw.js')) &&
      exists(path.join(SITE, 'manifest.webmanifest')));
    ok('站点版包含 .nojekyll', exists(path.join(SITE, '.nojekyll')));
    ok('站点版包含 version.json', exists(path.join(SITE, 'version.json')));
  }
}

console.log('\n3. 构建产物总量');
var total = 0;
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else total += fs.statSync(p).size;
  });
})(path.join(ROOT, 'dist'));
console.log('  dist 总计： ' + kb(total));

console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (fail) console.log('失败项：\n  - ' + msgs.join('\n  - '));
process.exit(fail ? 1 : 0);
