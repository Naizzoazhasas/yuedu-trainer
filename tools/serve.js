#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — 本地开发服务器（零依赖，仅 node 内置模块 http/fs/path）
 *
 * 用途：把项目根目录当作静态站点发布，方便本地调试与手机同网段预览。
 *       调音器要用麦克风，浏览器要求「安全上下文」——
 *       http://127.0.0.1 / http://localhost 被视作安全上下文，
 *       直接双击 HTML（file://）则不行，所以开发时请走本服务器。
 *
 * 用法：
 *   node tools/serve.js                     # 默认 127.0.0.1:8099，根目录=项目根
 *   node tools/serve.js --port 8123         # 指定端口
 *   node tools/serve.js --root dist/site    # 指定发布根目录
 *   node tools/serve.js --host 0.0.0.0      # 指定监听地址
 *   node tools/serve.js --help
 *
 * 特性：正确的 Content-Type、Cache-Control: no-store（开发期方便刷新）、
 *       目录请求回落到 index.html、404 返回中文提示页。
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function parseArgs(argv) {
  const opt = { port: 8099, root: PROJECT_ROOT, host: '127.0.0.1', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') opt.port = parseInt(argv[++i], 10);
    else if (a.indexOf('--port=') === 0) opt.port = parseInt(a.slice(7), 10);
    else if (a === '--root' || a === '-r') opt.root = argv[++i];
    else if (a.indexOf('--root=') === 0) opt.root = a.slice(7);
    else if (a === '--host') opt.host = argv[++i] || opt.host;
    else if (a.indexOf('--host=') === 0) opt.host = a.slice(7);
    else if (a === '--help' || a === '-h') opt.help = true;
    else console.log('  [提示] 未知参数已忽略：' + a);
  }
  return opt;
}

function usage() {
  console.log([
    '用法：node tools/serve.js [选项]',
    '  --port <端口>   监听端口（默认 8099）',
    '  --root <目录>   静态根目录（默认项目根）',
    '  --host <地址>   监听地址（默认 127.0.0.1）',
    '  --help          显示本帮助'
  ].join('\n'));
}

function send(res, status, type, body, extraHeaders) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const headers = Object.assign({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  }, extraHeaders || {});
  headers['Content-Type'] = type;
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}

