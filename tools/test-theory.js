/* 读谱训练器 — 乐理内核独立测试（不依赖浏览器）
 * 运行： node tools/test-theory.js
 * 这里的期望值全部用「独立实现」重算，而不是抄理论代码本身，避免自我印证。
 */
'use strict';

var path = require('path');
var T = require(path.join(__dirname, '..', 'src', 'core', 'theory.js'));

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; msgs.push('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

var LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/* ---- 独立实现：五线谱位置 ---- */
function refStaffPos(p, clef) {
  var base = clef === 'bass' ? { l: 'G', o: 2 } : { l: 'E', o: 4 };
  return (LETTER.indexOf(p.step) - LETTER.indexOf(base.l)) + (p.oct - base.o) * 7;
}

/* ---- 独立实现：midi ---- */
function refMidi(p) { return 12 * (p.oct + 1) + SEMI[p.step] + (p.acc || 0); }

/* ---- 独立实现：调号 ---- */
function refSigCount(fifths) { return Math.abs(fifths); }

/* ---- 独立实现：某调音阶（不依赖被测代码，用显式的五度圈音名表 + 目标音高反推拼写） ---- */
/* 五度圈上每个五度数对应的主音写法（写死，避免再犯公式错） */
var MAJOR_BY_FIFTHS = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#'
};
function parseName(s) {
  var m = s.match(/^([A-G])(#|b)?/);
  return { step: m[1], acc: m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0) };
}
/* 由「音级字母 + 目标 midi」反推八度与变音。
 * 关键：八度要用「目标音高所在的八度段」来定，不能只用字母的自然音高，
 * 否则 Cb4(59) 这种比 B3 还低的音会被算成第 3 八度。 */
function spellByMidi(letter, targetMidi) {
  var oct = Math.floor(targetMidi / 12) - 1;
  var acc = targetMidi - (12 * (oct + 1) + SEMI[letter]);
  /* acc 超出 ±2 说明八度选偏了，按箭头方向回正 */
  while (acc > 2) { oct += 1; acc = targetMidi - (12 * (oct + 1) + SEMI[letter]); }
  while (acc < -2) { oct -= 1; acc = targetMidi - (12 * (oct + 1) + SEMI[letter]); }
  return { step: letter, acc: acc, oct: oct };
}
function refMajorSpelling(fifths) {
  var tonicName = parseName(MAJOR_BY_FIFTHS[String(fifths)]);
  var li0 = LETTER.indexOf(tonicName.step);
  var tonicMidi = 60 + SEMI[tonicName.step] + tonicName.acc;
  var out = [];
  for (var i = 0; i < 7; i++) {
    out.push(spellByMidi(LETTER[(li0 + i) % 7], tonicMidi + [0, 2, 4, 5, 7, 9, 11][i]));
  }
  return out;
}
function refScaleNames(fifths, mode) {
  var maj = refMajorSpelling(fifths);
  var tonic, steps;
  if (mode === 'minor') {
    /* 关系小调的主音 = 关系大调的第 6 级（就是那个音本身，不要再去改八度） */
    tonic = { step: maj[5].step, acc: maj[5].acc, oct: maj[5].oct };
    steps = [0, 2, 3, 5, 7, 8, 11];                                       // 和声小调
  } else {
    tonic = { step: maj[0].step, acc: maj[0].acc, oct: maj[0].oct };
    steps = [0, 2, 4, 5, 7, 9, 11];
  }
  var tm = 12 * (tonic.oct + 1) + SEMI[tonic.step] + tonic.acc;
  var li0 = LETTER.indexOf(tonic.step);
  var out = [];
  for (var i = 0; i < 7; i++) {
    var li = (li0 + i) % 7;
    var spelled = spellByMidi(LETTER[li], tm + steps[i]);
    var acc = spelled.acc;
    out.push(LETTER[li] + (acc === 1 ? '#' : acc === -1 ? 'b' : acc === 2 ? '##' : acc === -2 ? 'bb' : ''));
  }
  return out;
}

console.log('=== 乐理内核测试 ===\n');

/* ---------- 1. midiOf / pitchFromMidi ---------- */
console.log('1. 音高换算');
eq('C4 = 60', T.midiOf({ step: 'C', acc: 0, oct: 4 }), 60);
eq('A4 = 69', T.midiOf({ step: 'A', acc: 0, oct: 4 }), 69);
eq('F#4 = 66', T.midiOf({ step: 'F', acc: 1, oct: 4 }), 66);
eq('Bb3 = 58', T.midiOf({ step: 'B', acc: -1, oct: 3 }), 58);
eq('Cb4 = 59 (与 B3 同音)', T.midiOf({ step: 'C', acc: -1, oct: 4 }), 59);
eq('B#3 = 60 (与 C4 同音)', T.midiOf({ step: 'B', acc: 1, oct: 3 }), 60);
var midiRoundTripOk = true;
for (var m = 21; m <= 108; m++) {
  if (T.midiOf(T.pitchFromMidi(m, true)) !== m) midiRoundTripOk = false;
  if (T.midiOf(T.pitchFromMidi(m, false)) !== m) midiRoundTripOk = false;
}
ok('pitchFromMidi 在 A0..C8 全部往返一致（升/降两种写法）', midiRoundTripOk);

/* ---------- 2. 五线谱位置 ---------- */
console.log('2. 五线谱位置');
eq('高音谱 E4 = 0（第 1 线）', T.staffPos({ step: 'E', acc: 0, oct: 4 }, 'treble'), 0);
eq('高音谱 G4 = 2（第 2 线）', T.staffPos({ step: 'G', acc: 0, oct: 4 }, 'treble'), 2);
eq('高音谱 F5 = 8（第 5 线）', T.staffPos({ step: 'F', acc: 0, oct: 5 }, 'treble'), 8);
eq('高音谱 C4 = -2（下加一线）', T.staffPos({ step: 'C', acc: 0, oct: 4 }, 'treble'), -2);
eq('低音谱 G2 = 0（第 1 线）', T.staffPos({ step: 'G', acc: 0, oct: 2 }, 'bass'), 0);
eq('低音谱 A2 = 1（第 1 间）', T.staffPos({ step: 'A', acc: 0, oct: 2 }, 'bass'), 1);
eq('低音谱 B2 = 2（第 2 线）', T.staffPos({ step: 'B', acc: 0, oct: 2 }, 'bass'), 2);
eq('低音谱 C4 = 10（上加二线）', T.staffPos({ step: 'C', acc: 0, oct: 4 }, 'bass'), 10);
eq('低音谱 F3 = 6（第 4 线）', T.staffPos({ step: 'F', acc: 0, oct: 3 }, 'bass'), 6);
var posOk = true;
['treble', 'bass'].forEach(function (clef) {
  for (var o = 1; o <= 6; o++) {
    LETTER.forEach(function (st) {
      var p = { step: st, acc: 0, oct: o };
      if (T.staffPos(p, clef) !== refStaffPos(p, clef)) posOk = false;
    });
  }
});
ok('全部自然音位（84 项）与独立公式一致', posOk);

/* ---------- 3. 调号 ---------- */
console.log('3. 调号');
var SIG_SHARP = [5, 2, 6, 3, 7, 4, 8];
var SIG_FLAT = [4, 7, 3, 6, 2, 5, 1];
/* 每个五度数对应的主音音级（用显式表推导，小调 = 大调主音下方小三度） */
var MAJOR_TONIC_PC = { '-7': 11, '-6': 6, '-5': 1, '-4': 8, '-3': 3, '-2': 10, '-1': 5, '0': 0, '1': 7, '2': 2, '3': 9, '4': 4, '5': 11, '6': 6, '7': 1 };
function refTonicOf(fifths, mode) {
  var maj = MAJOR_TONIC_PC[String(fifths)];
  if (maj === undefined) return 0;
  if (mode === 'minor') return ((maj - 3) % 12 + 12) % 12;
  return maj;
}
var sigOk = true;
for (var f = -7; f <= 7; f++) {
  var key = { tonic: refTonicOf(f), mode: 'major', fifths: f };
  var sig = T.keySignature(key);
  if (sig.count !== refSigCount(f)) sigOk = false;
  if (f > 0 && JSON.stringify(sig.positions) !== JSON.stringify(SIG_SHARP.slice(0, f))) sigOk = false;
  if (f < 0 && JSON.stringify(sig.positions) !== JSON.stringify(SIG_FLAT.slice(0, -f))) sigOk = false;
}
ok('15 个调号的数目与位置全部正确', sigOk);

var namesOk = true;
var EXPECT = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', '0': 'C', '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#' };
for (var f2 = -7; f2 <= 7; f2++) {
  var nm = T.keyName({ tonic: refTonicOf(f2), mode: 'major', fifths: f2 });
  if (nm !== EXPECT[String(f2)] + ' 大调') { namesOk = false; console.log('    调名不符: fifths=' + f2 + ' -> ' + nm); }
}
ok('15 个大调调名拼写正确（Cb / F# / C# 等）', namesOk);

/* 浅合并带进来的脏 fifths 必须被纠正 */
eq('normalizeKey 忽略与主音不自洽的 fifths（D 大调被误标 fifths=0）',
  JSON.stringify(T.normalizeKey({ tonic: 2, mode: 'major', fifths: 0 })),
  JSON.stringify({ tonic: 2, mode: 'major', fifths: 2 }));
eq('normalizeKey 保留与主音自洽的 fifths（Cb 大调 fifths=-7）',
  JSON.stringify(T.normalizeKey({ tonic: 11, mode: 'major', fifths: -7 })),
  JSON.stringify({ tonic: 11, mode: 'major', fifths: -7 }));

/* ---------- 4. 音阶拼写 ---------- */
console.log('4. 音阶拼写');
var scaleOk = true, scaleChecked = 0;
[-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].forEach(function (f3) {
  ['major', 'minor'].forEach(function (mode) {
    var k = { tonic: refTonicOf(f3, mode), mode: mode, fifths: f3 };
    var got = T.scalePitches(k, 4).map(function (p) { return T.pitchName(p, { octave: false }); });
    var want = refScaleNames(f3, mode);
    scaleChecked++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      scaleOk = false;
      console.log('    ' + (mode === 'major' ? f3 + ' 大调' : f3 + ' 小调(和声)') + ' got ' + got.join(' ') + ' | want ' + want.join(' '));
    }
    /* 每个音级必须只出现一次 */
    var letters = got.map(function (n) { return n[0]; });
    if (new Set(letters).size !== 7) { scaleOk = false; console.log('    音级重复: ' + got.join(' ')); }
  });
});
ok('30 个调的音阶拼写与音级不重复（' + scaleChecked + ' 项）', scaleOk);

