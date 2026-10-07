/* 探针：全站「选中高亮」一致性 + 音阶面板外观
 * 用法： node tools/browser-probe.js tools/_probe-ui.js --shot tools/_out/scale-panel.png
 */
'use strict';

function firstLine(el) { return (el.textContent || '').trim().split('\n')[0].slice(0, 16); }
function chips(sel) { return document.querySelectorAll(sel + ' .chip'); }
function activeIn(sel) {
  return Array.prototype.filter.call(chips(sel), function (c) { return c.classList.contains('active'); })
    .map(firstLine);
}
function allIn(sel) { return Array.prototype.map.call(chips(sel), firstLine); }

var problems = [];
function check(label, cond, detail) {
  if (!cond) problems.push(label + (detail ? ' → ' + detail : ''));
}

var out = { groups: {}, clicks: [], scale: {} };

/* ---------- 1. 每个芯片组的初始状态 ---------- */
['#gen-presets', '#gen-display', '#gen-renderer', '#gen-durations', '#gen-degrees', '#gen-tempo-presets']
  .forEach(function (sel) {
    out.groups[sel] = { all: allIn(sel), active: activeIn(sel) };
    check('初始状态下 ' + sel + ' 应该恰好有一个或多个高亮', activeIn(sel).length > 0,
      'all=' + JSON.stringify(allIn(sel)) + ' active=' + JSON.stringify(activeIn(sel)));
  });

/* ---------- 2. 逐一点击每个组的每个芯片，验证「点击后高亮必定包含被点项或状态一致」 ---------- */
function clickAll(sel, times) {
  var n = chips(sel).length;
  for (var k = 0; k < (times || n); k++) {
    var list = chips(sel);
    var target = list[k % list.length];
    if (!target) break;
    var label = firstLine(target);
    target.click();
    out.clicks.push({
      host: sel,
      clicked: label,
      active: activeIn(sel)
    });
    check('点击 ' + sel + ' 的「' + label + '」后该组不能完全没有高亮',
      activeIn(sel).length > 0,
      'active=' + JSON.stringify(activeIn(sel)));
  }
}

/* 时值：芯片是「切换」语义 —— 点未选中的会加上（自己应变高亮），
 * 点已选中的会取消（自己应变不高亮）。两种情况都要与实际 state 一致。 */
(function () {
  var list = chips('#gen-durations');
  /* 先确保全部取消，再逐个点亮，验证「点一下就亮」 */
  for (var i = 0; i < list.length; i++) {
    var c = chips('#gen-durations')[i];
    if (c && c.classList.contains('active') && chips('#gen-durations').length > 1) c.click();
  }
  var remaining = activeIn('#gen-durations');
  check('时值至少要保留一种', APP.app.state.durations.length >= 1,
    'state=' + JSON.stringify(APP.app.state.durations));

  for (var k = 0; k < chips('#gen-durations').length; k++) {
    var chip = chips('#gen-durations')[k];
    if (!chip) continue;
    var label = firstLine(chip);
    var wasActive = chip.classList.contains('active');
    chip.click();
    var act = activeIn('#gen-durations');
    out.clicks.push({ host: '#gen-durations', clicked: label, wasActive: wasActive, active: act,
      state: APP.app.state.durations.slice() });
    if (!wasActive) {
      check('点未选中的时值「' + label + '」后应变高亮', act.indexOf(label) >= 0,
        'active=' + JSON.stringify(act));
    } else {
      check('点已选中的时值「' + label + '」后应变不高亮', act.indexOf(label) < 0,
        'active=' + JSON.stringify(act));
    }
    /* 高亮集合必须与 state.durations 一致 */
    var expectNames = APP.app.state.durations.map(function (d) {
      var mm = { 4: '全音符', 2: '二分音符', 1: '四分音符', 0.5: '八分音符', 0.25: '十六分音符' };
      return mm[d];
    }).filter(Boolean);
    var gotNames = act.map(function (t) { return t.replace(/[0-9.]+拍$/, ''); });
    check('时值高亮集合应与 state.durations 一致',
      gotNames.slice().sort().join(',') === expectNames.slice().sort().join(','),
      'got=' + JSON.stringify(gotNames) + ' state=' + JSON.stringify(expectNames));
  }
})();

