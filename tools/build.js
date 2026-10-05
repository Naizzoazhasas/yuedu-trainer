#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — 构建脚本（零依赖，仅 node 内置模块 fs/path/crypto）
 *
 * 用途：
 *   1) 把 index.html 里的 <link rel="stylesheet"> 与所有 <script src="...">
 *      就地内联，产出「单文件离线版」 <out>/yuedu-trainer.html
 *      （可以直接双击用 file:// 打开，无任何网络请求）。
 *   2) 同时产出「常规多文件版」 <out>/site/（直接复制 index.html/src/icons 等），
 *      供 GitHub Pages 等静态托管使用。
 *   3) 生成 <out>/site/version.json，含每个文件的字节数与 sha1。
 *
 * 用法：
 *   node tools/build.js                     # 默认输出到项目根下的 dist/
 *   node tools/build.js --out dist          # 指定输出根目录（相对项目根或绝对路径）
 *   node tools/build.js --root <目录>       # 指定项目根（默认本仓库根，主要供自测使用）
 *   node tools/build.js --help
 *
 * 容忍缺失：index.html 或任何被引用的源文件不存在时，打印 [缺失] 提示并优雅跳过，
 *           不抛异常、不崩溃。
 * 幂等：每次构建先清空输出目录再重建，重复运行结果一致。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/* index.html 中脚本的既定加载顺序（仅用于缺失检查与提示，绝不改变顺序） */
const EXPECTED_SCRIPTS = [
  'src/core/util.js',
  'src/core/theory.js',
  'src/core/generator.js',
  'src/core/renderer.js',
  'vendor/vexflow.js',
  'src/core/vexrender.js',
  'src/core/jianpu.js',
  'src/audio/tuner.js',
  'src/audio/engine.js',
  'src/data/instruments.js',
  'src/export/exporter.js',
  'src/features/library.js',
  'src/features/ear.js',
  'src/features/practice.js',
  'src/app.js'
];
const EXPECTED_STYLES = 'src/styles.css';
/* 需要随多文件版本一起发布的静态资源（存在才复制）。
 * vendor/ 必须带上，否则站点版没有 VexFlow，五线谱会退回内置渲染器。 */
const SITE_ASSETS = [
  'manifest.webmanifest', 'sw.js', 'vendor/vexflow.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

/* 一次性同时匹配 <link rel="stylesheet" ...> 与 <script src="..." ...></script>，保证按文档顺序替换 */
const TAG_RE = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>|<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>(?:\s*<\/script>)?/gi;

/* ---------------- 小工具 ---------------- */
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }
function toAbs(root, rel) { return path.join(root, rel.split('/').join(path.sep)); }
function toPosix(p) { return p.split(path.sep).join('/'); }
function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

function parseArgs(argv) {
  const opt = { out: 'dist', root: PROJECT_ROOT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') opt.out = argv[++i] || opt.out;
    else if (a.indexOf('--out=') === 0) opt.out = a.slice(6);
    else if (a === '--root' || a === '-r') opt.root = argv[++i] || opt.root;
    else if (a.indexOf('--root=') === 0) opt.root = a.slice(7);
    else if (a === '--help' || a === '-h') opt.help = true;
    else console.log('  [提示] 未知参数已忽略：' + a);
  }
  return opt;
}

function usage() {
  console.log([
    '用法：node tools/build.js [选项]',
    '  --out <目录>   输出根目录（默认 dist，相对项目根）',
    '  --root <目录>  项目根目录（默认本仓库根，主要供自测使用）',
    '  --help         显示本帮助'
  ].join('\n'));
}

/* 报告缺失的预期文件（即便 index.html 尚不存在也能给出清单） */
function reportMissingExpectations(root) {
  const all = [EXPECTED_STYLES].concat(EXPECTED_SCRIPTS, SITE_ASSETS);
  const missing = all.filter(function (rel) { return !exists(toAbs(root, rel)); });
  if (missing.length) {
    console.log('\n  按契约预期存在、但当前不存在的文件共 ' + missing.length + ' 个：');
    missing.forEach(function (rel) { console.log('    [缺失] ' + rel); });
  } else {
    console.log('\n  预期文件齐全，无缺失。');
  }
  return missing;
}