/* 和声小调第 7 级必须升高 */
eq('a 小调和声第 7 级 = G#', T.pitchName(T.scalePitches({ tonic: 9, mode: 'minor', fifths: 0 }, 4)[6], { octave: false }), 'G#');
eq('d 小调和声第 7 级 = C#', T.pitchName(T.scalePitches({ tonic: 2, mode: 'minor', fifths: -1 }, 4)[6], { octave: false }), 'C#');

/* ---------- 5. 简谱（首调） ---------- */
console.log('5. 简谱 / 首调');
var jpOk = true;
[0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7].forEach(function (f4) {
  ['major', 'minor'].forEach(function (mode) {
    var k = { tonic: 0, mode: mode, fifths: f4 };
    T.scalePitches(k, 4).forEach(function (p, i) {
      var j = T.jianpuOf(p, k, 'relative');
      if (j.digit !== i + 1 || j.accidental !== '' || j.octave !== 0) {
        jpOk = false;
        console.log('    ' + T.keyName(k) + ' 第' + (i + 1) + '级 ' + T.pitchName(p) + ' -> ' + JSON.stringify(j));
      }
    });
  });
});
ok('30 个调的音阶音在首调简谱里都是 1-7、无变音、八度 0', jpOk);

eq('D 大调 C#5 = 7（不是 3#）', JSON.stringify(T.jianpuOf({ step: 'C', acc: 1, oct: 5 }, { tonic: 2, mode: 'major', fifths: 2 }, 'relative')), JSON.stringify({ digit: 7, accidental: '', octave: 0, rest: false }));
eq('D 大调 C4 = 低八度的 7b', JSON.stringify(T.jianpuOf({ step: 'C', acc: 0, oct: 4 }, { tonic: 2, mode: 'major', fifths: 2 }, 'relative')), JSON.stringify({ digit: 7, accidental: 'b', octave: -1, rest: false }));
eq('D 大调 D5 = 高八度的 1', JSON.stringify(T.jianpuOf({ step: 'D', acc: 0, oct: 5 }, { tonic: 2, mode: 'major', fifths: 2 }, 'relative')), JSON.stringify({ digit: 1, accidental: '', octave: 1, rest: false }));
eq('F 大调 Bb4 = 4', T.jianpuOf({ step: 'B', acc: -1, oct: 4 }, { tonic: 5, mode: 'major', fifths: -1 }, 'relative').digit, 4);
eq('F 大调 B4 = 4#', T.jianpuOf({ step: 'B', acc: 0, oct: 4 }, { tonic: 5, mode: 'major', fifths: -1 }, 'relative').accidental, '#');
eq('a 小调 G#4 = 7（升高的导音）', T.jianpuOf({ step: 'G', acc: 1, oct: 4 }, { tonic: 9, mode: 'minor', fifths: 0 }, 'relative').digit, 7);
eq('a 小调 C5 = 3（小调三级不记降号）', T.jianpuOf({ step: 'C', acc: 0, oct: 5 }, { tonic: 9, mode: 'minor', fifths: 0 }, 'relative').accidental, '');
eq('固定调：D 大调下 D4 = 2', T.jianpuOf({ step: 'D', acc: 0, oct: 4 }, { tonic: 2, mode: 'major', fifths: 2 }, 'fixed').digit, 2);
eq('固定调：D 大调下 F#4 = 4#', T.jianpuOf({ step: 'F', acc: 1, oct: 4 }, { tonic: 2, mode: 'major', fifths: 2 }, 'fixed').accidental, '#');

