/* 读谱训练器 —— WebView 与原生之间的文件保存桥接（网页侧）
 *
 * 背景：应用里的「保存为图片 / 导出 MIDI / 导出 MusicXML / 复制」在手机 App 里走的是
 * Blob + <a download>。普通浏览器会自己下载，但 WebView 默认没有下载能力，
 * 点了按钮会毫无反应。这个脚本把 blob 内容分块转成 base64 交给 Android 侧写文件。
 *
 * 只有在 APK 外壳里（存在 window.__yueduNative）才会真正生效；
 * 在普通浏览器里它只是安静地什么都不做，因此这个文件可以随页面一起发布。
 *
 * 分块传输的原因：一次性把几 MB 的 base64 字符串传过 JS→Java 边界，
 * 在部分 WebView 版本上会失败或卡住，分块（每块 192 KB）稳定得多。
 */
(function () {
  'use strict';

  var NATIVE = window.__yueduNative;
  if (!NATIVE || typeof NATIVE.startSave !== 'function') {
    /* 不在 App 外壳里：不做任何事，保持网页行为不变 */
    window.__yueduBridge = { available: false, saveBlob: function () { return Promise.resolve('unavailable'); } };
    return;
  }

  var CHUNK = 192 * 1024;          // 每块 base64 长度（约 144 KB 原始数据）
  var sessions = {};               // id -> { parts: [], bytes: number }
  var seq = 0;

  function nextId() { seq += 1; return 's' + seq + '-' + Date.now(); }

  /* 把 Blob 读成 base64（不含 data: 前缀） */
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      fr.onerror = function () { reject(fr.error || new Error('读取文件失败')); };
      fr.readAsDataURL(blob);
    });
  }

  /* 文件名兜底：优先用调用方给的，其次从 Blob 类型猜 */
  function guessName(mime) {
    var ext = 'bin';
    var m = String(mime || '').toLowerCase();
    if (m.indexOf('png') >= 0) ext = 'png';
    else if (m.indexOf('jpeg') >= 0 || m.indexOf('jpg') >= 0) ext = 'jpg';
    else if (m.indexOf('webp') >= 0) ext = 'webp';
    else if (m.indexOf('midi') >= 0 || m.indexOf('mid') >= 0) ext = 'mid';
    else if (m.indexOf('xml') >= 0) ext = 'xml';
    else if (m.indexOf('json') >= 0) ext = 'json';
    else if (m.indexOf('csv') >= 0) ext = 'csv';
    else if (m.indexOf('text') >= 0) ext = 'txt';
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'yuedu-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.' + ext;
  }

  /**
   * 保存一个 Blob 到手机存储。
   * @param {Blob} blob
   * @param {string} filename
   * @returns {Promise<string>} 原生侧返回的提示文字（含保存位置）
   */
  function saveBlob(blob, filename) {
    if (!blob) { return Promise.resolve('保存失败：内容为空'); }
    var name = filename || guessName(blob.type);
    var id = nextId();
    sessions[id] = { parts: [], bytes: 0 };
    var mime = blob.type || '';

    return blobToBase64(blob).then(function (b64) {
      var st = NATIVE.startSave(id, name, mime, b64.length);
      if (st !== true && String(st) !== 'true') {
        delete sessions[id];
        return '保存失败：' + (st || '原生侧拒绝');
      }
      var i = 0;
      while (i < b64.length) {
        var chunk = b64.substr(i, CHUNK);
        var ok = NATIVE.appendSave(id, chunk);
        if (ok !== true && String(ok) !== 'true') {
          delete sessions[id];
          return '保存失败：写入中断';
        }
        i += CHUNK;
      }
      return String(NATIVE.finishSave(id) || '已保存');
    }).catch(function (e) {
      delete sessions[id];
      throw e;
    });
  }

  /* ---------------- 拦截 <a download> 点击 ---------------- */
  /* 应用的导出模块与 util.download 都是创建 <a href=blob: download=...> 再 click()，
   * 这里在捕获阶段拦下来，改为交给原生保存。 */
  document.addEventListener('click', function (ev) {
    try {
      var el = ev.target;
      while (el && el !== document && !(el.tagName === 'A' && el.hasAttribute && el.hasAttribute('download'))) {
        el = el.parentNode;
      }
      if (!el || el === document) return;
      var href = el.getAttribute('href') || '';
      if (href.indexOf('blob:') !== 0) return;

      ev.preventDefault();
      ev.stopPropagation();
      var name = el.getAttribute('download') || guessName('');

      /* 用 XHR 取回 blob 内容（比 fetch 在老年份 WebView 上兼容性更好） */
      var xhr = new XMLHttpRequest();
      xhr.open('GET', href, true);
      xhr.responseType = 'blob';
      xhr.onload = function () {
        if (xhr.status !== 0 && xhr.status !== 200) {
          window.__yueduToast && window.__yueduToast('保存失败：无法读取导出内容');
          return;
        }
        saveBlob(xhr.response, name).then(function (msg) {
          if (window.__yueduToast) window.__yueduToast(msg);
        }, function (e) {
          if (window.__yueduToast) window.__yueduToast('保存失败：' + (e && e.message ? e.message : e));
        });
      };
      xhr.onerror = function () {
        if (window.__yueduToast) window.__yueduToast('保存失败：读取导出内容出错');
      };
      xhr.send();
    } catch (e) { /* 拦截失败时不影响网页原有行为 */ }
  }, true);

  /* 暴露给应用内部调用（也可以直接用上面的点击拦截） */
  window.__yueduBridge = {
    available: true,
    saveBlob: saveBlob,
    /* 把一个 data: URL 直接存成文件（不经过 Blob） */
    saveDataUrl: function (dataUrl, filename) {
      var s = String(dataUrl || '');
      var comma = s.indexOf(',');
      if (comma < 0) return Promise.resolve('保存失败：数据无效');
      var payload = s.slice(comma + 1);
      var mime = (s.match(/^data:([^;,]+)/) || [])[1] || '';
      var id = nextId();
      var st = NATIVE.startSave(id, filename || guessName(mime), mime, payload.length);
      if (st !== true && String(st) !== 'true') return Promise.resolve('保存失败：' + (st || '原生侧拒绝'));
      var i = 0;
      while (i < payload.length) {
        var ok = NATIVE.appendSave(id, payload.substr(i, CHUNK));
        if (ok !== true && String(ok) !== 'true') return Promise.resolve('保存失败：写入中断');
        i += CHUNK;
      }
      return Promise.resolve(String(NATIVE.finishSave(id) || '已保存'));
    }
  };

  /* 给原生侧一个统一的 toast 出口（原生会注入实现；没有就退回应用自己的提示） */
  if (!window.__yueduToast) {
    window.__yueduToast = function (msg) {
      try {
        if (window.APP && APP.util && APP.util.toast) APP.util.toast(msg, 'ok');
      } catch (e) { /* 忽略 */ }
    };
  }
})();
