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

/* ---------------- Release 说明（面向普通用户，简洁明了） ---------------- */

function releaseNotes(tag) {
  return [
    '# 读谱训练器 ' + tag + '　Android 版',
    '',
    '随机生成五线谱 / 简谱练习的视奏训练工具。**完全离线**，不申请联网权限。',
    '',
    '## 安装',
    '',
    '1. 点本页下方的 **`yuedu-trainer.apk`** 下载；',
    '2. 点开安装；系统提示「未知来源 / 禁止安装未知应用」时允许一次即可。',
    '',
    '> 也可以用数据线：`adb install -r yuedu-trainer.apk`',
    '> 如果装过旧版本提示「应用未安装」，先在设置里卸载旧的再装。',
    '',
    '## 功能',
    '',
    '| 模块 | 说明 |',
    '|---|---|',
    '| 生成 / 练习 | 随机生成节奏或旋律；可限定只出现哪几个音、哪几种时值、拍号、调号、速度 |',
    '| 五线谱 / 简谱 | 同一个乐段两种记法随时切换，都支持首调与固定调；简谱带小节线与高低八度点 |',
    '| 节拍器 | 可选拍号、重音、细分；速度可直接输入数字，也能敲拍测速 |',
    '| 调音器 | 麦克风实时测音高，显示音分偏差；支持吉他 / 尤克里里调弦与 A4 基准调整 |',
    '| 音阶查找对照 | 大标题 + 三个下拉 + 点亮的钢琴键盘；可查该调在吉他、口琴、竖笛等乐器上的位置 |',
    '| 乐器音阶表 | 吉他 / 尤克里里 / 贝斯指板、10 孔口琴吹吸、竖笛指法、钢琴键位 |',
    '| 移调 | 降 B 单簧管 / 小号、降 E 萨克斯、F 圆号等移调乐器的记谱音与实际音互转 |',
    '| 导出 | 保存为 PNG 图片、MIDI 文件、MusicXML（可直接导入 MuseScore） |',
    '| 练习模式 | 预备拍、速度渐变（慢练到原速）、进度统计 |',
    '| 听辨训练 | 听节奏 / 音程 / 和弦作答，**作答后立即公布正确答案的谱面** |',
    '',
    '## 使用提示',
    '',
    '- **麦克风**：调音器首次进入会请求录音权限，允许即可；拒绝也不影响其它功能。',
    '- **导出文件在哪**：图片保存在**相册**的 `Pictures/读谱训练器/`，MIDI 与 MusicXML 在**下载**的 `Download/读谱训练器/`；部分手机的相册需要下拉刷新才显示新文件夹。',
    '- **离线**：所有内容都打包在安装包里，飞行模式也能用。',
    '',
    '## 其它平台',
    '',
    '- 网页版（打开即用，可「添加到主屏幕」）：<https://naizzoazhasas.github.io/yuedu-trainer/>',
    '- Windows 电脑版：见仓库 README 的「电脑 App」一节，双击安装脚本即可',
    ''
  ].join('\n');
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
  var notes = releaseNotes(TAG);
  if (rel.status === 200) {
    release = rel.body;
    console.log('已存在 Release ' + TAG + '，将复用并覆盖同名资产');
    /* 说明文字也刷新一遍，保持对外介绍是最新的 */
    var patched = await api('PATCH', '/repos/' + REPO + '/releases/' + release.id, token, {
      name: '读谱训练器 ' + TAG + '　Android 版',
      body: notes
    });
    if (patched.status === 200) {
      release = patched.body;
      console.log('已更新 Release 说明');
    }
  } else if (rel.status === 404) {
    var created = await api('POST', '/repos/' + REPO + '/releases', token, {
      tag_name: TAG,
      name: '读谱训练器 ' + TAG + '　Android 版',
      body: notes,
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
