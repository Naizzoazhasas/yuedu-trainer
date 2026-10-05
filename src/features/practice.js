/* 读谱训练器 — 练习模式与进度记录
 * 全局命名空间：window.APP.practice
 * 依赖：APP.util（可选 APP.theory、APP.generator、APP.engine）
 *
 * 功能：倒计时预备拍、跟谱自动高亮 + 自动滚动、速度渐变训练、
 *       循环 / 节拍器 / 预备拍 / 手动 ±5 BPM、练习记录与统计。
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var STORAGE_KEY = 'yuedu.practiceLog';

  var listeners = [];

  /* ---------------- 工具 ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dayKeyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function localDayKey(iso) {
    var d = new Date(iso);
    if (!d || isNaN(d.getTime())) return null;
    return dayKeyOf(d);
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function readLog() {
    var raw = U.load(STORAGE_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (r) { return r && typeof r === 'object'; });
  }
  function saveLog(list) { U.save(STORAGE_KEY, list); }

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* 订阅者异常不影响主流程 */ }
    });
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* ---------------- 记录 ---------------- */

  function record(entry) {
    entry = entry || {};
    var score = entry.score || {};
    var bars = (score.bars && score.bars.length) || Number(entry.bars) || 0;
    var keyName = '';
    try {
      if (score.key && APP.theory && APP.theory.keyName) keyName = APP.theory.keyName(score.key);
    } catch (e) { keyName = ''; }
    var tempoNum = Number(entry.tempo);
    if (!isFinite(tempoNum) || tempoNum <= 0) tempoNum = Number(score.tempo) || 0;
    var sec = Number(entry.seconds);
    var rec = {
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      bars: Math.round(bars) || 0,
      tempo: Math.round(tempoNum) || 0,
      keyName: keyName,
      seconds: isFinite(sec) && sec > 0 ? Math.round(sec * 10) / 10 : 0,
      mode: score.mode || entry.mode || 'rhythm',
      accuracy: (typeof entry.accuracy === 'number' && isFinite(entry.accuracy)) ? entry.accuracy : null
    };
    var log = readLog();
    log.push(rec);
    saveLog(log);
    emit();
    return rec;
  }

  function clearRecords() {
    saveLog([]);
    emit();
  }

  /* 连续练习天数：从今天（若今天练过）或昨天往回数 */
  function streakOf(byDate) {
    var today = new Date();
    var cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!byDate[dayKeyOf(cursor)]) {
      cursor = new Date(cursor.getTime() - 86400000);
      if (!byDate[dayKeyOf(cursor)]) return 0;
    }
    var n = 0;
    while (byDate[dayKeyOf(cursor)]) {
      n++;
      cursor = new Date(cursor.getTime() - 86400000);
    }
    return n;
  }

  function stats() {
    var log = readLog();
    var totalSeconds = 0;
    var byDate = {};
    var byDateCount = {};
    log.forEach(function (r) {
      var k = localDayKey(r.at);
      if (!k) return;
      var s = Number(r.seconds) || 0;
      totalSeconds += s;
      byDate[k] = round1((byDate[k] || 0) + s / 60);
      byDateCount[k] = (byDateCount[k] || 0) + 1;
    });
    var days = Object.keys(byDate).sort().map(function (k) {
      return { date: k, minutes: byDate[k], count: byDateCount[k] || 0 };
    });
    var sessions = log.slice().sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at));
    });
    return {
      sessions: sessions,
      totalSessions: log.length,
      totalSeconds: Math.round(totalSeconds * 10) / 10,
      totalMinutes: round1(totalSeconds / 60),
      byDate: byDate,
      byDateCount: byDateCount,
      days: days,
      streakDays: streakOf(byDate)
    };
  }

  function last7Days(byDate) {
    var out = [];
    var now = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var k = dayKeyOf(d);
      out.push({
        date: k,
        label: (d.getMonth() + 1) + '/' + d.getDate(),
        minutes: byDate[k] || 0
      });
    }
    return out;
  }

  /* ---------------- 统计面板 ---------------- */

  function mountStats(container) {
    if (!container || !U.el) return { refresh: function () {} };
    var root = U.el('div', { class: 'prac-stats card' });
    U.clear(container);
    container.appendChild(root);

    function render() {
      var s = stats();
      U.clear(root);
      root.appendChild(U.el('div', { class: 'card-title' }, '练习进度'));
      root.appendChild(U.el('div', { class: 'prac-stat-line' },
        U.el('span', { class: 'badge prac-stat-total' }, '总练习次数：' + s.totalSessions + ' 次'),
        U.el('span', { class: 'badge prac-stat-time' }, '总时长：' + U.fmtTime(s.totalSeconds)),
        U.el('span', { class: 'badge prac-stat-streak' }, '连续练习：' + s.streakDays + ' 天')
      ));

      var week = last7Days(s.byDate);
      var max = 1;
      week.forEach(function (d) { if (d.minutes > max) max = d.minutes; });
      var chart = U.el('div', { class: 'prac-chart' });
      week.forEach(function (d) {
        var pct = Math.round((d.minutes / max) * 100);
        var col = U.el('div', { class: 'prac-chart-col', title: d.date + '：' + round1(d.minutes) + ' 分钟' });
        col.appendChild(U.el('div', { class: 'prac-chart-bar-wrap' },
          U.el('div', { class: 'prac-chart-bar', style: { height: Math.max(2, pct) + '%' } })
        ));
        col.appendChild(U.el('div', { class: 'prac-chart-value' }, d.minutes ? String(round1(d.minutes)) : ''));
        col.appendChild(U.el('div', { class: 'prac-chart-label' }, d.label));
        chart.appendChild(col);
      });
      root.appendChild(U.el('div', { class: 'prac-chart-title hint' }, '最近 7 天练习时长（分钟）'));
      root.appendChild(chart);

      var recent = s.sessions.slice(0, 5);
      if (recent.length) {
        var list = U.el('div', { class: 'prac-recent' });
        recent.forEach(function (r) {
          var d = new Date(r.at);
          var when = isNaN(d.getTime()) ? String(r.at) : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
          list.appendChild(U.el('div', { class: 'prac-recent-item hint' },
            when + ' · ' + r.bars + ' 小节 · ' + r.tempo + ' BPM · ' + U.fmtTime(r.seconds) +
            (r.keyName ? ' · ' + r.keyName : '')));
        });
        root.appendChild(U.el('div', { class: 'prac-recent-title hint' }, '最近记录'));
        root.appendChild(list);
      }

      root.appendChild(U.el('div', { class: 'row prac-stats-ops' },
        U.el('button', {
          class: 'btn ghost small prac-clear-btn', text: '清空练习记录',
          on: { click: onClear }
        })
      ));
    }

    function onClear() {
      var s = stats();
      if (!s.totalSessions) { U.toast('还没有练习记录', 'info'); return; }
      U.modal('清空练习记录', U.el('div', { class: 'hint' },
        '将删除全部 ' + s.totalSessions + ' 条练习记录（共 ' + U.fmtTime(s.totalSeconds) + '），且不可恢复。确定吗？'), [
        { label: '取消' },
        {
          label: '确定清空', kind: 'primary', onClick: function () {
            clearRecords();
            U.toast('已清空练习记录', 'ok');
          }
        }
      ]);
    }

    var off = onChange(render);
    render();
    return {
      root: root,
      refresh: render,
      destroy: function () { off(); U.clear(container); }
    };
  }

  /* ---------------- 练习模式 ---------------- */

  function mount(container, opts) {
    opts = opts || {};
    if (!container || !U.el) return emptyController();

    var engineRef = opts.engine || APP.engine;
    function engineOk() { return !!(engineRef && typeof engineRef.playScore === 'function'); }

    var st = {
      status: 'idle',          /* idle | counting | playing | paused | between */
      tempo: 80,
      target: 100,
      step: 5,
      repeat: 1,
      gradual: false,
      countIn: 4,
      pass: 0,
      passAtTempo: 0,
      bar: -1,
      note: -1,
      transport: null,
      timers: [],
      playStartedAt: 0,
      lastScore: null,
      destroyed: false
    };

    var root = U.el('div', { class: 'prac-root card' });
    U.clear(container);
    container.appendChild(root);
    root.appendChild(U.el('div', { class: 'card-title' }, '练习模式'));

    /* —— 控件 —— */
    var countInSel = U.el('select', { class: 'prac-countin' });
    [0, 1, 2, 4].forEach(function (n) {
      countInSel.appendChild(U.el('option', { value: String(n), text: n === 0 ? '无预备拍' : n + ' 拍预备拍' }));
    });
    countInSel.value = '4';
    countInSel.addEventListener('change', function () { st.countIn = Number(countInSel.value) || 0; });

    var loopCb = U.el('input', { type: 'checkbox', class: 'prac-loop' });
    loopCb.addEventListener('change', function () { updateUI(); });
    var metroCb = U.el('input', { type: 'checkbox', class: 'prac-metronome', checked: true });
    var gradualCb = U.el('input', { type: 'checkbox', class: 'prac-gradual' });
    gradualCb.addEventListener('change', function () { st.gradual = !!gradualCb.checked; updateUI(); });

    function numInput(cls, value, min, max) {
      var n = U.el('input', { type: 'number', class: cls, value: String(value), min: String(min), max: String(max), step: '1' });
      return n;
    }
    var startTempoIn = numInput('prac-start-tempo', 60, 20, 300);
    var targetTempoIn = numInput('prac-target-tempo', 120, 20, 300);
    var stepIn = numInput('prac-step', 5, 1, 40);
    var repeatIn = numInput('prac-repeat', 2, 1, 20);

    var tempoValue = U.el('span', { class: 'prac-tempo-value badge' }, '—');
    var passValue = U.el('span', { class: 'prac-pass-value badge' }, '第 0 遍');
    var targetValue = U.el('span', { class: 'prac-target-value hint' }, '');
    var nowBar = U.el('span', { class: 'prac-now-bar badge' }, '第 — 小节');
    var nowNote = U.el('span', { class: 'prac-now-note badge' }, '第 — 音');
    var countdownEl = U.el('div', { class: 'prac-countdown is-hidden' }, '');
    var hintEl = U.el('div', { class: 'hint prac-hint' }, '');

    var startBtn = U.el('button', { class: 'btn primary prac-start', text: '开始练习', on: { click: onStart } });
    var pauseBtn = U.el('button', { class: 'btn prac-pause', text: '暂停', disabled: true, on: { click: onPause } });
    var stopBtn = U.el('button', { class: 'btn ghost prac-stop', text: '停止', disabled: true, on: { click: function () { stop(); } } });
    var minusBtn = U.el('button', { class: 'btn small prac-minus', text: '−5 BPM', on: { click: function () { setTempo(getState().tempo - 5); } } });
    var plusBtn = U.el('button', { class: 'btn small prac-plus', text: '+5 BPM', on: { click: function () { setTempo(getState().tempo + 5); } } });

    /* —— 布局 —— */
    var row1 = U.el('div', { class: 'row prac-row' });
    row1.appendChild(startBtn); row1.appendChild(pauseBtn); row1.appendChild(stopBtn);
    row1.appendChild(minusBtn); row1.appendChild(plusBtn);
    row1.appendChild(tempoValue);

    var row2 = U.el('div', { class: 'row prac-row' });
    row2.appendChild(U.el('label', { class: 'prac-field' }, '预备拍', countInSel));
    row2.appendChild(U.el('label', { class: 'prac-field' }, '节拍器', metroCb));
    row2.appendChild(U.el('label', { class: 'prac-field' }, '循环', loopCb));
    row2.appendChild(U.el('label', { class: 'prac-field' }, '速度渐变', gradualCb));

    var row3 = U.el('div', { class: 'row prac-row prac-gradual-row' });
    row3.appendChild(U.el('label', { class: 'prac-field' }, '起始速度', startTempoIn));
    row3.appendChild(U.el('label', { class: 'prac-field' }, '目标速度', targetTempoIn));
    row3.appendChild(U.el('label', { class: 'prac-field' }, '每遍加速', stepIn));
    row3.appendChild(U.el('label', { class: 'prac-field' }, '重复遍数', repeatIn));

    var row4 = U.el('div', { class: 'row prac-row prac-now-row' });
    row4.appendChild(nowBar); row4.appendChild(nowNote); row4.appendChild(passValue); row4.appendChild(targetValue);

    root.appendChild(row1);
    root.appendChild(row2);
    root.appendChild(row3);
    root.appendChild(row4);
    root.appendChild(countdownEl);
    root.appendChild(hintEl);
    root.appendChild(U.el('div', { class: 'prac-progress' },
      U.el('div', { class: 'prac-progress-bar', style: { width: '0%' } })));
    var progressBar = root.querySelector('.prac-progress-bar');

    if (!engineOk()) {
      hintEl.textContent = '音频引擎不可用：无法播放练习（可先点击页面任意处初始化音频）。';
      startBtn.setAttribute('disabled', 'disabled');
      minusBtn.setAttribute('disabled', 'disabled');
      plusBtn.setAttribute('disabled', 'disabled');
    }

    /* —— 状态读写 —— */
    function readNums() {
      var s = Number(startTempoIn.value), t = Number(targetTempoIn.value);
      var k = Number(stepIn.value), r = Number(repeatIn.value);
      if (!isFinite(s) || s <= 0) s = 60;
      if (!isFinite(t) || t <= 0) t = s;
      if (!isFinite(k) || k <= 0) k = 5;
      if (!isFinite(r) || r <= 0) r = 1;
      st.target = clamp(Math.round(t), 20, 300);
      st.step = clamp(Math.round(k), 1, 40);
      st.repeat = clamp(Math.round(r), 1, 20);
      st.gradual = !!gradualCb.checked && st.target > s;
      return clamp(Math.round(s), 20, 300);
    }

    function getScore() {
      if (typeof opts.getScore !== 'function') return null;
      try { return opts.getScore(); } catch (e) { return null; }
    }

    function applyTempoToInputs(t) {
      tempoValue.textContent = t + ' BPM';
      targetValue.textContent = st.gradual ? ('目标 ' + st.target + ' BPM，' + st.step + ' BPM / ' + st.repeat + ' 遍') : '';
    }

    function updateUI() {
      tempoValue.textContent = (st.status === 'idle' && !st.transport ? '-' : String(st.tempo)) + ' BPM';
      passValue.textContent = st.pass > 0 ? ('第 ' + st.pass + ' 遍') : '第 0 遍';
      nowBar.textContent = st.bar >= 0 ? ('第 ' + (st.bar + 1) + ' 小节') : '第 — 小节';
      nowNote.textContent = st.note >= 0 ? ('第 ' + (st.note + 1) + ' 音') : '第 — 音';
      targetValue.textContent = st.gradual
        ? ('目标 ' + st.target + ' BPM｜每 ' + st.repeat + ' 遍 +' + st.step + ' BPM')
        : '';
      var playing = st.status === 'playing' || st.status === 'counting' || st.status === 'paused';
      pauseBtn.textContent = st.status === 'paused' ? '继续' : '暂停';
      pauseBtn.disabled = !playing;
      stopBtn.disabled = !playing;
      startBtn.disabled = playing || !engineOk();
      if (progressBar && st.gradual && st.target > 0) {
        var span = Math.max(1, st.target - (Number(startTempoIn.value) || st.target));
        var done = clamp((st.tempo - (Number(startTempoIn.value) || st.tempo)) / span, 0, 1);
        progressBar.style.setProperty('width', Math.round(done * 100) + '%');
      } else if (progressBar) {
        progressBar.style.setProperty('width', playing ? '100%' : '0%');
      }
    }

    /* —— 倒计时预备拍 —— */
    function pulseBeats() {
      var time = (getScore() && getScore().time) || { num: 4, den: 4 };
      try {
        if (APP.generator && APP.generator.beatsPerWholeOf) return APP.generator.beatsPerWholeOf(time.den);
      } catch (e) { /* 忽略 */ }
      return time.den === 8 ? 0.5 : 1;
    }

    function setCountdown(n) {
      if (n > 0) {
        countdownEl.textContent = String(n);
        countdownEl.classList.remove('is-hidden');
      } else {
        countdownEl.textContent = '';
        if (countdownEl.classList) countdownEl.classList.add('is-hidden');
      }
    }

    function runCountdown(n, tempo) {
      if (!n) return;
      setCountdown(n);                       /* 立刻显示第一拍，不让 UI 空等 */
      var sec = (60 / tempo) * pulseBeats();
      for (var i = 1; i <= n; i++) {
        (function (k) {
          st.timers.push(setTimeout(function () { setCountdown(n - k); }, k * sec * 1000));
        })(i);
      }
    }

    function clearTimers() {
      st.timers.forEach(function (t) { clearTimeout(t); });
      st.timers = [];
    }

    /* —— 自动翻页 / 滚动 —— */
    function scrollToBar(barIndex) {
      try {
        var doc = document;
        if (!doc || !doc.querySelector) return;
        var sheet = doc.querySelector('.score-sheet');
        var group = doc.querySelector('[data-bar-idx="' + barIndex + '"]');
        if (sheet && group && typeof sheet.scrollTo === 'function' && typeof group.offsetTop === 'number') {
          var top = Math.max(0, group.offsetTop - sheet.clientHeight / 3);
          sheet.scrollTo({ top: top, behavior: 'smooth' });
          return;
        }
        var target = sheet || (group && group.parentNode);
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (e) { /* DOM 里找不到就安全跳过 */ }
    }

    /* —— 播放 —— */
    function playCurrent(score) {
      if (!engineOk()) { hintEl.textContent = '音频引擎不可用，无法播放。'; return; }
      st.lastScore = score;
      st.pass += 1;
      st.passEnded = false;
      var passNo = st.pass;
      st.bar = -1;
      st.note = -1;
      var countIn = st.countIn;
      st.status = countIn > 0 ? 'counting' : 'playing';
      updateUI();
      hintEl.textContent = '';
      runCountdown(countIn, st.tempo);
      try {
        if (engineRef.init) { try { engineRef.init(); } catch (e) { /* 忽略 */ } }
        var tr = engineRef.playScore(score, {
          metronome: !!metroCb.checked,
          countIn: countIn,
          tempo: st.tempo,
          loop: !!loopCb.checked,
          timbre: 'clave',
          onNote: function (idx, bar, note, info) {
            st.bar = bar;
            st.note = (info && typeof info.index === 'number') ? info.index : idx;
            if (st.status === 'counting') st.status = 'playing';
            updateUI();
            try { if (typeof opts.onHighlight === 'function') opts.onHighlight(bar, st.note); } catch (e) { /* 忽略 */ }
            scrollToBar(bar);
          },
          onBar: function (bar) {
            st.bar = bar;
            if (st.status === 'counting') st.status = 'playing';
            updateUI();
            scrollToBar(bar);
          },
          onEnd: function () { onPassEnd(passNo); }
        });
        st.transport = tr;
        if (tr && typeof tr.on === 'function') {
          tr.on('end', function () { onPassEnd(passNo); });
        }
        st.playStartedAt = Date.now();
      } catch (e) {
        st.transport = null;
        st.status = 'idle';
        updateUI();
        hintEl.textContent = '播放失败：' + (e && e.message ? e.message : '未知错误');
      }
    }

    var endedToken = 0;
    function onPassEnd(passNo) {
      if (st.passEnded || passNo !== st.pass) return;   /* engine 会同时触发 'end' 与 onEnd，去重 */
      st.passEnded = true;
      var token = ++endedToken;
      var score = st.lastScore;
      var wasPlaying = st.status === 'playing' || st.status === 'counting';
      st.transport = null;
      if (!wasPlaying || st.destroyed) return;
      var secs = Math.max(0, (Date.now() - st.playStartedAt) / 1000);
      if (score && secs > 0.2) {
        try { record({ score: score, tempo: st.tempo, accuracy: null, seconds: secs }); } catch (e) { /* 忽略 */ }
      }
      st.passAtTempo += 1;

      var hasNext = st.gradual && st.tempo < st.target && !loopCb.checked;
      if (!hasNext) {
        st.status = 'idle';
        st.tempo = st.gradual ? st.target : st.tempo;
        setCountdown(0);
        updateUI();
        hintEl.textContent = st.gradual ? '速度渐变训练完成（达到目标速度 ' + st.target + ' BPM）。' : '本遍练习完成。';
        return;
      }

      var nextTempo = st.tempo;
      if (st.passAtTempo >= st.repeat) {
        nextTempo = Math.min(st.target, st.tempo + st.step);
        st.passAtTempo = 0;
      }
      st.status = 'between';
      updateUI();
      hintEl.textContent = '本遍完成，正在生成新乐段（' + nextTempo + ' BPM）…';

      if (typeof opts.onRequestNew !== 'function') {
        st.tempo = nextTempo;
        if (score) playCurrent(score);
        return;
      }
      try { opts.onRequestNew({ tempo: nextTempo }); } catch (e) { /* 忽略 */ }
      waitForScore(score, nextTempo, 0, token);
    }

    function waitForScore(prevScore, tempo, tries, token) {
      st.timers.push(setTimeout(function () {
        if (st.destroyed || token !== endedToken) return;
        if (st.status !== 'between') return;
        var s = getScore();
        if (s && s !== prevScore && s.bars && s.bars.length) {
          st.tempo = tempo;
          playCurrent(s);
          return;
        }
        if (tries >= 25) {
          /* 生成器没给出新乐段：用同一乐段以新速度继续，避免训练中断 */
          if (prevScore) { st.tempo = tempo; playCurrent(prevScore); return; }
          st.status = 'idle';
          updateUI();
          hintEl.textContent = '未能获取新乐段，速度渐变已停止。';
          return;
        }
        waitForScore(prevScore, tempo, tries + 1, token);
      }, 80));
    }

    /* —— 控制器 —— */
    function onStart() {
      if (!engineOk()) { U.toast('音频引擎不可用，无法开始练习', 'warn'); return; }
      var score = getScore();
      if (!score || !score.bars || !score.bars.length) {
        U.toast('当前没有乐段，请先生成', 'warn');
        hintEl.textContent = '当前没有乐段：先用生成器生成一段再开始练习。';
        return;
      }
      stop(true);
      st.destroyed = false;
      st.pass = 0;
      st.passAtTempo = 0;
      st.tempo = readNums();
      st.countIn = Number(countInSel.value) || 0;
      endedToken++;
      /* 确保 AudioContext 处于 running（warmup 始终 resolve，失败也不影响流程） */
      if (typeof engineRef.warmup === 'function') {
        try {
          var w = engineRef.warmup();
          if (w && typeof w.then === 'function') w.then(function () {}, function () {});
        } catch (e) { /* 忽略 */ }
      }
      playCurrent(score);
    }

    function onPause() {
      if (!st.transport) return;
      try {
        if (st.status === 'playing') {
          st.transport.pause();
          st.status = 'paused';
        } else if (st.status === 'paused') {
          st.transport.resume();
          st.status = 'playing';
        }
      } catch (e) { /* 忽略 */ }
      updateUI();
    }

    function stop(silent) {
      clearTimers();
      endedToken++;
      if (st.transport && typeof st.transport.stop === 'function') {
        try { st.transport.stop(); } catch (e) { /* 忽略 */ }
      }
      st.transport = null;
      st.status = 'idle';
      setCountdown(0);
      updateUI();
      if (!silent) hintEl.textContent = '已停止。';
    }

    function setTempo(bpm) {
      var v = clamp(Math.round(Number(bpm) || st.tempo), 20, 300);
      st.tempo = v;
      if (st.transport && typeof st.transport.setTempo === 'function') {
        try { st.transport.setTempo(v); } catch (e) { /* 忽略 */ }
      }
      updateUI();
      return v;
    }

    function getState() {
      return {
        status: st.status,
        tempo: st.tempo,
        target: st.target,
        step: st.step,
        repeat: st.repeat,
        gradual: st.gradual,
        countIn: st.countIn,
        metronome: !!metroCb.checked,
        loop: !!loopCb.checked,
        pass: st.pass,
        passAtTempo: st.passAtTempo,
        bar: st.bar,
        note: st.note
      };
    }

    function destroy() {
      st.destroyed = true;
      stop(true);
      U.clear(container);
    }

    /* 键盘：空格开始/暂停，Esc 停止 */
    function onKey(e) {
      if (st.destroyed) return;
      var tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); if (st.status === 'idle') onStart(); else onPause(); }
      else if (e.key === 'Escape') stop();
    }
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onKey);

    st.tempo = readNums();
    updateUI();

    return {
      root: root,
      start: onStart,
      stop: stop,
      pause: onPause,
      destroy: function () {
        if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('keydown', onKey);
        destroy();
      },
      setTempo: setTempo,
      getState: getState,
      scrollToBar: scrollToBar
    };
  }

  function emptyController() {
    var noop = function () {};
    return {
      start: noop, stop: noop, pause: noop, destroy: noop,
      setTempo: function (v) { return v; },
      getState: function () { return { status: 'idle', tempo: 0, pass: 0, bar: -1, note: -1 }; }
    };
  }

  /* ---------------- 导出 ---------------- */

  APP.practice = {
    storageKey: STORAGE_KEY,
    mount: mount,
    mountStats: mountStats,
    record: record,
    stats: stats,
    clearRecords: clearRecords,
    onChange: onChange,
    last7Days: last7Days
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.practice;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