/* 预设：点击后该预设必定高亮，且时值/音级高亮要与 state 一致 */
Array.prototype.forEach.call(chips('#gen-presets'), function (p) {
  var label = firstLine(p);
  p.click();
  var act = activeIn('#gen-presets');
  out.clicks.push({
    host: '#gen-presets', clicked: label, active: act,
    durations: APP.app.state.durations.slice(),
    durationsActive: activeIn('#gen-durations'),
    degrees: APP.app.state.degrees.slice(),
    degreesActive: activeIn('#gen-degrees')
  });
  check('点击预设「' + label + '」后它自己应该高亮', act.indexOf(label) === 0 && act.length === 1,
    'active=' + JSON.stringify(act));
  /* 时值高亮数量必须等于 state.durations 的项数（去重后） */
  var uniq = APP.app.state.durations.filter(function (v, i, a) { return a.indexOf(v) === i; });
  check('预设「' + label + '」后时值高亮数应等于允许的时值数',
    activeIn('#gen-durations').length === uniq.length,
    'active=' + JSON.stringify(activeIn('#gen-durations')) + ' state=' + JSON.stringify(uniq));
  check('预设「' + label + '」后音级高亮数应等于允许的音级数',
    activeIn('#gen-degrees').length === APP.app.state.degrees.length,
    'active=' + JSON.stringify(activeIn('#gen-degrees')) + ' state=' + JSON.stringify(APP.app.state.degrees));
});

/* 音级：点击后必须与 state 完全一致 */
Array.prototype.forEach.call(chips('#gen-degrees'), function (d) {
  var label = firstLine(d);
  d.click();
  var act = activeIn('#gen-degrees');
  var expect = APP.app.state.degrees.map(function (x) { return String(x); });
  var got = act.map(function (t) { return t.replace(/[^0-9]/g, ''); });
  out.clicks.push({ host: '#gen-degrees', clicked: label, active: act, state: expect });
  check('点击音级「' + label + '」后高亮应与 state 一致',
    got.join(',') === expect.join(','), 'got=' + got.join(',') + ' state=' + expect.join(','));
});

/* 显示方式 / 渲染器：点击后自己必定高亮 */
[['#gen-display', 'display'], ['#gen-renderer', 'renderer']].forEach(function (pair) {
  Array.prototype.forEach.call(chips(pair[0]), function (c) {
    var label = firstLine(c);
    c.click();
    var act = activeIn(pair[0]);
    out.clicks.push({ host: pair[0], clicked: label, active: act });
    check('点击 ' + pair[0] + '「' + label + '」后应只有一个高亮且是它自己',
      act.length === 1 && act[0] === label, 'active=' + JSON.stringify(act));
  });
});

/* 速度预设：点击后应高亮该数值 */
Array.prototype.forEach.call(chips('#gen-tempo-presets'), function (c) {
  var label = firstLine(c);
  c.click();
  var act = activeIn('#gen-tempo-presets');
  out.clicks.push({ host: '#gen-tempo-presets', clicked: label, active: act, tempo: APP.app.state.tempo });
  check('点击速度预设「' + label + '」后应高亮它', act.indexOf(label) >= 0,
    'active=' + JSON.stringify(act) + ' tempo=' + APP.app.state.tempo);
});

/* ---------- 3. 音阶面板 ---------- */
Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) {
  if (t.getAttribute('data-tab') === 'scale') t.click();
});
out.scale.title = (document.querySelector('#sc-title') || {}).textContent;
var kb = document.querySelector('#sc-keys svg');
if (kb) {
  var labels = kb.querySelectorAll('[data-key-label]');
  var keys = kb.querySelectorAll('[data-key-on]');
  var nodes = Array.prototype.slice.call(kb.childNodes);
  var lastKey = -1, firstLabel = -1;
  nodes.forEach(function (n, i) {
    if (n.getAttribute && n.getAttribute('data-key-on')) lastKey = i;
    if (n.getAttribute && n.getAttribute('data-key-label') && firstLabel < 0) firstLabel = i;
  });
  out.scale.kb = {
    labelCount: labels.length,
    keyCount: keys.length,
    firstLabelIndex: firstLabel,
    lastKeyIndex: lastKey,
    labelsOnTop: firstLabel > lastKey,
    sampleLabels: Array.prototype.slice.call(labels, 0, 10).map(function (l) { return l.textContent; }),
    viewBox: kb.getAttribute('viewBox')
  };
  check('每个音阶音都应有可见音名', labels.length > 0, 'labels=' + labels.length);
  check('音名必须画在高亮琴键之上（否则会被盖住）', firstLabel > lastKey,
    'firstLabel=' + firstLabel + ' lastKey=' + lastKey);
} else {
  check('音阶面板应渲染出钢琴键盘', false);
  out.scale.kb = null;
}

/* 三个下拉切换后标题/键盘应更新 */
['#sc-acc', '#sc-step', '#sc-mode'].forEach(function (sel) {
  var el = document.querySelector(sel);
  if (!el) { check(sel + ' 应存在', false); return; }
  var before = (document.querySelector('#sc-title') || {}).textContent;
  var opts = el.querySelectorAll('option');
  if (opts.length > 1) {
    el.value = opts[1].value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var after = (document.querySelector('#sc-title') || {}).textContent;
  out.scale[sel] = { before: before, after: after, changed: before !== after };
  check('切换 ' + sel + ' 后调名应更新', before !== after, before + ' → ' + after);
});

out.problems = problems;
out.pass = problems.length === 0;
return out;
