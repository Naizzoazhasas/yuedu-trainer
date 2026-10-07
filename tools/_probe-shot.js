/* 探针：只截图不做检查（配合 --tab / --size 使用）
 * 用法： node tools/browser-probe.js tools/_probe-shot.js --tab scale --size 1280x900 --shot out.png
 */
'use strict';
/* 把页面滚到顶部并收起可能挡住画面的 toast，返回一点基本信息 */
try {
  window.scrollTo(0, 0);
  var toasts = document.querySelectorAll('.toast, #toast-host, .toast-host');
  Array.prototype.forEach.call(toasts, function (t) { t.style.display = 'none'; });
} catch (e) { }

var sel = document.querySelector('.panel[data-panel="scale"]');
return {
  title: document.title,
  scaleTitle: (document.querySelector('#sc-title') || {}).textContent,
  kbViewBox: (document.querySelector('#sc-keys svg') || {}).getAttribute
    ? document.querySelector('#sc-keys svg').getAttribute('viewBox') : null,
  kbClientWidth: (function () {
    var s = document.querySelector('#sc-keys svg');
    return s ? Math.round(s.getBoundingClientRect().width) : null;
  })(),
  kbHostWidth: (function () {
    var s = document.querySelector('#sc-keys');
    return s ? Math.round(s.getBoundingClientRect().width) : null;
  })(),
  panelWidth: sel ? Math.round(sel.getBoundingClientRect().width) : null,
  windowWidth: window.innerWidth
};
