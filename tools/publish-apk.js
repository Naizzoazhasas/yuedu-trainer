/* 读谱训练器 — 把 APK 发布到 GitHub Release
 * 运行： node tools/publish-apk.js [--token <PAT>] [--tag v1.1.0]
 *
 * 为什么需要它：GitHub Pages 不能提供 APK 下载（会当成文本），
 * 而 Release 资产是标准做法，手机上点开链接就能下载安装。
 *
 * 令牌来源（按优先级）：
 *   1. 命令行 --token
 *   2. 环境变量 GITHUB_TOKEN / GH_TOKEN
 *   3. 临时文件 %TEMP%\yuedu-token.txt（由设备码授权流程写入）
 *
 * 只使用 node 内置模块（https / fs / path / child_process）。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var https = require('https');
var os = require('os');

var ROOT = path.join(__dirname, '..');
var APK = path.join(ROOT, 'dist', 'android', 'yuedu-trainer.apk');
var REPO = 'Naizzoazhasas/yuedu-trainer';

/* ---------------- 参数 ---------------- */

var args = process.argv.slice(2);
function argOf(name, def) {
  var i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  var pre = name + '=';
  for (var k = 0; k < args.length; k++) {
    if (args[k].indexOf(pre) === 0) return args[k].slice(pre.length);
  }
  return def;
}

var TAG = argOf('--tag', null);
var VERSION = argOf('--version', '1.1.0');
if (!TAG) TAG = 'v' + VERSION;

function readToken() {
  var t = argOf('--token', null);
  if (t) return t.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  var f = path.join(os.tmpdir(), 'yuedu-token.txt');
  try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* 忽略 */ }
  return null;
}

/* ---------------- 极简 HTTPS 客户端 ---------------- */

function api(method, urlPath, token, bodyObj, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
    var headers = {
      'User-Agent': 'yuedu-trainer-publish',
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });

    var req = https.request({
      hostname: 'api.github.com', path: urlPath, method: method, headers: headers, timeout: 120000
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* 可能不是 JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text: text });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('请求超时')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/* 上传资产：用 https 直接 PUT 到 uploads.github.com（Release 资产专用地址） */
function uploadAsset(uploadUrl, token, filePath, fileName, label, mime) {
  return new Promise(function (resolve, reject) {
    var stat = fs.statSync(filePath);
    var escaped = encodeURIComponent(fileName);
    var u = new URL(uploadUrl.replace('{?name,label}', ''));
    var url = u.protocol + '//' + u.host + u.pathname + '?name=' + escaped +
      (label ? '&label=' + encodeURIComponent(label) : '');

    var opts = {
      method: 'POST',
      headers: {
        'User-Agent': 'yuedu-trainer-publish',
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'Content-Type': mime || 'application/vnd.android.package-archive',
        'Content-Length': stat.size
      },
      timeout: 600000
    };

    var req = https.request(url, opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* 忽略 */ }
        resolve({ status: res.statusCode, body: json, text: text });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('上传超时')); });
    fs.createReadStream(filePath).pipe(req);
  });
}

/* ---------------- 主流程 ---------------- */

(async function main() {
  console.log('=== 发布 APK 到 GitHub Release ===\n');

  if (!fs.existsSync(APK)) {
    console.log('[失败] 找不到 APK：' + APK);
    console.log('       请先运行  node tools/build-apk.js');
    process.exit(1);
  }
  var token = readToken();
  if (!token) {
    console.log('[失败] 没有找到 GitHub 令牌。');
    console.log('       三种提供方式：--token <PAT> / 环境变量 GITHUB_TOKEN / %TEMP%\\yuedu-token.txt');
    process.exit(1);
  }

  var apkSize = fs.statSync(APK).size;
  console.log('APK： ' + APK);
  console.log('体积： ' + (apkSize / 1024 / 1024).toFixed(2) + ' MB');
  console.log('仓库： ' + REPO);
  console.log('标签： ' + TAG + '\n');

  /* 1) 确认仓库可访问、令牌有效 */
  var me = await api('GET', '/user', token);
  if (me.status !== 200) {
    console.log('[失败] 令牌校验失败（HTTP ' + me.status + '）：' + (me.body && me.body.message));
    process.exit(1);
  }
  console.log('认证用户： ' + me.body.login);

  /* 2) 找到或创建 Release */
  var rel = await api('GET', '/repos/' + REPO + '/releases/tags/' + TAG, token);
  var release = null;
  if (rel.status === 200) {
    release = rel.body;
    console.log('已存在 Release ' + TAG + '，将复用并覆盖同名资产');
  } else if (rel.status === 404) {
    var note = [
      '读谱训练器 Android 版（APK）',
      '',
      '**安装**：手机上下载本页附件 `yuedu-trainer.apk`，点开安装；',
      '系统提示「未知来源」时允许一次即可。也可以 `adb install yuedu-trainer.apk`。',
      '',
      '**功能**：随机节奏/旋律生成、五线谱（VexFlow 专业排版）与简谱对照、节拍器、',
      '调音器、调号音阶对照、常见乐器音阶表、移调、导出 PNG/MIDI/MusicXML、练习模式、听辨训练。',
      '',
      '**离线**：所有资源都打包在 APK 内，应用不申请联网权限，完全离线可用。',
      '**麦克风**：调音器需要录音权限，首次进入会让你授权。',
      '',
      '网页版（同样功能，https，调音器可用）：<https://naizzoazhasas.github.io/yuedu-trainer/>'
    ].join('\n');
    var created = await api('POST', '/repos/' + REPO + '/releases', token, {
      tag_name: TAG,
      name: '读谱训练器 ' + TAG + '（Android APK）',
      body: note,
      draft: false,
      prerelease: false
    });
    if (created.status !== 201) {
      console.log('[失败] 创建 Release 失败（HTTP ' + created.status + '）：' + (created.body && created.body.message));
      process.exit(1);
    }
    release = created.body;
    console.log('已创建 Release：' + release.html_url);
  } else {
    console.log('[失败] 查询 Release 失败（HTTP ' + rel.status + '）：' + (rel.body && rel.body.message));
    process.exit(1);
  }

  /* 3) 若已有同名资产，先删掉（避免 422 already_exists） */
  var fileName = 'yuedu-trainer.apk';
  if (release.assets && release.assets.length) {
    for (var i = 0; i < release.assets.length; i++) {
      if (release.assets[i].name === fileName) {
        console.log('删除同名旧资产（id ' + release.assets[i].id + '）…');
        await api('DELETE', '/repos/' + REPO + '/releases/assets/' + release.assets[i].id, token);
      }
    }
  }

  /* 4) 上传 */
  console.log('上传 APK（' + (apkSize / 1024 / 1024).toFixed(2) + ' MB）…');
  var up = await uploadAsset(release.upload_url, token, APK, fileName,
    '读谱训练器 Android 版', 'application/vnd.android.package-archive');
  if (up.status !== 201) {
    console.log('[失败] 上传资产失败（HTTP ' + up.status + '）：' + (up.body && up.body.message));
    if (up.status === 422) console.log('       （通常是同名资产已存在）');
    process.exit(1);
  }

  console.log('✓ 上传成功');
  console.log('  资产地址： ' + up.body.browser_download_url);
  console.log('  稳定下载链接（始终指向最新 APK）：');
  console.log('    https://github.com/' + REPO + '/releases/latest/download/' + fileName);
  console.log('');
  console.log('页面： ' + release.html_url);
  console.log('\n手机上打开上面「稳定下载链接」即可下载安装。');
})().catch(function (e) {
  console.log('[异常] ' + (e && e.message ? e.message : e));
  if (e && e.stack) console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