/* ---------------- 内联 ---------------- */

/* 删掉标记为「单文件版不要」的片段：
 *   <!-- build:drop-start 说明 --> ... <!-- build:drop-end -->
 * 用途：单文件离线版（file://）不需要 PWA 清单、图标与 Service Worker 注册，
 * 留着只会让浏览器报 404。站点版保留原样。 */
function stripDropBlocks(html, report) {
  const re = /[ \t]*<!--\s*build:drop-start[\s\S]*?-->[\s\S]*?<!--\s*build:drop-end\s*-->[ \t]*\r?\n?/gi;
  let n = 0;
  const out = html.replace(re, function () { n++; return ''; });
  if (n) console.log('  已移除 ' + n + ' 段「单文件版不需要」的内容（PWA 清单 / 图标 / Service Worker 注册）');
  if (report) report.dropped = n;
  return out;
}

function inlineHtml(html, root, report) {
  return html.replace(TAG_RE, function (tag) {
    const isScript = /^<script/i.test(tag);
    const attrRe = isScript ? /\bsrc\s*=\s*["']([^"']+)["']/i : /\bhref\s*=\s*["']([^"']+)["']/i;
    const m = tag.match(attrRe);
    if (!m) return tag;

    const url = m[1];
    /* 外链 / data: 一律原样保留（本项目按契约不应出现） */
    if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) {
      report.external.push(url);
      console.log('  [外链] ' + url + ' —— 按原样保留');
      return tag;
    }

    const rel = url.replace(/^\.\//, '').split('?')[0].split('#')[0];
    const abs = toAbs(root, rel);

    if (!exists(abs)) {
      report.missing.push(rel);
      console.log('  [缺失] ' + rel + ' —— 已跳过，产物中用注释占位以保持单文件自包含');
      return '<!-- [缺失] ' + rel + ' -->';
    }

    const buf = fs.readFileSync(abs);
    let text = buf.toString('utf8');
    const kind = isScript ? 'js' : 'css';

    if (isScript) {
      if (/<\/script/i.test(text)) {
        text = text.replace(/<\/script/gi, '<\\/script');
        report.escaped.push(rel);
        console.log('  [注意] ' + rel + ' 中含 "</script"，已转义为 "<\\/script"');
      }
      const open = tag.slice(0, tag.indexOf('>'));
      const attrs = open.replace(/^<script/i, '').replace(/\bsrc\s*=\s*["'][^"']+["']/i, '').trim();
      report.inlined.push({ rel: rel, kind: kind, bytes: buf.length, text: text });
      console.log('  [内联] ' + rel + '  (' + fmtBytes(buf.length) + ')');
      return '<script' + (attrs ? ' ' + attrs : '') + '>\n' + text + '\n</script>';
    }

    if (/<\/style/i.test(text)) {
      text = text.replace(/<\/style/gi, '<\\/style');
      report.escaped.push(rel);
      console.log('  [注意] ' + rel + ' 中含 "</style"，已转义');
    }
    report.inlined.push({ rel: rel, kind: kind, bytes: buf.length, text: text });
    console.log('  [内联] ' + rel + '  (' + fmtBytes(buf.length) + ')');
    return '<style>\n' + text + '\n</style>';
  });
}

/* ---------------- 产物校验 ---------------- */
function validate(artifact, report) {
  const problems = [];
  const warns = [];

  if (artifact.indexOf('src="src/') >= 0 || artifact.indexOf("src='src/") >= 0) {
    problems.push('产物中仍存在 src="src/…" 的脚本引用');
  }
  if (artifact.indexOf('href="src/styles.css"') >= 0 || artifact.indexOf("href='src/styles.css'") >= 0) {
    problems.push('产物中仍存在 href="src/styles.css" 的样式引用');
  }

  /* 内联的 JS 里不得出现行首 import/export（宽松正则 + 多行标志） */
  report.inlined.filter(function (f) { return f.kind === 'js'; }).forEach(function (f) {
    const m = f.text.match(/^[ \t]*(import|export)\s/m);
    if (m) problems.push(f.rel + ' 中出现行首 ' + m[1] + ' 语句（契约禁止 import/export）');
    const r = f.text.match(/^[ \t]*require\s*\(/m);
    if (r) warns.push(f.rel + ' 中出现 require( （浏览器端不可用）');
  });

  return { problems: problems, warns: warns };
}

/* ---------------- 目录复制 ---------------- */
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return fs.statSync(dst).size;
}

