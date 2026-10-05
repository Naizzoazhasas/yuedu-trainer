/* 读谱训练器 — 乐理内核
 * 全局命名空间：window.APP.theory
 * 只依赖 APP.util（可选）。所有音高计算必须走这里，其他模块不得自行实现音高换算。
 */
(function (APP) {
  'use strict';

  var STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /* 常用调号（调号 -> 主音音级）。顺序即五度圈：-7 ... +7 */
  var KEYS = [
    { tonic: 11, mode: 'major', fifths: -7 },  // Cb
    { tonic: 6, mode: 'major', fifths: -6 },  // Gb
    { tonic: 1, mode: 'major', fifths: -5 },  // Db
    { tonic: 8, mode: 'major', fifths: -4 },  // Ab
    { tonic: 3, mode: 'major', fifths: -3 },  // Eb
    { tonic: 10, mode: 'major', fifths: -2 },  // Bb
    { tonic: 5, mode: 'major', fifths: -1 },  // F
    { tonic: 0, mode: 'major', fifths: 0 },  // C
    { tonic: 7, mode: 'major', fifths: 1 },  // G
    { tonic: 2, mode: 'major', fifths: 2 },  // D
    { tonic: 9, mode: 'major', fifths: 3 },  // A
    { tonic: 4, mode: 'major', fifths: 4 },  // E
    { tonic: 11, mode: 'major', fifths: 5 },  // B
    { tonic: 6, mode: 'major', fifths: 6 },  // F#
    { tonic: 1, mode: 'major', fifths: 7 },  // C#
    { tonic: 9, mode: 'minor', fifths: 0 },  // Am
    { tonic: 4, mode: 'minor', fifths: 1 },  // Em
    { tonic: 11, mode: 'minor', fifths: 2 },  // Bm
    { tonic: 6, mode: 'minor', fifths: 3 },  // F#m
    { tonic: 1, mode: 'minor', fifths: 4 },  // C#m
    { tonic: 8, mode: 'minor', fifths: 5 },  // G#m
    { tonic: 3, mode: 'minor', fifths: 6 },  // D#m
    { tonic: 10, mode: 'minor', fifths: 7 },  // A#m
    { tonic: 2, mode: 'minor', fifths: -1 },  // Dm
    { tonic: 7, mode: 'minor', fifths: -2 },  // Gm
    { tonic: 0, mode: 'minor', fifths: -3 },  // Cm
    { tonic: 5, mode: 'minor', fifths: -4 },  // Fm
    { tonic: 10, mode: 'minor', fifths: -5 },  // Bbm
    { tonic: 3, mode: 'minor', fifths: -6 },  // Ebm
    { tonic: 8, mode: 'minor', fifths: -7 }   // Abm
  ];

  /* 中文调名：音级 -> 唱名式音名（按调号方向选写法） */
  var NAME_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NAME_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  var SIG_POS_SHARP = [5, 2, 6, 3, 7, 4, 8];   // F C G D A E B 在高音谱表的位置
  var SIG_POS_FLAT = [4, 7, 3, 6, 2, 5, 1];   // B E A D G C F

  var MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  var HARMONIC_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 11];

  var ACC_TEXT = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

  /* ---------------- 音高 ---------------- */

  function midiOf(p) {
    if (!p) return null;
    var s = STEP_SEMI[p.step];
    if (s === undefined) return null;
    return 12 * (p.oct + 1) + s + (p.acc || 0);
  }

  function modulo(v, m) { return ((v % m) + m) % m; }

  /* 从参照音出发，向上走 diatonicSteps 个音级、semitones 个半音，推出正确拼写的音高
   * （保证每个音级只出现一次：C 大调第 7 个音是 B 而不是 Cb） */
  function pitchFromDegree(refPitch, diatonicSteps, semitones) {
    var li = STEPS.indexOf(refPitch.step);
    var mi = li + diatonicSteps;
    var letter = STEPS[((mi % 7) + 7) % 7];
    var oct = refPitch.oct + Math.floor(mi / 7);
    var targetMidi = midiOf(refPitch) + semitones;
    var acc = targetMidi - (12 * (oct + 1) + STEP_SEMI[letter]);
    return { step: letter, acc: acc, oct: oct };
  }

  /* midi -> 音高；preferSharp 为 true 时用升号写法，否则降号 */
  function pitchFromMidi(midi, preferSharp) {
    if (midi === null || midi === undefined) return null;
    var m = Math.round(midi);
    var oct = Math.floor(m / 12) - 1;
    var pc = ((m % 12) + 12) % 12;
    var name = (preferSharp ? NAME_SHARP : NAME_FLAT)[pc];
    var step = name[0];
    var acc = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0;
    return { step: step, acc: acc, oct: oct };
  }

  function pitchName(p, opts) {
    if (!p) return '休止';
    opts = opts || {};
    var acc = (opts.accidentals === false) ? '' : (ACC_TEXT[String(p.acc || 0)] || '');
    var full = p.step + acc;
    if (opts.octave === false) return full;
    return full + p.oct;
  }

  function accidentalFor(pc, preferSharp) {
    var names = preferSharp ? NAME_SHARP : NAME_FLAT;
    var n = names[((pc % 12) + 12) % 12];
    return { step: n[0], acc: n.length > 1 ? (n[1] === '#' ? 1 : -1) : 0 };
  }

  /* ---------------- 调 ---------------- */

  function parseKey(input) {
    if (input && typeof input === 'object' && input.mode) return normalizeKey(input);
    var s = String(input === undefined || input === null ? 'C major' : input).trim();
    var mode = /minor|小调|m\b/i.test(s) ? 'minor' : 'major';
    if (/^\s*[a-gA-G]\s*$/.test(s)) mode = 'major';
    if (/^\s*[a-gA-G]\s*m\s*$/.test(s)) mode = 'minor';
    var m = s.match(/([A-Ga-g])\s*([#♯b♭]?)/);
    var letter = m ? m[1].toUpperCase() : 'C';
    var accTxt = m ? m[2] : '';
    var acc = (accTxt === '#' || accTxt === '♯') ? 1 : ((accTxt === 'b' || accTxt === '♭') ? -1 : 0);
    var pc = (STEP_SEMI[letter] + acc + 120) % 12;
    return findKey(pc, mode);
  }

  function findKey(pc, mode) {
    var cands = KEYS.filter(function (k) { return k.tonic === (((pc % 12) + 12) % 12) && k.mode === mode; });
    if (cands.length) {
      /* 优先选调号较简单（绝对五度数小）的那个写法 */
      cands.sort(function (a, b) { return Math.abs(a.fifths) - Math.abs(b.fifths); });
      return normalizeKey(cands[0]);
    }
    /* 冷门音（如 D# 大调）：用等音调近似 */
    var alt = KEYS.filter(function (k) { return k.tonic === ((pc + 1) % 12) && k.mode === mode; });
    if (alt.length) { var k = normalizeKey(alt[0]); k.fifths = k.fifths; return k; }
    return normalizeKey({ tonic: ((pc % 12) + 12) % 12, mode: mode, fifths: 0 });
  }

  function normalizeKey(k) {
    var tonic = ((k.tonic % 12) + 12) % 12;
    var mode = k.mode === 'minor' ? 'minor' : 'major';
    var fifths = k.fifths;
    /* 传入的 fifths 必须与主音自洽（可能是浅合并带进来的脏值，必须校验） */
    if (typeof fifths === 'number' && !isNaN(fifths) &&
      tonicOfFifths(fifths, mode) === tonic) {
      return { tonic: tonic, mode: mode, fifths: fifths };
    }
    var solved = fifthsOf(tonic, mode);
    if (solved === null || solved === undefined) solved = 0;
    return { tonic: tonic, mode: mode, fifths: solved };
  }

  /* 某个五度数对应的主音音级 */
  function tonicOfFifths(fifths, mode) {
    return ((fifthsToTonic(fifths, mode).semi % 12) + 12) % 12;
  }

  function fifthsOf(tonic, mode) {
    var c = KEYS.filter(function (k) { return k.tonic === tonic && k.mode === mode; });
    if (!c.length) return null;
    c.sort(function (a, b) { return Math.abs(a.fifths) - Math.abs(b.fifths); });
    return c[0].fifths;
  }

  /* 调号方向：升号调用升号写法 */
  function preferSharp(key) { return normalizeKey(key).fifths >= 0; }

  function tonicPitch(key, oct) {
    var k = normalizeKey(key);
    var sp = spellTonic(k.fifths, k.mode);
    return { step: sp.step, acc: sp.acc, oct: oct === undefined ? 4 : oct };
  }

  /* 由五度数推主音的正确写法（保证调号与调名一致：如 +6 必须写成 F# 而不是 Gb） */
  function spellTonic(fifths, mode) {
    var t = fifthsToTonic(fifths, mode);
    var oct = (mode === 'minor' && t.octAdj) ? 3 : 4;
    var targetMidi = 12 * (oct + 1) + t.semi;
    /* 八度直接由目标音高反推，避免重升重降跨八度带来的偏差 */
    var octFinal = Math.round((targetMidi - STEP_SEMI[STEPS[t.letterIdx]]) / 12) - 1;
    var acc = targetMidi - (12 * (octFinal + 1) + STEP_SEMI[STEPS[t.letterIdx]]);
    return { step: STEPS[t.letterIdx], acc: acc, oct: octFinal };
  }

  /* 五度数 -> 主音的字母序号 / 半音数 / 小调八度修正 */
  function fifthsToTonic(fifths, mode) {
    var letterIdx = ((fifths * 4) % 7 + 7) % 7;
    var semi = ((fifths * 7) % 12 + 12) % 12;
    if (mode === 'minor') {
      /* 关系小调主音 = 关系大调主音下方小三度（音级 +5，半音 -3） */
      letterIdx = (letterIdx + 5) % 7;
      semi = ((semi - 3) % 12 + 12) % 12;
      return { letterIdx: letterIdx, semi: semi, octAdj: -1 };
    }
    return { letterIdx: letterIdx, semi: semi, octAdj: 0 };
  }

  function keyName(key) {
    var k = normalizeKey(key);
    var sp = spellTonic(k.fifths, k.mode);
    var acc = ACC_TEXT[String(sp.acc || 0)];
    var base = sp.step + acc;
    if (k.mode === 'minor') return base + ' 小调';
    return base + ' 大调';
  }

  /* 该调的调号音（用于判断临时记号） */
  function keySignatureMap(key) {
    var k = normalizeKey(key);
    var map = {};
    scalePitches(k, 4, k.mode === 'minor' ? 'harmonic' : 'major').forEach(function (p) {
      map[p.step] = p.acc;
    });
    return map;
  }

  function keySignature(key) {
    var k = normalizeKey(key);
    var count = Math.abs(k.fifths);
    var isSharp = k.fifths > 0;
    return {
      count: count,
      accidental: isSharp ? 'sharp' : 'flat',
      positions: (isSharp ? SIG_POS_SHARP : SIG_POS_FLAT).slice(0, count).slice(),
      glyph: isSharp ? '\u266F' : '\u266D'
    };
  }

  /* 音阶：返回 7 个音的 Pitch 数组。type: 'major' | 'harmonic' | 'melodic' | 'natural'
   * startOct 指定起始八度（主音所在八度），默认 4 */
  function scalePitches(key, startOct, type) {
    var k = normalizeKey(key);
    var steps;
    if (k.mode === 'minor') {
      steps = (type === 'natural') ? [0, 2, 3, 5, 7, 8, 10] : HARMONIC_MINOR_STEPS;
    } else {
      steps = MAJOR_STEPS;
    }
    var oct = (startOct === undefined || startOct === null) ? 4 : startOct;
    var tonic = tonicPitch(k, oct);
    var out = [];
    for (var i = 0; i < 7; i++) {
      out.push(pitchFromDegree(tonic, i, steps[i]));
    }
    return out;
  }

  /* 供“调号音阶对照表”使用 */
  function scaleDegrees(key, type) {
    var k = normalizeKey(key);
    var pitches = scalePitches(k, 4, type);
    return pitches.map(function (p, i) {
      var base = pitchFromDegree({ step: 'C', acc: 0, oct: 4 }, 0, 0); // 占位
      return {
        degree: i + 1,
        pitch: p,
        name: pitchName(p, { octave: false }),
        solfa: ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'][i],
        midi: midiOf(p)
      };
    });
  }

  function allKeys() {
    return KEYS.map(function (k) {
      var nk = normalizeKey(k);
      nk.name = keyName(nk);
      nk.signature = keySignature(nk).count;
      return nk;
    });
  }

  /* ---------------- 首调唱名 / 简谱数字 ---------------- */

  /* 该音在调内的简谱表示：digit 1..7 + 变音 + 八度偏移 */
  function jianpuOf(pitch, key, mode) {
    if (!pitch) return { digit: 0, accidental: '', octave: 0, rest: true };
    mode = mode || 'relative';
    var k = normalizeKey(key);
    var prefer = preferSharp(k);

    if (mode === 'fixed') {
      var pc = ((midiOf(pitch) % 12) + 12) % 12;
      var nm = accidentalFor(pc, prefer);
      var digitF = STEPS.indexOf(nm.step) + 1;
      return {
        digit: digitF,
        accidental: ACC_TEXT[String(nm.acc || 0)],
        octave: pitch.oct - 4,
        rest: false
      };
    }

    /* 首调：主音记作 1。
     * 步骤 1（音级 li）：用主音的字母序号与八度起步，每升一个音级 li+1，
     *          确保七声音阶里每个音级只出现一次（C 紧接 B，不会被当成大跳）。
     * 步骤 2（八度 oct）：主音 octave=0；当 lc 回到 0（即越过主音）时 oct+1，
     *          当 lc 退到负数（即落到主音下方）时 oct-1。 */
    var tonic = tonicPitch(k, 4);
    var tMidi = midiOf(tonic);
    var semis = midiOf(pitch) - tMidi;
    var step = STEPS.indexOf(pitch.step);
    var oct = 0;
    var lc = step - STEPS.indexOf(tonic.step) + (pitch.oct - tonic.oct) * 7;
    while (lc >= 7) { lc -= 7; oct += 1; }
    while (lc < 0) { lc += 7; oct -= 1; }

    var li = lc;
    var semiInOct = modulo(semis - oct * 12, 12);

    /* 该音级在「本调自然音阶」里的半音数：小调第 3、6 级天然是降的，不记临时记号 */
    var scaleSemi = (k.mode === 'minor' && (li === 2 || li === 5))
      ? MAJOR_STEPS[li] - 1 : MAJOR_STEPS[li];

    return {
      digit: li + 1,
      accidental: (semiInOct === scaleSemi) ? '' : ACC_TEXT[String(semiInOct - scaleSemi)],
      octave: oct,
      rest: false
    };
  }

  var SOLFA = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
  function solfeggio(pitch, key) {
    var j = jianpuOf(pitch, key, 'relative');
    if (j.rest) return '休止';
    return (j.accidental || '') + SOLFA[j.digit - 1];
  }

  /* ---------------- 五线谱位置 ---------------- */

  /* 与参照音的“音级距离”（D 到 C 记作 -1，而不是 -6），用于音级/首调计算 */
  function letterDelta(from, to) {
    var d = letterDeltaRaw(from, to);
    while (d > 3) d -= 7;
    while (d < -3) d += 7;
    return d;
  }

  /* 未经八度归一的音级距离（可超出 ±3），用于五线谱位置 */
  function letterDeltaRaw(from, to) {
    return (STEPS.indexOf(to.step) - STEPS.indexOf(from.step)) + (to.oct - from.oct) * 7;
  }

  function diatonicIndex(p) {
    if (!p) return 0;
    return STEPS.indexOf(p.step) + (p.acc || 0) * 7 + p.oct * 7;
  }

  /* 五线谱位置：0 = 该谱表最下面那条线（高音谱 E4 / 低音谱 G2），每 1 = 一个音级 */
  function staffPos(p, clef) {
    if (!p) return 0;
    if (clef === 'bass') return letterDeltaRaw({ step: 'G', acc: 0, oct: 2 }, p);
    return letterDeltaRaw({ step: 'E', acc: 0, oct: 4 }, p);
  }

  /* 某个五线谱位置落在哪条线/间上：偶数=线，奇数=间（相对基准） */
  function isLine(pos) { return ((pos % 2) + 2) % 2 === 0; }

  /* ---------------- 临时记号 ---------------- */

  function accidentalGlyph(pitch, key) {
    if (!pitch) return '';
    var map = keySignatureMap(key);
    var keyAcc = map[pitch.step] || 0;
    var acc = pitch.acc || 0;
    if (acc === keyAcc) return '';
    if (acc === 0) return 'natural';
    return ACC_TEXT[String(acc)] || '';
  }

  /* ---------------- 频率 ---------------- */

  function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function freqToMidiFloat(freq) { return 69 + 12 * Math.log(freq / 440) / Math.LN2; }

  function centsBetween(freq, targetFreq) { return 1200 * Math.log(freq / targetFreq) / Math.LN2; }

  /* ---------------- 移调乐器 ---------------- */

  var TRANSPOSING_INSTRUMENTS = [
    { id: 'concert', name: 'C 调乐器（不移调）', writtenToConcert: 0, desc: '谱面音 = 实际音' },
    { id: 'clarinet-bb', name: '降 B 调单簧管', writtenToConcert: -2, desc: '谱面 C 实际发 Bb' },
    { id: 'trumpet-bb', name: '降 B 调小号', writtenToConcert: -2, desc: '谱面 C 实际发 Bb' },
    { id: 'sax-alto', name: '降 E 调中音萨克斯', writtenToConcert: -9, desc: '谱面 C 实际发 Eb' },
    { id: 'sax-tenor', name: '降 B 调次中音萨克斯', writtenToConcert: -14, desc: '谱面 C 实际发 Bb（低大二度）' },
    { id: 'horn-f', name: 'F 调圆号', writtenToConcert: -7, desc: '谱面 C 实际发 F' },
    { id: 'recorder-c', name: 'C 调竖笛 / 长笛', writtenToConcert: 0, desc: '不移调' }
  ];

  /* 记谱音 -> 实际音（半音位移） */
  function toConcert(pitchMidi, instrument) { return pitchMidi + (instrument.writtenToConcert || 0); }
  /* 实际音 -> 该乐器记谱音 */
  function toWritten(pitchMidi, instrument) { return pitchMidi - (instrument.writtenToConcert || 0); }

  /* 整个调一起移调 */
  function transposeKey(key, semitones) {
    var k = normalizeKey(key);
    var tonicMidi = midiOf(tonicPitch(k, 4)) + semitones;
    return findKey(((tonicMidi % 12) + 12) % 12, k.mode);
  }

  APP.theory = {
    STEPS: STEPS,
    STEP_SEMI: STEP_SEMI,
    KEY_LIST: KEYS,
    MAJOR_STEPS: MAJOR_STEPS,
    HARMONIC_MINOR_STEPS: HARMONIC_MINOR_STEPS,

    midiOf: midiOf,
    pitchFromMidi: pitchFromMidi,
    pitchFromDegree: pitchFromDegree,
    pitchName: pitchName,
    accidentalFor: accidentalFor,
    solfeggio: solfeggio,

    parseKey: parseKey,
    normalizeKey: normalizeKey,
    keyName: keyName,
    keySignature: keySignature,
    keySignatureMap: keySignatureMap,
    preferSharp: preferSharp,
    tonicPitch: tonicPitch,
    scalePitches: scalePitches,
    scaleDegrees: scaleDegrees,
    allKeys: allKeys,
    transposeKey: transposeKey,

    jianpuOf: jianpuOf,
    diatonicIndex: diatonicIndex,
    letterDelta: letterDelta,
    letterDeltaRaw: letterDeltaRaw,
    staffPos: staffPos,
    isLine: isLine,
    accidentalGlyph: accidentalGlyph,

    midiToFreq: midiToFreq,
    freqToMidiFloat: freqToMidiFloat,
    centsBetween: centsBetween,

    TRANSPOSING_INSTRUMENTS: TRANSPOSING_INSTRUMENTS,
    toConcert: toConcert,
    toWritten: toWritten
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = APP.theory;
})(typeof window !== 'undefined' ? (window.APP = window.APP || {}) : (global.APP = global.APP || {}));
