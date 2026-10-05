/* 读谱训练器 — 乐器音阶表（吉他 / 尤克里里 / 贝斯 / 十孔口琴 / 竖笛 / 钢琴）
 * 全局命名空间：window.APP.instruments
 * 依赖：APP.theory（音高换算一律走 theory，本模块不自行实现音高换算）
 * 契约见 docs/CONTRACTS.md 第 8 节；本文件不使用 import / export / require。
 *
 * ── 竖笛（RECORDER）孔位编号约定 ──────────────────────────────
 *   0      = 背面拇指孔（左手拇指）
 *   1,2,3  = 正面左侧三孔，自上而下：左手食指 / 中指 / 无名指
 *   4,5,6,7= 正面右侧四孔，自上而下：右手食指 / 中指 / 无名指 / 小指
 *   6、7 号为双孔：数据中的 0.5（半孔）表示“双孔只按住/放开其中一个”，
 *   渲染时合并为一个圆点（半实心）表示，教学上足够。
 *   状态值：0 = 开放（放开），1 = 按住（闭孔），0.5 = 半孔（拇指半开或双孔半开）。
 *   指法为巴洛克（英式）体系；高音区（E6 以上）拇指一律“半孔（pinch）”。
 *
 * ── 压音（bend）说明 ────────────────────────────────────────
 *   口琴压音深度各家教学资料略有差异，这里取流传最广的标准值：
 *   吸气压音 1 孔 1 个半音、2 孔 2 个半音（G4→F#4→F4）、3 孔 3 个半音
 *   （B4→Bb4→A4→Ab4）、4/6/8/10 孔各 1 个半音；吹气压音 8/9/10 孔各 1 个半音。
 *   （部分入门资料把 3 孔吸压音简写为 1 个半音，此处按标准值给出，属近似。）
 */