/* ---------- 6. 临时记号 ---------- */
console.log('6. 临时记号');
var D = { tonic: 2, mode: 'major', fifths: 2 };
eq('D 大调 F# 不写临时记号', T.accidentalGlyph({ step: 'F', acc: 1, oct: 5 }, D), '');
eq('D 大调 F 还原写还原号', T.accidentalGlyph({ step: 'F', acc: 0, oct: 5 }, D), 'natural');
eq('D 大调 C 还原写还原号', T.accidentalGlyph({ step: 'C', acc: 0, oct: 5 }, D), 'natural');
eq('D 大调 C# 不写临时记号', T.accidentalGlyph({ step: 'C', acc: 1, oct: 5 }, D), '');
eq('D 大调 G# 写升号', T.accidentalGlyph({ step: 'G', acc: 1, oct: 4 }, D), '#');
var F = { tonic: 5, mode: 'major', fifths: -1 };
eq('F 大调 Bb 不写临时记号', T.accidentalGlyph({ step: 'B', acc: -1, oct: 4 }, F), '');
eq('F 大调 B 还原写还原号', T.accidentalGlyph({ step: 'B', acc: 0, oct: 4 }, F), 'natural');

/* ---------- 7. 频率 ---------- */
console.log('7. 频率');
ok('A4 = 440Hz', Math.abs(T.midiToFreq(69) - 440) < 1e-9);
ok('A3 = 220Hz', Math.abs(T.midiToFreq(57) - 220) < 1e-9);
ok('C4 ≈ 261.626Hz', Math.abs(T.midiToFreq(60) - 261.6255653) < 1e-4);
ok('freqToMidiFloat(440) = 69', Math.abs(T.freqToMidiFloat(440) - 69) < 1e-9);
ok('freqToMidiFloat(midiToFreq(83)) = 83', Math.abs(T.freqToMidiFloat(T.midiToFreq(83)) - 83) < 1e-9);
ok('低 20 音分 ≈ -20', Math.abs(T.centsBetween(440 * Math.pow(2, -20 / 1200), 440) + 20) < 1e-6);

