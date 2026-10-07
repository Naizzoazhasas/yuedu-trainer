/* 探针：确认「安全上下文」是否成立 —— 这是调音器能不能用麦克风的唯一前提
 * 用法：
 *   node tools/browser-probe.js tools/_probe-tuner-ctx.js --url http://127.0.0.1:9608/index.html
 *   node tools/browser-probe.js tools/_probe-tuner-ctx.js --url file:///.../index.html   （对照：应判定为不可用）
 */
'use strict';

function firstLine(el) { return (el.textContent || '').trim().split('\n')[0].slice(0, 40); }

var report = {
  href: location.href,
  protocol: location.protocol,
  host: location.host,
  isSecureContext: window.isSecureContext,
  hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  hasGetUserMedia: typeof navigator.getUserMedia !== 'undefined' ||
    typeof navigator.webkitGetUserMedia !== 'undefined',
  canEnumerate: typeof (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) === 'function'
};

/* 应用自己的判定逻辑（tuner.isSupported）怎么说 */
try {
  report.tunerSupported = APP.tuner && APP.tuner.isSupported ? APP.tuner.isSupported() : 'no-api';
} catch (e) { report.tunerSupported = 'error: ' + e.message; }
try {
  report.tunerReason = APP.tuner && APP.tuner.unsupportedReason ? APP.tuner.unsupportedReason() : null;
} catch (e) { report.tunerReason = 'error: ' + e.message; }

/* 调音器面板实际渲染出来的文字（用户看到的那句话） */
try {
  var tabs = document.querySelectorAll('#tabs .tab');
  Array.prototype.forEach.call(tabs, function (t) {
    if (t.getAttribute('data-tab') === 'tuner') t.click();
  });
  var host = document.querySelector('#tuner-mount');
  report.tunerPanelText = host ? (host.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  report.tunerShowsUnavailable = !!(host && /不可用|无法使用|请通过 https/.test(host.textContent || ''));
} catch (e) {
  report.tunerPanelError = e.message;
}

/* 结论 */
report.verdict = (report.isSecureContext && report.hasMediaDevices)
  ? 'OK —— 安全上下文成立，getUserMedia 可用，调音器可以申请麦克风'
  : 'FAIL —— 不满足安全上下文或缺少 getUserMedia，调音器会显示不可用';

return report;