(function (APP) {
  'use strict';

  APP = APP || (window.APP = {});

  var NS = 'http://www.w3.org/2000/svg';

  /* SVG 内联着色的固定色值：PNG 导出时不依赖外部 CSS 变量 */
  var C = {
    bg: '#ffffff',
    ink: '#22293a',
    sub: '#5b6476',
    dim: '#a9b2c1',
    faint: '#dfe4ee',
    line: '#79839a',
    accent: '#2f6fed',
    accent2: '#e8734a',
    soft: '#eaf1fe',
    panel: '#f6f8fc',
    white: '#ffffff'
  };

  /* 黑键音级（相对 C 的半音数） */
  var BLACK_PC = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };

  /* ============================================================
   *  一、乐器数据
   * ============================================================ */

  /* 吉他：标准调弦 EADGBE，6 弦（低音 E2）→ 1 弦（高音 E4），品格 0..15 */
  var GUITAR = {
    id: 'guitar',
    name: '吉他',
    kind: 'fret',
    desc: '标准调弦 EADGBE（6→1 弦），品格 0–15；六线谱式排布（1 弦在上）',
    topNote: '1 弦（最细）在上，6 弦（最粗）在下',
    tuning: 'EADGBE',
    /* 音高为 midi：E2=40 A2=45 D3=50 G3=55 B3=59 E4=64 */
    strings: [
      { n: 6, midi: 40, label: 'E2', gauge: 0.34 },  // 最粗
      { n: 5, midi: 45, label: 'A2', gauge: 0.30 },
      { n: 4, midi: 50, label: 'D3', gauge: 0.26 },
      { n: 3, midi: 55, label: 'G3', gauge: 0.22 },
      { n: 2, midi: 59, label: 'B3', gauge: 0.18 },
      { n: 1, midi: 64, label: 'E4', gauge: 0.14 }   // 最细
    ],
    maxFret: 15,
    markers: [3, 5, 7, 9, 12, 15]   // 品位记号；12 品为双点
  };

  /* 尤克里里：GCEA（reentrant 高音 G 调弦），品格 0..12 */
  var UKULELE = {
    id: 'ukulele',
    name: '尤克里里',
    kind: 'fret',
    desc: '标准调弦 GCEA（reentrant，4 弦 G4 比 3 弦 C4 高），品格 0–12',
    topNote: '1 弦在上，4 弦在下；4 弦 G4 是高音弦（reentrant），音高比 3 弦 C4 更高',
    tuning: 'GCEA',
    strings: [
      { n: 4, midi: 67, label: 'G4', gauge: 0.28 },  // 高音 G（reentrant）
      { n: 3, midi: 60, label: 'C4', gauge: 0.26 },
      { n: 2, midi: 64, label: 'E4', gauge: 0.22 },
      { n: 1, midi: 69, label: 'A4', gauge: 0.18 }
    ],
    maxFret: 12,
    markers: [5, 7, 10, 12]
  };

  /* 贝斯：EADG 四弦，品格 0..12 */
  var BASS = {
    id: 'bass',
    name: '贝斯',
    kind: 'fret',
    desc: '标准调弦 EADG（4→1 弦），品格 0–12',
    topNote: '1 弦（最细）在上，4 弦（最粗）在下',
    tuning: 'EADG',
    strings: [
      { n: 4, midi: 28, label: 'E1', gauge: 0.36 },  // 低音 E
      { n: 3, midi: 33, label: 'A1', gauge: 0.32 },
      { n: 2, midi: 38, label: 'D2', gauge: 0.28 },
      { n: 1, midi: 43, label: 'G2', gauge: 0.24 }
    ],
    maxFret: 12,
    markers: [3, 5, 7, 9, 12]
  };

  /* 十孔全音阶口琴：C 调 Richter 调弦 */
  var HARMONICA = {
    id: 'harmonica',
    name: '十孔口琴',
    kind: 'harmonica',
    desc: 'C 调 Richter 调弦，孔 1–10，含吹音 / 吸音 / 常见压音（近似值）',
    /* 吹：C4 E4 G4 C5 E5 G5 C6 E6 G6 C7 */
    blow: [60, 64, 67, 72, 76, 79, 84, 88, 91, 96],
    /* 吸：D4 G4 B4 D5 F5 A5 B5 D6 F6 A6 */
    draw: [62, 67, 71, 74, 77, 81, 83, 86, 89, 93],
    /* 吸气压音深度（半音数），按孔号索引 */
    drawBendDepth: { 1: 1, 2: 2, 3: 3, 4: 1, 6: 1, 8: 1, 10: 1 },
    /* 吹气压音深度（半音数） */
    blowBendDepth: { 8: 1, 9: 1, 10: 1 }
  };

  /* 竖笛 / 八孔竖笛：巴洛克指法，C5..D7（两个八度多）
   * holes 字符串 8 个字符，依次为孔 0（拇指）与孔 1..7（正面自上而下）：
   *   X = 按住(1)   O = 开放(0)   / = 半孔(0.5)
   */
  var RECORDER = {
    id: 'recorder',
    name: '竖笛',
    kind: 'recorder',
    desc: '八孔竖笛，巴洛克（英式）指法，C5–D7；0=背面拇指孔，1–7=正面自上而下',
    holeOrder: '0 = 背面拇指孔；1,2,3 = 正面左手食指/中指/无名指；4,5,6,7 = 正面右手食指/中指/无名指/小指（自上而下）',
    notes: [
      { midi: 72, holes: 'XXXXXXXX' }, // C5  全按
      { midi: 73, holes: 'XXXXXXX/' }, // C#5 第 7 孔（双孔）半开
      { midi: 74, holes: 'XXXXXXXO' }, // D5
      { midi: 75, holes: 'XXXXXX/O' }, // D#5 第 6 孔半开
      { midi: 76, holes: 'XXXXXXOO' }, // E5
      { midi: 77, holes: 'XXXXXOXX' }, // F5  第 5 孔开放（交叉指法）
      { midi: 78, holes: 'XXXXOXXO' }, // F#5 第 4 孔开放（交叉指法）
      { midi: 79, holes: 'XXXXOOOO' }, // G5
      { midi: 80, holes: 'XXXOXX/O' }, // G#5 交叉指法 + 第 6 孔半开
      { midi: 81, holes: 'XXXOOOOO' }, // A5
      { midi: 82, holes: 'XXOXXOOO' }, // Bb5 交叉指法
      { midi: 83, holes: 'XXOOOOOO' }, // B5
      { midi: 84, holes: 'XOXOOOOO' }, // C6  拇指按住 + 第 2 孔（叉指）
      { midi: 85, holes: 'OXXOOOOO' }, // C#6 拇指开放
      { midi: 86, holes: 'OOXOOOOO' }, // D6
      { midi: 87, holes: 'OOXXXXXO' }, // D#6
      { midi: 88, holes: '/XXXXXOO' }, // E6  拇指半孔（pinch）
      { midi: 89, holes: '/XXXXOXO' }, // F6
      { midi: 90, holes: '/XXXOXOO' }, // F#6
      { midi: 91, holes: '/XXXOOOO' }, // G6
      { midi: 92, holes: '/XXOXOOO' }, // G#6
      { midi: 93, holes: '/XXOOOOO' }, // A6
      { midi: 94, holes: '/XXOXXX/' }, // Bb6
      { midi: 95, holes: '/XXOXXOO' }, // B6
      { midi: 96, holes: '/XOOXXOO' }, // C7
      { midi: 97, holes: '/XOXXOXO' }, // C#7
      { midi: 98, holes: '/XOXXOX/' }  // D7
    ]
  };

  /* 钢琴：88 键 A0(21) .. C8(108) */
  var PIANO = {
    id: 'piano',
    name: '钢琴',
    kind: 'piano',
    desc: '88 键 A0–C8，白键/黑键全音位；position = { key: midi, black: boolean }',
    lowMidi: 21,   // A0
    highMidi: 108  // C8
  };

  var ALL = [GUITAR, UKULELE, BASS, HARMONICA, RECORDER, PIANO];
  var BY_ID = {};
  ALL.forEach(function (x) { BY_ID[x.id] = x; });

  /* ============================================================
   *  二、基础工具
   * ============================================================ */

  function TH() { return APP.theory; }

  function joinStr(s, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  }

  /* 调：undefined 时按 fallbackC 决定是否用 C 大调兜底；null/false 表示“无调” */
  function resolveKey(k, fallbackC) {
    var T = TH();
    if (!T) return null;
    if (k === null || k === false) return null;
    if (k === undefined || k === '') return fallbackC ? T.parseKey('C major') : null;
    if (typeof k === 'object') return T.normalizeKey(k);
    return T.parseKey(String(k));
  }

  function mkSet(arr) {
    var o = {};
    (arr || []).forEach(function (m) { if (m !== null && m !== undefined) o[Math.round(m)] = true; });
    return o;
  }

  var _idxCache = {};

  /* 建立“midi -> 音位”索引（用默认 C 大调生成，只用于查位置） */
  function midiIndex(id) {
    if (_idxCache[id]) return _idxCache[id];
    var map = {};
    notesOf(id).forEach(function (n) {
      if (!map[n.midi]) map[n.midi] = [];
      map[n.midi].push(n);
    });
    Object.keys(map).forEach(function (m) {
      map[m].sort(function (a, b) { return posRank(id, a) - posRank(id, b); });
    });
    _idxCache[id] = map;
    return map;
  }

  /* 同一音高在乐器上有多个位置时的优先级（吉他优先低把位/空弦，口琴优先不压音） */
  function posRank(id, note) {
    var p = note.position || {};
    if (p.fret !== undefined) return p.fret * 10 + (p.string || 0);
    if (p.bend) return 500 + (p.bend.length || 0) * 10;
    if (p.blow === false) return 200;
    if (p.blow === true) return 100;
    return 300;
  }

  /* ============================================================
   *  三、统一音符对象
   * ============================================================ */

  /* midi -> { midi, name, nameNoOct, octave, solfa, jianpu, digit, jianpuOctave } */
  function makeNote(midi, key, preferSharp) {
    var T = TH();
    if (!T) return { midi: midi, name: String(midi), nameNoOct: String(midi), octave: 4, solfa: '', jianpu: '', digit: 0, jianpuOctave: 0 };
    var p = T.pitchFromMidi(midi, preferSharp !== false);
    var jp = key ? T.jianpuOf(p, key, 'relative') : null;
    return {
      midi: midi,
      name: T.pitchName(p, { octave: true }),          // 如 "F#4"
      nameNoOct: T.pitchName(p, { octave: false }),    // 如 "F#"
      octave: p.oct,
      pitch: p,
      solfa: key ? T.solfeggio(p, key) : '',           // 首调唱名，如 "#fa"
      jianpu: jp ? ((jp.accidental || '') + jp.digit) : '',  // 简谱数字，如 "#4"
      digit: jp ? jp.digit : 0,
      jianpuOctave: jp ? jp.octave : 0                 // 简谱八度偏移（>0 加高音点）
    };
  }

  var HOLE_MAP = { X: 1, O: 0, '/': 0.5 };

  function holesToArray(str) {
    var arr = [];
    for (var i = 0; i < 8; i++) {
      var v = HOLE_MAP[str.charAt(i)];
      arr.push(v === undefined ? 0 : v);
    }
    return arr;
  }

  /* ============================================================
   *  四、对外查询 API
   * ============================================================ */

  function list() {
    return ALL.map(function (x) {
      return { id: x.id, name: x.name, kind: x.kind, desc: x.desc };
    });
  }

  function get(id) { return BY_ID[id] || null; }

  /* notesOf(id, opts) -> [{ midi, name, nameNoOct, octave, solfa, jianpu, digit, jianpuOctave, position }]
   * opts: { key:'D major'|null, maxFret:number, preferFlat:boolean, diatonic:boolean }
   *   - key 省略 -> 默认 C 大调（保证 solfa / jianpu 有值）；显式传 null 则不计算简谱
   *   - diatonic:true 只返回该调自然音级（用于竖笛/口琴这类音域有限的乐器时列表更短）
   */
  function notesOf(id, opts) {
    opts = opts || {};
    var inst = get(id);
    if (!inst) return [];
    var T = TH();
    if (!T) return [];
    var key = resolveKey(opts.key, true);
    var preferSharp = opts.preferFlat ? false : (key ? T.preferSharp(key) : true);
    var out = [];

    if (inst.kind === 'fret') {
      var max = opts.maxFret == null ? inst.maxFret : Math.max(0, Math.min(24, opts.maxFret | 0));
      /* 按 6→1 弦、品位由低到高的顺序输出 */
      inst.strings.forEach(function (st) {
        for (var f = 0; f <= max; f++) {
          var midi = st.midi + f;
          var n = makeNote(midi, key, preferSharp);
          n.position = { string: st.n, fret: f, open: f === 0, stringMidi: st.midi };
          out.push(n);
        }
      });
    } else if (inst.kind === 'harmonica') {
      for (var h = 0; h < 10; h++) {
        var hole = h + 1;
        /* 吹音 */
        var nb = makeNote(inst.blow[h], key, preferSharp);
        nb.position = { hole: hole, blow: true, bend: '', bendSemitones: 0, type: 'blow' };
        out.push(nb);
        /* 吹气压音 */
        var bd = inst.blowBendDepth[hole] || 0;
        for (var d = 1; d <= bd; d++) {
          var nbb = makeNote(inst.blow[h] - d, key, preferSharp);
          nbb.position = { hole: hole, blow: true, bend: joinStr("'", d), bendSemitones: d, type: 'blowBend' };
          out.push(nbb);
        }
        /* 吸音 */
        var nd = makeNote(inst.draw[h], key, preferSharp);
        nd.position = { hole: hole, blow: false, bend: '', bendSemitones: 0, type: 'draw' };
        out.push(nd);
        /* 吸气压音 */
        var dd = inst.drawBendDepth[hole] || 0;
        for (var e = 1; e <= dd; e++) {
          var ndd = makeNote(inst.draw[h] - e, key, preferSharp);
          ndd.position = { hole: hole, blow: false, bend: joinStr("'", e), bendSemitones: e, type: 'drawBend' };
          out.push(ndd);
        }
      }
    } else if (inst.kind === 'recorder') {
      inst.notes.forEach(function (row) {
        var n = makeNote(row.midi, key, preferSharp);
        n.position = {
          holes: holesToArray(row.holes),
          holeState: row.holes,
          octave: n.octave
        };
        out.push(n);
      });
    } else if (inst.kind === 'piano') {
      var lo = opts.lowMidi == null ? inst.lowMidi : opts.lowMidi;
      var hi = opts.highMidi == null ? inst.highMidi : opts.highMidi;
      for (var m = lo; m <= hi; m++) {
        var np = makeNote(m, key, preferSharp);
        np.position = { key: m, black: !!BLACK_PC[((m % 12) + 12) % 12] };
        out.push(np);
      }
    }

    if (opts.diatonic && key) {
      var set = {};
      for (var o = 0; o <= 8; o++) {
        T.scalePitches(key, o).forEach(function (p) { set[T.midiOf(p)] = true; });
      }
      out = out.filter(function (n) { return set[n.midi]; });
    }
    return out;
  }

  /* scaleOnInstrument(scalePitches, id)
   * 把一组音（Pitch 对象数组，或 midi 数字数组）映射到乐器位置。
   * 返回与输入等长的数组：找到则给出 { index, midi, name, solfa, jianpu, position, positions }，
   * 找不到（超出乐器音域/无对应指法）则为 null。 */
  function scaleOnInstrument(scalePitches, id) {
    var inst = get(id);
    var T = TH();
    if (!inst || !T) return [];
    var listIn = Array.isArray(scalePitches) ? scalePitches : [scalePitches];
    var idx = midiIndex(id);
    var key = T.parseKey('C major');
    return listIn.map(function (item, i) {
      var midi = null;
      if (typeof item === 'number') midi = Math.round(item);
      else if (item && typeof item === 'object' && item.step) midi = T.midiOf(item);
      if (midi === null || midi === undefined || isNaN(midi)) return null;
      var hits = idx[midi];
      if (!hits || !hits.length) return null;
      var first = hits[0];
      return {
        index: i,
        midi: midi,
        name: first.name,
        nameNoOct: first.nameNoOct,
        octave: first.octave,
        solfa: first.solfa,
        jianpu: first.jianpu,
        key: key,
        position: first.position,
        positions: hits.map(function (h) { return h.position; })
      };
    });
  }

  /* 该调在给定音域内的音高集合（用于高亮）
   * 覆盖 [low, high] 所在的全部八度，并至少覆盖 startOct-2 .. startOct+3 */
  function scaleMidiSet(key, startOct, low, high, extra) {
    var T = TH();
    var set = {};
    if (!T || !key) return set;
    var base = (startOct == null ? 4 : startOct);
    var lo = (low == null ? 0 : low), hi = (high == null ? 127 : high);
    var from = Math.min(Math.floor(lo / 12) - 1, base - 2);
    var to = Math.max(Math.floor(hi / 12) - 1, base + 3);
    for (var o = from; o <= to; o++) {
      T.scalePitches(key, o).forEach(function (p) {
        var m = T.midiOf(p);
        if (m >= lo && m <= hi) set[m] = true;
      });
    }
    (extra || []).forEach(function (m) { set[Math.round(m)] = true; });
    return set;
  }

  /* 某乐器的 midi 音域（用于音阶高亮范围） */
  function midiRange(inst, maxFret) {
    if (inst.kind === 'fret') {
      var lo = Infinity, hi = -Infinity;
      inst.strings.forEach(function (st) {
        lo = Math.min(lo, st.midi);
        hi = Math.max(hi, st.midi + (maxFret == null ? inst.maxFret : maxFret));
      });
      return { low: lo, high: hi };
    }
    if (inst.kind === 'harmonica') {
      return { low: Math.min.apply(null, inst.blow), high: Math.max.apply(null, inst.blow) };
    }
    if (inst.kind === 'recorder') {
      var ms = inst.notes.map(function (n) { return n.midi; });
      return { low: Math.min.apply(null, ms), high: Math.max.apply(null, ms) };
    }
    return { low: inst.lowMidi, high: inst.highMidi };
  }

  /* ============================================================
   *  五、SVG 绘图基础
   * ============================================================ */

  function setA(node, a) {
    if (a) {
      Object.keys(a).forEach(function (k) {
        if (a[k] !== null && a[k] !== undefined) node.setAttribute(k, a[k]);
      });
    }
    return node;
  }
  /* 合并两个属性对象（后者优先），用于 rect/circle/... 的默认属性 + 调用方属性 */
  function merge(a, b) {
    var o = {};
    [a, b].forEach(function (src) {
      if (!src) return;
      Object.keys(src).forEach(function (k) {
        if (src[k] !== null && src[k] !== undefined) o[k] = src[k];
      });
    });
    return o;
  }
  function s(tag, a) { return setA(document.createElementNS(NS, tag), a); }
  function txt(x, y, str, a) {
    var t = s('text', { x: x, y: y });
    t.textContent = String(str);
    return setA(t, a);
  }
  function rect(x, y, w, h, a) { return s('rect', merge({ x: x, y: y, width: w, height: h }, a)); }
  function circ(cx, cy, r, a) { return s('circle', merge({ cx: cx, cy: cy, r: r }, a)); }
  function line(x1, y1, x2, y2, a) { return s('line', merge({ x1: x1, y1: y1, x2: x2, y2: y2 }, a)); }
  function halfDisc(cx, cy, r, a) {
    return s('path', merge({
      d: 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy + ' Z'
    }, a));
  }

  function root(w, h, title) {
    var svg = s('svg', {
      xmlns: NS,
      viewBox: '0 0 ' + w + ' ' + h,
      width: w,
      height: h,
      'font-family': '"Microsoft YaHei", "PingFang SC", system-ui, -apple-system, "Segoe UI", sans-serif'
    });
    svg.setAttribute('class', 'inst-chart');
    svg.appendChild(rect(0, 0, w, h, { fill: C.bg }));
    if (title) svg.appendChild(txt(24, 28, title, { 'font-size': 17, 'font-weight': '700', fill: C.ink }));
    return svg;
  }

  function legendLines(svg, lines, x, y0, gap) {
    lines.forEach(function (t, i) {
      if (!t) return;
      svg.appendChild(txt(x || 24, (y0 || 52) + i * (gap || 20), t, { 'font-size': 11.5, fill: C.sub }));
    });
  }

  /* 简谱数字 + 八度点（小圆点，位于圆点上下方的弦间空隙里） */
  function jianpuText(g, x, y, note, fill, size, dotFill) {
    g.appendChild(txt(x, y, note.jianpu, { 'font-size': size, fill: fill, 'text-anchor': 'middle' }));
    if (note.jianpuOctave > 0) g.appendChild(circ(x, y - 20, 1.8, { fill: dotFill }));
    else if (note.jianpuOctave < 0) g.appendChild(circ(x, y + 19, 1.8, { fill: dotFill }));
  }

  /* ============================================================
   *  六、指板图（吉他 / 尤克里里 / 贝斯）
   * ============================================================ */

  function drawFret(inst, opts) {
    var T = TH();
    var key = resolveKey(opts.key, false);
    var hasScale = !!key;
    var maxFret = opts.maxFret == null ? inst.maxFret : Math.max(1, Math.min(24, opts.maxFret | 0));
    var showName = opts.showNoteName !== false;
    var showSolfa = opts.showSolfa !== false;
    var showNonScale = opts.showNonScale !== false;
    var rng = midiRange(inst, maxFret);
    var scaleSet = scaleMidiSet(key, opts.startOct, rng.low, rng.high, null);
    var extraSet = mkSet(opts.highlight);

    /* 显示顺序：自上而下 1 弦 → 6 弦（1 弦在最上，细；与六线谱一致） */
    var rows = inst.strings.slice().reverse();
    var nStr = rows.length;

    var FRET_W = 62, STR_GAP = 42, NUT_X = 88, OPEN_X = 46, BOARD_TOP = 112;
    var boardBot = BOARD_TOP + (nStr - 1) * STR_GAP;
    var width = NUT_X + maxFret * FRET_W + 26;
    var height = boardBot + 62;

    var title = inst.name + (hasScale ? ' 音阶指板图 · ' + T.keyName(key) : ' 音位对照表');
    var svg = root(width, height, title);

    legendLines(svg, [
      (inst.topNote || ('1 弦在上，' + nStr + ' 弦在下')) + '；数字为品格号，0 = 空弦（画在琴枕左侧）',
      hasScale
        ? '简谱数字按 ' + T.keyName(key) + ' 首调记谱（数字上/下小圆点表示高/低八度）；实心圆 = 音阶音，空心小圆 = 非音阶音'
        : '简谱数字按 C 大调首调记谱；数字上/下小圆点表示高/低八度'
    ], 24, 52, 20);

    var g = s('g');
    svg.appendChild(g);

    /* 品位号 */
    for (var f = 1; f <= maxFret; f++) {
      g.appendChild(txt(NUT_X + (f - 0.5) * FRET_W, 86, f, {
        'font-size': 11, fill: C.dim, 'text-anchor': 'middle'
      }));
    }

    /* 品位记号（3/5/7/9/12/15，12 品双点） */
    var midY = (BOARD_TOP + boardBot) / 2;
    (inst.markers || []).forEach(function (m) {
      if (m > maxFret) return;
      var mx = NUT_X + (m - 0.5) * FRET_W;
      if (m === 12) {
        g.appendChild(circ(mx, midY - STR_GAP, 5, { fill: C.faint }));
        g.appendChild(circ(mx, midY + STR_GAP, 5, { fill: C.faint }));
      } else {
        g.appendChild(circ(mx, midY, 5, { fill: C.faint }));
      }
    });

    /* 弦线 + 弦号 + 音位 */
    rows.forEach(function (st, r) {
      var y = BOARD_TOP + r * STR_GAP;
      var lw = st.gauge || (0.14 + r * 0.04);
      g.appendChild(line(NUT_X, y, NUT_X + maxFret * FRET_W, y, {
        stroke: C.line, 'stroke-width': Math.max(0.7, lw * 6)
      }));
      g.appendChild(txt(16, y + 4, st.n, {
        'font-size': 12, fill: C.dim, 'text-anchor': 'middle', 'font-weight': '700'
      }));

      for (var fr = 0; fr <= maxFret; fr++) {
        var midi = st.midi + fr;
        var on = !hasScale || !!scaleSet[midi];
        var x = fr === 0 ? OPEN_X : NUT_X + (fr - 0.5) * FRET_W;
        if (!on && !showNonScale) continue;
        var note = makeNote(midi, key || T.parseKey('C major'), true);
        if (on) {
          var isExtra = !!extraSet[midi];
          var fill = isExtra ? C.accent2 : C.accent;
          g.appendChild(circ(x, y, 15, { fill: fill, stroke: C.white, 'stroke-width': 1.5 }));
          if (showName && showSolfa) {
            g.appendChild(txt(x, y - 2.5, note.nameNoOct, {
              'font-size': 11, fill: C.white, 'text-anchor': 'middle', 'font-weight': '700'
            }));
            jianpuText(g, x, y + 9.5, note, '#e2ecff', 10, C.white);
          } else if (showName) {
            g.appendChild(txt(x, y + 4, note.nameNoOct, {
              'font-size': 12, fill: C.white, 'text-anchor': 'middle', 'font-weight': '700'
            }));
          } else if (showSolfa) {
            g.appendChild(txt(x, y + 4, note.jianpu, {
              'font-size': 12, fill: C.white, 'text-anchor': 'middle', 'font-weight': '700'
            }));
          }
        } else {
          g.appendChild(circ(x, y, 6, { fill: 'none', stroke: C.faint, 'stroke-width': 1.4 }));
        }
      }
    });

    /* 琴枕 */
    g.appendChild(rect(NUT_X - 4, BOARD_TOP - 7, 6, boardBot - BOARD_TOP + 14, { fill: C.ink, rx: 1 }));
    /* 品丝 */
    for (var k = 1; k <= maxFret; k++) {
      g.appendChild(line(NUT_X + k * FRET_W, BOARD_TOP - 6, NUT_X + k * FRET_W, boardBot + 6, {
        stroke: C.line, 'stroke-width': (k === 12 ? 2.4 : 1.6)
      }));
    }

    /* 底部图例 */
    svg.appendChild(txt(24, boardBot + 34,
      hasScale ? '● 实心圆：该调音阶音位　　○ 空心小圆：非音阶音　　◎ 橙色：额外高亮' : '● 全部音位（未指定调，故不区分音阶音）',
      { 'font-size': 11.5, fill: C.sub }));
    return svg;
  }

  /* ============================================================
   *  七、口琴图（10 孔，上吹下吸）
   * ============================================================ */

  function drawHarmonicaChart(inst, opts) {
    var T = TH();
    var key = resolveKey(opts.key, false);
    var hasScale = !!key;
    var hr = midiRange(inst);
    var scaleSet = scaleMidiSet(key, opts.startOct, hr.low - 3, hr.high, null);
    var extraSet = mkSet(opts.highlight);
    var showName = opts.showNoteName !== false;
    var showSolfa = opts.showSolfa !== false;

    var n = 10, colW = 92, left = 74;
    var blowTop = 132, boxH = 54;
    var drawTop = blowTop + boxH + 46;
    var bendMax = 3;
    var width = left + n * colW + 30;
    var height = drawTop + boxH + 20 + bendMax * 16 + 34;

    var title = inst.name + ' 音位图' + (hasScale ? ' · ' + T.keyName(key) : ' · C 调 Richter');
    var svg = root(width, height, title);

    legendLines(svg, [
      '上排 = 吹音（blow），下排 = 吸音（draw）；中间数字为孔号',
      '孔上/孔下的小字是该孔可压出的音（′ 表示压音深度，为近似值）；实心 = 该调音阶音'
    ], 24, 52, 20);

    var g = s('g');
    svg.appendChild(g);

    /* 行标 */
    g.appendChild(txt(20, blowTop + boxH / 2 + 5, '吹音', { 'font-size': 13, fill: C.sub, 'font-weight': '700' }));
    g.appendChild(txt(20, drawTop + boxH / 2 + 5, '吸音', { 'font-size': 13, fill: C.sub, 'font-weight': '700' }));
    g.appendChild(txt(20, drawTop + boxH + 24, '压音', { 'font-size': 11, fill: C.accent2 }));

    for (var i = 0; i < n; i++) {
      var hole = i + 1;
      var cx = left + i * colW + colW / 2;
      var bx = cx - (colW - 14) / 2;
      var bw = colW - 14;

      /* 吹音 */
      addHarmonicaBox(g, cx, bx, blowTop, bw, boxH, inst.blow[i], true, hole, key, scaleSet, extraSet, showName, showSolfa);
      /* 吸音 */
      addHarmonicaBox(g, cx, bx, drawTop, bw, boxH, inst.draw[i], false, hole, key, scaleSet, extraSet, showName, showSolfa);

      /* 孔号 */
      g.appendChild(txt(cx, drawTop - 24, hole, {
        'font-size': 14, fill: C.ink, 'text-anchor': 'middle', 'font-weight': '700'
      }));

      /* 吹气压音（孔上） */
      var bd = inst.blowBendDepth[hole] || 0;
      for (var d = 1; d <= bd; d++) {
        var mb = inst.blow[i] - d;
        var noteB = makeNote(mb, key || T.parseKey('C major'), true);
        var onB = !hasScale || !!scaleSet[mb];
        g.appendChild(txt(cx, blowTop - 8 - d * 16, noteB.nameNoOct + joinStr('′', d), {
          'font-size': 10.5, 'text-anchor': 'middle',
          fill: onB ? (extraSet[mb] ? C.accent2 : C.accent) : C.dim
        }));
      }
      /* 吸气压音（孔下） */
      var dd = inst.drawBendDepth[hole] || 0;
      for (var e = 1; e <= dd; e++) {
        var md = inst.draw[i] - e;
        var noteD = makeNote(md, key || T.parseKey('C major'), true);
        var onD = !hasScale || !!scaleSet[md];
        g.appendChild(txt(cx, drawTop + boxH + 16 + e * 16, noteD.nameNoOct + joinStr('′', e), {
          'font-size': 10.5, 'text-anchor': 'middle',
          fill: onD ? (extraSet[md] ? C.accent2 : C.accent) : C.dim
        }));
      }
    }
    return svg;
  }

  function addHarmonicaBox(g, cx, bx, by, bw, bh, midi, blow, hole, key, scaleSet, extraSet, showName, showSolfa) {
    var T = TH();
    var note = makeNote(midi, key || T.parseKey('C major'), true);
    var on = !key || !!scaleSet[midi];
    var isExtra = !!extraSet[midi];
    var fill = !on ? C.panel : (isExtra ? C.accent2 : (blow ? C.accent : '#3f8f5f'));
    var ink = on ? C.white : C.ink;
    g.appendChild(rect(bx, by, bw, bh, {
      rx: 9, fill: fill, stroke: on ? fill : C.faint, 'stroke-width': on ? 0 : 1.2
    }));
    if (showName && showSolfa) {
      g.appendChild(txt(cx, by + bh / 2 - 3, note.nameNoOct, {
        'font-size': 15, fill: ink, 'text-anchor': 'middle', 'font-weight': '700'
      }));
      g.appendChild(txt(cx, by + bh / 2 + 14, note.jianpu, {
        'font-size': 11.5, fill: on ? '#e9f0ff' : C.sub, 'text-anchor': 'middle'
      }));
    } else {
      g.appendChild(txt(cx, by + bh / 2 + 5, showSolfa ? note.jianpu : note.nameNoOct, {
        'font-size': 15, fill: ink, 'text-anchor': 'middle', 'font-weight': '700'
      }));
    }
  }

  /* ============================================================
   *  八、竖笛指法图
   * ============================================================ */

  function drawRecorder(inst, opts) {
    var T = TH();
    var key = resolveKey(opts.key, false);
    var hasScale = !!key;
    var rr = midiRange(inst);
    var scaleSet = scaleMidiSet(key, opts.startOct, rr.low, rr.high, null);
    var extraSet = mkSet(opts.highlight);
    var perRow = opts.perRow || 7;
    var cellW = 130, cellH = 148, left = 26, top = 116;

    var notes = inst.notes.slice();
    if (opts.onlyScale && hasScale) {
      notes = notes.filter(function (r) { return !!scaleSet[r.midi]; });
    }
    var rows = Math.max(1, Math.ceil(notes.length / perRow));
    var width = left * 2 + perRow * cellW;
    var height = top + rows * cellH + 16;

    var title = inst.name + ' 指法图' + (hasScale ? ' · ' + T.keyName(key) : ' · 巴洛克指法 C5–D7');
    var svg = root(width, height, title);

    legendLines(svg, [
      '● = 按住（闭孔）　○ = 放开（开孔）　◐ = 半孔（拇指半开 / 双孔半开）',
      '孔位：0 = 背面拇指孔；1–7 = 正面自上而下（左手 1–3，右手 4–7）；6、7 为双孔，图中合并为一个圆'
    ], 24, 52, 20);

    var g = s('g');
    svg.appendChild(g);

    notes.forEach(function (row, i) {
      var col = i % perRow, lineNo = Math.floor(i / perRow);
      var cx = left + col * cellW + cellW / 2;
      var cy = top + lineNo * cellH;
      var note = makeNote(row.midi, key || T.parseKey('C major'), true);
      var on = !hasScale || !!scaleSet[row.midi];
      var isExtra = !!extraSet[row.midi];

      g.appendChild(rect(cx - cellW / 2 + 6, cy + 4, cellW - 12, cellH - 18, {
        rx: 10,
        fill: isExtra ? '#fdeee7' : (on ? C.soft : '#fafbfd'),
        stroke: isExtra ? '#f3c4b0' : (on ? '#d3e0fb' : '#eef1f6')
      }));

      /* 音名 + 简谱 */
      g.appendChild(txt(cx, cy + 32, note.name, {
        'font-size': 15, 'font-weight': '700', 'text-anchor': 'middle',
        fill: isExtra ? C.accent2 : (on ? C.accent : C.dim)
      }));
      g.appendChild(txt(cx, cy + 52, note.jianpu + (note.solfa ? ' ' + note.solfa : ''), {
        'font-size': 11, 'text-anchor': 'middle', fill: C.sub
      }));

      /* 指法：笛身 + 拇指孔 + 7 个正面孔 */
      var holes = holesToArray(row.holes);
      g.appendChild(rect(cx - 9, cy + 62, 18, 72, { rx: 9, fill: C.white, stroke: C.line, 'stroke-width': 1.2 }));
      drawHole(g, cx - 27, cy + 70, 7, holes[0]);
      for (var k = 0; k < 7; k++) {
        drawHole(g, cx, cy + 64 + k * 10.5, 5.2, holes[k + 1]);
      }
      /* 孔位编号只在图例里说明，格子里不重复标注（间距太小会糊在一起） */
    });
    return svg;
  }

  function drawHole(g, cx, cy, r, state) {
    if (state >= 1) {
      g.appendChild(circ(cx, cy, r, { fill: C.ink, stroke: C.ink, 'stroke-width': 1 }));
    } else if (state > 0) {
      g.appendChild(circ(cx, cy, r, { fill: C.white, stroke: C.ink, 'stroke-width': 1.3 }));
      g.appendChild(halfDisc(cx, cy, r - 0.6, { fill: C.ink }));
    } else {
      g.appendChild(circ(cx, cy, r, { fill: C.white, stroke: C.line, 'stroke-width': 1.3 }));
    }
  }

  /* ============================================================
   *  九、钢琴键盘图
   * ============================================================ */

  function drawPiano(inst, opts) {
    var T = TH();
    var key = resolveKey(opts.key, false);
    var hasScale = !!key;
    var extraSet = mkSet(opts.highlight);
    var showName = opts.showNoteName !== false;
    var showSolfa = opts.showSolfa !== false;

    var low = opts.lowMidi == null ? inst.lowMidi : opts.lowMidi;
    var high = opts.highMidi == null ? inst.highMidi : opts.highMidi;
    var wkW = opts.keyWidth || 26, wkH = 150, padL = 30, top = 88;
    var scaleSet = scaleMidiSet(key, opts.startOct, low, high, null);

    var whites = [];
    for (var m = low; m <= high; m++) {
      if (!BLACK_PC[((m % 12) + 12) % 12]) whites.push(m);
    }
    var width = padL * 2 + whites.length * wkW;
    var height = top + wkH + 52;

    var title = '钢琴键盘音位图' + (hasScale ? ' · ' + T.keyName(key) : ' · A0–C8');
    var svg = root(width, height, title);

    legendLines(svg, [
      '白键 ' + whites.length + ' 个，黑键为升/降音；浅蓝 = 该调音阶音，橙色 = 额外高亮',
      '被高亮的白键在键面上方标出音名与简谱数字；黑键音名竖排写在键面上'
    ], 24, 52, 20);

    var g = s('g');
    svg.appendChild(g);

    /* 白键 */
    var whiteIndex = {};
    whites.forEach(function (wm, i) { whiteIndex[wm] = i; });
    whites.forEach(function (wm, i) {
      var x = padL + i * wkW;
      var note = makeNote(wm, key || T.parseKey('C major'), true);
      var on = !hasScale || !!scaleSet[wm];
      var isExtra = !!extraSet[wm];
      var bg = !on ? '#ffffff' : (isExtra ? '#fdeee7' : '#dbe7ff');
      g.appendChild(rect(x, top, wkW, wkH, { fill: bg, stroke: C.line, 'stroke-width': 1 }));
      /* C 音标记八度 */
      if (((wm % 12) + 12) % 12 === 0) {
        g.appendChild(txt(x + wkW / 2, top + wkH - 8, note.name, {
          'font-size': 9.5, fill: C.dim, 'text-anchor': 'middle'
        }));
      }
      if (on && hasScale && showName) {
        g.appendChild(txt(x + wkW / 2, top + 16, note.nameNoOct, {
          'font-size': 9.5, fill: isExtra ? C.accent2 : C.accent, 'text-anchor': 'middle', 'font-weight': '700'
        }));
        if (showSolfa) {
          g.appendChild(txt(x + wkW / 2, top + 29, note.jianpu, {
            'font-size': 9, fill: C.sub, 'text-anchor': 'middle'
          }));
        }
      }
    });

    /* 黑键 */
    for (var bm = low; bm <= high; bm++) {
      if (!BLACK_PC[((bm % 12) + 12) % 12]) continue;
      /* 该黑键位于“紧邻其左侧的白键”右边 */
      var leftWhite = bm - 1;
      while (leftWhite >= low && BLACK_PC[((leftWhite % 12) + 12) % 12]) leftWhite--;
      var i2 = whiteIndex[leftWhite];
      if (i2 === undefined) continue;
      var bx = padL + (i2 + 1) * wkW - wkW * 0.3;
      var bwidth = wkW * 0.6;
      var note2 = makeNote(bm, key || T.parseKey('C major'), true);
      var on2 = !hasScale || !!scaleSet[bm];
      var isExtra2 = !!extraSet[bm];
      var bg2 = !on2 ? C.ink : (isExtra2 ? C.accent2 : C.accent);
      g.appendChild(rect(bx, top, bwidth, wkH * 0.62, { fill: bg2, stroke: C.white, 'stroke-width': 0.8, rx: 1 }));
      if (on2 && hasScale) {
        var lg = s('g', { transform: 'translate(' + (bx + bwidth / 2 + 3) + ',' + (top + wkH * 0.62 - 8) + ') rotate(-90)' });
        lg.appendChild(txt(0, 0, note2.nameNoOct, {
          'font-size': 8.5, fill: C.white, 'text-anchor': 'start', 'font-weight': '700'
        }));
        g.appendChild(lg);
      }
    }
    return svg;
  }

  /* ============================================================
   *  十、renderChart
   * ============================================================ */

  /* renderChart(container, id, opts) -> SVGElement
   * opts: { key:'D major', showSolfa:true, showNoteName:true, maxFret:15,
   *         startOct:4, highlight:[midi...], perRow, onlyScale, lowMidi, highMidi }
   *   key 只影响简谱数字（首调）的显示与音阶音高亮；省略 key 时画完整音位表。
   */
  function renderChart(container, id, opts) {
    opts = opts || {};
    var inst = get(id);
    var svg;
    try {
      if (!inst) {
        svg = root(360, 70, '未找到乐器：' + id);
        svg.appendChild(txt(24, 52, '可用乐器：' + ALL.map(function (x) { return x.id; }).join(' / '),
          { 'font-size': 12, fill: C.sub }));
      } else if (inst.kind === 'fret') {
        svg = drawFret(inst, opts);
      } else if (inst.kind === 'harmonica') {
        svg = drawHarmonicaChart(inst, opts);
      } else if (inst.kind === 'recorder') {
        svg = drawRecorder(inst, opts);
      } else {
        svg = drawPiano(inst, opts);
      }
    } catch (e) {
      /* 契约要求：任何模块不得因异常打断启动 */
      svg = root(420, 70, '乐器图绘制失败');
      svg.appendChild(txt(24, 52, String(e && e.message ? e.message : e), { 'font-size': 11, fill: C.accent2 }));
    }
    if (inst) svg.setAttribute('data-inst', inst.id);
    if (container && container.appendChild) {
      if (APP.util && APP.util.clear) APP.util.clear(container);
      else while (container.firstChild) container.removeChild(container.firstChild);
      if (container.classList) container.classList.add('inst-chart-host');
      container.appendChild(svg);
    }
    return svg;
  }

  /* ============================================================
   *  十一、注册
   * ============================================================ */

  APP.instruments = {
    GUITAR: GUITAR,
    UKULELE: UKULELE,
    BASS: BASS,
    HARMONICA: HARMONICA,
    RECORDER: RECORDER,
    PIANO: PIANO,

    list: list,
    get: get,
    notesOf: notesOf,
    renderChart: renderChart,
    scaleOnInstrument: scaleOnInstrument,

    /* 附加（便于其它模块查阅，非契约必需） */
    all: function () { return ALL.slice(); },
    byKind: function (kind) { return ALL.filter(function (x) { return x.kind === kind; }); }
  };

})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