function notFoundPage(reqPath) {
  const safe = String(reqPath).replace(/[<>&"]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
  });
  return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>404 — 找不到文件</title>' +
    '<style>body{background:#0f1420;color:#e8eefc;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif;' +
    'margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}' +
    '.box{max-width:620px;padding:32px;background:#161d2c;border:1px solid #26314a;border-radius:14px}' +
    'h1{margin:0 0 12px;font-size:22px}p{margin:8px 0;color:#9fb0d0}code{background:#0f1420;padding:2px 6px;' +
    'border-radius:6px;color:#4d8dff}a{color:#4d8dff}</style></head><body><div class="box">' +
    '<h1>404 — 找不到这个文件</h1>' +
    '<p>请求路径：<code>' + safe + '</code></p>' +
    '<p>请检查路径拼写，或返回 <a href="./">首页</a>。</p>' +
    '<p>如果你刚改过源码，注意本服务器不做任何构建，它只发布磁盘上的文件。</p>' +
    '</div></body></html>\n';
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  console.log('=== 读谱训练器 · 本地开发服务器 ===');
  console.log('用途：零依赖静态服务器，用于本地调试（调音器需要 http://127.0.0.1 或 https）。\n');
  if (opt.help) { usage(); return 0; }

  if (!Number.isFinite(opt.port) || opt.port <= 0 || opt.port > 65535) {
    console.log('  [错误] 端口不合法：' + opt.port);
    return 1;
  }

  const root = path.resolve(opt.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.log('  [错误] 根目录不存在或不是目录：' + root);
    return 1;
  }

  const server = http.createServer(function (req, res) {
    const started = Date.now();
    let pathname = '/';
    try {
      pathname = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0]);
    } catch (e) {
      send(res, 400, 'text/html; charset=utf-8', notFoundPage(String(req.url)));
      return;
    }

    /* 解析成绝对路径，并阻止越界访问（../） */
    const rel = pathname.replace(/^\/+/, '');
    let target = path.resolve(root, rel.split('/').join(path.sep));
    if (target !== root && target.indexOf(root + path.sep) !== 0) {
      console.log('  403  ' + req.method + ' ' + pathname + '  （越界访问已拒绝）');
      send(res, 403, 'text/html; charset=utf-8', notFoundPage(pathname));
      return;
    }

    let st = null;
    try { st = fs.statSync(target); } catch (e) { st = null; }

    /* 目录请求 → 回落到 index.html */
    if (st && st.isDirectory()) {
      const idx = path.join(target, 'index.html');
      if (fs.existsSync(idx) && fs.statSync(idx).isFile()) target = idx;
      else {
        const listing = fs.readdirSync(target).filter(function (n) { return n[0] !== '.'; });
        const body = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
          '<title>目录索引</title><style>body{background:#0f1420;color:#e8eefc;font:16px/1.8 system-ui,' +
          '"Microsoft YaHei",sans-serif;padding:32px}a{color:#4d8dff}</style></head><body>' +
          '<h1>目录：' + pathname + '</h1><ul>' +
          listing.map(function (n) {
            const href = (pathname.replace(/\/?$/, '/') + encodeURIComponent(n));
            return '<li><a href="' + href + '">' + n + '</a></li>';
          }).join('') + '</ul><p><a href="./">返回首页</a></p></body></html>\n';
        console.log('  200  ' + req.method + ' ' + pathname + '  （目录索引，无 index.html）  ' + (Date.now() - started) + 'ms');
        send(res, 200, 'text/html; charset=utf-8', body);
        return;
      }
    }

    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      console.log('  404  ' + req.method + ' ' + pathname + '  ' + (Date.now() - started) + 'ms');
      send(res, 404, 'text/html; charset=utf-8', notFoundPage(pathname));
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const size = fs.statSync(target).size;

    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-store' });
      res.end();
      console.log('  200  HEAD ' + pathname + '  ' + type + '  ' + (Date.now() - started) + 'ms');
      return;
    }

    const stream = fs.createReadStream(target);
    stream.on('error', function () {
      send(res, 500, 'text/html; charset=utf-8', notFoundPage(pathname));
    });
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    stream.pipe(res);
    console.log('  200  ' + req.method + ' ' + pathname + '  ' + type + '  ' + size + 'B  ' + (Date.now() - started) + 'ms');
  });

  server.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.log('\n  [错误] 端口 ' + opt.port + ' 已被占用。');
      console.log('  请关闭占用该端口的程序后重试，或换一个端口：');
      console.log('      node tools/serve.js --port ' + (opt.port + 1));
      console.log('  （本服务器不会静默改用其它端口，以免你打开错误的地址。）');
      process.exit(1);
    }
    console.log('\n  [错误] 服务器启动失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  });

  server.listen(opt.port, opt.host, function () {
    const shown = opt.host === '0.0.0.0' || opt.host === '::' ? '127.0.0.1' : opt.host;
    console.log('  根目录：  ' + root);
    console.log('  监听地址：http://' + shown + ':' + opt.port + '/');
    if (opt.host === '0.0.0.0' || opt.host === '::') {
      console.log('  （已绑定全部网卡，同局域网设备可用本机 IP 访问）');
    }
    console.log('');
    console.log('  ⚠ 调音器需要麦克风，必须通过 http://127.0.0.1 或 https 访问；');
    console.log('    直接双击 HTML 文件（file://）无法使用麦克风。');
    console.log('');
    console.log('  按 Ctrl+C 停止服务。');
  });

  return -1; /* 常驻，不退出 */
}

const code = main();
if (code >= 0) process.exit(code);