/* ---------- 8. 移调 ---------- */
console.log('8. 移调');
var clarinet = T.TRANSPOSING_INSTRUMENTS.filter(function (i) { return i.id === 'clarinet-bb'; })[0];
eq('降 B 单簧管记谱 C4 -> 实际 Bb3', T.pitchName(T.pitchFromMidi(T.toConcert(60, clarinet))), 'Bb3');
eq('降 B 单簧管实际 Bb3 -> 记谱 C4', T.toWritten(58, clarinet), 60);
var alto = T.TRANSPOSING_INSTRUMENTS.filter(function (i) { return i.id === 'sax-alto'; })[0];
eq('降 E 中音萨克斯记谱 C4 -> 实际 Eb3', T.pitchName(T.pitchFromMidi(T.toConcert(60, alto))), 'Eb3');
eq('F 调圆号记谱 C4 -> 实际 F3', T.pitchName(T.pitchFromMidi(T.toConcert(60, T.TRANSPOSING_INSTRUMENTS.filter(function (i) { return i.id === 'horn-f'; })[0]))), 'F3');
/* 移调后调号也要跟着走 */
eq('D 大调上移 2 半音 = E 大调', T.keyName(T.transposeKey({ tonic: 2, mode: 'major', fifths: 2 }, 2)), 'E 大调');
eq('D 大调下移 2 半音 = C 大调', T.keyName(T.transposeKey({ tonic: 2, mode: 'major', fifths: 2 }, -2)), 'C 大调');
eq('C 大调下移 2 半音 = Bb 大调', T.keyName(T.transposeKey({ tonic: 0, mode: 'major', fifths: 0 }, -2)), 'Bb 大调');
eq('C 大调上移 1 半音 = Db 大调', T.keyName(T.transposeKey({ tonic: 0, mode: 'major', fifths: 0 }, 1)), 'Db 大调');

