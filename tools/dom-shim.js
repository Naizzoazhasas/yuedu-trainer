/* 读谱训练器 — node 测试用的最小 DOM 桩
 * 只实现渲染层与功能模块用到的 API，够用来做结构断言。
 * 用法： const dom = require('./tools/dom-shim.js'); dom.install(); 之后 global.document / global.window 可用。
 */
'use strict';

function PseudoStyle() {}
PseudoStyle.prototype.setProperty = function (k, v) { this[k] = v; };
PseudoStyle.prototype.removeProperty = function (k) { delete this[k]; };

var SEQ = 0;

function Node(nodeType, tagName) {
  this.nodeType = nodeType;
  this.tagName = (tagName || '').toUpperCase();
  this.childNodes = [];
  this.attributes = {};
  this.parentNode = null;
  this.style = new PseudoStyle();
  this._text = '';
  this._classes = [];
  this._listeners = {};
  this._id = ++SEQ;
}
Object.defineProperty(Node.prototype, 'textContent', {
  get: function () {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map(function (c) { return c.textContent; }).join('');
  },
  set: function (v) {
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) {
      var t = new Node(3, '#text');
      t._text = String(v);
      t.parentNode = this;
      this.childNodes.push(t);
    }
  }
});
Object.defineProperty(Node.prototype, 'className', {
  get: function () { return this._classes.join(' '); },
  set: function (v) { this._classes = String(v).split(/\s+/).filter(Boolean); }
});
Object.defineProperty(Node.prototype, 'classList', {
  get: function () {
    var self = this;
    return {
      add: function (c) { if (self._classes.indexOf(c) < 0) self._classes.push(c); },
      remove: function (c) { self._classes = self._classes.filter(function (x) { return x !== c; }); },
      toggle: function (c, on) {
        var has = self._classes.indexOf(c) >= 0;
        var want = (on === undefined) ? !has : !!on;
        if (want && !has) self._classes.push(c);
        if (!want && has) self._classes = self._classes.filter(function (x) { return x !== c; });
        return want;
      },
      contains: function (c) { return self._classes.indexOf(c) >= 0; }
    };
  }
});
Node.prototype.setAttribute = function (k, v) {
  this.attributes[k] = String(v);
  if (k === 'class') this.className = v;
  if (k === 'id') this.id = v;
  if (k.indexOf('data-') === 0) this['__' + k] = String(v);
};
Node.prototype.getAttribute = function (k) {
  if (k === 'class') return this.className;
  return this.attributes[k] === undefined ? null : this.attributes[k];
};
Node.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
Node.prototype.hasAttribute = function (k) { return this.attributes[k] !== undefined; };
Node.prototype.setAttributeNS = function (ns, k, v) { this.setAttribute(k, v); };
Node.prototype.appendChild = function (c) {
  if (!c) return c;
  if (c.parentNode) c.parentNode.removeChild(c);
  c.parentNode = this;
  this.childNodes.push(c);
  return c;
};
Node.prototype.insertBefore = function (c, ref) {
  var i = this.childNodes.indexOf(ref);
  c.parentNode = this;
  if (i < 0) this.childNodes.push(c);
  else this.childNodes.splice(i, 0, c);
  return c;
};
Node.prototype.removeChild = function (c) {
  var i = this.childNodes.indexOf(c);
  if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; }
  return c;
};
Node.prototype.replaceChild = function (n, o) {
  var i = this.childNodes.indexOf(o);
  if (i >= 0) { this.childNodes[i] = n; n.parentNode = this; o.parentNode = null; }
  return o;
};
Node.prototype.addEventListener = function (ev, fn) {
  (this._listeners[ev] = this._listeners[ev] || []).push(fn);
};
Node.prototype.removeEventListener = function (ev, fn) {
  if (this._listeners[ev]) this._listeners[ev] = this._listeners[ev].filter(function (f) { return f !== fn; });
};
Node.prototype.dispatch = function (ev, detail) {
  var e = { type: ev, target: this, preventDefault: function () {}, stopPropagation: function () {} };
  if (detail) Object.keys(detail).forEach(function (k) { e[k] = detail[k]; });
  (this._listeners[ev] || []).forEach(function (f) { f.call(this, e); });
  /* 也要触发 on<event> 形式的处理器（本项目大量使用 el.onchange = fn） */
  var inline = this['on' + ev];
  if (typeof inline === 'function') inline.call(this, e);
  return e;
};
Node.prototype.click = function () { this.dispatch('click'); };
Node.prototype.focus = function () {};
Node.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 400, height: 120, right: 400, bottom: 120, x: 0, y: 0 };
};
Object.defineProperty(Node.prototype, 'firstChild', {
  get: function () { return this.childNodes[0] || null; }
});
Object.defineProperty(Node.prototype, 'children', {
  get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); }
});
Node.prototype.querySelectorAll = function (sel) { return queryAll(this, sel); };
Node.prototype.querySelector = function (sel) { return queryAll(this, sel)[0] || null; };
Node.prototype.contains = function (n) {
  var p = n;
  while (p) { if (p === this) return true; p = p.parentNode; }
  return false;
};
Node.prototype.cloneNode = function (deep) {
  var c = new Node(this.nodeType, this.tagName);
  c._text = this._text;
  c._classes = this._classes.slice();
  var attrs = this.attributes;
  Object.keys(attrs).forEach(function (k) { c.attributes[k] = attrs[k]; });
  if (deep) this.childNodes.forEach(function (x) { c.appendChild(x.cloneNode(true)); });
  return c;
};

