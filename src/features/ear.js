/* 读谱训练器 — 听辨练习
 * 全局命名空间：window.APP.ear
 * 依赖：APP.util、APP.theory、APP.generator、APP.engine（可选）
 *
 * 三种题型：
 *   ① 节奏模仿：听一条随机节奏，用「敲拍」把节奏打回来，按相对时值比对打分
 *   ② 音程辨识：听两个音，选出音程名称
 *   ③ 和弦性质：听一个大三或小三和弦，选出「大 / 小」
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;
  var G = APP.generator;

  /* 音程表：半音数 -> 名称 */
  var INTERVALS = [
    { semi: 0, name: '纯一度' }, { semi: 1, name: '小二度' }, { semi: 2, name: '大二度' },
    { semi: 3, name: '小三度' }, { semi: 4, name: '大三度' }, { semi: 5, name: '纯四度' },
    { semi: 6, name: '三全音' }, { semi: 7, name: '纯五度' }, { semi: 8, name: '小六度' },
    { semi: 9, name: '大六度' }, { semi: 10, name: '小七度' }, { semi: 11, name: '大七度' },
    { semi: 12, name: '纯八度' }
  ];

  function intervalName(semi) {
    var m = INTERVALS.filter(function (x) { return x.semi === semi; });
    return m.length ? m[0].name : (semi + ' 半音');
  }

  /* ---------------- 评分 ---------------- */

  /**
   * 把「敲出来的时间点」和「目标音头时间点（秒）」比对打分。
   * 先按总时长把两者归一到同一时间尺度（消除用户整体快慢的影响），
   * 再算每个音头的相对位置误差。
   * @returns {{score:number, detail:Array, meanErr:number, tempoFactor:number}}
   */
  function scoreTaps(taps, targets) {
    if (!taps || taps.length < 2 || !targets || targets.length < 2) {
      return { score: 0, detail: [], meanErr: 1, tempoFactor: 1, reason: 'taps-too-few' };
    }
    var t0 = taps[0], g0 = targets[0];
    var tSpan = taps[taps.length - 1] - t0;
    var gSpan = targets[targets.length - 1] - g0;
    if (tSpan <= 0.05 || gSpan <= 0.05) {
      return { score: 0, detail: [], meanErr: 1, tempoFactor: 1, reason: 'span-too-small' };
    }
    var factor = tSpan / gSpan;              // >1 表示用户打得慢
    var detail = [];
    var sum = 0;
    targets.forEach(function (gt, i) {
      /* 目标音头在归一化时间轴上的比例 */
      var ratio = (gt - g0) / gSpan;
      var want = t0 + ratio * tSpan;
      /* 找最近的敲击 */
      var best = Infinity, bi = -1;
      taps.forEach(function (tt, j) {
        var d = Math.abs(tt - want);
        if (d < best) { best = d; bi = j; }
      });
      /* 用「相邻音头间隔」做归一化误差：绝对误差 / 平均间隔 */
      var unit = gSpan / Math.max(1, targets.length - 1);
      var relErr = best / (unit * factor);
      sum += relErr;
      detail.push({ index: i, want: want, got: taps[bi], err: best, relErr: relErr, tapIndex: bi });
    });
    var meanErr = sum / targets.length;
    /* 平均相对误差 0 → 100 分；0.5 → 0 分 */
    var score = Math.round(U.clamp(100 - meanErr * 200, 0, 100));
    return { score: score, detail: detail, meanErr: meanErr, tempoFactor: factor };
  }

  /* 从 Score 的小节里取音头时间点（秒），跳过休止符 */
  function onsetsOf(score, barIndex) {
    var bar = score.bars[barIndex || 0];
    if (!bar) return [];
    var out = [];
    var t = 0;
    var spb = 60 / (score.tempo || 60);
    bar.notes.forEach(function (n) {
      var beats = U.beatsOf(n.dur, n.dotted);
      if (n.pitch) out.push(t * spb);
      t += beats;
    });
    return out;
  }

  /* ---------------- 主界面 ---------------- */

  function mount(container, opts) {
    opts = opts || {};
    if (!container) return null;
    U.clear(container);

    var engine = opts.getEngine ? opts.getEngine() : APP.engine;

    var session = {
      mode: 'rhythm',
      level: 'easy',
      question: null,
      phase: 'idle',      // idle | listening | answering | done
      taps: [],
      playStart: 0,
      listenStart: 0,
      tries: [],
      stopAll: function () { stopListen(); stopPlay(); }
    };

    function hasEngine() { return !!(engine && engine.playNote); }

    /* ---- 顶部：题型与难度 ---- */
    var modeRow = U.el('div', { class: 'chip-row', style: { marginBottom: '10px' } });
    [['rhythm', '节奏模仿'], ['interval', '音程辨识'], ['chord', '和弦性质']].forEach(function (m) {
      modeRow.appendChild(U.el('button', {
        class: 'chip' + (session.mode === m[0] ? ' active' : ''),
        type: 'button', data: { mode: m[0] }, text: m[1],
        on: { click: function () { session.mode = m[0]; refreshModes(); newQuestion(); } }
      }));
    });

    var levelRow = U.el('div', { class: 'chip-row', style: { marginBottom: '12px' } });
    [['easy', '简单'], ['medium', '中等'], ['hard', '困难']].forEach(function (l) {
      levelRow.appendChild(U.el('button', {
        class: 'chip' + (session.level === l[0] ? ' active' : ''),
        type: 'button', data: { level: l[0] }, text: l[1],
        on: {
          click: function () {
            session.level = l[0];
            U.queryAll('.chip', levelRow).forEach(function (c) {
              c.classList.toggle('active', c.getAttribute('data-level') === l[0]);
            });
            newQuestion();
          }
        }
      }));
    });

    /* ---- 题目区 ---- */
    var prompt = U.el('div', { class: 'ear-prompt' });
    var actions = U.el('div', { class: 'row', style: { margin: '12px 0' } });
    var playBtn = U.el('button', { class: 'btn primary lg', text: '\u25B6 播放题目' });
    var answerBtn = U.el('button', { class: 'btn accent lg', text: '\u25CF 开始作答' });
    var stopBtn = U.el('button', { class: 'btn ghost', text: '\u25A0 停止' });
    var skipBtn = U.el('button', { class: 'btn ghost', text: '\u21BB 换一题' });
    actions.appendChild(playBtn);
    actions.appendChild(answerBtn);
    actions.appendChild(stopBtn);
    actions.appendChild(skipBtn);

    var pad = U.el('div', { class: 'ear-pad' });
    var tapBtn = U.el('button', {
      class: 'ear-tap', type: 'button',
      html: '敲拍作答<br><span class="hint">按空格键或点这里，把节奏打回来</span>'
    });
    pad.appendChild(tapBtn);

    var choices = U.el('div', { class: 'ear-choices' });
    var feedback = U.el('div', { class: 'ear-feedback' });
    var statsEl = U.el('div', { class: 'row', style: { marginTop: '10px' } });

    var root = U.el('div', { class: 'ear-root' });
    root.appendChild(modeRow);
    root.appendChild(levelRow);
    root.appendChild(prompt);
    root.appendChild(actions);
    root.appendChild(pad);
    root.appendChild(choices);
    root.appendChild(feedback);
    root.appendChild(statsEl);
    container.appendChild(root);

    var audioHint = U.el('div', { class: 'hint', style: { marginTop: '8px' } });
    if (!hasEngine()) {
      audioHint.textContent = '音频引擎未加载，无法播放题目；请确认 src/audio/engine.js 已加载。';
      root.appendChild(audioHint);
    }

    /* ---- 播放相关 ---- */
    var timers = [];
    function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    var playTransport = null;
    function stopPlay() {
      clearTimers();
      if (playTransport && playTransport.stop) { try { playTransport.stop(); } catch (e) { /* 忽略 */ } }
      playTransport = null;
    }
    function stopListen() {
      session.phase = 'idle';
      tapBtn.classList.remove('live');
    }

    function refreshModes() {
      U.queryAll('.chip', modeRow).forEach(function (c) {
        c.classList.toggle('active', c.getAttribute('data-mode') === session.mode);
      });
      pad.style.display = session.mode === 'rhythm' ? '' : 'none';
      choices.style.display = session.mode === 'rhythm' ? 'none' : '';
      answerBtn.style.display = session.mode === 'rhythm' ? '' : 'none';
    }

    /* ---- 出题 ---- */
    function newQuestion() {
      stopPlay(); stopListen();
      feedback.textContent = '';
      U.clear(choices);
      session.taps = [];
      session.phase = 'idle';
      tapBtn.classList.remove('live');

      if (session.mode === 'rhythm') {
        var bars = session.level === 'easy' ? 1 : 2;
        var durations = session.level === 'easy' ? [1, 2] : (session.level === 'medium' ? [1, 2, 0.5] : [1, 2, 0.5, 0.25]);
        var tempo = session.level === 'easy' ? 66 : (session.level === 'medium' ? 80 : 92);
        var score = G.generateRhythm({
          bars: bars, durations: durations, useRests: false, useDotted: session.level === 'hard',
          time: { num: session.level === 'hard' ? 3 : 4, den: 4 },
          tempo: tempo, seed: Math.floor(Math.random() * 1e9),
          key: opts.getKey ? opts.getKey() : { tonic: 0, mode: 'major' }
        });
        session.question = { kind: 'rhythm', score: score, targets: onsetsOf(score, 0).concat(
          bars > 1 ? onsetsOf(score, 1).map(function (t) { return t + U.beatsOf(4, false) * (60 / tempo); }) : []
        ) };
        /* 更稳妥：把两小节的音头时间重新合并成一条时间轴 */
        var merged = [], acc = 0;
        score.bars.forEach(function (bar) {
          var t = 0;
          bar.notes.forEach(function (n) {
            var beats = U.beatsOf(n.dur, n.dotted);
            if (n.pitch) merged.push(acc + t * (60 / tempo));
            t += beats;
          });
          acc += t * (60 / tempo);
        });
        session.question.targets = merged;
        prompt.textContent = '听这段节奏（' + (session.level === 'easy' ? tempo : tempo) + ' PBM，' + bars + ' 小节），然后把节奏敲回来。';
      } else if (session.mode === 'interval') {
        var maxSemi = session.level === 'easy' ? 7 : (session.level === 'medium' ? 10 : 12);
        var semiChoices = INTERVALS.filter(function (x) { return x.semi > 0 && x.semi <= maxSemi; });
        var pick = U.pick(semiChoices);
        if (!pick) pick = INTERVALS[1];
        var baseMidi = 60 + U.randInt(0, 7);
        session.question = {
          kind: 'interval', semi: pick.semi, name: pick.name,
          lowMidi: baseMidi, highMidi: baseMidi + pick.semi,
          options: semiChoices
        };
        prompt.textContent = '听两个音，选出它们的音程关系。';
        session.question.options.forEach(function (o) {
          choices.appendChild(U.el('button', {
            class: 'chip', type: 'button', text: o.name,
            on: { click: function () { gradeChoice(o.semi, o.name); } }
          }));
        });
      } else {
        var isMajor = Math.random() < 0.5;
        var root = 60 + U.randInt(0, 7);
        var third = isMajor ? 4 : 3;
        session.question = {
          kind: 'chord', quality: isMajor ? 'major' : 'minor',
          midis: [root, root + third, root + 7]
        };
        prompt.textContent = '听一个和弦，判断它是大三和弦还是小三和弦。';
        choices.appendChild(U.el('button', {
          class: 'chip', type: 'button', text: '大三和弦',
          on: { click: function () { gradeChoice('major', '大三和弦'); } }
        }));
        choices.appendChild(U.el('button', {
          class: 'chip', type: 'button', text: '小三和弦',
          on: { click: function () { gradeChoice('minor', '小三和弦'); } }
        }));
      }
      refreshModes();
      answerBtn.disabled = session.mode !== 'rhythm';
    }

    /* ---- 播放题目 ---- */
    function playQuestion() {
      if (!hasEngine()) { U.toast('音频引擎不可用，无法播放', 'err'); return; }
      stopPlay();
      try { engine.init && engine.init(); } catch (e) { /* 忽略 */ }

      if (session.mode === 'rhythm') {
        var spb = 60 / session.question.score.tempo;
        /* 节奏题用节奏音色播放，并跟着打一遍节拍器便于对齐 */
        playTransport = engine.playScore(session.question.score, {
          metronome: true, countIn: session.level === 'easy' ? 4 : 4,
          timbre: 'clave', tempo: session.question.score.tempo
        });
      } else if (session.mode === 'interval') {
        var low = session.question.lowMidi, high = session.question.highMidi;
        if (engine.playNote) {
          engine.playNote(low, 0.9, 'sine');
          later(function () { engine.playNote(high, 0.9, 'sine'); }, 900);
          later(function () { engine.playNote(low, 0.7, 'sine'); }, 2000);
          later(function () { engine.playNote(high, 0.7, 'sine'); }, 2750);
        }
      } else {
        var midis = session.question.midis;
        if (engine.playChord) {
          engine.playChord(midis, 1.6, 'piano');
          later(function () { engine.playChord(midis, 1.6, 'piano'); }, 1900);
        } else if (engine.playNote) {
          midis.forEach(function (m) { engine.playNote(m, 1.6, 'piano'); });
        }
      }
      feedback.textContent = '正在播放…';
      later(function () { feedback.textContent = '播放完毕，可以作答了。'; }, 1600);
    }

    /* ---- 听辨选择题作答 ---- */
    function gradeChoice(value, label) {
      if (!session.question) return;
      var correct = session.mode === 'interval' ? session.question.semi === value
        : session.question.quality === value;
      var truth = session.mode === 'interval' ? session.question.name : (session.question.quality === 'major' ? '大三和弦' : '小三和弦');
      feedback.textContent = correct ? ('\u2713 答对了！' + truth) : ('\u2717 答错了，正确答案是「' + truth + '」');
      feedback.className = 'ear-feedback ' + (correct ? 'ok' : 'err');
      record(correct ? 100 : 0, session.mode, 1);
      later(newQuestion, 1400);
    }

    /* ---- 节奏作答 ---- */
    function beginAnswer() {
      if (session.mode !== 'rhythm' || !session.question) return;
      session.taps = [];
      session.phase = 'answering';
      tapBtn.classList.add('live');
      feedback.textContent = '开始敲拍！第一个音一敲下去就开始计时。';
      feedback.className = 'ear-feedback';
    }

    function tap() {
      if (session.phase !== 'answering') {
        U.toast('请先点「开始作答」', 'warn');
        return;
      }
      var now = performance.now() / 1000;
      if (!session.taps.length) session.taps.push(now);
      else session.taps.push(now);
      tapBtn.textContent = '第 ' + session.taps.length + ' 下';
      /* 敲够目标音头数量（+1 容错）就自动判分 */
      if (session.taps.length >= session.question.targets.length) {
        finishRhythm();
      }
    }

    function finishRhythm() {
      session.phase = 'idle';
      tapBtn.classList.remove('live');
      var res = scoreTaps(session.taps.slice(), session.question.targets);
      var lvl = res.score >= 85 ? 'ok' : (res.score >= 60 ? 'warn' : 'err');
      feedback.className = 'ear-feedback ' + lvl;
      var advice = res.score >= 85 ? '节奏很稳！'
        : res.score >= 60 ? '基本跟上了，注意个别音的长短。'
          : (res.tempoFactor > 1.25 ? '整体偏慢，试着跟紧节拍器。'
            : res.tempoFactor < 0.8 ? '整体偏快，放慢一点更稳。' : '有些音的时值不对，再听一遍。');
      feedback.textContent = '得分 ' + res.score + ' / 100　' + advice;
      tapBtn.innerHTML = '敲拍作答<br><span class="hint">按空格键或点这里</span>';
      record(res.score, 'rhythm', session.question.targets.length);
      later(newQuestion, 2200);
    }

    /* ---- 统计与记录 ---- */
    function record(score, kind, n) {
      session.tries.push({ at: Date.now(), score: score, kind: kind, n: n || 1 });
      renderStats();
      if (typeof opts.onRecord === 'function' && kind === 'rhythm') {
        try {
          opts.onRecord({
            score: score, mode: 'ear-' + kind, tempo: session.question && session.question.score ? session.question.score.tempo : null,
            bars: session.question && session.question.score ? session.question.score.bars.length : 0,
            accuracy: score, seconds: 0
          });
        } catch (e) { /* 忽略 */ }
      }
    }

    function renderStats() {
      U.clear(statsEl);
      if (!session.tries.length) return;
      var recent = session.tries.slice(-10);
      var avg = Math.round(recent.reduce(function (a, b) { return a + b.score; }, 0) / recent.length);
      var best = recent.reduce(function (a, b) { return Math.max(a, b.score); }, 0);
      statsEl.appendChild(U.el('span', { class: 'badge accent', text: '最近 ' + recent.length + ' 题平均 ' + avg + ' 分' }));
      statsEl.appendChild(U.el('span', { class: 'badge', text: '最好 ' + best + ' 分' }));
      statsEl.appendChild(U.el('span', { class: 'badge', text: '累计 ' + session.tries.length + ' 题' }));
      var bar = U.el('div', { class: 'ear-history' });
      recent.forEach(function (t) {
        var h = U.clamp(t.score, 4, 100);
        bar.appendChild(U.el('div', {
          class: 'ear-hist-bar ' + (t.score >= 85 ? 'ok' : t.score >= 60 ? 'warn' : 'err'),
          style: { height: h + '%' }, title: t.score + ' 分'
        }));
      });
      statsEl.appendChild(bar);
    }

    /* ---- 事件绑定 ---- */
    playBtn.addEventListener('click', playQuestion);
    answerBtn.addEventListener('click', beginAnswer);
    stopBtn.addEventListener('click', function () {
      session.stopAll();
      feedback.textContent = '已停止。';
      feedback.className = 'ear-feedback';
    });
    skipBtn.addEventListener('click', newQuestion);
    tapBtn.addEventListener('click', tap);

    function onKey(e) {
      if (e.code === 'Space' && container.isConnected !== false) {
        var tag = (e.target && e.target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (session.mode !== 'rhythm') return;
        if (container.offsetParent === null) return;   // 面板不可见时不响应
        e.preventDefault();
        if (session.phase === 'answering') tap(); else beginAnswer();
      }
    }
    document.addEventListener('keydown', onKey);
    session.destroy = function () {
      document.removeEventListener('keydown', onKey);
      session.stopAll();
    };
    session.newQuestion = newQuestion;
    session.beginAnswer = beginAnswer;

    newQuestion();
    renderStats();
    return session;
  }

  APP.ear = {
    mount: mount,
    scoreTaps: scoreTaps,
    onsetsOf: onsetsOf,
    INTERVALS: INTERVALS,
    intervalName: intervalName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.ear;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