/* ---------- 9. parseKey ---------- */
console.log('9. 调解析');
eq('parseKey("D major")', JSON.stringify(T.parseKey('D major')), JSON.stringify({ tonic: 2, mode: 'major', fifths: 2 }));
eq('parseKey("D大调")', JSON.stringify(T.parseKey('D大调')), JSON.stringify({ tonic: 2, mode: 'major', fifths: 2 }));
eq('parseKey("bb minor") = Bb 小调', T.keyName(T.parseKey('bb minor')), 'Bb 小调');
eq('parseKey("F#m") = F# 小调', T.keyName(T.parseKey('F#m')), 'F# 小调');
eq('parseKey("a") = a 小调的相对大调？不，应为 A 大调', T.keyName(T.parseKey('a')), 'A 大调');
eq('parseKey("Am") = a 小调', T.keyName(T.parseKey('Am')), 'a 小调'.replace('a', 'A'));

/* ---------- 10. allKeys ---------- */
console.log('10. 调表');
var keys = T.allKeys();
ok('allKeys 返回 30 个调', keys.length === 30, 'got ' + keys.length);
ok('allKeys 每项都有名字和调号数目', keys.every(function (k) { return typeof k.name === 'string' && typeof k.signature === 'number'; }));

/* ---------- 汇总 ---------- */
console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (msgs.length) console.log(msgs.join('\n'));
process.exit(fail ? 1 : 0);
