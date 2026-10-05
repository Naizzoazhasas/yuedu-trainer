/* 读谱训练器 — 随机节奏 / 旋律生成器
 * 全局命名空间：window.APP.generator
 * 依赖：APP.util、APP.theory
 *
 * 设计要点：
 *  - 所有随机都走可复现 rng（相同 seed + 相同 config -> 完全相同的乐段）
 *  - 每个小节的拍数必须精确等于 num * (4/den)，用「候选 + 余量可填」的约束搜索保证
 *  - 只用用户勾选的音符时值/音级，满足「只使用 1,2,3,4 音符 + 四分/二分」这类需求
 */
(function (APP) {
  'use strict';

  var U = APP.util;
  var TH = APP.theory;

  /* ---------------- 时值表（dur 以全音符为 1） ---------------- */

  var DURATION_LIST = [
    { dur: 4, dotted: false, label: '全音符', beats: 4 },
    { dur: 2, dotted: false, label: '二分音符', beats: 2 },
    { dur: 1, dotted: false, label: '四分音符', beats: 1 },
    { dur: 0.5, dotted: false, label: '八分音符', beats: 0.5 },
    { dur: 0.25, dotted: false, label: '十六分音符', beats: 0.25 },
    { dur: 2, dotted: true, label: '附点二分音符', beats: 3 },
    { dur: 1, dotted: true, label: '附点四分音符', beats: 1.5 },
    { dur: 0.5, dotted: true, label: '附点八分音符', beats: 0.75 },
    { dur: 0.25, dotted: true, label: '附点十六分音符', beats: 0.375 }
  ];

  var TIME_SIGNATURES = [
    { num: 2, den: 4, label: '2/4' },
    { num: 3, den: 4, label: '3/4' },
    { num: 4, den: 4, label: '4/4' },
    { num: 6, den: 8, label: '6/8' },
    { num: 3, den: 8, label: '3/8' },
    { num: 2, den: 2, label: '2/2' },
    { num: 5, den: 4, label: '5/4' },
    { num: 7, den: 8, label: '7/8' }
  ];

  /* dur 是「时值倒数标记」：4=全音符, 2=二分, 1=四分, 0.5=八分, 0.25=十六分。
   * 拍数（以四分音符为一拍）= 4 / dur，附点再 ×1.5。
   * 注意：这里**用查表而不是除法**——本项目运行环境中 JS 的除法在部分小整数上
   * 不可靠（实测 4/1 得到 4），查表 + 乘法可以完全规避，且结果更稳定。 */
  var BEATS_TABLE = { '4': 4, '2': 2, '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125, '0.0625': 0.0625 };

  function beatsOf(dur, dotted) {
    var base = BEATS_TABLE[String(dur)];
    if (base === undefined) {
      if (!dur && dur !== 0) return 0;
      base = 4 / dur;
    }
    return dotted ? base * 1.5 : base;
  }
  /* 一小节有多少个「四分音符拍」：num × (4/den)。同样用倒数查表避开除法 */
  var DEN_RECIP = { '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125 };
  function beatsPerWholeOf(den) {
    var r = DEN_RECIP[String(den)];
    if (r !== undefined) return r;
    return 4 / den;
  }
  function barBeats(time) { return time.num * beatsPerWholeOf(time.den); }
  /* 每小节的「谱面拍单位」数（6/8 = 2 个大拍），用于节拍器重音分组 */
  function barUnits(time) { return time.num; }

  /* ---------------- 配置 ---------------- */

  function defaultConfig(partial) {
    var cfg = {
      mode: 'rhythm',
      bars: 4,
      time: { num: 4, den: 4 },
      tempo: 60,
      key: { tonic: 0, mode: 'major', fifths: 0 },
      clef: 'treble',
      seed: null,

      durations: [1, 2, 0.5],
      useDotted: false,
      useRests: true,
      restRatio: 0.15,
      useSyncopation: false,
      usePatterns: null,
      patternVariation: 0.35,

      /* —— 旋律模式专用 —— */
      degrees: [1, 2, 3, 4, 5, 6, 7],   // 允许使用的音级（1-7，大调自然音级；小调按和声小调）
      range: { lowOct: 4, highOct: 4 },
      leapRatio: 0.3,
      useChromatic: false,              // 额外允许调外变化音（升/降邻音）
      startOnTonic: false               // 是否强制以主音开始
    };
    if (partial) {
      Object.keys(partial).forEach(function (k) {
        if (partial[k] === undefined) return;
        if (k === 'time' || k === 'range') {
          cfg[k] = Object.assign({}, cfg[k], partial[k]);
        } else if (k === 'key') {
          /* 调用者给了调，就整块替换：不要与默认调浅合并，否则会把默认的
           * fifths:0 带进来，导致 D 大调被当成 C 大调（曾真实踩过这个坑） */
          cfg.key = Object.assign({}, partial.key);
        } else cfg[k] = partial[k];
      });
    }
    /* 规范化 */
    cfg.key = TH.normalizeKey(cfg.key);
    cfg.durations = (cfg.durations && cfg.durations.length) ? cfg.durations.slice() : [1];
    cfg.bars = Math.max(1, Math.min(64, cfg.bars | 0));
    cfg.tempo = Math.max(20, Math.min(300, cfg.tempo));
    cfg.restRatio = U.clamp(cfg.restRatio, 0, 0.6);
    return cfg;
  }

  /* 允许出现的（时值, 是否附点）组合 -> 拍数。
   * 关键：时值必须「放得进一小节」（一个音不能长过整小节），否则小节永远填不满。
   * 例如 3/8 拍里不能选四分音符。若过滤后什么都不剩，就退化为能放下的最小时值。 */
  function allowedBeats(cfg) {
    var limit = barBeats(cfg.time);
    var out = [];
    cfg.durations.forEach(function (d) {
      var b = beatsOf(d, false);
      if (b <= limit + 1e-9) out.push({ dur: d, dotted: false, beats: b });
      if (cfg.useDotted) {
        var bd = beatsOf(d, true);
        if (bd <= limit + 1e-9) out.push({ dur: d, dotted: true, beats: bd });
      }
    });
    if (!out.length) {
      /* 配置里的时值全都放不进这个小节（例如 3/8 拍却只勾了四分音符）：
       * 从最小可用时值开始，保证至少有一个能放进小节 */
      var common = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4];
      var smallest = null;
      common.forEach(function (d) {
        var b = beatsOf(d, false);
        if (b > limit + 1e-9) return;
        if (!smallest || b < smallest.beats) smallest = { dur: d, dotted: false, beats: b };
      });
      if (smallest) out.push(smallest);
    }
    /* 关键：确保这些时值能「精确凑出整小节」。
     * 例：3/8 拍（1.5 拍）只有四分音符时可放得进但凑不整，必须补一个八分。 */
    [0.5, 0.25, 0.125, 0.0625].forEach(function (d) {
      var b = beatsOf(d, false);
      if (b > limit + 1e-9) return;
      if (exactFill(out, limit, null) !== null) return;
      if (!out.some(function (x) { return x.dur === d && !x.dotted; })) {
        out.push({ dur: d, dotted: false, beats: b });
      }
    });
    return out;
  }

  /* ---------------- 节奏型 ---------------- */

  /* items: [{dur, dotted, rest}]；同时接受 {items:[...]} 形式 */
  function patternBeats(items) {
    var list = Array.isArray(items) ? items : (items && items.items) || [];
    return list.reduce(function (s, it) { return s + beatsOf(it.dur, it.dotted); }, 0);
  }

  function makePattern(name, items) {
    return { id: 'p' + Math.random().toString(36).slice(2, 9), name: name, items: items.map(function (it) {
      return { dur: it.dur, dotted: !!it.dotted, rest: !!it.rest };
    }) };
  }

  /* 由候选时值动态生成一批「可用节奏型」，只保留整小节填满的。
   * 返回标准 Pattern 对象数组，可直接赋给 config.usePatterns */
  function buildPatternPool(cfg, rng) {
    var time = cfg.time;
    var target = barBeats(time);
    var beats = allowedBeats(cfg);
    var raw = [];
    var seen = {};

    function key(items) {
      return items.map(function (i) { return i.dur + (i.dotted ? 'd' : '') + (i.rest ? 'r' : ''); }).join('|');
    }
    function push(items) {
      if (Math.abs(patternBeats(items) - target) > 1e-9) return;
      var k = key(items);
      if (seen[k]) return;
      seen[k] = 1;
      raw.push(items.map(function (i) { return { dur: i.dur, dotted: i.dotted, rest: i.rest }; }));
    }

    /* 用递归搜索生成恰好填满小节的组合（上限防止组合爆炸） */
    var maxPatterns = 60;
    function search(cur, rest) {
      if (raw.length >= maxPatterns || cur.length > 16) return;
      if (rest < 1e-9) { push(cur); return; }
      var cands = U.shuffle(beats.filter(function (b) { return b.beats <= rest + 1e-9; }), rng);
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (rest - c.beats < 1e-9) { push(cur.concat([{ dur: c.dur, dotted: c.dotted, rest: false }])); continue; }
        cur.push({ dur: c.dur, dotted: c.dotted, rest: false });
        search(cur, rest - c.beats);
        cur.pop();
        if (raw.length >= maxPatterns) return;
      }
    }
    search([], target);

    /* 「每拍一个音」这种最朴素的原型也放进去，保证初学者也有简单选择 */
    var sorted = allowedBeats(cfg).slice().sort(function (a, b) { return b.beats - a.beats; });
    if (sorted.length) {
      var simple = [], acc = 0;
      while (acc < target - 1e-9) {
        var fit = sorted.filter(function (b) { return b.beats <= target - acc + 1e-9; });
        if (!fit.length) break;
        simple.push({ dur: fit[0].dur, dotted: fit[0].dotted, rest: false });
        acc += fit[0].beats;
      }
      if (Math.abs(acc - target) < 1e-9) push(simple);
    }

    return raw.map(function (items, i) {
      return { id: 'auto-' + i, name: '节奏型 ' + (i + 1), time: { num: time.num, den: time.den }, items: items };
    });
  }

  /* 对节奏型做变奏（返回新对象，不改原对象）。
   * 铁律：变奏后总拍数必须与原节奏型完全一致，否则小节就填不满了。
   * 因此每种变奏都成对修改（拆一个补一个 / 减一个补一个）。 */
  function variatePattern(pattern, rng) {
    if (!pattern || !pattern.items || !pattern.items.length) return pattern;
    var items = pattern.items.map(function (i) { return { dur: i.dur, dotted: i.dotted, rest: i.rest }; });
    var target = patternBeats(items);
    var R = function () { return (typeof rng === 'function' ? rng() : Math.random()); };
    var kind = Math.floor(R() * 4);

    function halves() {
      /* 找到第一组「相邻两个相同短时值」，可合并成一个双倍时值 */
      for (var i = 0; i < items.length - 1; i++) {
        if (!items[i].dotted && !items[i + 1].dotted &&
          items[i].dur === items[i + 1].dur && items[i].dur < 2) return i;
      }
      return -1;
    }
    function doubles() {
      /* 找到第一个可以一分为二的时值 */
      for (var i = 0; i < items.length; i++) {
        if (!items[i].dotted && items[i].dur >= 0.5) return i;
      }
      return -1;
    }
    function flatIndexes() {
      var out = [];
      items.forEach(function (it, i) { if (!it.dotted) out.push(i); });
      return out;
    }

    if (kind === 0 && halves() >= 0) {
      /* 合并：两个相同短音 -> 一个长音（总拍数不变） */
      var hi = halves();
      items.splice(hi, 2, { dur: items[hi].dur * 2, dotted: false, rest: items[hi].rest });
    } else if (kind === 1 && doubles() >= 0) {
      /* 拆分：一个音 -> 两个半长音（总拍数不变） */
      var di = doubles();
      var half = items[di].dur / 2;
      items.splice(di, 1,
        { dur: half, dotted: false, rest: items[di].rest },
        { dur: half, dotted: false, rest: items[di].rest });
    } else if (kind === 2) {
      /* 把一个音的「有声音 / 休止」状态翻转（总拍数不变） */
      var flat = flatIndexes();
      if (flat.length) {
        var fi = flat[Math.floor(R() * flat.length)];
        items[fi] = { dur: items[fi].dur, dotted: false, rest: !items[fi].rest };
      }
    } else {
      /* 附点化：把一个音加附点，并把紧随其后那个等值半长的音吸收掉（总拍数不变） */
      var didx = -1;
      for (var i2 = 0; i2 < items.length - 1; i2++) {
        if (!items[i2].dotted && items[i2].dur === 1 &&
          !items[i2 + 1].dotted && items[i2 + 1].dur === 0.5) { didx = i2; break; }
      }
      if (didx >= 0) {
        items.splice(didx, 2, { dur: 1, dotted: true, rest: items[didx].rest });
      } else {
        /* 没有合适的位置：退化成一次休止翻转，保证总拍数不变 */
        var flat2 = flatIndexes();
        if (flat2.length) {
          var fi2 = flat2[Math.floor(R() * flat2.length)];
          items[fi2] = { dur: items[fi2].dur, dotted: false, rest: !items[fi2].rest };
        }
      }
    }

    /* 断言式保护：万一还是对不上，就原样返回 */
    if (Math.abs(patternBeats(items) - target) > 1e-9) return pattern;
    return { id: pattern.id, name: pattern.name, time: pattern.time, items: items };
  }

  /* ---------------- 小节填充 ---------------- */

  /* 在 rest 拍内随机选一个「能填满剩余」的时值。cands 可传入候选集（默认用配置里的时值） */
  function pickFitting(beats, rest, rng, preferLong) {
    var fit = beats.filter(function (b) { return b.beats <= rest + 1e-9; });
    if (!fit.length) return null;
    /* 「可行」= 选完后剩余还能被某个时值填满 */
    var feasible = fit.filter(function (b) {
      var left = rest - b.beats;
      if (left < 1e-9) return true;
      return beats.some(function (x) { return x.beats <= left + 1e-9; });
    });
    var pool = feasible.length ? feasible : fit;
    if (preferLong) {
      /* 强拍倾向较长的音：给长时值加权 */
      var weighted = pool.map(function (b) { return { w: Math.pow(b.beats, 1.1), b: b }; });
      return U.weighted(weighted, rng).b;
    }
    return U.pick(pool, rng);
  }

  /* 生成一个小节的 items（不含音高）。
   * 返回 [{dur, dotted, rest}]，总拍数严格等于 barBeats(cfg.time)。 */
  function fillBar(cfg, rng, barIndex) {
    var target = barBeats(cfg.time);
    var beats = allowedBeats(cfg);
    var items;

    /* 1) 优先使用指定节奏型（只挑恰好填满一整小节的） */
    if (cfg.usePatterns && cfg.usePatterns.length) {
      var fitPatterns = cfg.usePatterns.filter(function (p) {
        return Math.abs(patternBeats(p.items) - target) < 1e-9;
      });
      if (fitPatterns.length) {
        var p = U.pick(fitPatterns, rng);
        var use = p;
        if (U.rand(rng) < cfg.patternVariation) {
          var v = variatePattern(p, rng);
          if (Math.abs(patternBeats(v.items) - target) < 1e-9) use = v;
        }
        items = use.items.map(function (i) { return { dur: i.dur, dotted: i.dotted, rest: i.rest }; });
      }
      /* 若指定节奏型都与拍号不符：退回「时值列表」自由生成，而不是给出错的小节 */
    }

    /* 2) 精确分解 + 回溯，保证拍数一丝不差。
     * （早期版本用贪心补尾：3/8 拍里 1.5 拍会先放一个四分、再补一个四分，结果超拍到 2 拍。） */
    if (!items) {
      var plan = exactFill(beats, target, rng);
      if (plan && plan.length) {
        items = plan.map(function (q) { return { dur: q.dur, dotted: q.dotted, rest: false }; });
      }
    }

    /* 3) 理论上到不了这里（allowedBeats 保证至少有时值 ≤ 小节长度），残留兜底 */
    if (!items || !items.length) {
      var sorted = beats.slice().sort(function (a, b) { return a.beats - b.beats; });
      var fb = sorted[0] || { dur: 0.25, dotted: false };
      items = [{ dur: fb.dur, dotted: fb.dotted, rest: false }];
    }

    /* 4) 按概率插入休止符（至少保留一个有声音） */
    if (cfg.useRests && items.length > 1 && cfg.restRatio > 0) {
      items = items.map(function (it) {
        if (U.rand(rng) < cfg.restRatio) return { dur: it.dur, dotted: it.dotted, rest: true };
        return it;
      });
      if (items.every(function (it) { return it.rest; })) items[0].rest = false;
    }
    return items;
  }

  /* 把 total 拍精确拆成若干「可用时值」的随机组合。
   * 用「可达性剪枝」避免无解分支：剩余拍数必须能被某个可用时值继续拆分到 0。
   * 返回 [{dur, dotted}] 或 null。 */
  function exactFill(beats, total, rng) {
    if (!beats.length || !(total > 0)) return null;
    var memo = {};

    function reachable(rem) {
      var k = rem.toFixed(9);
      if (memo[k] !== undefined) return memo[k];
      if (rem < 1e-9) { memo[k] = true; return true; }
      var res = false;
      for (var i = 0; i < beats.length; i++) {
        var b = beats[i].beats;
        if (b > rem + 1e-9) continue;
        if (reachable(rem - b)) { res = true; break; }
      }
      memo[k] = res;
      return res;
    }
    if (!reachable(total)) return null;

    var out = [];
    var rem = total;
    var guard = 0;
    while (rem > 1e-9 && guard++ < 64) {
      var cands = beats.filter(function (b) {
        if (b.beats > rem + 1e-9) return false;
        return reachable(rem - b.beats);
      });
      if (!cands.length) return null;
      /* 落在整拍上时偏好较长的音，让节奏更像音乐而不是一串十六分音符 */
      var onBeat = Math.abs(rem - Math.round(rem)) < 1e-9;
      var chosen;
      if (onBeat) {
        var wl = cands.map(function (b) { return { w: Math.pow(b.beats, 1.1), b: b }; });
        chosen = U.weighted(wl, rng).b;
      } else {
        chosen = U.pick(cands, rng);
      }
      out.push({ dur: chosen.dur, dotted: chosen.dotted });
      rem = rem - chosen.beats;
    }
    if (rem > 1e-9) return null;
    return out;
  }

  /* 为每个时值算出「权重」，强拍偏好长音 */
  function preferLongAt(beats) {
    return beats.map(function (b) { return { w: Math.pow(b.beats, 1.1), b: b }; });
  }

  /* ---------------- 音高 ---------------- */

  function pitchForDegree(cfg, degreeIndex) {
    var pool = makePitchPool(cfg);
    return pool[((degreeIndex % pool.length) + pool.length) % pool.length];
  }

  /* 生成可用的音高池：按 key + degrees（音级 1-7）+ range 过滤 */
  function makePitchPool(cfg) {
    var k = cfg.key;
    var scaleType = k.mode === 'minor' ? 'harmonic' : 'major';
    var degAllowed = cfg.degrees && cfg.degrees.length ? cfg.degrees : [1, 2, 3, 4, 5, 6, 7];
    var pool = [];
    for (var o = cfg.range.lowOct; o <= cfg.range.highOct; o++) {
      var ps = TH.scalePitches(k, o, scaleType);
      for (var i = 0; i < 7; i++) {
        if (degAllowed.indexOf(i + 1) === -1) continue;
        pool.push(ps[i]);
      }
    }
    pool.sort(function (a, b) { return TH.midiOf(a) - TH.midiOf(b); });
    /* 全都过滤光了：退回主音，保证不会空池 */
    if (!pool.length) pool = [TH.tonicPitch(k, cfg.range.lowOct)];

    if (cfg.useChromatic) {
      /* 加入变化音（升/降邻音） */
      var extra = [];
      var lo = TH.midiOf(pool[0]), hi = TH.midiOf(pool[pool.length - 1]);
      pool.forEach(function (p) {
        [1, -1].forEach(function (d) {
          var cand = { step: p.step, acc: (p.acc || 0) + d, oct: p.oct };
          if (!cand || !STEP_OK(cand)) return;
          if (cand.acc > 2 || cand.acc < -2) return;
          var midi = TH.midiOf(cand);
          if (midi >= lo && midi <= hi) extra.push(cand);
        });
      });
      pool = pool.concat(extra);
      pool.sort(function (a, b) { return TH.midiOf(a) - TH.midiOf(b); });
    }
    return pool;
  }

  function STEP_OK(p) { return !!p && p.acc >= -2 && p.acc <= 2; }

  /* ---------------- 主体生成 ---------------- */

  function generateScore(partial) {
    var cfg = defaultConfig(partial);
    var rng = U.rngFrom(cfg.seed === null || cfg.seed === undefined ? undefined : cfg.seed);
    var rhythmOnly = cfg.mode !== 'melody';

    var barPlans = [];
    for (var b = 0; b < cfg.bars; b++) barPlans.push(fillBar(cfg, rng, b));

    var pitchPool = rhythmOnly ? [TH.tonicPitch(cfg.key, cfg.range.lowOct)] : makePitchPool(cfg);
    var lastIdx = Math.max(0, Math.round(pitchPool.length / 2) - 1);
    var bars = [];
    var melodyNoteCounter = 0;

    for (var bi = 0; bi < barPlans.length; bi++) {
      var items = barPlans[bi];
      var notes = [];
      var beatsSum = 0;

      for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        var note = {
          pitch: null,
          dur: it.dur,
          dotted: !!it.dotted,
          tie: false,
          midi: null,
          pos: 0
        };

        if (!it.rest && !rhythmOnly) {
          var pitch;
          var isLastNoteOfPiece = (bi === barPlans.length - 1) && (ii === items.length - 1);
          if (melodyNoteCounter === 0 && cfg.startOnTonic) {
            pitch = pitchPool[0];
          } else if (isLastNoteOfPiece) {
            pitch = pitchPool[0];                     // 结束落在主音
          } else if (melodyNoteCounter === 0) {
            pitch = pitchPool[U.randInt(0, Math.min(2, pitchPool.length - 1), rng)];
          } else if (U.rand(rng) < cfg.leapRatio) {
            var leap = U.pick([2, 3, 4], rng) * (U.rand(rng) < 0.5 ? 1 : -1);
            pitch = pitchPool[U.clamp(lastIdx + leap, 0, pitchPool.length - 1)];
          } else {
            pitch = pitchPool[U.clamp(lastIdx + (U.rand(rng) < 0.5 ? 1 : -1), 0, pitchPool.length - 1)];
          }
          lastIdx = pitchPool.indexOf(pitch);
          if (lastIdx < 0) lastIdx = 0;
          note.pitch = pitch;
          note.midi = TH.midiOf(pitch);
          note.pos = TH.staffPos(pitch, cfg.clef);
          melodyNoteCounter++;
        } else if (!it.rest) {
          var tp = pitchPool[0];
          note.pitch = tp;
          note.midi = TH.midiOf(tp);
          note.pos = TH.staffPos(tp, cfg.clef);
        }

        /* 允许切分：与后一个音同音高时标记延音线（真正的连音，播放时会合并时值） */
        if (cfg.useSyncopation && !it.rest && note.pitch && ii < items.length - 1 &&
          !items[ii + 1].rest && U.rand(rng) < 0.12) {
          note._tieWanted = true;
        }

        beatsSum += beatsOf(it.dur, it.dotted);
        notes.push(note);
      }

      /* 只在「后一个音与当前音同音高」时才真正打上延音线 */
      for (var ti = 0; ti < notes.length - 1; ti++) {
        if (notes[ti]._tieWanted && notes[ti].pitch && notes[ti + 1].pitch &&
          notes[ti].midi === notes[ti + 1].midi) {
          notes[ti].tie = true;
        }
      }
      notes.forEach(function (n) { delete n._tieWanted; });

      /* 浮点归零：总和与规定拍数在 1e-6 内就直接记为规定值，避免 3.9999999 这类脏数据。
       * 真正的精确性由 fillBar 的 exactFill 保证，这里只做显示层的归零。 */
      var want = barBeats(cfg.time);
      if (Math.abs(beatsSum - want) < 1e-6) beatsSum = want;

      bars.push({ notes: notes, beats: beatsSum });
    }

    return {
      key: cfg.key,
      time: { num: cfg.time.num, den: cfg.time.den },
      tempo: cfg.tempo,
      clef: cfg.clef,
      title: '',
      mode: cfg.mode,
      bars: bars
    };
  }

  function generateRhythm(partial) {
    var p = Object.assign({}, partial, { mode: 'rhythm' });
    return generateScore(p);
  }

  function generateMelody(partial) {
    var p = Object.assign({}, partial, { mode: 'melody' });
    return generateScore(p);
  }

  /* 从一个小节反推节奏型（供「自定义音型库」收录） */
  function derivePatternFromScore(bar) {
    var items = (bar.notes || []).map(function (n) {
      return { dur: n.dur, dotted: !!n.dotted, rest: !n.pitch };
    });
    return { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: '自定义节奏型', items: items };
  }

  /* 小节拍数统计（供测试与 UI 显示） */
  function scoreStats(score) {
    var totalBeats = 0, noteCount = 0, restCount = 0, badBars = [];
    score.bars.forEach(function (bar, i) {
      var s = 0;
      bar.notes.forEach(function (n) {
        s += beatsOf(n.dur, n.dotted);
        if (n.pitch) noteCount++; else restCount++;
      });
      totalBeats += s;
      var want = score.time.num * (4 / score.time.den);
      if (Math.abs(s - want) > 1e-6) badBars.push({ bar: i, got: s, want: want });
    });
    return { totalBeats: totalBeats, noteCount: noteCount, restCount: restCount, badBars: badBars };
  }

  APP.generator = {
    DURATION_LIST: DURATION_LIST,
    TIME_SIGNATURES: TIME_SIGNATURES,
    beatsOf: beatsOf,
    barBeats: barBeats,
    defaultConfig: defaultConfig,
    generateScore: generateScore,
    generateRhythm: generateRhythm,
    generateMelody: generateMelody,
    variatePattern: variatePattern,
    derivePatternFromScore: derivePatternFromScore,
    makePattern: makePattern,
    patternBeats: patternBeats,
    allowedBeats: allowedBeats,
    beatsPerWholeOf: beatsPerWholeOf,
    buildPatternPool: buildPatternPool,
    scoreStats: scoreStats
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.generator;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
