/* 读谱训练器 — 通用工具
 * 全局命名空间：window.APP.util
 * 无依赖。所有模块都从这里取小工具，不要重复实现。
 */
(function (APP) {
  'use strict';

  APP = APP || (window.APP = {});
  var listeners = [];

  /* ---------------- DOM ---------------- */

  function query(sel, root) { return (root || document).querySelector(sel); }
  function queryAll(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* el('div', {class:'x', on:{click:fn}, style:{color:'red'}, data:{a:1}}, '文本', childNode) */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class' || k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') {
          if (typeof v === 'string') node.setAttribute('style', v);
          else Object.keys(v).forEach(function (p) { node.style.setProperty(p, v[p]); });
        } else if (k === 'on' && typeof v === 'object') {
          Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
        } else if (k === 'data' && typeof v === 'object') {
          Object.keys(v).forEach(function (d) { node.setAttribute('data-' + d, v[d]); });
        } else if (k === 'value') {
          node.value = v;
        } else if (k === 'checked' || k === 'selected' || k === 'disabled') {
          node[k] = !!v;
        } else if (k === 'for') {
          node.htmlFor = v;
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    appendChildren(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }

  function appendChildren(node, kids) {
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { appendChildren(node, c); return; }
      node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function frag(children) {
    var f = document.createDocumentFragment();
    appendChildren(f, [children]);
    return f;
  }

  /* ---------------- 数学 / 随机 ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* 可复现随机：seed 相同则序列相同（mulberry32） */
  function rngFrom(seed) {
    if (seed === undefined || seed === null || seed === '') {
      return function () { return Math.random(); };
    }
    var a = (typeof seed === 'string' ? hashString(seed) : (seed | 0)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function R(rng) { return typeof rng === 'function' ? rng() : Math.random(); }

  function rand(rng) { return R(rng); }
  function randInt(a, b, rng) { return a + Math.floor(R(rng) * (b - a + 1)); }
  function pick(arr, rng) {
    if (!arr || !arr.length) return undefined;
    return arr[Math.floor(R(rng) * arr.length) % arr.length];
  }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(R(rng) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* 按权重挑选：items = [{w:number, ...}] 或 weights 数组 */
  function weighted(items, rng) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += (items[i].w || 0);
    if (total <= 0) return items[0];
    var r = R(rng) * total;
    for (i = 0; i < items.length; i++) {
      r -= (items[i].w || 0);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function deepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone);
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = deepClone(v[k]); });
    return o;
  }

  /* ---------------- 格式化 / 下载 ---------------- */

  function fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    if (sec < 60) return sec.toFixed(1) + 's';
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + '分' + (s < 10 ? '0' : '') + s + '秒';
  }

  function download(blobOrUrl, filename) {
    var url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    var a = el('a', { href: url, download: filename || 'download' });
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(url);
    }, 400);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = el('textarea', { value: text });
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------------- toast / modal ---------------- */

  var toastHost = null;
  function toast(msg, type) {
    if (!toastHost) {
      toastHost = el('div', { class: 'toast-host' });
      document.body.appendChild(toastHost);
    }
    var t = el('div', { class: 'toast ' + (type || 'info'), text: msg });
    toastHost.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, type === 'err' ? 4200 : 2600);
  }

  function modal(title, bodyNode, actions) {
    var mask = el('div', { class: 'modal-mask' });
    var box = el('div', { class: 'modal' });
    var head = el('div', { class: 'modal-head' }, el('div', { class: 'modal-title', text: title }),
      el('button', { class: 'btn ghost small', text: '✕', on: { click: close } }));
    var body = el('div', { class: 'modal-body' });
    if (typeof bodyNode === 'string') body.innerHTML = bodyNode;
    else if (bodyNode) body.appendChild(bodyNode);
    var foot = el('div', { class: 'modal-foot' });
    (actions || []).forEach(function (a) {
      foot.appendChild(el('button', {
        class: 'btn ' + (a.kind || ''), text: a.label,
        on: { click: function () { if (!a.onClick || a.onClick() !== false) close(); } }
      }));
    });
    box.appendChild(head); box.appendChild(body);
    if (foot.childNodes.length) box.appendChild(foot);
    mask.appendChild(box);
    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    document.body.appendChild(mask);
    return { close: close, body: body };
  }

  /* ---------------- 生命周期 ---------------- */

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---------------- 本地存储 ---------------- */

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 其它 ---------------- */

  function debounce(fn, wait) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 120);
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function timestampName(prefix, ext) {
    var d = new Date();
    return (prefix || 'score') + '-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + (ext || '.png');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 拍时值 -> 描述文字（供 UI 显示）
   * dur 是「时值倒数标记」：4=全音符, 2=二分, 1=四分, 0.5=八分, 0.25=十六分
   * 拍数（以四分音符为一拍）= 4 / dur，附点再 ×1.5。
   * 用查表 + 乘法而非除法：运行环境的 JS 除法在部分小整数上不可靠。 */
  var BEATS_TABLE = { '4': 4, '2': 2, '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125, '0.0625': 0.0625 };

  function beatsOf(dur, dotted) {
    var base = BEATS_TABLE[String(dur)];
    if (base === undefined) {
      if (!dur && dur !== 0) return 0;
      base = 4 / dur;
    }
    return dotted ? base * 1.5 : base;
  }

  APP.util = {
    query: query, queryAll: queryAll, el: el, clear: clear, frag: frag, appendChildren: appendChildren,
    clamp: clamp, lerp: lerp,
    rngFrom: rngFrom, hashString: hashString, rand: rand, randInt: randInt, pick: pick,
    shuffle: shuffle, weighted: weighted, deepClone: deepClone,
    fmtTime: fmtTime, download: download, copyText: copyText,
    toast: toast, modal: modal, ready: ready,
    load: load, save: save, debounce: debounce,
    pad2: pad2, timestampName: timestampName, escapeHtml: escapeHtml, beatsOf: beatsOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.util;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
