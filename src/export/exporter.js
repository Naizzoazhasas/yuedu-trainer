/* 读谱训练器 — 导出模块
 * 全局命名空间：window.APP.export
 *
 * 提供三种导出：
 *  1) PNG  —— 不依赖任何第三方库，DOM/SVG → Canvas 2D 手动绘制（file:// 下亦可用）
 *  2) MIDI —— 手写标准 MIDI 文件（SMF type 1：速度/拍号轨 + 音符轨）
 *  3) MusicXML 4.0 score-partwise（可被 MuseScore 直接打开）
 *
 * 依赖：APP.util（可选，全部有本地兜底）、APP.theory（可选，midiOf 有本地兜底）
 * 约束：纯 ES2019，无 import/export/require，任何入口都不抛异常打断调用方。
 */
(function (APP) {
  'use strict';

  APP = APP || (window.APP = window.APP || {});

  /* ==================== 环境探测 ==================== */

  function hasDOM() {
    return typeof document !== 'undefined' && !!document && typeof document.createElement === 'function';
  }

  function hasWindow() { return typeof window !== 'undefined' && !!window; }

  /* ==================== 小工具（不依赖 APP.util） ==================== */

  var UI_FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans CJK SC",' +
    'system-ui,-apple-system,"Segoe UI",Arial,sans-serif';

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function toNum(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }

  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function nowStamp() {
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' +
      p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  function todayISO() {
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  /* 取 APP.util 里的函数，缺失时用本地兜底 */
  function utilFn(name, fallback) {
    var u = APP.util;
    return (u && typeof u[name] === 'function') ? u[name] : fallback;
  }

  function toast(msg, type) {
    var u = APP.util;
    if (u && typeof u.toast === 'function') { u.toast(msg, type); return; }
    if (typeof console !== 'undefined' && console.log) console.log('[导出] ' + msg);
  }

  function createEl(tag, attrs) {
    var children = Array.prototype.slice.call(arguments, 2);
    if (hasDOM()) {
      var f = utilFn('el', null);
      if (f) {
        return f.apply(null, [tag, attrs].concat(children));
      }
      var n = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === 'class') n.className = attrs[k];
          else if (k === 'text') n.textContent = attrs[k];
          else if (k === 'on' && typeof attrs[k] === 'object') {
            Object.keys(attrs[k]).forEach(function (ev) { n.addEventListener(ev, attrs[k][ev]); });
          } else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
            n.setAttribute(k, attrs[k]);
          }
        });
      }
      children.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (isArr(c)) { c.forEach(function (d) { n.appendChild(d); }); return; }
        n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
      return n;
    }
    return null;
  }

  function clearNode(node) {
    utilFn('clear', function (n) { while (n && n.firstChild) n.removeChild(n.firstChild); })(node);
  }

  /* ==================== 通用下载 ==================== */

  function downloadBlob(blob, filename) {
    var name = filename || ('score-' + nowStamp() + '.bin');
    if (APP.util && typeof APP.util.download === 'function') {
      try { APP.util.download(blob, name); return; } catch (e) { /* 走兜底 */ }
    }
    if (!hasDOM() || typeof URL === 'undefined' || !URL.createObjectURL) return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
    }, 500);
  }

  /* ==================== 剪贴板 ==================== */

  function legacyCopy(text) {
    if (!hasDOM()) return false;
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.setAttribute('readonly', 'readonly');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  /* 复制文本：优先 APP.util.copyText，退化为内置实现；永远 resolve boolean */
  function copyText(text) {
    var s = (text === null || text === undefined) ? '' : String(text);
    try {
      var u = APP.util;
      if (u && typeof u.copyText === 'function') {
        return Promise.resolve(u.copyText(s)).then(function (v) { return !!v; }, function () {
          return legacyCopy(s);
        });
      }
    } catch (e) { /* 忽略，走兜底 */ }
    try {
      if (hasDOM() && typeof navigator !== 'undefined' && navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return legacyCopy(s); });
      }
    } catch (e2) { /* 忽略 */ }
    return Promise.resolve(legacyCopy(s));
  }

  /* ==================== PNG：DOM → Canvas ==================== */

  /* 顶层不参与绘制的标签 */
  var SKIP_TAGS = {
    script: 1, style: 1, head: 1, title: 1, meta: 1, link: 1, br: 1, wbr: 1,
    noscript: 1, template: 1, base: 1, source: 1, track: 1, param: 1, area: 1,
    map: 1, col: 1, colgroup: 1, datalist: 1, dialog: 1
  };

  /* 明确不支持、需要记录警告的标签 */
  var UNSUPPORTED_TAGS = {
    iframe: 1, frame: 1, frameset: 1, video: 1, audio: 1, object: 1, embed: 1,
    portal: 1, slot: 1
  };

  /* 序列化 SVG 时把计算样式内联进去，避免 clone 后丢样式 */
  var SVG_STYLE_PROPS = [
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
    'stroke-dashoffset', 'opacity', 'visibility', 'display',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-anchor', 'dominant-baseline', 'letter-spacing', 'word-spacing',
    'stop-color', 'stop-opacity', 'paint-order', 'transform', 'color', 'shape-rendering'
  ];

  function isTransparentColor(c) {
    if (!c) return true;
    var s = String(c).replace(/\s+/g, '').toLowerCase();
    if (s === 'transparent') return true;
    if (s === 'rgba(0,0,0,0)') return true;
    if (/^rgba\([^)]*,0(\.0+)?\)$/.test(s)) return true;
    return false;
  }

  function px(v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }

  /* 圆角矩形路径（不依赖 ctx.roundRect，最大兼容） */
  function pathRoundRect(ctx, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    if (rad <= 0.01) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function radiusOf(cs) {
    var tl = px(cs.borderTopLeftRadius, 0);
    var tr = px(cs.borderTopRightRadius, 0);
    var br = px(cs.borderBottomRightRadius, 0);
    var bl = px(cs.borderBottomLeftRadius, 0);
    return Math.max(tl, tr, br, bl);
  }

  /* 画背景与边框 */
  function drawBox(cs, ctx, x, y, w, h, warnings) {
    if (!cs) return;
    var radius = radiusOf(cs);

    var bg = cs.backgroundColor;
    var bgImg = cs.backgroundImage;
    if (bgImg && bgImg !== 'none') {
      warnOnce(warnings, '渐变/背景图片（background-image）不会被绘制。');
    }
    if (!isTransparentColor(bg)) {
      ctx.save();
      ctx.fillStyle = bg;
      pathRoundRect(ctx, x, y, w, h, radius);
      ctx.fill();
      ctx.restore();
    }

    var bt = cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden' ? px(cs.borderTopWidth) : 0;
    var br = cs.borderRightStyle !== 'none' && cs.borderRightStyle !== 'hidden' ? px(cs.borderRightWidth) : 0;
    var bb = cs.borderBottomStyle !== 'none' && cs.borderBottomStyle !== 'hidden' ? px(cs.borderBottomWidth) : 0;
    var bl = cs.borderLeftStyle !== 'none' && cs.borderLeftStyle !== 'hidden' ? px(cs.borderLeftWidth) : 0;
    if (!(bt > 0 || br > 0 || bb > 0 || bl > 0)) return;

    var ct = cs.borderTopColor, cr = cs.borderRightColor, cb = cs.borderBottomColor, cl = cs.borderLeftColor;
    var uniform = (bt === br && br === bb && bb === bl) &&
      (ct === cr && cr === cb && cb === cl);

    ctx.save();
    if (uniform && bt > 0) {
      ctx.strokeStyle = ct;
      ctx.lineWidth = bt;
      pathRoundRect(ctx, x + bt / 2, y + bt / 2, w - bt, h - bt, Math.max(0, radius - bt / 2));
      ctx.stroke();
    } else {
      /* 各边宽度/颜色不同：逐边填充矩形（放弃圆角，视觉损失可接受） */
      if (bt > 0) { ctx.fillStyle = ct; ctx.fillRect(x, y, w, bt); }
      if (bb > 0) { ctx.fillStyle = cb; ctx.fillRect(x, y + h - bb, w, bb); }
      if (bl > 0) { ctx.fillStyle = cl; ctx.fillRect(x, y, bl, h); }
      if (br > 0) { ctx.fillStyle = cr; ctx.fillRect(x + w - br, y, br, h); }
    }
    ctx.restore();
  }

  function warnOnce(warnings, msg) {
    if (!warnings) return;
    for (var i = 0; i < warnings.length; i++) if (warnings[i] === msg) return;
    warnings.push(msg);
  }

  /* 绘制元素自身的直接文本子节点（HTML 文本用 fillText 重画） */
  function drawOwnText(node, cs, ctx, x, y, w, h) {
    if (!cs) return;
    var text = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 3) text += c.nodeValue;
    }
    if (!text || String(text).replace(/\s+/g, '') === '') return;

    var fs = px(cs.fontSize, 14);
    var lh = cs.lineHeight === 'normal' || !cs.lineHeight ? fs * 1.35 : px(cs.lineHeight, fs * 1.35);
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    /* 去掉多行首尾纯空行 */
    while (lines.length > 1 && lines[0].trim() === '') lines.shift();
    while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) return;

    var bt = px(cs.borderTopWidth), br = px(cs.borderRightWidth);
    var bb = px(cs.borderBottomWidth), bl = px(cs.borderLeftWidth);
    var pt = px(cs.paddingTop), pr = px(cs.paddingRight);
    var pb = px(cs.paddingBottom), pl = px(cs.paddingLeft);

    var align = String(cs.textAlign || 'start');
    var tx, ha;
    if (align === 'center') { tx = x + w / 2; ha = 'center'; }
    else if (align === 'right' || align === 'end') { tx = x + w - br - pr; ha = 'right'; }
    else { tx = x + bl + pl; ha = 'left'; }

    var blockH = lh * lines.length;
    var availTop = y + bt + pt;
    var availH = Math.max(0, h - bt - bb - pt - pb);
    var top = availTop + Math.max(0, (availH - blockH) / 2);

    ctx.save();
    ctx.font = fontOf(cs);
    ctx.fillStyle = cs.color || '#000000';
    ctx.textAlign = ha;
    ctx.textBaseline = 'middle';
    var maxW = Math.max(1, w - bl - br - pl - pr);
    for (var k = 0; k < lines.length; k++) {
      var line = lines[k];
      if (line.trim() === '') continue;
      ctx.fillText(line, tx, top + lh * (k + 0.5), maxW);
    }
    ctx.restore();
  }

  function fontOf(cs) {
    var style = cs.fontStyle && cs.fontStyle !== 'normal' ? cs.fontStyle + ' ' : '';
    var variant = cs.fontVariant && cs.fontVariant !== 'normal' ? cs.fontVariant + ' ' : '';
    var weight = cs.fontWeight && cs.fontWeight !== 'normal' && cs.fontWeight !== '400' ? cs.fontWeight + ' ' : '';
    var size = cs.fontSize || '14px';
    var family = cs.fontFamily || 'sans-serif';
    return style + variant + weight + size + ' ' + family;
  }

  /* ---- SVG 序列化 ---- */

  function inlineSvgStyles(origSvg, cloneSvg) {
    var orig, cl;
    try {
      orig = origSvg.querySelectorAll('*');
      cl = cloneSvg.querySelectorAll('*');
    } catch (e) { return; }
    var n = Math.min(orig.length, cl.length);
    for (var i = 0; i < n; i++) {
      var cs;
      try { cs = getComputedStyle(orig[i]); } catch (e) { continue; }
      if (!cs) continue;
      for (var k = 0; k < SVG_STYLE_PROPS.length; k++) {
        var prop = SVG_STYLE_PROPS[k];
        var val = '';
        try { val = cs.getPropertyValue(prop); } catch (e) { val = ''; }
        if (!val) continue;
        try { cl[i].style.setProperty(prop, val); } catch (e) { /* 忽略该属性 */ }
      }
    }
  }

  /* SVG → dataURL（dataURL 不受 file:// 同源限制） */
  function svgToDataURL(svg, w, h) {
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('xmlns:xlink')) {
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
    var cw = clone.getAttribute('width');
    var chh = clone.getAttribute('height');
    if (!cw || /%/.test(cw)) clone.setAttribute('width', String(Math.max(1, Math.round(w))));
    if (!chh || /%/.test(chh)) clone.setAttribute('height', String(Math.max(1, Math.round(h))));
    try { inlineSvgStyles(svg, clone); } catch (e) { /* 样式内联失败不影响主体 */ }
    var xml = new XMLSerializer().serializeToString(clone);
    /* 有些浏览器序列化 SVG 时不带 xmlns，补上 */
    if (xml.indexOf('xmlns=') === -1) {
      xml = xml.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  function loadImage(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof Image === 'undefined') { reject(new Error('当前环境不支持 Image。')); return; }
      var done = false;
      var img = new Image();
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('图片加载超时。'));
      }, timeoutMs || 10000);
      img.onload = function () {
        if (done) return;
        done = true; clearTimeout(timer); resolve(img);
      };
      img.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer); reject(new Error('图片加载失败。'));
      };
      try { img.src = src; } catch (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      }
    });
  }

  /* ---- SVG 逐元素回落绘制 ---- */

  function attrNum(el, name) {
    var v = parseFloat(el.getAttribute(name));
    return isFinite(v) ? v : 0;
  }

  function shapePath(el, tag) {
    try {
      if (typeof Path2D === 'undefined') return null;
      if (tag === 'path') {
        var d = el.getAttribute('d');
        return d ? new Path2D(d) : null;
      }
      var p = new Path2D();
      if (tag === 'rect') {
        p.rect(attrNum(el, 'x'), attrNum(el, 'y'),
          Math.max(0, attrNum(el, 'width')), Math.max(0, attrNum(el, 'height')));
      } else if (tag === 'circle') {
        var r = attrNum(el, 'r');
        if (r <= 0) return null;
        p.arc(attrNum(el, 'cx'), attrNum(el, 'cy'), r, 0, Math.PI * 2);
      } else if (tag === 'ellipse') {
        var rx = attrNum(el, 'rx'), ry = attrNum(el, 'ry');
        if (rx <= 0 || ry <= 0) return null;
        p.ellipse(attrNum(el, 'cx'), attrNum(el, 'cy'), rx, ry, 0, 0, Math.PI * 2);
      } else if (tag === 'line') {
        p.moveTo(attrNum(el, 'x1'), attrNum(el, 'y1'));
        p.lineTo(attrNum(el, 'x2'), attrNum(el, 'y2'));
      } else if (tag === 'polyline' || tag === 'polygon') {
        var pts = String(el.getAttribute('points') || '').trim().split(/[\s,]+/);
        if (pts.length < 4) return null;
        p.moveTo(parseFloat(pts[0]) || 0, parseFloat(pts[1]) || 0);
        for (var i = 2; i + 1 < pts.length; i += 2) {
          p.lineTo(parseFloat(pts[i]) || 0, parseFloat(pts[i + 1]) || 0);
        }
        if (tag === 'polygon') p.closePath();
      } else return null;
      return p;
    } catch (e) { return null; }
  }

  var SVG_SHAPE_TAGS = {
    path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1
  };

  /* 只用几何属性 + 计算样式做近似绘制（Image 加载失败时的兜底） */
  function drawSvgFallback(svg, ctx, origin, warnings) {
    var all;
    try { all = svg.querySelectorAll('*'); } catch (e) { return; }
    var drawn = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var tag = String(el.tagName || '').toLowerCase();
      if (tag === 'foreignobject') { warnOnce(warnings, 'SVG 中的 <foreignObject> 无法回落绘制。'); continue; }
      if (tag === 'defs' || tag === 'clippath' || tag === 'mask' || tag === 'lineargradient' ||
        tag === 'radialgradient' || tag === 'pattern' || tag === 'filter' || tag === 'symbol' ||
        tag === 'marker' || tag === 'style' || tag === 'title' || tag === 'desc') continue;

      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;

      var m = null;
      try { m = el.getScreenCTM ? el.getScreenCTM() : null; } catch (e) { m = null; }
      if (!m) continue;

      ctx.save();
      try {
        ctx.transform(m.a, m.b, m.c, m.d, m.e - origin.left, m.f - origin.top);
        var fill = cs.fill;
        var stroke = cs.stroke;
        var strokeW = px(cs.strokeWidth, 1);
        var hasFill = fill && fill !== 'none' && px(cs.fillOpacity, 1) > 0;
        var hasStroke = stroke && stroke !== 'none' && strokeW > 0 && px(cs.strokeOpacity, 1) > 0;

        if (SVG_SHAPE_TAGS[tag]) {
          var p = shapePath(el, tag);
          if (p) {
            if (hasFill && tag !== 'line' && tag !== 'polyline') { ctx.fillStyle = fill; ctx.fill(p); }
            if (hasStroke) {
              ctx.strokeStyle = stroke;
              ctx.lineWidth = strokeW;
              if (cs.linecap) ctx.lineCap = cs.linecap;
              if (cs.linejoin) ctx.lineJoin = cs.linejoin;
              ctx.stroke(p);
            }
            drawn++;
          }
        } else if (tag === 'text') {
          var txt = el.textContent;
          if (txt && String(txt).trim() !== '') {
            ctx.font = fontOf(cs);
            ctx.fillStyle = hasFill ? fill : '#000000';
            ctx.textBaseline = 'alphabetic';
            var anchor = cs.textAnchor || el.getAttribute('text-anchor') || 'start';
            ctx.textAlign = anchor === 'middle' ? 'center' : (anchor === 'end' ? 'right' : 'left');
            ctx.fillText(String(txt), attrNum(el, 'x'), attrNum(el, 'y'));
            drawn++;
          }
        } else if (tag === 'image') {
          var href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
          if (/^data:/i.test(href)) warnOnce(warnings, 'SVG 内的 <image> 在回落模式下未绘制。');
        }
      } catch (e) { /* 单个元素失败不影响其它 */ }
      ctx.restore();
    }
    if (!drawn) warnOnce(warnings, 'SVG 内容未能绘制（回落模式）。');
  }

  /* ---- 核心：遍历 DOM 重绘 ---- */

  function drawSvgNode(svg, ctx, x, y, w, h, origin, warnings) {
    var url = null;
    try {
      url = svgToDataURL(svg, w, h);
    } catch (e) {
      url = null;
      warnOnce(warnings, 'SVG 序列化失败，已改用逐元素绘制。');
    }
    if (!url) {
      drawSvgFallback(svg, ctx, origin, warnings);
      return Promise.resolve();
    }
    return loadImage(url, 10000).then(function (img) {
      try { ctx.drawImage(img, x, y, w, h); }
      catch (e) {
        warnOnce(warnings, 'SVG 绘制失败，已改用逐元素绘制。');
        drawSvgFallback(svg, ctx, origin, warnings);
      }
    }, function () {
      warnOnce(warnings, 'SVG 转为图片失败，已回落到逐元素绘制。');
      drawSvgFallback(svg, ctx, origin, warnings);
    });
  }

  function drawImgNode(img, ctx, x, y, w, h, warnings) {
    var src = img.getAttribute('src') || '';
    if (!/^data:/i.test(src)) {
      warnOnce(warnings, '图片 <img> 不是 dataURL（file:// 下不可用），已跳过。');
      return Promise.resolve();
    }
    return loadImage(src, 8000).then(function (im) {
      try { ctx.drawImage(im, x, y, w, h); } catch (e) { warnOnce(warnings, '图片绘制失败，已跳过。'); }
    }, function () {
      warnOnce(warnings, '图片加载失败，已跳过。');
    });
  }

  function drawElement(node, ctx, origin, warnings, depth) {
    return Promise.resolve().then(function () {
      if (!node || node.nodeType !== 1) return null;
      if (depth > 80) return null;

      var tag = String(node.tagName || '').toLowerCase();
      if (SKIP_TAGS[tag]) return null;
      if (UNSUPPORTED_TAGS[tag]) {
        warnOnce(warnings, '暂不支持导出 <' + tag + '> 标签，已跳过。');
        return null;
      }
      if (tag === 'svg') {
        var r0 = node.getBoundingClientRect();
        return drawSvgNode(node, ctx, r0.left - origin.left, r0.top - origin.top,
          r0.width, r0.height, origin, warnings);
      }
      if (tag === 'canvas') {
        var rc = node.getBoundingClientRect();
        try { ctx.drawImage(node, rc.left - origin.left, rc.top - origin.top, rc.width, rc.height); }
        catch (e) { warnOnce(warnings, '画布内容无法拷贝（可能被跨域图片污染）。'); }
        return null;
      }
      if (tag === 'img') {
        var ri = node.getBoundingClientRect();
        return drawImgNode(node, ctx, ri.left - origin.left, ri.top - origin.top,
          ri.width, ri.height, warnings);
      }

      var r = node.getBoundingClientRect();
      var x = r.left - origin.left, y = r.top - origin.top;
      var w = r.width, h = r.height;

      var cs = null;
      try { cs = getComputedStyle(node); } catch (e) { cs = null; }
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return null;

      var contents = cs && cs.display === 'contents';
      if (!contents && w <= 0 && h <= 0) return null;
      if (!contents && (r.width <= 0 || r.height <= 0)) {
        /* 空盒子：仍然可能有子元素（如零高容器），继续向下遍历 */
        if (node.children && node.children.length) {
          return drawChildren(node, ctx, origin, warnings, depth);
        }
        return null;
      }

      var clipped = false;
      if (!contents && cs) {
        var of = String(cs.overflow || '') + String(cs.overflowX || '') + String(cs.overflowY || '');
        if (/hidden|clip|auto|scroll/.test(of)) {
          ctx.save();
          pathRoundRect(ctx, x, y, w, h, radiusOf(cs));
          ctx.clip();
          clipped = true;
        }
        drawBox(cs, ctx, x, y, w, h, warnings);
        drawOwnText(node, cs, ctx, x, y, w, h);
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          var val = node.value;
          if (!val) val = node.getAttribute('placeholder') || '';
          if (val) {
            ctx.save();
            ctx.font = fontOf(cs);
            ctx.fillStyle = cs.color || '#000000';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(val), x + px(cs.paddingLeft) + px(cs.borderLeftWidth) + 2,
              y + h / 2, Math.max(1, w - 8));
            ctx.restore();
          }
        }
      }

      return drawChildren(node, ctx, origin, warnings, depth).then(function () {
        if (clipped) ctx.restore();
      }, function () {
        if (clipped) ctx.restore();
      });
    });
  }

  function drawChildren(node, ctx, origin, warnings, depth) {
    var kids = node.children;
    if (!kids || !kids.length) return Promise.resolve();
    var list = [];
    for (var i = 0; i < kids.length; i++) list.push(kids[i]);
    var chain = Promise.resolve();
    list.forEach(function (c) {
      chain = chain.then(function () { return drawElement(c, ctx, origin, warnings, depth + 1); });
    });
    return chain;
  }

  /* 量取根节点尺寸（canvas 未插入文档时 rect 为 0，退回 width/height 属性） */
  function measureRoot(root) {
    var rect = { left: 0, top: 0, width: 0, height: 0 };
    try {
      var r = root.getBoundingClientRect();
      rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    } catch (e) { /* 忽略 */ }
    if ((rect.width <= 0 || rect.height <= 0) && String(root.tagName || '').toLowerCase() === 'canvas') {
      var cw = root.width, ch = root.height;
      if (cw > 0 && ch > 0) { rect.width = cw; rect.height = ch; }
    }
    if (rect.width <= 0 || rect.height <= 0) {
      if (root.offsetWidth > 0 && root.offsetHeight > 0) {
        rect.width = root.offsetWidth; rect.height = root.offsetHeight;
      }
    }
    return rect;
  }

  /* DOM 节点 → 已绘制好的 canvas */
  function buildCanvas(nodeOrCanvas, opts, warnings) {
    return Promise.resolve().then(function () {
      if (!hasDOM()) throw new Error('当前环境没有浏览器 DOM，无法导出图片。');
      var root = nodeOrCanvas;
      if (root && root.nodeType === 3) root = root.parentNode;   // 文本节点
      if (!root || root.nodeType !== 1) throw new Error('传入的对象不是可绘制的 DOM 节点。');

      var rect = measureRoot(root);
      var cw = Math.ceil(rect.width), ch = Math.ceil(rect.height);
      if (cw <= 0 || ch <= 0) throw new Error('目标节点尺寸为 0，无法导出图片。');

      var dpr = (hasWindow() && window.devicePixelRatio) || 1;
      var scale = parseFloat(opts.scale) > 0 ? parseFloat(opts.scale) : Math.max(dpr, 2);
      var pad = opts.padding === undefined || opts.padding === null ? 16 : Math.max(0, toNum(opts.padding, 0));
      var title = opts.title ? String(opts.title) : '';
      var titleH = title ? (toNum(opts.titleHeight, 34) || 34) : 0;

      var w = cw + pad * 2;
      var h = ch + pad * 2 + titleH;

      /* 限制画布边长，避免超过浏览器上限（导致 toBlob 返回 null） */
      var maxSide = toNum(opts.maxSide, 16384) || 16384;
      var limit = Math.min(maxSide / w, maxSide / h);
      if (scale > limit) scale = Math.max(1, limit);

      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持 Canvas 2D，无法导出图片。');

      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      /* 背景（opts.background === null 表示透明底） */
      var bg = opts.background === undefined ? '#ffffff' : opts.background;
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }

      /* 顶部标题 */
      if (title) {
        ctx.save();
        ctx.fillStyle = opts.titleColor || '#111827';
        ctx.font = (toNum(opts.titleWeight, 600) || 600) + ' ' + (toNum(opts.titleSize, 20) || 20) + 'px ' + UI_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        try {
          ctx.fillText(title, w / 2, pad + titleH / 2 - 2, Math.max(1, w - pad * 2));
        } catch (e) { /* 标题绘制失败不影响主体 */ }
        ctx.restore();
      }

      ctx.save();
      ctx.translate(pad, pad + titleH);
      return drawElement(root, ctx, rect, warnings, 0).then(function () {
        ctx.restore();
        return canvas;
      }, function (err) {
        ctx.restore();
        throw err;
      });
    });
  }

  function dataURLToBlob(dataURL) {
    var parts = String(dataURL).split(',');
    var mime = /data:([^;]+)/.exec(parts[0]);
    var bin = typeof atob === 'function' ? atob(parts[1]) : '';
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: (mime && mime[1]) || 'image/png' });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (typeof canvas.toBlob === 'function') {
        try {
          canvas.toBlob(function (b) {
            if (b) resolve(b);
            else {
              try { resolve(dataURLToBlob(canvas.toDataURL('image/png'))); }
              catch (e) { reject(new Error('画布导出为空。')); }
            }
          }, 'image/png');
          return;
        } catch (e) { /* 继续走兜底 */ }
      }
      try { resolve(dataURLToBlob(canvas.toDataURL('image/png'))); }
      catch (e) { reject(new Error('画布被跨域内容污染，无法导出。')); }
    });
  }

  /* 把导出过程中的警告挂到返回值上 */
  function attachWarnings(target, warnings) {
    try { target.warnings = warnings; } catch (e) { /* 忽略 */ }
    E.lastWarnings = warnings;
    return target;
  }

  /* toPNG：nodeOrCanvas → Promise<Blob>；给了 filename 就顺手下载 */
  function toPNG(nodeOrCanvas, filename, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var warnings = [];
      function fail(msg, e) {
        var m = String(msg === null || msg === undefined ? '未知错误' : msg);
        if (e && e.message && String(e.message) !== m) m += '（' + e.message + '）';
        reject(new Error('PNG 导出失败：' + m));
      }
      try {
        buildCanvas(nodeOrCanvas, opts, warnings).then(function (canvas) {
          return canvasToBlob(canvas).then(function (blob) {
            attachWarnings(blob, warnings);
            if (filename && opts.download !== false) {
              try { downloadBlob(blob, filename); } catch (e) { /* 下载失败不影响返回值 */ }
            }
            resolve(blob);
          }, function (e) { fail('画布转换为 PNG 失败', e); });
        }, function (e) { fail(e && e.message ? e.message : String(e), e); });
      } catch (e) {
        fail(e && e.message ? e.message : String(e), e);
      }
    });
  }

  /* toDataURL：nodeOrCanvas → Promise<string> */
  function toDataURL(node, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var warnings = [];
      try {
        buildCanvas(node, opts, warnings).then(function (canvas) {
          try {
            var url = canvas.toDataURL('image/png');
            E.lastWarnings = warnings;
            resolve(url);
          } catch (e) { reject(new Error('PNG 导出失败：画布无法输出 dataURL（可能被跨域内容污染）。')); }
        }, function (e) { reject(new Error('PNG 导出失败：' + (e && e.message ? e.message : String(e)))); });
      } catch (e) {
        reject(new Error('PNG 导出失败：' + (e && e.message ? e.message : String(e))));
      }
    });
  }

  /* exportScoreImage：截取当前谱面（可带顶部标题） */
  function exportScoreImage(container, filename, title) {
    var name = filename || ('谱面-' + nowStamp() + '.png');
    return toPNG(container, name, { title: title || '', background: '#ffffff', padding: 16 });
  }

  /* ==================== MIDI ==================== */

  var TICKS_PER_QUARTER = 480;
  var STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function midiOfPitch(p) {
    if (!p) return null;
    if (APP.theory && typeof APP.theory.midiOf === 'function') {
      try {
        var m = APP.theory.midiOf(p);
        if (m !== null && m !== undefined && isFinite(m)) return m;
      } catch (e) { /* 走兜底 */ }
    }
    var semi = STEP_SEMI[p.step];
    if (semi === undefined) return null;
    return 12 * ((p.oct || 0) + 1) + semi + (p.acc || 0);
  }

  /* 时值换算（契约第 1 节的唯一权威公式）：
   *   beats = 基础拍数表[dur] * (dotted ? 1.5 : 1)
   * 4=全音符=4 拍, 2=二分=2 拍, 1=四分=1 拍, 0.5=八分=0.5 拍 …
   * 约定：不直接用 4/dur 参与关键计算，统一走查表 + 乘法（等价于 APP.util.beatsOf）。 */
  var BEATS_TABLE = { '4': 4, '2': 2, '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125, '0.0625': 0.0625 };

  function baseBeats(dur) {
    var b = BEATS_TABLE[String(dur)];
    if (b !== undefined) return b;
    /* 兜底：dur 是「时值倒数标记」，全音符记作 4，基础拍数即 dur 本身 */
    var n = toNum(dur, 1);
    return n > 0 ? n : 1;
  }

  function beatsOfNote(n) {
    var dur = (n && n.dur) ? n.dur : 1;
    var dotted = !!(n && n.dotted);
    /* 优先复用 APP.util.beatsOf，保证全项目时值口径一致 */
    if (APP.util && typeof APP.util.beatsOf === 'function') {
      try {
        var b = APP.util.beatsOf(dur, dotted);
        if (isFinite(b) && b > 0) return b;
      } catch (e) { /* 走本地兜底 */ }
    }
    return baseBeats(dur) * (dotted ? 1.5 : 1);
  }

  function ticksOfNote(n) {
    var t = Math.round(beatsOfNote(n) * TICKS_PER_QUARTER);
    return t > 0 ? t : 0;
  }

  function normalizeScore(score) {
    var s = score || {};
    var time = s.time && s.time.num ? { num: s.time.num | 0, den: s.time.den || 4 } : { num: 4, den: 4 };
    return {
      key: s.key || { tonic: 0, mode: 'major', fifths: 0 },
      time: time,
      tempo: clampNum(toNum(s.tempo, 100) || 100, 20, 300),
      clef: s.clef === 'bass' ? 'bass' : 'treble',
      title: s.title ? String(s.title) : '',
      bars: isArr(s.bars) ? s.bars : []
    };
  }

  /* 拍号一小节 = 多少 tick。以四分音符为一拍：den 分音符 = （4/den）拍，同样走查表 */
  var DEN_BEATS = { '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125 };

  function barTicks(time) {
    var num = (time && time.num) || 4;
    var den = (time && time.den) || 4;
    var per = DEN_BEATS[String(den)];
    if (per === undefined) per = 4 / den;
    return Math.round(num * per * TICKS_PER_QUARTER);
  }

  function scoreTotalTicks(s) {
    var total = 0;
    s.bars.forEach(function (bar) {
      (bar && bar.notes ? bar.notes : []).forEach(function (n) { total += ticksOfNote(n); });
    });
    return total;
  }

  /* 展平成线性音符序列，并做延音线合并（同音重触发在 MIDI 里会被吞掉） */
  function soundingNotes(s) {
    var flat = [];
    s.bars.forEach(function (bar) {
      (bar && bar.notes ? bar.notes : []).forEach(function (n) {
        flat.push({ note: n || {}, ticks: ticksOfNote(n), midi: midiOfPitch(n ? n.pitch : null) });
      });
    });
    var out = [];
    var t = 0;
    for (var i = 0; i < flat.length; i++) {
      var cur = flat[i];
      if (cur.midi === null) { t += cur.ticks; continue; }   // 休止符只推进时间
      var end = t + cur.ticks;
      var j = i;
      while (flat[j].note && flat[j].note.tie && flat[j + 1] && flat[j + 1].midi === cur.midi) {
        j++;
        end += flat[j].ticks;
      }
      out.push({ midi: clampNum(Math.round(cur.midi), 0, 127), start: t, end: end, ticks: end - t, merged: j - i + 1 });
      t = end;
      i = j;
    }
    return { flat: flat, sound: out, total: scoreTotalTicks(s) };
  }

  /* 字节写入器 */
  function ByteWriter() { this.bytes = []; }
  ByteWriter.prototype.u8 = function (v) { this.bytes.push((v | 0) & 0xFF); return this; };
  ByteWriter.prototype.u16 = function (v) { this.u8(v >> 8); this.u8(v & 0xFF); return this; };
  ByteWriter.prototype.u32 = function (v) {
    this.u8(Math.floor(v / 16777216) & 0xFF);
    this.u8((v >> 16) & 0xFF);
    this.u8((v >> 8) & 0xFF);
    this.u8(v & 0xFF);
    return this;
  };
  ByteWriter.prototype.ascii = function (str) {
    var s = String(str === null || str === undefined ? '' : str);
    for (var i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7F);
    return this;
  };
  ByteWriter.prototype.raw = function (arr) {
    for (var i = 0; i < arr.length; i++) this.u8(arr[i]);
    return this;
  };
  /* UTF-8（自己实现，不依赖 TextEncoder） */
  ByteWriter.prototype.utf8 = function (str) {
    var s = String(str === null || str === undefined ? '' : str);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) this.u8(c);
      else if (c < 0x800) { this.u8(0xC0 | (c >> 6)); this.u8(0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          this.u8(0xF0 | (cp >> 18)); this.u8(0x80 | ((cp >> 12) & 0x3F));
          this.u8(0x80 | ((cp >> 6) & 0x3F)); this.u8(0x80 | (cp & 0x3F));
          i++;
        } else { this.u8(0xEF); this.u8(0xBF); this.u8(0xBD); }
      } else { this.u8(0xE0 | (c >> 12)); this.u8(0x80 | ((c >> 6) & 0x3F)); this.u8(0x80 | (c & 0x3F)); }
    }
    return this;
  };
  /* 变长量（VLQ），正确处理 > 127 的 delta */
  ByteWriter.prototype.varLen = function (v) {
    var n = Math.max(0, Math.round(toNum(v, 0)));
    var buf = [n % 128];
    n = Math.floor(n / 128);
    while (n > 0) { buf.unshift((n % 128) | 0x80); n = Math.floor(n / 128); }
    this.raw(buf);
    return this;
  };
  ByteWriter.prototype.varLenNum = function (v) { return this.varLen(v); };
  /* 轨道名（FF 03） */
  ByteWriter.prototype.trackName = function (text) {
    var tmp = new ByteWriter();
    tmp.utf8(text);
    this.varLen(0); this.u8(0xFF); this.u8(0x03); this.varLen(tmp.bytes.length); this.raw(tmp.bytes);
    return this;
  };
  ByteWriter.prototype.endOfTrack = function () {
    this.varLen(0); this.u8(0xFF); this.u8(0x2F); this.u8(0x00);
    return this;
  };

  function buildMetaTrack(s) {
    var b = new ByteWriter();
    b.trackName('速度与拍号');
    /* 速度：FF 51 03 tttttt（微秒/四分音符） */
    var usPerQuarter = Math.max(1, Math.round(60000000 / s.tempo));
    b.varLen(0); b.u8(0xFF); b.u8(0x51); b.u8(0x03);
    b.u8((usPerQuarter >> 16) & 0xFF); b.u8((usPerQuarter >> 8) & 0xFF); b.u8(usPerQuarter & 0xFF);
    /* 拍号：FF 58 04 nn dd cc bb */
    var dd = Math.round(Math.log(s.time.den) / Math.LN2);
    var cc = 24;   // 每节拍器拍数（MIDI clock）
    var bb = 8;    // 每个四分音符的 32 分音符数
    b.varLen(0); b.u8(0xFF); b.u8(0x58); b.u8(0x04);
    b.u8(s.time.num & 0xFF); b.u8(dd & 0xFF); b.u8(cc & 0xFF); b.u8(bb & 0xFF);
    /* 调号：FF 59 02 sf mi */
    var sf = clampNum(Math.round(toNum(s.key.fifths, 0)), -7, 7);
    var mi = (s.key.mode === 'minor') ? 1 : 0;
    b.varLen(0); b.u8(0xFF); b.u8(0x59); b.u8(0x02);
    b.u8(sf & 0xFF); b.u8(mi & 0xFF);
    b.endOfTrack();
    return b.bytes;
  }

  function buildNoteTrack(s, info) {
    var b = new ByteWriter();
    b.trackName('旋律');
    /* 组装 on/off 事件：同一 tick 上 note off 必须排在 note on 之前，避免同音被截断 */
    var events = [];
    info.sound.forEach(function (n) {
      events.push({ t: n.start, type: 1, midi: n.midi, vel: 80 });   // type 1 = note on
      events.push({ t: n.end, type: 0, midi: n.midi, vel: 64 });     // type 0 = note off
    });
    events.sort(function (a, c) {
      if (a.t !== c.t) return a.t - c.t;
      return a.type - c.type;
    });
    var prev = 0;
    events.forEach(function (ev) {
      var delta = ev.t - prev;
      if (delta < 0) delta = 0;
      prev = ev.t;
      b.varLen(delta);
      if (ev.type === 1) { b.u8(0x90); b.u8(ev.midi); b.u8(ev.vel); }
      else { b.u8(0x80); b.u8(ev.midi); b.u8(ev.vel); }
    });
    /* 把轨道推进到乐曲总长度（休止收尾时也能对齐），再写 EOT */
    if (info.total > prev) b.varLen(info.total - prev);
    b.endOfTrack();
    return b.bytes;
  }

  /* 生成标准 MIDI 文件字节（SMF type 1） */
  function midiBytes(score) {
    var s = normalizeScore(score);
    var info = soundingNotes(s);
    var meta = buildMetaTrack(s);
    var notes = buildNoteTrack(s, info);

    var out = new ByteWriter();
    out.ascii('MThd');
    out.u32(6);
    out.u16(1);                    // format = 1
    out.u16(2);                    // ntrks = 2
    out.u16(TICKS_PER_QUARTER);    // division = 480
    out.ascii('MTrk'); out.u32(meta.length); out.raw(meta);
    out.ascii('MTrk'); out.u32(notes.length); out.raw(notes);
    return new Uint8Array(out.bytes);
  }

  function toMIDI(score) {
    return new Blob([midiBytes(score)], { type: 'audio/midi' });
  }

  function exportMIDIFile(score, filename) {
    var name = filename || (APP.util && APP.util.timestampName
      ? APP.util.timestampName('score', '.mid') : ('score-' + nowStamp() + '.mid'));
    var blob = toMIDI(score);
    downloadBlob(blob, name);
    return blob;
  }

  /* ==================== MusicXML ==================== */

  var DIVISIONS = 480;

  function xmlClean(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  function xmlText(s) {
    return xmlClean(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  var TYPE_BY_DUR = {
    4: 'whole', 2: 'half', 1: 'quarter', 0.5: 'eighth',
    0.25: '16th', 0.125: '32nd', 0.0625: '64th'
  };

  function typeOfDur(dur) {
    var d = toNum(dur, 1);
    if (TYPE_BY_DUR[d]) return TYPE_BY_DUR[d];
    /* 容错：取最接近的标准时值 */
    var best = null, bestDiff = Infinity;
    Object.keys(TYPE_BY_DUR).forEach(function (k) {
      var diff = Math.abs(parseFloat(k) - d);
      if (diff < bestDiff) { bestDiff = diff; best = TYPE_BY_DUR[k]; }
    });
    return best || 'quarter';
  }

  /* 凑小节用的可表示时值（含附点） */
  var FILL_STEPS = [
    { ticks: 2880, dur: 4, dotted: true },
    { ticks: 1920, dur: 4, dotted: false },
    { ticks: 1440, dur: 2, dotted: true },
    { ticks: 960, dur: 2, dotted: false },
    { ticks: 720, dur: 1, dotted: true },
    { ticks: 480, dur: 1, dotted: false },
    { ticks: 360, dur: 0.5, dotted: true },
    { ticks: 240, dur: 0.5, dotted: false },
    { ticks: 180, dur: 0.25, dotted: true },
    { ticks: 120, dur: 0.25, dotted: false },
    { ticks: 90, dur: 0.125, dotted: true },
    { ticks: 60, dur: 0.125, dotted: false },
    { ticks: 45, dur: 0.0625, dotted: true },
    { ticks: 30, dur: 0.0625, dotted: false }
  ];

  function fillRests(ticks) {
    var out = [];
    var left = ticks;
    var guard = 0;
    while (left >= 30 && guard++ < 64) {
      var picked = null;
      for (var i = 0; i < FILL_STEPS.length; i++) {
        if (FILL_STEPS[i].ticks <= left) { picked = FILL_STEPS[i]; break; }
      }
      if (!picked) break;
      out.push({ dur: picked.dur, dotted: picked.dotted, ticks: picked.ticks });
      left -= picked.ticks;
    }
    return out;
  }

  function noteXML(opts) {
    /* opts: {pitch, dur, dotted, rest, tieStart, tieStop, staff} */
    var out = [];
    out.push('      <note>');
    if (opts.rest) {
      out.push('        <rest/>');
    } else {
      var p = opts.pitch;
      out.push('        <pitch>');
      out.push('          <step>' + xmlText(p.step) + '</step>');
      var alter = Math.round(toNum(p.acc, 0));
      if (alter !== 0) out.push('          <alter>' + alter + '</alter>');
      out.push('          <octave>' + Math.round(toNum(p.oct, 4)) + '</octave>');
      out.push('        </pitch>');
    }
    out.push('        <duration>' + Math.max(1, Math.round(opts.ticks)) + '</duration>');
    if (opts.tieStart) out.push('        <tie type="start"/>');
    if (opts.tieStop) out.push('        <tie type="stop"/>');
    out.push('        <voice>1</voice>');
    out.push('        <type>' + typeOfDur(opts.dur) + '</type>');
    if (opts.dotted) out.push('        <dot/>');
    out.push('        <staff>' + (opts.staff || 1) + '</staff>');
    if (opts.tieStart || opts.tieStop) {
      out.push('        <notations>');
      if (opts.tieStart) out.push('          <tied type="start"/>');
      if (opts.tieStop) out.push('          <tied type="stop"/>');
      out.push('        </notations>');
    }
    out.push('      </note>');
    return out;
  }

  /* 单小节转 XML 行数组；小节不足拍号时用休止符补齐 */
  function measureXML(s, bar, index, warnings) {
    var out = [];
    out.push('    <measure number="' + (index + 1) + '">');

    if (index === 0) {
      out.push('      <attributes>');
      out.push('        <divisions>' + DIVISIONS + '</divisions>');
      out.push('        <key>');
      out.push('          <fifths>' + clampNum(Math.round(toNum(s.key.fifths, 0)), -7, 7) + '</fifths>');
      out.push('        </key>');
      out.push('        <time>');
      out.push('          <beats>' + s.time.num + '</beats>');
      out.push('          <beat-type>' + s.time.den + '</beat-type>');
      out.push('        </time>');
      out.push('        <clef>');
      out.push('          <sign>' + (s.clef === 'bass' ? 'F' : 'G') + '</sign>');
      out.push('          <line>' + (s.clef === 'bass' ? 4 : 2) + '</line>');
      out.push('        </clef>');
      out.push('      </attributes>');
    }

    var notes = (bar && isArr(bar.notes)) ? bar.notes : [];
    var sum = 0;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i] || {};
      var rest = !n.pitch;
      var ticks = ticksOfNote(n);
      sum += ticks;
      var midi = rest ? null : midiOfPitch(n.pitch);
      var next = notes[i + 1];
      var prev = notes[i - 1];
      var tieStart = false, tieStop = false;
      if (!rest) {
        tieStart = !!n.tie && !!next && midiOfPitch(next.pitch) === midi;
        tieStop = !!prev && !!prev.tie && midiOfPitch(prev.pitch) === midi;
      }
      noteXML({
        pitch: n.pitch, dur: n.dur, dotted: !!n.dotted, rest: rest,
        ticks: ticks, tieStart: tieStart, tieStop: tieStop, staff: 1
      }).forEach(function (l) { out.push(l); });
    }

    var expected = barTicks(s.time);
    if (sum < expected) {
      fillRests(expected - sum).forEach(function (r) {
        noteXML({
          rest: true, dur: r.dur, dotted: r.dotted, ticks: r.ticks, staff: 1
        }).forEach(function (l) { out.push(l); });
      });
    } else if (sum > expected) {
      warnOnce(warnings, '第 ' + (index + 1) + ' 小节时值超过拍号，导出内容可能与原谱不一致。');
    }

    out.push('    </measure>');
    return out;
  }

  function toMusicXML(score) {
    var s = normalizeScore(score);
    var warnings = [];
    var title = s.title || '读谱练习';
    var L = [];
    L.push('<?xml version="1.0" encoding="UTF-8"?>');
    L.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"' +
      ' "http://www.musicxml.org/dtds/partwise.dtd">');
    L.push('<score-partwise version="4.0">');
    L.push('  <work>');
    L.push('    <work-title>' + xmlText(title) + '</work-title>');
    L.push('  </work>');
    L.push('  <identification>');
    L.push('    <encoding>');
    L.push('      <software>读谱训练器</software>');
    L.push('      <encoding-date>' + todayISO() + '</encoding-date>');
    L.push('    </encoding>');
    L.push('  </identification>');
    L.push('  <part-list>');
    L.push('    <score-part id="P1">');
    L.push('      <part-name>' + xmlText(title) + '</part-name>');
    L.push('    </score-part>');
    L.push('  </part-list>');
    L.push('  <part id="P1">');

    var bars = s.bars.length ? s.bars : [{ notes: [] }];
    bars.forEach(function (bar, i) {
      measureXML(s, bar, i, warnings).forEach(function (l) { L.push(l); });
    });

    L.push('  </part>');
    L.push('</score-partwise>');
    E.lastXMLWarnings = warnings;
    return L.join('\n');
  }

  function exportMusicXMLFile(score, filename) {
    var s = normalizeScore(score);
    var name = filename || (APP.util && APP.util.timestampName
      ? APP.util.timestampName('score', '.musicxml') : ('score-' + nowStamp() + '.musicxml'));
    var xml = toMusicXML(score);
    var blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' });
    downloadBlob(blob, name);
    return blob;
  }

  /* ==================== 导出面板 ==================== */

  function pickNode(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function findJianpuNode() {
    return pickNode('.jianpu-host') || pickNode('[data-role="jianpu"]') ||
      pickNode('.jianpu') || pickNode('#jianpu');
  }

  function findScoreNode() {
    return pickNode('[data-role="score"]') || pickNode('.score-host') ||
      pickNode('.staff-host') || pickNode('#score') || pickNode('svg');
  }

  /*
   * mountPanel(container, { getScore, getScoreNode, getTitle, getJianpuNode? })
   * 中文导出面板；所有失败都用 APP.util.toast(..., 'err') 提示。
   */
  function mountPanel(container, opts) {
    opts = opts || {};
    if (!container || !hasDOM()) return null;

    function getScoreSafe() {
      try {
        var s = typeof opts.getScore === 'function' ? opts.getScore() : null;
        if (s && s.bars) return s;
      } catch (e) { /* 忽略 */ }
      return null;
    }

    function getScoreNodeSafe() {
      try {
        var n = typeof opts.getScoreNode === 'function' ? opts.getScoreNode() : null;
        if (n && n.nodeType === 1) return n;
      } catch (e) { /* 忽略 */ }
      return findScoreNode();
    }

    function getJianpuNodeSafe() {
      try {
        var n = typeof opts.getJianpuNode === 'function' ? opts.getJianpuNode() : null;
        if (n && n.nodeType === 1) return n;
      } catch (e) { /* 忽略 */ }
      return findJianpuNode();
    }

    function getTitleSafe() {
      try {
        if (typeof opts.getTitle === 'function') {
          var t = opts.getTitle();
          if (t) return String(t);
        }
      } catch (e) { /* 忽略 */ }
      var s = getScoreSafe();
      return (s && s.title) ? String(s.title) : '读谱训练器';
    }

    function scoreName(ext) {
      return '读谱训练器-' + nowStamp() + ext;
    }

    function doPng(kind) {
      var node = kind === 'jianpu' ? getJianpuNodeSafe() : getScoreNodeSafe();
      if (!node) {
        toast('没有找到可导出的' + (kind === 'jianpu' ? '简谱' : '谱面') + '内容。', 'err');
        return;
      }
      var title = getTitleSafe();
      if (kind === 'jianpu') title += ' 简谱';
      var name = scoreName('.png');
      exportScoreImage(node, name, title).then(function (blob) {
        var extra = (blob && blob.warnings && blob.warnings.length)
          ? '（' + blob.warnings.length + ' 项内容未绘制）' : '';
        toast('已导出 PNG：' + Math.round((blob.size || 0) / 1024) + ' KB' + extra, 'ok');
      }, function (e) {
        toast((e && e.message) || 'PNG 导出失败。', 'err');
      });
    }

    function doMidi() {
      var s = getScoreSafe();
      if (!s) { toast('没有可导出的乐段。', 'err'); return; }
      try {
        exportMIDIFile(s, scoreName('.mid'));
        toast('已导出 MIDI 文件。', 'ok');
      } catch (e) { toast('MIDI 导出失败：' + (e && e.message ? e.message : e), 'err'); }
    }

    function doMusicXML() {
      var s = getScoreSafe();
      if (!s) { toast('没有可导出的乐段。', 'err'); return; }
      try {
        exportMusicXMLFile(s, scoreName('.musicxml'));
        toast('已导出 MusicXML 文件。', 'ok');
      } catch (e) { toast('MusicXML 导出失败：' + (e && e.message ? e.message : e), 'err'); }
    }

    function doCopy() {
      var s = getScoreSafe();
      if (!s) { toast('没有可复制的乐段。', 'err'); return; }
      var text = '';
      try {
        if (APP.jianpu && typeof APP.jianpu.toText === 'function') text = APP.jianpu.toText(s, {});
      } catch (e) { text = ''; }
      if (!text) { toast('简谱文本暂不可用。', 'err'); return; }
      copyText(text).then(function (ok) {
        if (ok) toast('简谱文本已复制到剪贴板。', 'ok');
        else toast('复制失败，请手动选择文本复制。', 'err');
      });
    }

    clearNode(container);

    var panel = createEl('div', { class: 'exp-panel' });
    panel.appendChild(createEl('div', { class: 'exp-head' },
      createEl('div', { class: 'exp-title', text: '导出' }),
      createEl('div', { class: 'exp-sub', text: 'PNG 为 2 倍高清白底图，可直接打印或分享' })));

    var btns = [
      { act: 'png-score', label: '导出谱面 PNG', kind: 'primary', fn: function () { doPng('score'); } },
      { act: 'png-jianpu', label: '导出简谱 PNG', fn: function () { doPng('jianpu'); } },
      { act: 'midi', label: '导出 MIDI', fn: doMidi },
      { act: 'musicxml', label: '导出 MusicXML', fn: doMusicXML },
      { act: 'copy', label: '复制简谱文本', kind: 'ghost', fn: doCopy }
    ];

    var row = createEl('div', { class: 'exp-row' });
    btns.forEach(function (b) {
      row.appendChild(createEl('button', {
        class: 'btn ' + (b.kind || '') + ' exp-btn',
        'data-act': b.act,
        type: 'button',
        text: b.label,
        on: {
          click: function () {
            try { b.fn(); }
            catch (e) { toast('导出失败：' + (e && e.message ? e.message : e), 'err'); }
          }
        }
      }));
    });
    panel.appendChild(row);

    container.appendChild(panel);
    return {
      el: panel,
      buttons: btns.map(function (b) { return b.act; }),
      refresh: function () { /* 预留：需要时可重绘状态 */ }
    };
  }

  /* ==================== 对外 API ==================== */

  var E = {
    /* PNG */
    toPNG: toPNG,
    saveNodeImage: toPNG,        // 等价别名，供其它模块调用
    exportScoreImage: exportScoreImage,
    toDataURL: toDataURL,
    downloadBlob: downloadBlob,

    /* MIDI */
    toMIDI: toMIDI,
    midiBytes: midiBytes,
    exportMIDIFile: exportMIDIFile,

    /* MusicXML */
    toMusicXML: toMusicXML,
    exportMusicXMLFile: exportMusicXMLFile,

    /* 其它 */
    copyText: copyText,
    mountPanel: mountPanel,

    /* 状态 */
    lastWarnings: [],
    lastXMLWarnings: [],
    TICKS_PER_QUARTER: TICKS_PER_QUARTER,
    DIVISIONS: DIVISIONS
  };

  APP['export'] = E;

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
