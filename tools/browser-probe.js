/* 读谱训练器 — 用真实浏览器（CDP）做界面探针
 *
 * 为什么需要它：本项目在 node 里的 DOM 是自制桩（tools/dom-shim.js），
 * 可以验证逻辑，但无法验证「真实浏览器里选中后到底有没有高亮」这类渲染问题。
 * 这里用 Chrome DevTools Protocol：启动无头 Edge → 连上 → 执行任意 JS → 取回 JSON。
 * 只用 node 内置模块（http + 全局 WebSocket，Node 22+ 自带）。
 *
 * 用法：
 *   node tools/browser-probe.js tools/_probe-highlight.js
 *   其中被传入的文件应导出一个字符串表达式（module.exports = '...'），
 *   该表达式会在页面里 return 求值结果（会被 JSON 序列化）。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var spawn = require('child_process').spawn;

var ROOT = path.join(__dirname, '..');
var EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function findBrowser() {
  for (var i = 0; i < EDGE_CANDIDATES.length; i++) {
    if (EDGE_CANDIDATES[i] && fs.existsSync(EDGE_CANDIDATES[i])) return EDGE_CANDIDATES[i];
  }
  return null;
}

function httpGetJson(url) {
  return new Promise(function (resolve, reject) {
    var req = http.get(url, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('timeout')); });
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** 等待调试端口就绪，返回 webSocketDebuggerUrl */
async function waitForTarget(port, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 25000);
  var lastErr = null;
  while (Date.now() < deadline) {
    try {
      var list = await httpGetJson('http://127.0.0.1:' + port + '/json/list');
      for (var i = 0; i < list.length; i++) {
        if (list[i].type === 'page' && list[i].webSocketDebuggerUrl) return list[i];
      }
    } catch (e) { lastErr = e; }
    await sleep(400);
  }
  throw new Error('等不到调试目标' + (lastErr ? '（' + lastErr.message + '）' : ''));
}

/** 极简 CDP 客户端 */
function Cdp(wsUrl) {
  var self = this;
  this.ws = new WebSocket(wsUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.events = [];
  this.ready = new Promise(function (resolve, reject) {
    self.ws.addEventListener('open', function () { resolve(); });
    self.ws.addEventListener('error', function (e) { reject(new Error('WebSocket 出错')); });
  });
  this.ws.addEventListener('message', function (ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && self.pending.has(msg.id)) {
      var p = self.pending.get(msg.id);
      self.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method) {
      self.events.push(msg);
    }
  });
}

Cdp.prototype.send = function (method, params) {
  var self = this;
  var id = this.nextId++;
  return new Promise(function (resolve, reject) {
    self.pending.set(id, { resolve: resolve, reject: reject });
    self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    setTimeout(function () {
      if (self.pending.has(id)) {
        self.pending.delete(id);
        reject(new Error(method + ' 超时'));
      }
    }, 20000);
  });
};

Cdp.prototype.evaluate = async function (expression) {
  var r = await this.send('Runtime.evaluate', {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error('页面内异常：' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description
      || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
};

/* ==================== 主流程 ==================== */

async function main() {
  var probeFile = process.argv[2];
  if (!probeFile) {
    console.error('用法: node tools/browser-probe.js <探针文件.js>  [--url <地址>] [--shot <png>]');
    process.exit(2);
  }
  probeFile = path.resolve(probeFile);
  var probe = fs.readFileSync(probeFile, 'utf8');

  /* 允许探针文件用 module.exports = '...' 或直接写表达式 */
  var expr = probe;
  var m = probe.match(/module\.exports\s*=\s*([\s\S]+);?\s*$/);
  if (m) {
    try { expr = eval(m[1]); } catch (e) { expr = m[1]; }
  }

  var urlArg = process.argv.indexOf('--url');
  var appUrl = urlArg >= 0 ? process.argv[urlArg + 1]
    : 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?probe=1';

  var shotIdx = process.argv.indexOf('--shot');
  var shotPath = shotIdx >= 0 ? path.resolve(process.argv[shotIdx + 1]) : null;

  /* --size 1280x900 可指定窗口尺寸，便于验证不同屏幕宽度下的排版 */
  var sizeIdx = process.argv.indexOf('--size');
  var winSize = sizeIdx >= 0 ? process.argv[sizeIdx + 1] : '1280,900';
  winSize = String(winSize).replace('x', ',');

  /* --tab scale 可以先切到某个标签页，便于给单个面板截图 */
  var tabIdx = process.argv.indexOf('--tab');
  var wantTab = tabIdx >= 0 ? process.argv[tabIdx + 1] : null;

  var browser = findBrowser();
  if (!browser) {
    console.error('找不到 Edge / Chrome');
    process.exit(2);
  }

  var port = 9400 + Math.floor(Math.random() * 400);
  var profile = path.join(os.tmpdir(), 'yuedu-probe-' + port);
  var args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--window-size=' + winSize,
    'about:blank'
  ];

  console.log('启动浏览器：' + path.basename(browser) + '（调试端口 ' + port + '）');
  var child = spawn(browser, args, { stdio: 'ignore', detached: false });

  var target = null;
  try {
    target = await waitForTarget(port);
  } catch (e) {
    console.error('✗ ' + e.message);
    try { child.kill(); } catch (err) { }
    process.exit(1);
  }

  var cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  console.log('打开页面：' + appUrl);
  await cdp.send('Page.navigate', { url: appUrl });

  /* 等页面加载完 + 应用 boot 完成（APP.app 出现且有 state） */
  var ok = false;
  for (var i = 0; i < 50; i++) {
    await sleep(300);
    try {
      ok = await cdp.evaluate(
        "!!(window.APP && window.APP.app && window.APP.app.state && document.querySelector('#gen-durations .chip'))");
      if (ok) break;
    } catch (e) { /* 页面还没就绪 */ }
  }
  console.log(ok ? '应用已 boot 完成' : '⚠ 等不到应用 boot，继续执行探针（结果可能不完整）');

  /* 可选：先切到指定标签页，方便给单个面板截图 */
  if (wantTab) {
    try {
      await cdp.evaluate(
        "(function(){var t=document.querySelector('#tabs .tab[data-tab=\"" + wantTab + "\"]');" +
        "if(t){t.click();return true;}return false;})()");
      await sleep(900);
      console.log('已切到标签页：' + wantTab);
    } catch (e) {
      console.log('切换标签页失败：' + e.message);
    }
  }

  var out;
  try {
    out = await cdp.evaluate('(function(){ ' + expr + ' })()');
  } catch (e) {
    console.error('✗ 探针执行失败：' + e.message);
    out = { error: e.message };
  }

  console.log('\n===== 探针结果 =====');
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));

  if (shotPath) {
    try {
      var shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
      console.log('\n截图已保存：' + shotPath);
    } catch (e) {
      console.log('截图失败：' + e.message);
    }
  }

  try { cdp.ws.close(); } catch (e) { }
  try { child.kill(); } catch (e) { }
  await sleep(300);
  process.exit(0);
}

main().catch(function (e) {
  console.error('异常：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