/* 极简选择器：支持后代（空格）与逗号分组；单段支持 tag / .class / #id / [attr] / [attr=val] 组合 */
function matchCompound(node, sel) {
  if (node.nodeType !== 1) return false;
  sel = sel.trim();
  if (!sel) return false;
  if (sel === '*') return true;
  var parts = sel.split(/(?=[.#\[])/).filter(Boolean);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p[0] === '.') {
      if (node._classes.indexOf(p.slice(1)) < 0) return false;
    } else if (p[0] === '#') {
      if (node.id !== p.slice(1)) return false;
    } else if (p[0] === '[') {
      var m = p.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
      if (!m) return false;
      if (node.getAttribute(m[1]) === null) return false;
      if (m[2] !== undefined && String(node.getAttribute(m[1])) !== m[2]) return false;
    } else {
      if (node.tagName !== p.toUpperCase()) return false;
    }
  }
  return true;
}

/* 单条复合路径（可能有空格分隔的祖先链） */
function matchPath(node, path) {
  var parts = path.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (!matchCompound(node, parts[parts.length - 1])) return false;
  var pi = parts.length - 2;
  var cur = node.parentNode;
  while (pi >= 0 && cur && cur.nodeType === 1) {
    if (matchCompound(cur, parts[pi])) pi--;
    cur = cur.parentNode;
  }
  return pi < 0;
}

function queryAll(root, sel) {
  var groups = String(sel).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var out = [];
  (function walk(n) {
    n.childNodes.forEach(function (c) {
      if (c.nodeType !== 1) return;
      var hit = false;
      for (var g = 0; g < groups.length; g++) {
        if (matchPath(c, groups[g])) { hit = true; break; }
      }
      if (hit && out.indexOf(c) < 0) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

function Document() {
  Node.call(this, 9, '#document');
  this.documentElement = new Node(1, 'html');
  this.body = new Node(1, 'body');
  this.documentElement.appendChild(this.body);
  this.appendChild(this.documentElement);
  this.readyState = 'complete';
  this._listeners = {};
}
Document.prototype = Object.create(Node.prototype);
Document.prototype.constructor = Document;
Document.prototype.createElement = function (tag) { return new Node(1, tag); };
Document.prototype.createElementNS = function (ns, tag) { return new Node(1, tag); };
Document.prototype.createTextNode = function (t) { var n = new Node(3, '#text'); n._text = String(t); return n; };
Document.prototype.createDocumentFragment = function () { return new Node(11, '#fragment'); };
Document.prototype.getElementById = function (id) {
  var found = null;
  (function walk(n) {
    n.childNodes.forEach(function (c) {
      if (!found && c.nodeType === 1 && c.id === id) found = c;
      walk(c);
    });
  })(this);
  return found;
};

/* XML 序列化：用于断言渲染出的 SVG */
function serialize(node, indent, level) {
  level = level || 0;
  if (node.nodeType === 3) return node._text;
  if (node.nodeType === 11) return node.childNodes.map(function (c) { return serialize(c, indent, level); }).join('');
  var pad = indent ? '\n' + '  '.repeat(level) : '';
  var attrs = Object.keys(node.attributes).map(function (k) {
    return ' ' + k + '="' + String(node.attributes[k]).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
  }).join('');
  var kids = node.childNodes.map(function (c) { return serialize(c, indent, level + 1); }).join('');
  if (!node.childNodes.length) return pad + '<' + node.tagName.toLowerCase() + attrs + ' />';
  return pad + '<' + node.tagName.toLowerCase() + attrs + '>' + kids +
    (indent ? '\n' + '  '.repeat(level) : '') + '</' + node.tagName.toLowerCase() + '>';
}

var doc = null;

function install() {
  doc = new Document();
  var win = global;
  win.document = doc;
  win.Node = Node;
  win.XMLSerializer = function () {};
  win.XMLSerializer.prototype.serializeToString = function (n) { return serialize(n, true, 0); };
  /* navigator / location 在 node 里可能是只读的，用 defineProperty 安全覆盖 */
  function def(obj, key, value) {
    try {
      Object.defineProperty(obj, key, { value: value, writable: true, configurable: true, enumerable: true });
    } catch (e) { /* 实在改不动就算了 */ }
  }
  if (!win.navigator) def(win, 'navigator', { userAgent: 'node' });
  if (!win.location) def(win, 'location', { protocol: 'file:', href: 'file:///test/index.html', hostname: '' });
  win.requestAnimationFrame = function (fn) { return setTimeout(function () { fn(Date.now()); }, 0); };
  win.cancelAnimationFrame = function (id) { clearTimeout(id); };
  win.getComputedStyle = function (n) {
    var s = n.style || {};
    var out = {};
    ['fontSize', 'fontFamily', 'fontWeight', 'color', 'textAlign', 'backgroundColor',
      'borderTopWidth', 'borderLeftWidth', 'borderTopColor', 'borderLeftColor', 'fill', 'stroke'].forEach(function (k) {
        out[k] = s[k] || '';
      });
    out.getPropertyValue = function (k) { return s[k] || ''; };
    return out;
  };
  if (!win.localStorage) {
    var store = {};
    win.localStorage = {
      getItem: function (k) { return store[k] === undefined ? null : store[k]; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
      clear: function () { store = {}; }
    };
  }
  if (!win.URL) win.URL = {};
  if (!win.URL.createObjectURL) win.URL.createObjectURL = function () { return 'blob:stub'; };
  if (!win.URL.revokeObjectURL) win.URL.revokeObjectURL = function () {};
  if (!win.Blob) {
    win.Blob = function (parts, opts) { this.parts = parts || []; this.type = (opts && opts.type) || ''; this.size = 0; };
  }
  return doc;
}

module.exports = { install: install, Node: Node, serialize: serialize, get document() { return doc; } };
