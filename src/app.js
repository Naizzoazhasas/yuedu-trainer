/* 读谱训练器 — 主程序
 * 全局命名空间：window.APP.app
 * 依赖（按 index.html 的加载顺序，全部可选，缺失时优雅降级）：
 *   util / theory / generator / renderer / jianpu / engine / tuner / instruments / export / library / ear / practice
 *
 * 职责：
 *   - 全局状态（localStorage 持久化）与「快速档位」预设
 *   - 所有控件的装配与事件绑定
 *   - 乐段生成、渲染、播放与高亮
 *   - 节拍器面板、调号音阶对照、移调工具、乐器音阶表、导出面板、统计与听辨的挂载
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;
  var G = APP.generator;
  var R = APP.renderer;
  var JP = APP.jianpu;

  var STATE_KEY = 'yuedu.state.v1';

  /* ---------------- 默认状态 ---------------- */

  function defaultState() {
    return {
      preset: 'beginner',
      mode: 'rhythm',
      bars: 4,
      tempo: 60,
      time: { num: 4, den: 4 },
      keyId: '0-major',
      clef: 'treble',
      durations: [1, 2],
      useDotted: false,
      useRests: false,
      useSyncopation: false,
      restRatio: 15,
      degrees: [1, 2, 3, 4, 5, 6, 7],
      lowOct: 4,
      highOct: 4,
      useChromatic: false,
      startOnTonic: false,
      display: 'both',
      renderer: 'auto',
      showName: false,
      showSolfa: true,
      jpFixed: false,
      usePatterns: false,
      seed: null
    };
  }

  var state = defaultState();
  var currentScore = null;
  var transport = null;
  var metro = null;
  var metroTimer = null;
  var practiceCtl = null;
  var lastSeedText = '';

  /* ---------------- 快速档位预设 ---------------- */

  var PRESETS = [
    {
      id: 'beginner', name: '入门', icon: '\u2460',
      hint: '只出现 1 2 3 4 级音、二分与四分音符、C 大调、60 PBM、无休止符',
      patch: {
        mode: 'rhythm', bars: 4, tempo: 60, time: { num: 4, den: 4 }, keyId: '0-major',
        durations: [1, 2], useDotted: false, useRests: false, useSyncopation: false,
        degrees: [1, 2, 3, 4], lowOct: 4, highOct: 4, useChromatic: false
      }
    },
    {
      id: 'basic', name: '初级', icon: '\u2461',
      hint: '1-5 级音、加入八分音符、G / F 大调也练',
      patch: {
        mode: 'melody', bars: 4, tempo: 72, durations: [1, 2, 0.5], useRests: true, restRatio: 10,
        degrees: [1, 2, 3, 4, 5], lowOct: 4, highOct: 4, useDotted: false, useSyncopation: false
      }
    },
    {
      id: 'medium', name: '中级', icon: '\u2462',
      hint: '完整七声音阶、附点与十六分音符、有休止符、含变化音',
      patch: {
        mode: 'melody', bars: 8, tempo: 88, durations: [1, 2, 0.5, 0.25], useDotted: true,
        useRests: true, restRatio: 15, useSyncopation: true, degrees: [1, 2, 3, 4, 5, 6, 7],
        lowOct: 4, highOct: 5, useChromatic: true
      }
    },
    {
      id: 'advanced', name: '高级', icon: '\u2463',
      hint: '复合拍号、密集十六分、切分、低音谱、更多调号',
      patch: {
        mode: 'melody', bars: 8, tempo: 108, time: { num: 6, den: 8 }, durations: [1, 0.5, 0.25],
        useDotted: true, useRests: true, restRatio: 20, useSyncopation: true,
        degrees: [1, 2, 3, 4, 5, 6, 7], lowOct: 3, highOct: 5, useChromatic: true, clef: 'bass'
      }
    },
    {
      id: 'rhythmonly', name: '纯节奏', icon: '\u25CB',
      hint: '固定单音，只练时值与节奏型（读谱基本功）',
      patch: {
        mode: 'rhythm', bars: 4, tempo: 80, durations: [1, 2, 0.5], useRests: true,
        useSyncopation: false, useDotted: false
      }
    }
  ];

  /* ---------------- 持久化 ---------------- */

  function loadState() {
    var saved = U.load(STATE_KEY, null);
    if (saved && typeof saved === 'object') {
      var def = defaultState();
      Object.keys(def).forEach(function (k) {
        if (saved[k] !== undefined) state[k] = saved[k];
      });
    }
  }
  function saveState() {
    U.save(STATE_KEY, state);
  }

  /* ---------------- 由状态构造生成器配置 ---------------- */

  function keyFromId(id) {
    var parts = String(id || '0-major').split('-');
    var tonic = parseInt(parts[0], 10) || 0;
    var mode = parts[1] === 'minor' ? 'minor' : 'major';
    return TH.normalizeKey({ tonic: tonic, mode: mode });
  }

  function buildConfig(overrides) {
    var cfg = {
      mode: state.mode,
      bars: state.bars,
      tempo: state.tempo,
      time: { num: state.time.num, den: state.time.den },
      key: keyFromId(state.keyId),
      clef: state.clef,
      seed: state.seed === null || state.seed === undefined ? undefined : state.seed,
      durations: state.durations.slice(),
      useDotted: state.useDotted,
      useRests: state.useRests,
      useSyncopation: state.useSyncopation,
      restRatio: state.restRatio / 100,
      degrees: state.degrees.slice(),
      range: { lowOct: state.lowOct, highOct: state.highOct },
      useChromatic: state.useChromatic,
      startOnTonic: state.startOnTonic,
      usePatterns: null,
      patternVariation: 0.35,
      leapRatio: 0.3
    };
    if (state.usePatterns && APP.library) {
      try {
        var active = APP.library.getActive();
        if (active && active.length) cfg.usePatterns = active;
      } catch (e) { /* 忽略 */ }
    }
    if (overrides) Object.keys(overrides).forEach(function (k) { cfg[k] = overrides[k]; });
    return cfg;
  }

  /* ---------------- 五线谱渲染后端选择 ---------------- */

  /* 解析「实际使用哪个后端」：
   *   auto     -> 有 VexFlow 就用 VexFlow，否则用内置自绘
   *   vexflow  -> 强制 VexFlow（不可用则回退内置，并提示）
   *   builtin  -> 强制内置自绘
   * 返回 { name, api, fallback } —— fallback 表示发生了降级 */
  function resolveRenderer() {
    var want = state.renderer || 'auto';
    var vfOk = !!(APP.vexrender && APP.vexrender.isAvailable && APP.vexrender.isAvailable());
    if (want === 'builtin') return { name: 'builtin', api: R, fallback: false };
    if (vfOk) return { name: 'vexflow', api: APP.vexrender, fallback: false };
    return { name: 'builtin', api: R, fallback: want === 'vexflow' };
  }

  function rendererLabel(name) {
    return name === 'vexflow' ? 'VexFlow' : '内置自绘';
  }

  /* ---------------- 生成与渲染 ---------------- */

  function regenerate(opts) {
    opts = opts || {};
    if (opts.tempo !== undefined) state.tempo = opts.tempo;
    /* 不指定 seed 时传入随机种子，保证同一次生成内部一致且可显示 */
    if (opts.seed !== undefined) state.seed = opts.seed;
    else if (state.seed === null) state.seed = Math.floor(Math.random() * 1e9);

    var t0 = Date.now();
    try {
      currentScore = G.generateScore(buildConfig());
    } catch (e) {
      U.toast('生成失败：' + (e && e.message ? e.message : e), 'err');
      return null;
    }
    renderCurrent();
    lastSeedText = String(state.seed);
    var seedEl = U.query('#gen-seed');
    if (seedEl) seedEl.textContent = 'seed ' + lastSeedText;
    var meta = U.query('#gen-meta');
    if (meta) {
      var st = G.scoreStats(currentScore);
      meta.textContent = TH.keyName(currentScore.key) + ' · ' +
        currentScore.time.num + '/' + currentScore.time.den + ' · ' +
        state.tempo + ' PBM · ' + st.noteCount + ' 音' +
        (st.restCount ? ' / ' + st.restCount + ' 休' : '');
    }
    if (opts.quiet !== true) {
      var ms = Date.now() - t0;
      if (ms > 120) U.toast('已生成（' + ms + 'ms）', 'ok');
    }
    /* 若练习模块在跑，跟着换谱 */
    return currentScore;
  }

  function renderCurrent() {
    var disp = state.display;
    var staffHost = U.query('#gen-staff-host');
    var jpHost = U.query('#gen-jianpu-host');
    if (!staffHost || !jpHost) return;
    var subText = state.showName && state.showSolfa ? 'both' : (state.showName ? 'name' : (state.showSolfa ? 'solfa' : false));

    var pick = resolveRenderer();
    try {
      if (disp === 'staff' || disp === 'both') {
        staffHost.style.display = '';
        var res = pick.api.renderScoreInto(staffHost, currentScore, {
          width: 940, showBarNumbers: true, showSubText: subText
        });
        /* 如果 VexFlow 中途失败，立即用内置渲染器兜一次，保证用户一定看到谱 */
        if (pick.name === 'vexflow' && res && res.error) {
          U.toast('VexFlow 渲染出错，已自动切换内置渲染器', 'warn');
          R.renderScoreInto(staffHost, currentScore, {
            width: 940, showBarNumbers: true, showSubText: subText
          });
        }
      } else {
        staffHost.style.display = 'none';
        U.clear(staffHost);
      }
    } catch (e) {
      /* 渲染失败不打断：退回内置渲染器 */
      try {
        R.renderScoreInto(staffHost, currentScore, { width: 940, showBarNumbers: true, showSubText: subText });
      } catch (e2) { /* 忽略 */ }
    }

    /* 渲染引擎状态提示 */
    var hint = U.query('#gen-renderer-hint');
    if (hint) {
      if (pick.fallback) hint.textContent = '（VexFlow 未加载，已用内置自绘）';
      else hint.textContent = '（当前：' + rendererLabel(pick.name) + '）';
    }

    try {
      if (disp === 'jianpu' || disp === 'both') {
        jpHost.style.display = '';
        JP.renderInto(jpHost, currentScore, {
          mode: state.jpFixed ? 'fixed' : 'relative',
          showSolfa: state.showSolfa,
          showNoteName: state.showName
        });
      } else {
        jpHost.style.display = 'none';
        U.clear(jpHost);
      }
    } catch (e) { /* 忽略 */ }
  }

  /* 播放高亮：VexFlow 与内置后端的 API 形状一致，直接按当前后端调用 */
  function hl(pick, kind, sheet, bar, note) {
    try {
      if (kind === 'note' && pick.api.highlightNote) pick.api.highlightNote(sheet, bar, note);
      else if (kind === 'bar' && pick.api.highlightBar) pick.api.highlightBar(sheet, bar);
      else if (kind === 'clear' && pick.api.clearHighlight) pick.api.clearHighlight(sheet);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 播放 ---------------- */

  function ensureAudio() {
    if (!APP.engine) return false;
    try { APP.engine.init(); } catch (e) { /* 忽略 */ }
    return true;
  }

  function setPlaying(on) {
    var play = U.query('#gen-play');
    var stopBtn = U.query('#gen-stop');
    var bar = U.query('#gen-playbar');
    if (play) play.disabled = on;
    if (stopBtn) stopBtn.disabled = !on;
    if (bar) bar.style.display = on ? '' : 'none';
    var badge = U.query('#hdr-audio');
    if (badge) {
      var st = APP.engine && APP.engine.state ? APP.engine.state() : '无引擎';
      badge.textContent = on ? '正在播放' : (st === 'running' ? '音频就绪' : '音频未启动');
      badge.className = 'badge ' + (st === 'running' ? 'ok' : '');
    }
  }

  function stopPlayback() {
    if (practiceCtl) { try { practiceCtl.stop(); } catch (e) { /* 忽略 */ } }
    if (transport) { try { transport.stop(); } catch (e) { /* 忽略 */ } }
    transport = null;
    var sheet = U.query('#gen-sheet');
    hl(resolveRenderer(), 'clear', sheet);
    setPlaying(false);
  }

  function playScore(withMetronome) {
    if (!currentScore) return;
    if (!ensureAudio()) { U.toast('音频引擎未加载', 'err'); return; }
    stopPlayback();
    var sheet = U.query('#gen-sheet');
    var pick = resolveRenderer();
    var totalNotes = currentScore.bars.reduce(function (a, b) { return a + b.notes.length; }, 0);
    var curBar = -1, curNote = -1;
    var done = 0;

    try {
      transport = APP.engine.playScore(currentScore, {
        tempo: state.tempo,
        metronome: !!withMetronome,
        countIn: 0,
        timbre: state.mode === 'rhythm' ? 'clave' : 'piano',
        onBar: function (bar) {
          curBar = bar;
          hl(pick, 'bar', sheet, bar);
          var prog = U.query('#gen-progress');
          if (prog) prog.textContent = '第 ' + (bar + 1) + ' / ' + currentScore.bars.length + ' 小节';
        },
        onNote: function (i, bar, note, info) {
          if (info && info.isRest) return;
          curNote = info && info.index !== undefined ? info.index : 0;
          hl(pick, 'note', sheet, bar, curNote);
          done++;
        },
        onEnd: function () {
          transport = null;
          hl(pick, 'clear', sheet);
          setPlaying(false);
          U.toast('播放结束', 'ok');
          try { practiceCtl && practiceCtl.onPlaybackEnd && practiceCtl.onPlaybackEnd(); } catch (e) { /* 忽略 */ }
        }
      });
      setPlaying(true);
      var prog2 = U.query('#gen-progress');
      if (prog2) prog2.textContent = '准备播放 ' + currentScore.bars.length + ' 小节…';
      var ct = U.query('#gen-curtempo');
      if (ct) ct.textContent = state.tempo + ' PBM';
    } catch (e) {
      U.toast('播放失败：' + (e && e.message ? e.message : e), 'err');
      setPlaying(false);
    }
  }

  /* ---------------- 速度（PBM）----------------
   * 用户可以拖滑块，也可以**直接在数字框里输入**。
   * 两个控件共用 applyTempo 保持同步，并显示对应的意大利术语。 */

  /* BPM -> 意大利术语（教学上很有用） */
  function tempoWord(bpm) {
    if (bpm < 40) return '庄板 Grave';
    if (bpm < 60) return '广板 Largo';
    if (bpm < 66) return '慢板 Larghetto';
    if (bpm < 76) return '柔板 Adagio';
    if (bpm < 108) return '行板 Andante';
    if (bpm < 120) return '小行板 Moderato';
    if (bpm < 156) return '快板 Allegro';
    if (bpm < 176) return '活泼的快板 Vivace';
    if (bpm < 200) return '急板 Presto';
    return '最急板 Prestissimo';
  }

  /* 统一的设速入口：同步 state / 滑块 / 数字框 / 术语 / 播放中的节拍器 */
  function applyTempo(bpm, opts) {
    opts = opts || {};
    bpm = Math.round(U.clamp(Number(bpm) || 60, 30, 240));
    state.tempo = bpm;

    var slider = U.query('#gen-tempo');
    if (slider) slider.value = String(bpm);
    var num = U.query('#gen-tempo-num');
    if (num) num.value = String(bpm);

    var w = U.query('#gen-tempo-word');
    if (w) w.textContent = bpm + ' · ' + tempoWord(bpm);
    var ct = U.query('#gen-curtempo');
    if (ct) ct.textContent = bpm + ' PBM';

    if (transport && transport.setTempo) {
      try { transport.setTempo(bpm); } catch (e) { /* 忽略 */ }
    }
    try { if (metro && metro.isRunning && metro.isRunning()) metro.setTempo(bpm); } catch (e) { /* 忽略 */ }
    if (!opts.quiet) saveState();
    return bpm;
  }

  function nudgeTempo(delta) {
    applyTempo(state.tempo + delta);
  }

  /* ---------------- 侧栏控件装配 ---------------- */

  function chipRow(host, items, isActive, onToggle, extraClass) {
    if (!host) return;
    U.clear(host);
    items.forEach(function (item) {
      var b = U.el('button', {
        class: 'chip' + (isActive(item) ? ' active' : '') + (extraClass ? ' ' + extraClass : ''),
        type: 'button',
        on: {
          click: function () {
            onToggle(item);
            saveState();
          }
        }
      });
      b.appendChild(document.createTextNode(item.label));
      if (item.sub) b.appendChild(U.el('span', { class: 'sub', text: item.sub }));
      host.appendChild(b);
    });
  }

  function buildSidebar() {
    /* 预设 */
    var presetHost = U.query('#gen-presets');
    if (presetHost) {
      U.clear(presetHost);
      PRESETS.forEach(function (p) {
        var b = U.el('button', {
          class: 'chip' + (state.preset === p.id ? ' active' : ''),
          type: 'button',
          on: {
            click: function () {
              state.preset = p.id;
              Object.keys(p.patch).forEach(function (k) {
                if (k === 'time') state.time = { num: p.patch.time.num, den: p.patch.time.den };
                else state[k] = p.patch[k];
              });
              saveState();
              syncControls();
              regenerate();
              U.toast('已切换到「' + p.name + '」档位', 'ok');
            }
          }
        });
        b.appendChild(document.createTextNode(p.icon + ' ' + p.name));
        presetHost.appendChild(b);
      });
      var cur = PRESETS.filter(function (p) { return p.id === state.preset; })[0];
      var hint = U.query('#gen-preset-hint');
      if (hint) hint.textContent = cur ? cur.hint : '';
    }

    /* 拍号 */
    var timeSel = U.query('#gen-time');
    if (timeSel) {
      U.clear(timeSel);
      G.TIME_SIGNATURES.forEach(function (t) {
        timeSel.appendChild(U.el('option', {
          value: t.num + '/' + t.den, text: t.label,
          selected: state.time.num === t.num && state.time.den === t.den
        }));
      });
      timeSel.onchange = function () {
        var p = timeSel.value.split('/');
        state.time = { num: parseInt(p[0], 10), den: parseInt(p[1], 10) };
        saveState(); regenerate();
      };
    }

    /* 调号 */
    var keySel = U.query('#gen-key');
    if (keySel) {
      U.clear(keySel);
      TH.allKeys().forEach(function (k) {
        var id = k.tonic + '-' + k.mode;
        keySel.appendChild(U.el('option', { value: id, text: k.name, selected: state.keyId === id }));
      });
      keySel.onchange = function () { state.keyId = keySel.value; saveState(); regenerate(); };
    }

    /* 八度 */
    ['#gen-lowoct', '#gen-highect'].forEach(function (sel, idx) {
      var s = U.query(sel);
      if (!s) return;
      U.clear(s);
      ['#gen-lowoct', '#gen-highect'];
      for (var o = 2; o <= 6; o++) {
        var isLow = idx === 0;
        var val = isLow ? state.lowOct : state.highOct;
        s.appendChild(U.el('option', { value: String(o), text: '第 ' + o + ' 八度', selected: val === o }));
      }
      s.onchange = function () {
        var v = parseInt(s.value, 10);
        if (idx === 0) { state.lowOct = v; if (state.highOct < v) state.highOct = v; }
        else { state.highOct = v; if (state.lowOct > v) state.lowOct = v; }
        saveState(); syncControls(); regenerate();
      };
    });
  }

  /* 把 state 同步到所有控件（预设切换 / 载入后调用） */
  function syncControls() {
    function setVal(sel, v) { var e = U.query(sel); if (e) e.value = String(v); }
    function setChk(sel, v) { var e = U.query(sel); if (e) e.checked = !!v; }
    setVal('#gen-mode', state.mode);
    setVal('#gen-bars', state.bars);
    /* 速度：滑块、数字框、术语统一由 applyTempo 同步 */
    applyTempo(state.tempo, { quiet: true });
    setVal('#gen-time', state.time.num + '/' + state.time.den);
    setVal('#gen-key', state.keyId);
    setVal('#gen-clef', state.clef);
    setChk('#gen-dotted', state.useDotted);
    setChk('#gen-rests', state.useRests);
    setChk('#gen-sync', state.useSyncopation);
    setVal('#gen-restratio', state.restRatio);
    var rv = U.query('#gen-restratio-val'); if (rv) rv.textContent = state.restRatio + '%';
    setChk('#gen-chromatic', state.useChromatic);
    setChk('#gen-starttonic', state.startOnTonic);
    setChk('#gen-showname', state.showName);
    setChk('#gen-showsolfa', state.showSolfa);
    setChk('#gen-jpfixed', state.jpFixed);
    setVal('#gen-lowoct', state.lowOct);
    setVal('#gen-highect', state.highOct);

    state.durations = state.durations.filter(function (d) { return typeof d === 'number'; });

    chipRow(U.query('#gen-durations'), G.DURATION_LIST.map(function (d) {
      return { id: d.dur + '/' + d.dotted, dur: d.dur, dotted: d.dotted, label: d.label, sub: U.beatsOf(d.dur, d.dotted) + '拍' };
    }), function (it) {
      return state.durations.indexOf(it.dur) >= 0 && !!it.dotted === !!state.useDotted && !it.dotted;
    }, function (it) {
      if (it.dotted) { state.useDotted = !state.useDotted; syncControls(); regenerate(); return; }
      var i = state.durations.indexOf(it.dur);
      if (i >= 0) {
        if (state.durations.length <= 1) { U.toast('至少要保留一种时值', 'warn'); return; }
        state.durations.splice(i, 1);
      } else state.durations.push(it.dur);
      syncControls(); regenerate();
    });

    chipRow(U.query('#gen-degrees'), [1, 2, 3, 4, 5, 6, 7].map(function (d) {
      return { id: d, label: String(d), sub: TH.solfeggio(TH.scalePitches(keyFromId(state.keyId), 4, keyFromId(state.keyId).mode === 'minor' ? 'harmonic' : 'major')[d - 1], keyFromId(state.keyId)) };
    }), function (it) { return state.degrees.indexOf(it.id) >= 0; }, function (it) {
      var i = state.degrees.indexOf(it.id);
      if (i >= 0) {
        if (state.degrees.length <= 1) { U.toast('至少要保留一个音级', 'warn'); return; }
        state.degrees.splice(i, 1);
      } else state.degrees.push(it.id);
      state.degrees.sort(function (a, b) { return a - b; });
      syncControls(); regenerate();
    });

    chipRow(U.query('#gen-display'), [
      { id: 'staff', label: '五线谱' },
      { id: 'jianpu', label: '简谱' },
      { id: 'both', label: '两者都要' }
    ], function (it) { return state.display === it.id; }, function (it) {
      state.display = it.id; syncControls(); renderCurrent();
    });

    /* 五线谱渲染引擎选择 */
    var vfReady = !!(APP.vexrender && APP.vexrender.isAvailable && APP.vexrender.isAvailable());
    chipRow(U.query('#gen-renderer'), [
      { id: 'auto', label: '自动', sub: vfReady ? 'VexFlow' : '内置' },
      { id: 'vexflow', label: 'VexFlow', sub: vfReady ? '专业排版' : '未加载' },
      { id: 'builtin', label: '内置自绘', sub: '零依赖' }
    ], function (it) { return (state.renderer || 'auto') === it.id; }, function (it) {
      state.renderer = it.id; syncControls(); renderCurrent();
      if (it.id === 'vexflow' && !vfReady) U.toast('VexFlow 未加载，将使用内置自绘', 'warn');
    });

    var pc = U.query('#gen-pitch-card');
    if (pc) pc.style.display = state.mode === 'melody' ? '' : 'none';

    var libChip = U.query('#gen-usepatterns');
    if (libChip) libChip.checked = state.usePatterns;
  }

  function bindSidebarEvents() {
    function on(sel, ev, fn) { var e = U.query(sel); if (e) e.addEventListener(ev, fn); }

    on('#gen-mode', 'change', function (e) { state.mode = e.target.value; saveState(); syncControls(); regenerate(); });
    on('#gen-bars', 'change', function (e) {
      state.bars = U.clamp(parseInt(e.target.value, 10) || 4, 1, 32);
      e.target.value = String(state.bars); saveState(); regenerate();
    });
    /* 速度：滑块「拖动时」即时预览，「松手」重新生成；
     * 数字框支持直接键入，「回车 / 失焦」才生效（避免输到一半就被夹到边界）。 */
    on('#gen-tempo', 'input', function (e) {
      applyTempo(e.target.value, { quiet: true });
    });
    on('#gen-tempo', 'change', function (e) {
      applyTempo(e.target.value);
      regenerate();
    });
    var tempoNum = U.query('#gen-tempo-num');
    if (tempoNum) {
      tempoNum.addEventListener('input', function () {
        /* 输入过程中只做轻量同步，不动 state（可能是空串或半截数字） */
        var raw = parseInt(tempoNum.value, 10);
        if (isFinite(raw) && raw >= 30 && raw <= 240) {
          var slider = U.query('#gen-tempo');
          if (slider) slider.value = String(raw);
        }
      });
      tempoNum.addEventListener('change', function () {
        var raw = parseInt(tempoNum.value, 10);
        if (!isFinite(raw)) {
          tempoNum.value = String(state.tempo);      // 非法输入就还原
          U.toast('速度请输入 30–240 之间的整数', 'warn');
          return;
        }
        var bpm = applyTempo(raw);
        if (bpm !== raw) {
          U.toast('已限制到 ' + bpm + ' PBM（允许范围 30–240）', 'warn');
        }
        regenerate();
      });
      tempoNum.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); tempoNum.dispatchEvent(new Event('change')); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); applyTempo(state.tempo + 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); applyTempo(state.tempo - 1); }
      });
    }
    /* 常用速度一键设定 */
    var presetHost = U.query('#gen-tempo-presets');
    if (presetHost) {
      U.clear(presetHost);
      [40, 60, 72, 88, 100, 120, 144, 180].forEach(function (bpm) {
        presetHost.appendChild(U.el('button', {
          class: 'chip small', type: 'button', text: String(bpm),
          title: bpm + ' PBM · ' + tempoWord(bpm),
          on: {
            click: function () {
              applyTempo(bpm);
              syncControls();
              regenerate();
            }
          }
        }));
      });
    }
    on('#gen-clef', 'change', function (e) { state.clef = e.target.value; saveState(); regenerate(); });
    on('#gen-dotted', 'change', function (e) { state.useDotted = e.target.checked; saveState(); syncControls(); regenerate(); });
    on('#gen-rests', 'change', function (e) { state.useRests = e.target.checked; saveState(); regenerate(); });
    on('#gen-sync', 'change', function (e) { state.useSyncopation = e.target.checked; saveState(); regenerate(); });
    on('#gen-restratio', 'input', function (e) {
      state.restRatio = parseInt(e.target.value, 10) || 0;
      var v = U.query('#gen-restratio-val'); if (v) v.textContent = state.restRatio + '%';
    });
    on('#gen-restratio', 'change', function () { saveState(); regenerate(); });
    on('#gen-chromatic', 'change', function (e) { state.useChromatic = e.target.checked; saveState(); regenerate(); });
    on('#gen-starttonic', 'change', function (e) { state.startOnTonic = e.target.checked; saveState(); regenerate(); });
    on('#gen-showname', 'change', function (e) { state.showName = e.target.checked; saveState(); renderCurrent(); });
    on('#gen-showsolfa', 'change', function (e) { state.showSolfa = e.target.checked; saveState(); renderCurrent(); });
    on('#gen-jpfixed', 'change', function (e) { state.jpFixed = e.target.checked; saveState(); renderCurrent(); });

    on('#gen-new', 'click', function () { state.seed = Math.floor(Math.random() * 1e9); regenerate(); });
    on('#gen-play', 'click', function () { playScore(false); });
    on('#gen-playmetro', 'click', function () { playScore(true); });
    on('#gen-stop', 'click', stopPlayback);
    on('#gen-slower', 'click', function () { nudgeTempo(-5); });
    on('#gen-faster', 'click', function () { nudgeTempo(5); });
    on('#gen-records', 'click', function () {
      var m = U.modal('练习记录', '');
      if (APP.practice) {
        APP.practice.mountStats(m.body);
      } else {
        m.body.appendChild(U.el('div', { text: '练习模块未加载。' }));
      }
    });
  }

  /* ---------------- 标签页 ---------------- */

  var inited = {};

  function switchTab(id) {
    U.queryAll('#tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === id);
    });
    U.queryAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-panel') === id);
    });
    if (!inited[id]) { inited[id] = true; initPanel(id); }
  }

  function initPanel(id) {
    try {
      if (id === 'metro') initMetronome();
      else if (id === 'tuner') initTuner();
      else if (id === 'scale') { initScale(); initTranspose(); }
      else if (id === 'inst') initInstruments();
      else if (id === 'ear') initEar();
      else if (id === 'lib') initLibrary();
    } catch (e) {
      U.toast('该面板初始化失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  /* ---------------- 节拍器 ---------------- */

  function initMetronome() {
    var host = U.query('#metro-mount');
    if (!host) return;
    U.clear(host);

    var cfg = { tempo: state.tempo, num: state.time.num, den: state.time.den, accent: true, sub: 1 };

    var dial = U.el('div', { class: 'metro-dial' });
    var face = U.el('div', { class: 'metro-face' });
    var beatEl = U.el('div', { class: 'metro-beat', text: '—' });
    face.appendChild(beatEl);
    dial.appendChild(face);

    var lamps = U.el('div', { class: 'metro-lamps' });
    var lampEls = [];
    for (var i = 0; i < 12; i++) {
      var l = U.el('div', { class: 'metro-lamp' });
      lampEls.push(l);
      lamps.appendChild(l);
    }

    var tempoField = U.el('div', { class: 'field' },
      U.el('span', { class: 'label' }, '速度 PBM ', U.el('span', { class: 'hint', id: 'metro-tempo-word' })),
      U.el('div', { class: 'tempo-row' },
        U.el('input', {
          type: 'number', id: 'metro-tempo-num', min: '20', max: '240', step: '1',
          value: String(cfg.tempo), inputmode: 'numeric', 'aria-label': '节拍器速度数值输入'
        }),
        U.el('input', {
          type: 'range', id: 'metro-tempo', min: '20', max: '240', step: '1',
          value: String(cfg.tempo), 'aria-label': '节拍器速度滑块'
        })));

    var timeSel = U.el('select', { id: 'metro-time' });
    G.TIME_SIGNATURES.forEach(function (t) {
      timeSel.appendChild(U.el('option', {
        value: t.num + '/' + t.den, text: t.label,
        selected: t.num === cfg.num && t.den === cfg.den
      }));
    });

    var subSel = U.el('select', { id: 'metro-sub' });
    [['1', '每拍'], ['2', '八分细分'], ['3', '三连音'], ['4', '十六分细分']].forEach(function (o) {
      subSel.appendChild(U.el('option', { value: o[0], text: o[1] }));
    });

    var accentChk = U.el('input', { type: 'checkbox', id: 'metro-accent', checked: true });

    var startBtn = U.el('button', { class: 'btn primary lg', id: 'metro-toggle', text: '\u25B6 开始' });

    /* 节拍器自己的设速入口（与生成页的速度独立，但会写回 state 供下次生成使用） */
    function setMetroTempo(bpm, quiet) {
      bpm = Math.round(U.clamp(Number(bpm) || 60, 20, 240));
      cfg.tempo = bpm;
      state.tempo = bpm;
      var s = U.query('#metro-tempo'); if (s) s.value = String(bpm);
      var n = U.query('#metro-tempo-num'); if (n) n.value = String(bpm);
      var w = U.query('#metro-tempo-word');
      if (w) w.textContent = bpm + ' · ' + tempoWord(bpm);
      if (metro && metro.isRunning && metro.isRunning()) {
        try { metro.setTempo(bpm); } catch (e) { /* 忽略 */ }
      }
      if (!quiet) saveState();
      return bpm;
    }

    var tapTimes = [];
    var tapBtn = U.el('button', {
      class: 'btn', id: 'metro-tap', text: '\u30BF 敲拍测速',
      on: {
        click: function () {
          var now = Date.now();
          tapTimes = tapTimes.filter(function (t) { return now - t < 2600; });
          tapTimes.push(now);
          if (tapTimes.length >= 2) {
            var gaps = [];
            for (var k = 1; k < tapTimes.length; k++) gaps.push(tapTimes[k] - tapTimes[k - 1]);
            var avg = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
            var bpm = setMetroTempo(Math.round(60000 / avg));
            U.toast('测得 ' + bpm + ' PBM', 'ok');
          }
        }
      }
    });

    var row = U.el('div', { class: 'grid-3' },
      U.el('div', { class: 'field' }, U.el('span', { class: 'label', text: '拍号' }), timeSel),
      U.el('div', { class: 'field' }, U.el('span', { class: 'label', text: '细分' }), subSel),
      U.el('div', { class: 'field' }, U.el('span', { class: 'label', text: '重音' }),
        U.el('label', { class: 'check' }, accentChk, U.el('span', { text: '每小节第一拍加重' }))));

    host.appendChild(dial);
    host.appendChild(lamps);
    host.appendChild(tempoField);
    host.appendChild(row);
    host.appendChild(U.el('div', { class: 'row' }, startBtn, tapBtn,
      U.el('span', { class: 'hint', text: '提示：敲拍测速需要连续敲 2 次以上。' })));

    function paint(beat, accent) {
      beatEl.textContent = String(beat);
      var total = cfg.num;
      for (var k = 0; k < lampEls.length; k++) {
        lampEls[k].className = 'metro-lamp' + (k === beat - 1 ? (accent ? ' on accent' : ' on') : '');
        lampEls[k].style.display = k < total ? '' : 'none';
      }
    }

    function start() {
      if (!APP.engine) { U.toast('音频引擎未加载，无法使用节拍器', 'err'); return; }
      try { APP.engine.init(); } catch (e) { /* 忽略 */ }
      metro = new APP.engine.Metronome();
      metro.start({
        tempo: cfg.tempo,
        time: { num: cfg.num, den: cfg.den },
        accent: cfg.accent,
        subdivision: cfg.sub,
        onTick: function (beat, bar, isAccent, info) {
          paint(beat, isAccent);
          if (info && info.isSub) return;
        }
      });
      startBtn.textContent = '\u25A0 停止';
      startBtn.classList.remove('primary');
      U.toast('节拍器已启动 ' + cfg.tempo + ' PBM', 'ok');
    }
    function stop() {
      if (metro) { try { metro.stop(); } catch (e) { /* 忽略 */ } metro = null; }
      startBtn.textContent = '\u25B6 开始';
      startBtn.classList.add('primary');
      beatEl.textContent = '—';
      lampEls.forEach(function (l) { l.className = 'metro-lamp'; });
    }

    startBtn.addEventListener('click', function () {
      if (metro && metro.isRunning && metro.isRunning()) stop(); else start();
    });
    var tempoSlider = U.query('#metro-tempo');
    if (tempoSlider) {
      tempoSlider.addEventListener('input', function () {
        setMetroTempo(tempoSlider.value);
      });
    }
    var tempoNum = U.query('#metro-tempo-num');
    if (tempoNum) {
      tempoNum.addEventListener('input', function () {
        var raw = parseInt(tempoNum.value, 10);
        if (isFinite(raw) && raw >= 20 && raw <= 240 && tempoSlider) tempoSlider.value = String(raw);
      });
      tempoNum.addEventListener('change', function () {
        var raw = parseInt(tempoNum.value, 10);
        if (!isFinite(raw)) {
          tempoNum.value = String(cfg.tempo);
          U.toast('速度请输入 20–240 之间的整数', 'warn');
          return;
        }
        var bpm = setMetroTempo(raw);
        if (bpm !== raw) U.toast('已限制到 ' + bpm + ' PBM（允许范围 20–240）', 'warn');
      });
      tempoNum.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); tempoNum.dispatchEvent(new Event('change')); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setMetroTempo(cfg.tempo + 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setMetroTempo(cfg.tempo - 1); }
      });
    }
    setMetroTempo(cfg.tempo, true);
    timeSel.addEventListener('change', function () {
      var p = timeSel.value.split('/');
      cfg.num = parseInt(p[0], 10); cfg.den = parseInt(p[1], 10);
      if (metro && metro.isRunning && metro.isRunning()) { stop(); start(); }
      else paint(1, true);
    });
    subSel.addEventListener('change', function () {
      cfg.sub = parseInt(subSel.value, 10);
      if (metro && metro.isRunning && metro.isRunning()) { stop(); start(); }
    });
    accentChk.addEventListener('change', function () { cfg.accent = accentChk.checked; });
    paint(1, true);
    U.queryAll('#metro-mount .metro-lamp').forEach(function (l, i) {
      l.style.display = i < cfg.num ? '' : 'none';
    });
  }

  /* ---------------- 调音器 ---------------- */

  function initTuner() {
    var host = U.query('#tuner-mount');
    if (!host) return;
    var hint = U.query('#tuner-env-hint');
    if (APP.tuner && APP.tuner.isSupported && !APP.tuner.isSupported()) {
      if (hint) hint.textContent = APP.tuner.unsupportedReason ? APP.tuner.unsupportedReason() : '';
    } else if (hint) {
      hint.textContent = '需要用麦克风；支持吉他 / 尤克里里调弦模式与 A4 基准调节';
    }
    if (!APP.tuner || !APP.tuner.open) {
      host.appendChild(U.el('div', { class: 'hint', text: '调音器模块未加载。' }));
      return;
    }
    APP.tuner.open(host, { stdPitch: 440, mode: 'chromatic' });
  }

  /* ---------------- 调号与音阶 ---------------- */

  function initScale() {
    var keySel = U.query('#scale-key');
    var typeSel = U.query('#scale-type');
    var jpSel = U.query('#scale-jpmode');
    var solfaChk = U.query('#scale-solfa');
    var circlesChk = U.query('#scale-circles');
    if (!keySel) return;
    if (circlesChk && circlesChk.checked === undefined) circlesChk.checked = true;

    U.clear(keySel);
    TH.allKeys().forEach(function (k) {
      keySel.appendChild(U.el('option', { value: k.tonic + '-' + k.mode, text: k.name + '（' + k.signature + ' 个' + (k.signature > 0 ? '升号' : k.signature < 0 ? '降号' : '无升降') + '）' }));
    });
    keySel.value = state.keyId;

    function render() {
      var host = U.query('#scale-mount');
      U.clear(host);
      var k = keyFromId(keySel.value);
      var type = typeSel.value;
      var jpMode = jpSel.value;
      var showSolfa = solfaChk.checked;

      /* 头部说明 */
      var sig = TH.keySignature(k);
      var info = U.el('div', { class: 'row', style: { marginBottom: '12px' } },
        U.el('span', { class: 'badge accent', text: TH.keyName(k) }),
        U.el('span', { class: 'badge', text: '调号：' + (sig.count === 0 ? '无升降号' : sig.count + ' 个' + (sig.accidental === 'sharp' ? '升号 ♯' : '降号 ♭')) }),
        U.el('span', { class: 'badge', text: '关系' + (k.mode === 'major' ? '小调' : '大调') + '：' + TH.keyName(TH.normalizeKey({ tonic: k.tonic, mode: k.mode === 'major' ? 'minor' : 'major' })) }));
      host.appendChild(info);

      /* 音阶表 */
      var typeName = type === 'major' ? '自然大调' : (type === 'harmonic' ? '和声小调' : '自然小调');
      var useType = type;
      var pitches = TH.scalePitches(k, 4, useType);
      var table = U.el('table', { class: 'scale-table' });
      var head = U.el('tr', {});
      ['音级', '音名', '首调简谱', '固定调简谱', 'MIDI', '频率(Hz)'].forEach(function (h) {
        head.appendChild(U.el('th', { text: h }));
      });
      table.appendChild(head);
      pitches.forEach(function (p, i) {
        var rel = TH.jianpuOf(p, k, 'relative');
        var fix = TH.jianpuOf(p, k, 'fixed');
        var jpText = function (j) {
          var s = (j.accidental === '#' ? '\u266F' : j.accidental === 'b' ? '\u266D' : '') + j.digit;
          if (j.octave < 0) s += ' (低' + (-j.octave) + '八度)';
          if (j.octave > 0) s += ' (高' + j.octave + '八度)';
          return s;
        };
        var tr = U.el('tr', {});
        tr.appendChild(U.el('td', { text: String(i + 1) + (showSolfa ? ' ' + ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'][i] : '') }));
        tr.appendChild(U.el('td', { class: 'strong', text: TH.pitchName(p, { octave: true }) }));
        tr.appendChild(U.el('td', { text: jpText(rel) }));
        tr.appendChild(U.el('td', { text: jpText(fix) }));
        tr.appendChild(U.el('td', { text: String(TH.midiOf(p)) }));
        tr.appendChild(U.el('td', { text: TH.midiToFreq(TH.midiOf(p)).toFixed(2) }));
        table.appendChild(tr);
      });
      host.appendChild(U.el('div', { class: 'scale-table-wrap' }, table));
      host.appendChild(U.el('div', { class: 'hint', style: { marginTop: '8px' },
        text: '「首调简谱」把本调主音记作 1（唱名固定为 do）；「固定调简谱」只有 C 才是 1。频率按 A4 = 440Hz 计算。' }));

      /* 五度圈 */
      if (circlesChk.checked) {
        host.appendChild(circleOfFifths(k));
      }
      host.appendChild(U.el('div', { class: 'hint', style: { marginTop: '6px' },
        text: '音阶数据可点右上角「保存为图片」导出 PNG。' }));
    }

    keySel.addEventListener('change', function () { state.keyId = keySel.value; saveState(); render(); });
    typeSel.addEventListener('change', render);
    jpSel.addEventListener('change', render);
    solfaChk.addEventListener('change', render);
    circlesChk.addEventListener('change', render);

    var pngBtn = U.query('#scale-png');
    if (pngBtn) {
      pngBtn.addEventListener('click', function () {
        var node = U.query('#scale-mount');
        if (!APP['export'] || !APP['export'].saveNodeImage) { U.toast('导出模块未加载', 'err'); return; }
        APP['export'].saveNodeImage(node, U.timestampName('调号音阶', '.png'), {
          title: '调号与音阶对照 · ' + TH.keyName(keyFromId(keySel.value))
        }).then(function () { U.toast('已保存图片', 'ok'); }, function (e) {
          U.toast('保存失败：' + (e && e.message ? e.message : e), 'err');
        });
      });
    }
    render();
  }

  /* 五度圈 SVG */
  function circleOfFifths(activeKey) {
    var W = 460, H = 460, cx = W / 2, cy = H / 2;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.style.maxWidth = '100%';
    svg.style.height = 'auto';
    svg.style.background = '#ffffff';

    function mk(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }
    function label(x, y, text, size, fill, weight, anchor) {
      var t = mk('text', {
        x: x, y: y, 'text-anchor': anchor || 'middle', 'dominant-baseline': 'middle',
        'font-size': size, fill: fill || '#131a26', 'font-family': '"PingFang SC",system-ui,sans-serif',
        'font-weight': weight || 500
      });
      t.textContent = text;
      return t;
    }

    var majors = TH.allKeys().filter(function (k) { return k.mode === 'major' && k.fifths >= -6 && k.fifths <= 6; });
    majors.sort(function (a, b) { return a.fifths - b.fifths; });
    var R1 = 150, R2 = 205;
    var activeName = TH.keyName(activeKey);
    var activePc = activeKey.tonic;

    svg.appendChild(mk('circle', { cx: cx, cy: cy, r: R1, fill: 'none', stroke: '#d8dfeb', 'stroke-width': 1.2 }));
    svg.appendChild(mk('circle', { cx: cx, cy: cy, r: R2, fill: 'none', stroke: '#d8dfeb', 'stroke-width': 1.2 }));

    var n = majors.length;
    for (var i = 0; i < n; i++) {
      var ang = (-90 + i * (360 / n)) * Math.PI / 180;
      var k = majors[i];
      var mid = TH.normalizeKey({ tonic: k.tonic, mode: 'minor' });
      var isActive = (k.tonic === activePc && activeKey.mode === 'major');
      /* 外圈：大调 */
      var x1 = cx + Math.cos(ang) * R2, y1 = cy + Math.sin(ang) * R2;
      svg.appendChild(mk('circle', {
        cx: x1, cy: y1, r: 17,
        fill: isActive ? '#4d8dff' : '#f2f5fa',
        stroke: isActive ? '#4d8dff' : '#c9d3e2', 'stroke-width': 1.2
      }));
      svg.appendChild(label(x1, y1, TH.keyName(k).replace(' 大调', ''), 12, isActive ? '#ffffff' : '#131a26', 700));
      /* 内圈：关系小调 */
      var x2 = cx + Math.cos(ang) * R1, y2 = cy + Math.sin(ang) * R1;
      var isActMin = (mid.tonic === activePc && activeKey.mode === 'minor');
      svg.appendChild(mk('circle', {
        cx: x2, cy: y2, r: 14,
        fill: isActMin ? '#ff8a4c' : '#f8fafc',
        stroke: isActMin ? '#ff8a4c' : '#d8dfeb', 'stroke-width': 1.2
      }));
      svg.appendChild(label(x2, y2, TH.keyName(mid).replace(' 小调', '') + 'm', 10.5, isActMin ? '#4a2200' : '#5b6779', 600));
    }
    /* 中心说明 */
    svg.appendChild(label(cx, cy - 16, '五度圈', 15, '#131a26', 700));
    svg.appendChild(label(cx, cy + 6, '外圈大调 / 内圈关系小调', 10.5, '#6b7280', 400));
    svg.appendChild(label(cx, cy + 26, TH.keyName(activeKey), 13, '#4d8dff', 700));
    return svg;
  }

  /* ---------------- 移调 / 固定调转换 ---------------- */

  function initTranspose() {
    var host = U.query('#transpose-mount');
    if (!host) return;
    U.clear(host);

    var keySel = U.el('select', {});
    TH.allKeys().forEach(function (k) {
      keySel.appendChild(U.el('option', { value: k.tonic + '-' + k.mode, text: k.keyName || k.name }));
    });
    keySel.value = state.keyId;

    var instSel = U.el('select', {});
    TH.TRANSPOSING_INSTRUMENTS.forEach(function (it) {
      instSel.appendChild(U.el('option', { value: it.id, text: it.name + '（' + it.desc + '）' }));
    });

    var semiSel = U.el('select', {});
    for (var s = -12; s <= 12; s++) {
      semiSel.appendChild(U.el('option', { value: String(s), text: (s > 0 ? '+' : '') + s + ' 半音', selected: s === 0 }));
    }

    var out = U.el('div', { class: 'tr-out' });

    function render() {
      U.clear(out);
      var k = keyFromId(keySel.value);
      var inst = TH.TRANSPOSING_INSTRUMENTS.filter(function (x) { return x.id === instSel.value; })[0] || TH.TRANSPOSING_INSTRUMENTS[0];
      var semi = parseInt(semiSel.value, 10) || 0;

      /* 1) 目标调：原调 + 半音位移 */
      var targetKey = TH.transposeKey(k, semi);
      var rows = U.el('table', { class: 'scale-table' });
      rows.appendChild(U.el('tr', {}, ['项目', '结果'].map(function (h) { return U.el('th', { text: h }); })));
      function addRow(a, b) {
        rows.appendChild(U.el('tr', {}, U.el('td', { text: a }), U.el('td', { class: 'strong', text: b })));
      }
      addRow('原调', TH.keyName(k));
      addRow('移调半音数', (semi > 0 ? '+' : '') + semi);
      addRow('移调后的调', TH.keyName(targetKey));
      addRow('移调后调号', (function () {
        var sig = TH.keySignature(targetKey);
        return sig.count === 0 ? '无升降号' : sig.count + ' 个' + (sig.accidental === 'sharp' ? '升号 ♯' : '降号 ♭');
      })());
      addRow('移调乐器', inst.name);
      if (inst.writtenToConcert !== 0) {
        var writtenC = 60;                       // 记谱 C4
        var concert = TH.toConcert(writtenC, inst);
        addRow('记谱音 → 实际音', '记谱 C4 → 实际 ' + TH.pitchName(TH.pitchFromMidi(concert)) +
          '（差 ' + inst.writtenToConcert + ' 半音）');
        var concertKey = TH.transposeKey(k, inst.writtenToConcert);
        addRow('按该乐器记谱应写的调', TH.keyName(concertKey));
        addRow('反向查实际调', '实际 ' + TH.keyName(k) + ' → 该乐器记谱 ' + TH.keyName(TH.transposeKey(k, -inst.writtenToConcert)));
      }
      out.appendChild(U.el('div', { class: 'scale-table-wrap' }, rows));

      /* 2) 固定调（C 调读谱）对照：把该调音阶按固定调写出 */
      var pitches = TH.scalePitches(k, 4);
      var fixed = U.el('table', { class: 'scale-table' });
      fixed.appendChild(U.el('tr', {}, ['音级', '本调音名', '首调简谱', '固定调简谱（C 调读谱）', '固定调音名'].map(function (h) {
        return U.el('th', { text: h });
      })));
      pitches.forEach(function (p, i) {
        var rel = TH.jianpuOf(p, k, 'relative');
        var fix = TH.jianpuOf(p, k, 'fixed');
        var pc = ((TH.midiOf(p) % 12) + 12) % 12;
        fixed.appendChild(U.el('tr', {},
          U.el('td', { text: String(i + 1) }),
          U.el('td', { class: 'strong', text: TH.pitchName(p, { octave: true }) }),
          U.el('td', { text: (rel.accidental || '') + rel.digit }),
          U.el('td', { text: (fix.accidental === '#' ? '\u266F' : fix.accidental === 'b' ? '\u266D' : '') + fix.digit + (fix.octave ? '（' + (fix.octave > 0 ? '高' : '低') + Math.abs(fix.octave) + '八度）' : '') }),
          U.el('td', { text: TH.pitchName(TH.pitchFromMidi(pc + 60, TH.preferSharp(k)), { octave: false }) })
        ));
      });
      out.appendChild(U.el('div', { class: 'hint', style: { marginTop: '12px' },
        text: '固定调对照：把本调的每个音换算成「在 C 调里它是什么音」，便于用固定调思维读谱。' }));
      out.appendChild(U.el('div', { class: 'scale-table-wrap', style: { marginTop: '6px' } }, fixed));
    }

    keySel.addEventListener('change', render);
    instSel.addEventListener('change', render);
    semiSel.addEventListener('change', render);

    host.appendChild(U.el('div', { class: 'grid-3' },
      U.el('div', { class: 'field' }, U.el('span', { class: 'label', text: '原调' }), keySel),
      U.el('div', { class: 'field' }, U.el('span', { class: 'label', text: '移调乐器' }), instSel),
      U.el('div', { class: 'field' }, U.el('span', { class: 'label', text: '整体移调' }), semiSel)));
    host.appendChild(out);
    render();

    var pngBtn = U.query('#tr-png');
    if (pngBtn) {
      pngBtn.addEventListener('click', function () {
        if (!APP['export'] || !APP['export'].saveNodeImage) { U.toast('导出模块未加载', 'err'); return; }
        APP['export'].saveNodeImage(host, U.timestampName('移调对照', '.png'), { title: '移调与固定调对照' })
          .then(function () { U.toast('已保存图片', 'ok'); }, function (e) { U.toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
      });
    }
  }

  /* ---------------- 乐器音阶表 ---------------- */

  function initInstruments() {
    var host = U.query('#inst-mount');
    var idSel = U.query('#inst-id');
    var keySel = U.query('#inst-key');
    var fretSel = U.query('#inst-maxfret');
    var solfaChk = U.query('#inst-solfa');
    var onlyChk = U.query('#inst-onlyscale');
    if (!host || !APP.instruments) {
      if (host) host.appendChild(U.el('div', { class: 'hint', text: '乐器模块未加载。' }));
      return;
    }

    U.clear(idSel);
    APP.instruments.list().forEach(function (it) {
      idSel.appendChild(U.el('option', { value: it.id, text: it.name + '（' + it.kind + '）' }));
    });
    U.clear(keySel);
    TH.allKeys().forEach(function (k) {
      keySel.appendChild(U.el('option', { value: k.tonic + '-' + k.mode, text: k.name }));
    });
    keySel.value = state.keyId;

    function render() {
      U.clear(host);
      var id = idSel.value;
      var k = keyFromId(keySel.value);
      var scale = TH.scalePitches(k, 4);
      var scaleUp = TH.scalePitches(k, 5);
      var highlight = scale.concat(scaleUp).map(function (p) { return TH.midiOf(p); });
      try {
        APP.instruments.renderChart(host, id, {
          key: k,
          showSolfa: solfaChk.checked,
          showNoteName: true,
          maxFret: parseInt(fretSel.value, 10),
          highlight: highlight,
          onlyScale: onlyChk.checked
        });
      } catch (e) {
        host.appendChild(U.el('div', { class: 'hint', text: '绘制失败：' + (e && e.message ? e.message : e) }));
      }
    }

    idSel.addEventListener('change', render);
    keySel.addEventListener('change', render);
    fretSel.addEventListener('change', render);
    solfaChk.addEventListener('change', render);
    onlyChk.addEventListener('change', render);
    render();

    var pngBtn = U.query('#inst-png');
    if (pngBtn) {
      pngBtn.addEventListener('click', function () {
        if (!APP['export'] || !APP['export'].saveNodeImage) { U.toast('导出模块未加载', 'err'); return; }
        var name = (idSel.options[idSel.selectedIndex] || {}).text || '乐器音阶表';
        APP['export'].saveNodeImage(host, U.timestampName('乐器音阶表', '.png'), {
          title: name + ' · ' + TH.keyName(keyFromId(keySel.value))
        }).then(function () { U.toast('已保存图片', 'ok'); }, function (e) {
          U.toast('保存失败：' + (e && e.message ? e.message : e), 'err');
        });
      });
    }
    var copyBtn = U.query('#inst-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var id = idSel.value;
        var k = keyFromId(keySel.value);
        var notes = [];
        try { notes = APP.instruments.notesOf(id, { key: k }); } catch (e) { notes = []; }
        var lines = [APP.instruments.get(id).name + ' · ' + TH.keyName(k)];
        notes.filter(function (n) { return n; }).forEach(function (n) {
          var pos = n.position || {};
          var where = pos.fret !== undefined ? (pos.string + '弦' + pos.fret + '品')
            : pos.hole !== undefined ? ('第' + pos.hole + '孔' + (pos.blow ? '吹' : '吸'))
              : pos.key !== undefined ? ('键 ' + pos.key) : '';
          lines.push([n.name, n.solfa || '', where].join('\t'));
        });
        U.copyText(lines.join('\n')).then(function (ok) {
          U.toast(ok ? '已复制文字表' : '复制失败', ok ? 'ok' : 'err');
        });
      });
    }
  }

  /* ---------------- 听辨练习 ---------------- */

  function initEar() {
    var host = U.query('#ear-mount');
    if (!host) return;
    if (!APP.ear || !APP.ear.mount) {
      host.appendChild(U.el('div', { class: 'hint', text: '听辨模块未加载。' }));
      return;
    }
    APP.ear.mount(host, {
      getEngine: function () { return APP.engine; },
      getKey: function () { return keyFromId(state.keyId); },
      getTempo: function () { return state.tempo; },
      onRecord: function (r) { try { APP.practice && APP.practice.record(r); } catch (e) { /* 忽略 */ } }
    });
  }

  /* ---------------- 音型库 / 导出 ---------------- */

  function initLibrary() {
    var libHost = U.query('#lib-mount');
    if (libHost) {
      if (APP.library && APP.library.mount) {
        APP.library.mount(libHost, {
          getCurrentBar: function () { return currentScore && currentScore.bars[0]; },
          getTempo: function () { return state.tempo; },
          onChange: function () { /* 生成时会即时读取 getActive() */ }
        });
      } else {
        libHost.appendChild(U.el('div', { class: 'hint', text: '音型库模块未加载。' }));
      }
    }

    var expHost = U.query('#exp-mount');
    if (expHost) {
      if (APP['export'] && APP['export'].mountPanel) {
        APP['export'].mountPanel(expHost, {
          getScore: function () { return currentScore; },
          getScoreNode: function () { return U.query('#gen-sheet'); },
          getTitle: function () { return '读谱训练器 · 练习谱'; }
        });
      } else {
        expHost.appendChild(U.el('div', { class: 'hint', text: '导出模块未加载。' }));
      }
    }

    var statsHost = U.query('#stats-mount');
    if (statsHost) {
      if (APP.practice && APP.practice.mountStats) APP.practice.mountStats(statsHost);
      else statsHost.appendChild(U.el('div', { class: 'hint', text: '练习统计模块未加载。' }));
    }
  }

  /* ---------------- 练习模式（挂在生成页） ---------------- */

  function initPractice() {
    var host = U.query('#prac-mount');
    if (!host || !APP.practice || !APP.practice.mount) {
      var card = U.query('#prac-card');
      if (card) card.style.display = 'none';
      return;
    }
    try {
      practiceCtl = APP.practice.mount(host, {
        getScore: function () { return currentScore; },
        onRequestNew: function (o) {
          o = o || {};
          state.seed = Math.floor(Math.random() * 1e9);
          if (o.tempo) state.tempo = o.tempo;
          syncControls();
          regenerate({ quiet: true });
        },
        onHighlight: function (bar, note) {
          var sheet = U.query('#gen-sheet');
          if (!sheet) return;
          var pick2 = resolveRenderer();
          hl(pick2, 'bar', sheet, bar);
          if (note !== undefined && note !== null) hl(pick2, 'note', sheet, bar, note);
          var target = sheet.querySelector('[data-bar-idx="' + bar + '"]');
          if (target && target.scrollIntoView) {
            try { sheet.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 忽略 */ }
          }
        },
        engine: APP.engine
      });
    } catch (e) {
      host.appendChild(U.el('div', { class: 'hint', text: '练习模式初始化失败：' + (e && e.message ? e.message : e) }));
    }
  }

  /* ---------------- 使用说明 ---------------- */

  function showHelp() {
    var html = [
      '<p><b>这个工具能做什么</b></p>',
      '<ul>',
      '<li><b>生成 / 练习</b>：随机生成节奏型或旋律，五线谱与简谱同时或分别显示。左侧可以精确限制「只出现哪些音符时值」和「只出现哪几个音级」——例如只勾 1 2 3 4、只留二分与四分音符、4/4 拍 60 PBM，就是一条很温和的入门练习。</li>',
      '<li><b>快速档位</b>：入门 / 初级 / 中级 / 高级 / 纯节奏，一键切换全部参数。</li>',
      '<li><b>节拍器</b>：20–240 PBM，支持 2/4 3/4 4/4 6/8 等拍号、重音、八分/三连音/十六分细分，还有敲拍测速。</li>',
      '<li><b>调音器</b>：用麦克风检测音高，支持半音阶 / 吉他 / 尤克里里模式、A4 基准频率与灵敏度调节。<b>需要 https 或 localhost</b>，直接双击 HTML 文件（file://）浏览器不允许用麦克风。</li>',
      '<li><b>调号与音阶</b>：15 个常用调的调号、音阶音名、首调与固定调简谱、频率对照，还有五度圈。</li>',
      '<li><b>移调 / 固定调转换</b>：整体移调、为降 B 单簧管/降 E 萨克斯等移调乐器换算，以及「这个调的每个音在 C 调里是什么」的固定调对照。</li>',
      '<li><b>乐器音阶表</b>：吉他、尤克里里、贝斯、十孔口琴、竖笛、钢琴的音阶位置图，可保存为图片。</li>',
      '<li><b>听辨练习</b>：节奏模仿与音程辨识，自动打分。</li>',
      '<li><b>音型库 / 导出</b>：自定义节奏型并参与随机生成；导出谱面图片（PNG）、MIDI、MusicXML，或复制简谱文本。</li>',
      '</ul>',
      '<p><b>快捷键</b>：<span class="kbd">空格</span> 播放/停止　<span class="kbd">N</span> 生成新乐段　<span class="kbd">1</span>–<span class="kbd">7</span> 切换标签页</p>',
      '<p class="hint">所有数据只保存在你自己的浏览器里；本页面完全离线可用，不发送任何网络请求。</p>'
    ].join('');
    U.modal('使用说明', html);
  }

  /* ---------------- 快捷键 ---------------- */

  function bindHotkeys() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        /* 听辨面板打开时，空格交给它敲拍（避免与播放/停止冲突） */
        var earPanel = U.query('.panel[data-panel="ear"]');
        if (earPanel && earPanel.classList.contains('active')) return;
        if (transport) stopPlayback(); else playScore(false);
      } else if (e.key === 'n' || e.key === 'N') {
        state.seed = Math.floor(Math.random() * 1e9);
        regenerate();
      } else if (/^[1-7]$/.test(e.key)) {
        var tabs = U.queryAll('#tabs .tab');
        var idx = parseInt(e.key, 10) - 1;
        if (tabs[idx]) switchTab(tabs[idx].getAttribute('data-tab'));
      }
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    loadState();
    buildSidebar();
    bindSidebarEvents();
    syncControls();

    /* 标签页事件 */
    U.queryAll('#tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });

    /* 生成页默认内容 */
    regenerate({ quiet: true });
    initPractice();
    bindHotkeys();

    /* 头部按钮 */
    var helpBtn = U.query('#hdr-help');
    if (helpBtn) helpBtn.addEventListener('click', showHelp);
    var helpBtn2 = U.query('#about-help');
    if (helpBtn2) helpBtn2.addEventListener('click', showHelp);

    var copyConf = U.query('#about-copyconf');
    if (copyConf) {
      copyConf.addEventListener('click', function () {
        U.copyText(JSON.stringify(state, null, 2)).then(function (ok) {
          U.toast(ok ? '已复制当前配置' : '复制失败', ok ? 'ok' : 'err');
        });
      });
    }

    var info = U.query('#about-info');
    if (info) {
      var mods = [
        ['乐理内核', !!APP.theory], ['生成器', !!APP.generator], ['五线谱渲染', !!APP.renderer],
        ['简谱渲染', !!APP.jianpu], ['音频引擎', !!APP.engine], ['调音器', !!APP.tuner],
        ['乐器音阶表', !!APP.instruments], ['导出', !!APP['export']], ['音型库', !!APP.library],
        ['听辨练习', !!APP.ear], ['练习模式', !!APP.practice]
      ];
      info.textContent = '模块状态：' + mods.map(function (m) { return m[0] + (m[1] ? '✓' : '✗'); }).join('　') +
        '　|　页面协议：' + location.protocol;
    }

    /* 屏幕提示：file:// 下部分功能受限 */
    if (location.protocol === 'file:') {
      setTimeout(function () {
        U.toast('当前是本地文件方式打开：调音器（麦克风）不可用；如需完整功能请用 https 或 localhost 打开。', 'warn');
      }, 900);
    }
    setPlaying(false);
  }

  APP.app = {
    state: state,
    getScore: function () { return currentScore; },
    regenerate: regenerate,
    playScore: playScore,
    stopPlayback: stopPlayback,
    initMetronome: initMetronome
  };

  U.ready(boot);
})(window.APP = window.APP || {});
