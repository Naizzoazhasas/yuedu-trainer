/* 读谱训练器 — 自定义音型（节奏型）库
 * 全局命名空间：window.APP.library
 * 依赖：APP.util、APP.generator（可选 APP.theory、APP.engine）
 *
 * Pattern（严格按契约第 1 / 第 4 节）：
 *   { id, name, time: { num, den }, items: [{ dur, dotted, rest }, ...] }
 * dur 是「时值倒数标记」：4=全音符, 2=二分, 1=四分, 0.5=八分, 0.25=十六分。
 * 拍数一律走 APP.util.beatsOf(dur, dotted) / APP.generator.patternBeats，不自己写除法。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var G = APP.generator;

  var STORAGE_KEY = 'yuedu.customPatterns';
  var ACTIVE_KEY = 'yuedu.activePatterns';

  /* ---------------- 内置节奏型（拍数必须精确等于 num * (4/den)） ---------------- */

  function IT(dur, dotted, rest) { return { dur: dur, dotted: !!dotted, rest: !!rest }; }

  var BUILTINS = [
    /* —— 4/4（4 拍）—— */
    { id: 'b-whole-44', name: '全音符', time: { num: 4, den: 4 }, items: [IT(4)] },
    { id: 'b-half-44', name: '二分音符 ×2', time: { num: 4, den: 4 }, items: [IT(2), IT(2)] },
    { id: 'b-quarter-44', name: '四分音符 ×4', time: { num: 4, den: 4 }, items: [IT(1), IT(1), IT(1), IT(1)] },
    { id: 'b-dotq8-44', name: '附点四分 + 八分 ×2', time: { num: 4, den: 4 }, items: [IT(1, true), IT(0.5), IT(1, true), IT(0.5)] },
    { id: 'b-sync-44', name: '切分（八分 + 四分 ×3 + 八分）', time: { num: 4, den: 4 }, items: [IT(0.5), IT(1), IT(1), IT(1), IT(0.5)] },
    { id: 'b-16th-44', name: '十六分四连 + 四分 + 二分', time: { num: 4, den: 4 }, items: [IT(0.25), IT(0.25), IT(0.25), IT(0.25), IT(1), IT(2)] },
    { id: 'b-rest-44', name: '二分 + 四分休止 + 四分', time: { num: 4, den: 4 }, items: [IT(2), IT(1, false, true), IT(1)] },
    /* —— 3/4（3 拍）—— */
    { id: 'b-two8q-34', name: '两个八分 + 两个四分', time: { num: 3, den: 4 }, items: [IT(0.5), IT(0.5), IT(1), IT(1)] },
    { id: 'b-waltz-34', name: '圆舞曲（四分 ×3）', time: { num: 3, den: 4 }, items: [IT(1), IT(1), IT(1)] },
    { id: 'b-halfdot-34', name: '附点二分音符', time: { num: 3, den: 4 }, items: [IT(2, true)] },
    { id: 'b-qqr-34', name: '四分 + 四分休止 + 四分', time: { num: 3, den: 4 }, items: [IT(1), IT(1, false, true), IT(1)] },
    /* —— 2/4（2 拍）—— */
    { id: 'b-march-24', name: '进行曲（四分 ×2）', time: { num: 2, den: 4 }, items: [IT(1), IT(1)] },
    { id: 'b-eight4-24', name: '四个八分', time: { num: 2, den: 4 }, items: [IT(0.5), IT(0.5), IT(0.5), IT(0.5)] },
    /* —— 6/8（6 × 4/8 = 3 拍）—— */
    { id: 'b-six8-even', name: '6/8 均分六个八分', time: { num: 6, den: 8 }, items: [IT(0.5), IT(0.5), IT(0.5), IT(0.5), IT(0.5), IT(0.5)] },
    { id: 'b-six8-two', name: '6/8 两大拍（附点四分 ×2）', time: { num: 6, den: 8 }, items: [IT(1, true), IT(1, true)] }
  ];

  /* ---------------- 状态 ---------------- */

  var custom = [];        /* 用户自定义（持久化） */
  var activeIds = null;   /* null = 全部参用生成；数组 = 显式勾选 */
  var listeners = [];

  function beatsOf(dur, dotted) {
    if (U && typeof U.beatsOf === 'function') return U.beatsOf(dur, dotted);
    return 0;
  }
  function patternBeats(items) {
    if (G && typeof G.patternBeats === 'function') return G.patternBeats(items);
    return (items || []).reduce(function (s, it) { return s + beatsOf(it.dur, it.dotted); }, 0);
  }
  function barBeats(time) {
    if (G && typeof G.barBeats === 'function') return G.barBeats(time);
    if (G && typeof G.beatsPerWholeOf === 'function') return time.num * G.beatsPerWholeOf(time.den);
    return time.num * (4 / time.den);
  }
  function clone(p) { return U.deepClone(p); }

  function validTime(t) {
    var num = Number(t && t.num), den = Number(t && t.den);
    if (!isFinite(num) || !isFinite(den) || num <= 0 || den <= 0) return { num: 4, den: 4 };
    return { num: Math.round(num), den: Math.round(den) };
  }

  function sanitizeItem(it) {
    if (!it) return null;
    var dur = Number(it.dur);
    if (!isFinite(dur) || dur <= 0) return null;
    return { dur: dur, dotted: !!it.dotted, rest: !!it.rest };
  }

  /* 补全 Pattern 的 id / name / time，过滤非法时值 */
  function sanitizePattern(p, fallbackTime) {
    p = p || {};
    var items = (p.items || []).map(sanitizeItem).filter(Boolean);
    var id = typeof p.id === 'string' && p.id ? p.id : newId();
    var name = typeof p.name === 'string' && p.name ? p.name : '自定义节奏型';
    var time = validTime(p.time || fallbackTime || { num: 4, den: 4 });
    return { id: id, name: name, time: time, items: items };
  }

  function newId() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readCustom() {
    var raw = U.load(STORAGE_KEY, []);
    if (!Array.isArray(raw)) raw = [];
    custom = raw.map(function (p) { return sanitizePattern(p, null); });
  }

  function readActive() {
    var raw = U.load(ACTIVE_KEY, null);
    if (Array.isArray(raw)) {
      activeIds = raw.filter(function (x) { return typeof x === 'string'; });
    } else {
      activeIds = null;
    }
  }

  function saveCustom() { U.save(STORAGE_KEY, custom); }
  function saveActive() {
    if (activeIds === null) { try { localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* 忽略 */ } }
    else U.save(ACTIVE_KEY, activeIds);
  }

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* 订阅者出错不影响主流程 */ }
    });
  }

  /* ---------------- 查询 ---------------- */

  function builtins() { return U.deepClone(BUILTINS); }
  function customs() { return U.deepClone(custom); }
  function all() { return builtins().concat(customs()); }

  function byId(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function isBuiltin(id) {
    return BUILTINS.some(function (b) { return b.id === id; });
  }

  /* ---------------- 增删改 ---------------- */

  function add(pattern) {
    var p = sanitizePattern(pattern, { num: 4, den: 4 });
    if (!p.items.length) {
      if (U.toast) U.toast('节奏型为空，无法保存', 'warn');
      return null;
    }
    /* 自定义 id 与内置/已有冲突时重新分配 */
    var taken = {};
    all().forEach(function (x) { taken[x.id] = 1; });
    if (taken[p.id]) p.id = newId();
    custom.push(p);
    if (activeIds !== null && activeIds.indexOf(p.id) < 0) activeIds.push(p.id);
    saveCustom(); saveActive(); emit();
    return clone(p);
  }

  function remove(id) {
    if (!isBuiltin(id)) {
      var n = custom.length;
      custom = custom.filter(function (p) { return p.id !== id; });
      if (custom.length === n) return false;
      if (activeIds !== null) activeIds = activeIds.filter(function (x) { return x !== id; });
      saveCustom(); saveActive(); emit();
      return true;
    }
    return false;
  }

  function rename(id, name) {
    var nm = String(name === undefined || name === null ? '' : name).trim();
    if (!nm) return false;
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i].name = nm;
        saveCustom(); emit();
        return true;
      }
    }
    return false;
  }

  function clear() {
    custom = [];
    if (activeIds !== null) {
      var builtinIds = {};
      BUILTINS.forEach(function (b) { builtinIds[b.id] = 1; });
      activeIds = activeIds.filter(function (x) { return builtinIds[x]; });
    }
    saveCustom(); saveActive(); emit();
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* ---------------- 参与生成的选择 ---------------- */

  function getActive() {
    var list = all();
    if (activeIds === null) return list;
    var set = {};
    activeIds.forEach(function (x) { set[x] = 1; });
    return list.filter(function (p) { return set[p.id]; });
  }

  function setActive(ids) {
    if (!Array.isArray(ids)) return;
    var seen = {};
    activeIds = ids.filter(function (x) {
      if (typeof x !== 'string' || seen[x]) return false;
      seen[x] = 1; return true;
    });
    saveActive(); emit();
  }

  function toggleActive(id) {
    if (activeIds === null) activeIds = all().map(function (p) { return p.id; });
    var i = activeIds.indexOf(id);
    if (i >= 0) activeIds.splice(i, 1); else activeIds.push(id);
    saveActive(); emit();
    return i < 0;
  }

  function isActiveId(id) { return getActive().some(function (p) { return p.id === id; }); }

  /* ---------------- 预览与试听 ---------------- */

  /* 时值 -> 图形符号（契约建议：四分 ■、八分 ▬、十六分 ▪、休止 0） */
  function glyphOf(item) {
    if (item.rest) return '0';
    var d = Number(item.dur);
    if (d >= 4) return '█';
    if (d === 2) return '▓';
    if (d === 1) return '■';
    if (d === 0.5) return '▬';
    if (d === 0.25) return '▪';
    return '·';
  }

  function durLabel(dur, dotted) {
    var list = (G && G.DURATION_LIST) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].dur === dur && !!list[i].dotted === !!dotted) return list[i].label;
    }
    return '时值 ' + dur + (dotted ? '（附点）' : '');
  }

  /* 按拍分组：累加到 ≥1 拍就断一组 */
  function groupByBeat(items) {
    var groups = [], cur = [], acc = 0;
    (items || []).forEach(function (it) {
      cur.push(it);
      acc += beatsOf(it.dur, it.dotted);
      if (acc >= 1 - 1e-9) { groups.push(cur); cur = []; acc = 0; }
    });
    if (cur.length) groups.push(cur);
    return groups;
  }

  function buildPreview(pattern) {
    var wrap = U.el('div', { class: 'lib-preview', title: '拍数 ' + fmtBeats(patternBeats(pattern.items)) });
    groupByBeat(pattern.items).forEach(function (group) {
      var g = U.el('div', { class: 'lib-beat-group' });
      group.forEach(function (it) {
        var b = beatsOf(it.dur, it.dotted);
        var cell = U.el('span', {
          class: 'lib-cell lib-cell-' + cellKind(it),
          title: (it.rest ? '休止 ' : '') + durLabel(it.dur, it.dotted) + '（' + fmtBeats(b) + ' 拍）'
        }, glyphOf(it) + (it.dotted && !it.rest ? '·' : ''));
        cell.style.setProperty('flex', String(Math.max(0.25, b)));
        g.appendChild(cell);
      });
      wrap.appendChild(g);
    });
    return wrap;
  }

  function cellKind(it) {
    if (it.rest) return 'rest';
    var d = Number(it.dur);
    if (d >= 4) return 'whole';
    if (d === 2) return 'half';
    if (d === 1) return 'quarter';
    if (d === 0.5) return 'eighth';
    if (d === 0.25) return 'sixteenth';
    return 'tiny';
  }

  function fmtBeats(b) {
    return Math.abs(b - Math.round(b)) < 1e-9 ? String(Math.round(b)) : String(Math.round(b * 1000) / 1000);
  }

  /* Pattern -> 临时 Score（只含该小节，mode='rhythm'），交给 engine.playScore 试听 */
  function patternToScore(pattern, tempo) {
    var TH = APP.theory;
    var pitch = { step: 'C', acc: 0, oct: 4 };
    var midi = (TH && TH.midiOf) ? TH.midiOf(pitch) : 60;
    var pos = (TH && TH.staffPos) ? TH.staffPos(pitch, 'treble') : -2;
    var notes = (pattern.items || []).map(function (it) {
      var rest = !!it.rest;
      return {
        pitch: rest ? null : pitch,
        dur: it.dur,
        dotted: !!it.dotted,
        tie: false,
        midi: rest ? null : midi,
        pos: rest ? 0 : pos
      };
    });
    return {
      key: { tonic: 0, mode: 'major', fifths: 0 },
      time: { num: pattern.time.num, den: pattern.time.den },
      tempo: tempo,
      clef: 'treble',
      title: pattern.name || '节奏型试听',
      mode: 'rhythm',
      bars: [{ notes: notes, beats: patternBeats(pattern.items) }]
    };
  }

  /* ---------------- UI ---------------- */

  function mount(container, opts) {
    opts = opts || {};
    var state = {
      time: { num: 4, den: 4 },
      total: 4,
      items: [],
      restNext: false,
      auditionTr: null
    };
    if (!container || !U.el) return { refresh: function () {} };

    var root = U.el('div', { class: 'lib-root card' });
    var listHost = U.el('div', { class: 'lib-list' });
    var toolbar = U.el('div', { class: 'lib-toolbar row' });
    var editorHost = U.el('div', { class: 'lib-editor' });

    U.clear(container);
    container.appendChild(root);
    root.appendChild(U.el('div', { class: 'card-title' }, '音型库'));
    root.appendChild(toolbar);
    root.appendChild(listHost);
    root.appendChild(editorHost);

    /* —— 顶部工具栏 —— */
    var btnAll = U.el('button', { class: 'btn small', text: '全部参用', on: { click: function () { setActive(all().map(function (p) { return p.id; })); } } });
    var btnNone = U.el('button', { class: 'btn small', text: '全部不参用', on: { click: function () { setActive([]); } } });
    var btnClear = U.el('button', { class: 'btn ghost small', text: '清空自定义', on: { click: function () { onClearCustom(); } } });
    toolbar.appendChild(btnAll);
    toolbar.appendChild(btnNone);
    toolbar.appendChild(btnClear);

    function onClearCustom() {
      if (!custom.length) { U.toast('还没有自定义节奏型', 'info'); return; }
      U.modal('清空自定义节奏型', U.el('div', { class: 'hint' }, '将删除全部自定义节奏型（内置库不受影响），确定吗？'), [
        { label: '取消' },
        { label: '清空', kind: 'primary', onClick: function () { clear(); U.toast('已清空自定义节奏型', 'ok'); } }
      ]);
    }

    /* —— 列表 —— */
    function renderList() {
      U.clear(listHost);
      var list = all();
      var activeSet = {};
      getActive().forEach(function (p) { activeSet[p.id] = 1; });

      listHost.appendChild(U.el('div', { class: 'lib-section-title' }, '全部音型（' + list.length + ' 条，参用 ' + Object.keys(activeSet).length + ' 条）'));

      list.forEach(function (p) {
        var item = U.el('div', { class: 'lib-item', data: { 'pattern-id': p.id } });
        var head = U.el('div', { class: 'lib-item-head' });
        var nameEl = U.el('div', { class: 'lib-name', text: p.name });
        head.appendChild(nameEl);
        head.appendChild(U.el('span', { class: 'badge lib-time', text: p.time.num + '/' + p.time.den }));
        head.appendChild(U.el('span', { class: 'hint lib-beats', text: '共 ' + fmtBeats(patternBeats(p.items)) + ' 拍' }));
        if (isBuiltin(p.id)) head.appendChild(U.el('span', { class: 'chip lib-builtin-tag', text: '内置' }));
        item.appendChild(head);

        item.appendChild(buildPreview(p));

        var actions = U.el('div', { class: 'lib-actions' });
        var cb = U.el('input', { type: 'checkbox', class: 'lib-active', checked: !!activeSet[p.id] });
        cb.addEventListener('change', function () { toggleActive(p.id); });
        actions.appendChild(U.el('label', { class: 'lib-check' }, cb, '参用生成'));

        if (isBuiltin(p.id)) {
          actions.appendChild(U.el('button', { class: 'btn ghost small', text: '重命名', disabled: true, title: '内置节奏型不可重命名' }));
          actions.appendChild(U.el('button', { class: 'btn ghost small', text: '删除', disabled: true, title: '内置节奏型不可删除' }));
        } else {
          actions.appendChild(U.el('button', {
            class: 'btn ghost small lib-btn-rename', text: '重命名',
            on: { click: function () { startRename(p, nameEl); } }
          }));
          actions.appendChild(U.el('button', {
            class: 'btn ghost small lib-btn-del', text: '删除',
            on: { click: function () { if (remove(p.id)) U.toast('已删除「' + p.name + '」', 'ok'); } }
          }));
        }
        actions.appendChild(U.el('button', {
          class: 'btn small lib-btn-audition', text: '试听',
          on: { click: function () { auditionPattern(p); } }
        }));
        item.appendChild(actions);
        listHost.appendChild(item);
      });
    }

    /* 就地重命名：Enter 提交，Esc 取消，失焦提交 */
    function startRename(p, nameEl) {
      var input = U.el('input', { class: 'lib-name-input', type: 'text', value: p.name });
      var done = false;
      function commit(ok) {
        if (done) return;
        done = true;
        var v = String(input.value || '').trim();
        if (ok && v && v !== p.name) rename(p.id, v);
        else renderList();
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
      });
      input.addEventListener('blur', function () { commit(true); });
      nameEl.textContent = '';
      nameEl.appendChild(input);
      if (input.focus) input.focus();
      if (input.select) input.select();
    }

    /* —— 新建 / 录制编辑器 —— */
    function editorBarBeats() { return barBeats(state.time); }
    function editorFilled() { return patternBeats(state.items); }

    var timeSel = U.el('select', { class: 'lib-editor-time' });
    ((G && G.TIME_SIGNATURES) || [{ num: 4, den: 4, label: '4/4' }]).forEach(function (t) {
      timeSel.appendChild(U.el('option', { value: t.num + '/' + t.den, text: '拍号 ' + t.label }));
    });
    timeSel.addEventListener('change', function () {
      var parts = String(timeSel.value).split('/');
      state.time = { num: Number(parts[0]) || 4, den: Number(parts[1]) || 4 };
      state.total = editorBarBeats();
      if (beatsInput) beatsInput.value = String(state.total);
      renderEditor();
    });

    var beatsInput = U.el('input', { class: 'lib-editor-beats', type: 'number', min: '1', step: '0.5', value: String(state.total) });
    beatsInput.addEventListener('change', function () {
      var v = Number(beatsInput.value);
      if (!isFinite(v) || v <= 0) v = editorBarBeats();
      state.total = Math.round(v * 1000) / 1000;
      renderEditor();
    });

    var nameInput = U.el('input', { class: 'lib-name-input', type: 'text', value: '' });
    nameInput.setAttribute('placeholder', '节奏型名称（可留空）');

    var restToggle = U.el('input', { type: 'checkbox', class: 'lib-rest-next' });
    restToggle.addEventListener('change', function () { state.restNext = !!restToggle.checked; });

    var timeline = U.el('div', { class: 'lib-timeline' });
    var fillStatus = U.el('div', { class: 'lib-fill-status' });

    var saveBtn = U.el('button', { class: 'btn primary small lib-save-btn', text: '保存到我的音型库', on: { click: onSave } });
    var auditionBtn = U.el('button', { class: 'btn small lib-audition-btn', text: '试听', on: { click: function () { auditionItems(); } } });
    var undoBtn = U.el('button', { class: 'btn ghost small lib-undo-btn', text: '撤销一位', on: { click: function () { state.items.pop(); renderEditor(); } } });
    var clearBtn = U.el('button', { class: 'btn ghost small lib-clear-btn', text: '清空时间轴', on: { click: function () { state.items = []; renderEditor(); } } });

    function onSave() {
      if (Math.abs(editorFilled() - state.total) > 1e-9) {
        U.toast('还没填满小节：已填 ' + fmtBeats(editorFilled()) + ' / 共 ' + fmtBeats(state.total) + ' 拍', 'warn');
        return;
      }
      var nm = String(nameInput.value || '').trim() || ('自定义 ' + state.time.num + '/' + state.time.den + '（' + fmtBeats(editorFilled()) + ' 拍）');
      var saved = add({ name: nm, time: state.time, items: state.items });
      if (!saved) return;
      nameInput.value = '';
      state.items = [];
      renderEditor();
      U.toast('已保存「' + saved.name + '」', 'ok');
    }

    /* 时值按钮：来自 generator.DURATION_LIST */
    var durBtns = U.el('div', { class: 'lib-dur-row chip-row' });
    ((G && G.DURATION_LIST) || []).forEach(function (d) {
      durBtns.appendChild(U.el('button', {
        class: 'chip lib-dur-btn',
        text: d.label + '（' + fmtBeats(beatsOf(d.dur, d.dotted)) + '拍）',
        on: {
          click: function () {
            state.items.push({ dur: d.dur, dotted: !!d.dotted, rest: !!state.restNext });
            renderEditor();
          }
        }
      }));
    });

    function renderEditor() {
      U.clear(editorHost);

      editorHost.appendChild(U.el('div', { class: 'lib-section-title' }, '新建 / 录制节奏型'));

      var setup = U.el('div', { class: 'lib-editor-setup row' });
      setup.appendChild(U.el('span', { class: 'label' }, '拍号'));
      setup.appendChild(timeSel);
      setup.appendChild(U.el('span', { class: 'label' }, '总拍数'));
      setup.appendChild(beatsInput);
      setup.appendChild(U.el('span', { class: 'hint' }, '（选择时值按钮，往时间轴追加音符）'));
      editorHost.appendChild(setup);

      var restRow = U.el('div', { class: 'row lib-rest-row' });
      restRow.appendChild(U.el('label', { class: 'lib-check' }, restToggle, '下一位为休止符'));
      restRow.appendChild(undoBtn);
      restRow.appendChild(clearBtn);
      restRow.appendChild(U.el('span', { class: 'hint lib-dur-hint' }, '点击时间轴上的方块可切换休止'));
      editorHost.appendChild(restRow);
      editorHost.appendChild(durBtns);

      /* 时间轴 */
      U.clear(timeline);
      if (!state.items.length) {
        timeline.appendChild(U.el('div', { class: 'hint' }, '时间轴为空：用上面的时值按钮添加音符'));
      } else {
        groupByBeat(state.items).forEach(function (group) {
          var g = U.el('div', { class: 'lib-beat-group' });
          group.forEach(function (it, gi) {
            var idx = state.items.indexOf(it);
            var cell = U.el('span', {
              class: 'lib-cell lib-cell-' + cellKind(it) + (it.rest ? ' is-rest' : ''),
              title: durLabel(it.dur, it.dotted) + '（点击切换休止）',
              on: { click: function () { if (idx >= 0) { state.items[idx].rest = !state.items[idx].rest; renderEditor(); } } }
            }, glyphOf(it) + (it.dotted && !it.rest ? '·' : ''));
            cell.style.setProperty('flex', String(Math.max(0.25, beatsOf(it.dur, it.dotted))));
            g.appendChild(cell);
          });
          timeline.appendChild(g);
        });
      }
      editorHost.appendChild(timeline);

      var filled = editorFilled();
      var diff = filled - state.total;
      var cls = Math.abs(diff) < 1e-9 ? 'is-exact' : (diff > 0 ? 'is-over' : 'is-under');
      U.clear(fillStatus);
      fillStatus.className = 'lib-fill-status ' + cls;
      fillStatus.appendChild(U.el('span', { text: '已填 ' + fmtBeats(filled) + ' / 共 ' + fmtBeats(state.total) + ' 拍' }));
      fillStatus.appendChild(U.el('span', {
        class: 'lib-fill-note',
        text: Math.abs(diff) < 1e-9 ? '✓ 正好填满' : (diff > 0 ? '超出 ' + fmtBeats(diff) + ' 拍' : '还差 ' + fmtBeats(-diff) + ' 拍')
      }));
      editorHost.appendChild(fillStatus);

      var ops = U.el('div', { class: 'row lib-editor-ops' });
      ops.appendChild(nameInput);
      ops.appendChild(saveBtn);
      ops.appendChild(auditionBtn);
      if (typeof opts.getCurrentBar === 'function') {
        ops.appendChild(U.el('button', { class: 'btn small lib-collect-btn', text: '从当前乐段采集', on: { click: onCollect } }));
      }
      editorHost.appendChild(ops);

      var noEngine = !engineOf();
      if (noEngine) {
        auditionBtn.setAttribute('disabled', 'disabled');
        ops.appendChild(U.el('span', { class: 'hint lib-engine-hint' }, '音频引擎不可用，无法试听'));
      } else if (state.auditionTr) {
        auditionBtn.textContent = '停止试听';
      } else {
        auditionBtn.textContent = '试听';
      }
      syncAuditionBtn();
      editorHost.appendChild(U.el('div', { class: 'lib-audition-status hint' }, state.auditionTr ? '正在试听…' : ''));
    }

    function onCollect() {
      var bar = null;
      try { bar = opts.getCurrentBar(); } catch (e) { bar = null; }
      if (!bar || !bar.notes || !bar.notes.length) { U.toast('当前没有可用的小节', 'warn'); return; }
      var p = G.derivePatternFromScore(bar);
      p.time = { num: state.time.num, den: state.time.den };
      p.name = '采集 ' + state.time.num + '/' + state.time.den + '（' + fmtBeats(patternBeats(p.items)) + ' 拍）';
      var saved = add(p);
      if (saved) U.toast('已从当前乐段采集「' + saved.name + '」', 'ok');
    }

    /* —— 试听 —— */
    function engineOf() {
      var e = opts.engine || APP.engine;
      return (e && typeof e.playScore === 'function') ? e : null;
    }

    function tempoOf() {
      if (typeof opts.getTempo === 'function') {
        try {
          var t = Number(opts.getTempo());
          if (isFinite(t) && t > 0) return t;
        } catch (e) { /* 忽略 */ }
      }
      return 80;
    }

    function auditionPattern(p) {
      var items = p.items;
      if (!items || !items.length) { U.toast('节奏型为空，无法试听', 'warn'); return; }
      auditionCore({ id: p.id, name: p.name, time: p.time, items: items });
    }

    function auditionItems() {
      if (!state.items.length) { U.toast('时间轴为空，无法试听', 'warn'); return; }
      auditionCore({ id: 'temp', name: '编辑器试听', time: state.time, items: state.items });
    }

    function auditionCore(pattern) {
      var eng = engineOf();
      if (!eng) { U.toast('音频引擎不可用，无法试听', 'warn'); return; }
      stopAudition();
      var tempo = tempoOf();
      try {
        if (eng.init) { try { eng.init(); } catch (e) { /* 忽略 */ } }
        if (eng.warmup) {
          try {
            var w = eng.warmup();
            if (w && typeof w.then === 'function') w.then(function () {}, function () {});
          } catch (e) { /* 忽略 */ }
        }
        state.auditionTr = eng.playScore(patternToScore(pattern, tempo), {
          metronome: false, timbre: 'clave', tempo: tempo,
          onEnd: function () { state.auditionTr = null; syncAuditionBtn(); }
        });
        var tr = state.auditionTr;
        if (tr && typeof tr.on === 'function') {
          tr.on('end', function () { state.auditionTr = null; syncAuditionBtn(); });
        }
      } catch (e) {
        state.auditionTr = null;
        U.toast('试听失败：' + (e && e.message ? e.message : '未知错误'), 'err');
      }
      syncAuditionBtn();
    }

    function stopAudition() {
      if (state.auditionTr && typeof state.auditionTr.stop === 'function') {
        try { state.auditionTr.stop(); } catch (e) { /* 忽略 */ }
      }
      state.auditionTr = null;
    }

    function syncAuditionBtn() {
      if (!auditionBtn) return;
      if (!engineOf()) { auditionBtn.setAttribute('disabled', 'disabled'); return; }
      auditionBtn.textContent = state.auditionTr ? '停止试听' : '试听';
    }

    /* —— 订阅与刷新 —— */
    var off = onChange(function () {
      renderList();
      if (typeof opts.onChange === 'function') {
        try { opts.onChange(); } catch (e) { /* 忽略 */ }
      }
    });

    renderList();
    renderEditor();

    return {
      root: root,
      refresh: function () { renderList(); renderEditor(); },
      builtins: builtins,
      custom: customs,
      destroy: function () {
        off();
        stopAudition();
        U.clear(container);
      }
    };
  }

  /* ---------------- 初始化 ---------------- */

  try {
    readCustom();
    readActive();
  } catch (e) { /* 启动阶段任何异常都不允许打断 */ }

  APP.library = {
    storageKey: STORAGE_KEY,
    activeKey: ACTIVE_KEY,
    all: all,
    builtins: builtins,
    custom: customs,
    add: add,
    remove: remove,
    rename: rename,
    clear: clear,
    onChange: onChange,
    getActive: getActive,
    setActive: setActive,
    toggleActive: toggleActive,
    isActive: isActiveId,
    get: byId,
    patternBeats: patternBeats,
    beatsOf: beatsOf,
    patternToScore: patternToScore,
    mount: mount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.library;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