function copyDir(root, relDir, siteDir, list) {
  const from = toAbs(root, relDir);
  if (!fs.existsSync(from)) return;
  fs.readdirSync(from, { withFileTypes: true }).forEach(function (ent) {
    const rel = relDir.replace(/\/$/, '') + '/' + ent.name;
    if (ent.isDirectory()) copyDir(root, rel, siteDir, list);
    else if (ent.isFile()) {
      const dst = path.join(siteDir, rel.split('/').join(path.sep));
      const n = copyFile(toAbs(root, rel), dst);
      list.push({ path: rel, bytes: n, sha1: sha1(fs.readFileSync(dst)) });
    }
  });
}

/* ---------------- 主流程 ---------------- */
function main() {
  const opt = parseArgs(process.argv.slice(2));
  console.log('=== 读谱训练器 · 构建（单文件离线版 + 多文件站点版） ===');
  console.log('用途：内联 index.html 引用的 CSS/JS，产出可 file:// 直开的单文件，同时复制一份多文件站点。\n');

  if (opt.help) { usage(); return 0; }

  const root = path.resolve(opt.root);
  const outRoot = path.isAbsolute(opt.out) ? path.resolve(opt.out) : path.resolve(root, opt.out);

  console.log('  项目根：' + root);
  console.log('  输出根：' + outRoot);

  /* 安全阀：绝不允许把输出目录设成项目根或它的祖先 */
  if (outRoot === root || root.indexOf(outRoot + path.sep) === 0) {
    console.log('\n  [错误] 输出目录不能是项目根目录或其上级目录，已中止。');
    return 1;
  }

  const indexPath = path.join(root, 'index.html');
  if (!exists(indexPath)) {
    console.log('\n  [缺失] index.html —— 尚未就绪，本次构建优雅跳过（未生成任何产物）。');
    reportMissingExpectations(root);
    console.log('\n  待 index.html 就绪后重新运行：node tools/build.js');
    return 0;
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  const report = { inlined: [], missing: [], escaped: [], external: [] };

  /* 1) 清空输出目录（幂等） */
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  const siteDir = path.join(outRoot, 'site');
  fs.mkdirSync(siteDir, { recursive: true });

  /* 2) 单文件构建 */
  console.log('\n--- 内联 index.html ---');
  const t0 = Date.now();
  const artifact = inlineHtml(stripDropBlocks(html, report), root, report);
  const singlePath = path.join(outRoot, 'yuedu-trainer.html');
  fs.writeFileSync(singlePath, artifact, 'utf8');
  const singleBytes = fs.statSync(singlePath).size;

  /* 3) 校验单文件产物 */
  console.log('\n--- 校验单文件产物 ---');
  const v = validate(artifact, report);
  if (v.warns.length) v.warns.forEach(function (w) { console.log('  [警告] ' + w); });
  if (v.problems.length) {
    v.problems.forEach(function (p) { console.log('  ✗ ' + p); });
  } else {
    console.log('  ✓ 不含 src="src/…" 与 href="src/styles.css"');
    console.log('  ✓ 内联 JS 中无行首 import/export（已用多行 ^\\s*(import|export)\\s 正则检查）');
  }

  /* 4) 多文件站点版 */
  console.log('\n--- 生成多文件站点版 ---');
  const siteFiles = [];
  const htmlBytes = copyFile(indexPath, path.join(siteDir, 'index.html'));
  siteFiles.push({ path: 'index.html', bytes: htmlBytes, sha1: sha1(fs.readFileSync(path.join(siteDir, 'index.html'))) });
  console.log('  [复制] index.html  (' + fmtBytes(htmlBytes) + ')');
  ['src', 'icons', 'docs'].forEach(function (d) {
    const before = siteFiles.length;
    copyDir(root, d, siteDir, siteFiles);
    const n = siteFiles.length - before;
    if (n) console.log('  [复制] ' + d + '/  共 ' + n + ' 个文件');
    else if (!fs.existsSync(toAbs(root, d))) console.log('  [缺失] ' + d + '/  （跳过）');
  });
  SITE_ASSETS.forEach(function (rel) {
    if (!exists(toAbs(root, rel))) { console.log('  [缺失] ' + rel + '  （跳过）'); return; }
    if (siteFiles.some(function (f) { return f.path === rel; })) return; /* 已随目录复制过，避免重复 */
    const buf = fs.readFileSync(toAbs(root, rel));
    const dst = path.join(siteDir, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    siteFiles.push({ path: rel, bytes: buf.length, sha1: sha1(buf) });
    console.log('  [复制] ' + rel + '  (' + fmtBytes(buf.length) + ')');
  });
  /* GitHub Pages 用：让下划线开头的目录也能被发布 */
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');

  /* 5) version.json */
  let pkgVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg && pkg.version) pkgVersion = String(pkg.version);
  } catch (e) { /* 没有 package.json 也没关系 */ }

  /* 去重（同一路径可能既随目录复制、又随 SITE_ASSETS 复制），再按路径排序 */
  const seen = Object.create(null);
  const deduped = [];
  siteFiles.forEach(function (f) {
    if (seen[f.path]) return;
    seen[f.path] = true;
    deduped.push(f);
  });
  siteFiles.length = 0;
  Array.prototype.push.apply(siteFiles, deduped);
  siteFiles.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
  const versionInfo = {
    name: '读谱训练器',
    slug: 'yuedu-trainer',
    version: pkgVersion,
    builtAt: new Date().toISOString(),
    singleFile: 'yuedu-trainer.html',
    fileCount: siteFiles.length,
    files: siteFiles
  };
  const versionJson = JSON.stringify(versionInfo, null, 2) + '\n';
  fs.writeFileSync(path.join(siteDir, 'version.json'), versionJson, 'utf8');
  console.log('  [生成] version.json  (' + fmtBytes(Buffer.byteLength(versionJson)) + '，' + siteFiles.length + ' 个文件条目)');

  /* 6) 汇总 */
  console.log('\n--- 内联明细 ---');
  if (report.inlined.length === 0) console.log('  （没有任何文件被内联）');
  report.inlined.forEach(function (f) {
    console.log('  ' + (f.kind === 'css' ? 'CSS' : 'JS ') + '  ' + f.rel.padEnd(34, ' ') + fmtBytes(f.bytes));
  });
  const inlinedBytes = report.inlined.reduce(function (s, f) { return s + f.bytes; }, 0);
  console.log('  内联总量：' + fmtBytes(inlinedBytes) + '（' + report.inlined.length + ' 个文件）');

  console.log('\n--- 构建结果 ---');
  console.log('  单文件版：' + toPosix(path.relative(root, singlePath)) + '  ' + fmtBytes(singleBytes));
  console.log('  站点版：  ' + toPosix(path.relative(root, siteDir)) + '/  共 ' + siteFiles.length + ' 个文件');
  console.log('  用时：    ' + (Date.now() - t0) + 'ms');

  if (report.missing.length) {
    console.log('\n  [缺失] 共 ' + report.missing.length + ' 个被引用文件不存在（已跳过）：');
    report.missing.forEach(function (rel) { console.log('    - ' + rel); });
  }
  reportMissingExpectations(root);

  if (v.problems.length) {
    console.log('\n=== 构建完成，但校验未通过 ✗ ===');
    return 1;
  }
  console.log('\n=== 构建成功 ✓ ===');
  return 0;
}

process.exit(main());
