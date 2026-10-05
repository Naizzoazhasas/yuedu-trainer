/* 读谱训练器 — 生成器测试（不依赖浏览器）
 * 运行： node tools/test-generator.js
 * 核心不变量：每个小节的拍数必须精确等于 num*(4/den)；只用被勾选的时值与音级；同 seed 可复现。
 */
'use strict';

var path = require('path');
require(path.join(__dirname, '..', 'src', 'core', 'util.js'));
require(path.join(__dirname, '..', 'src', 'core', 'theory.js'));
var G = require(path.join(__dirname, '..', 'src', 'core', 'generator.js'));
var TH = global.APP.theory;

var pass = 0, fail = 0, msgs = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; msgs.push('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

var TIMES = G.TIME_SIGNATURES;
var DUR_SETS = [
  [1],
  [2, 1],
  [4, 2, 1],
  [1, 0.5],
  [1, 2, 0.5],
  [0.5, 0.25],
  [4, 2, 1, 0.5, 0.25]
];

console.log('=== 生成器测试 ===\n');

/* ---------- 1. 拍数精确性（最核心的不变量） ---------- */
console.log('1. 小节拍数精确性');
var beatFail = [], cases = 0;
TIMES.forEach(function (t) {
  DUR_SETS.forEach(function (ds) {
    [false, true].forEach(function (dot) {
      [false, true].forEach(function (rest) {
        for (var seed = 1; seed <= 25; seed++) {
          cases++;
          var cfg = {
            mode: (seed % 2) ? 'melody' : 'rhythm',
            bars: 4, time: { num: t.num, den: t.den }, tempo: 60,
            key: { tonic: (seed * 5) % 12, mode: (seed % 3 === 0) ? 'minor' : 'major' },
            durations: ds, useDotted: dot, useRests: rest, restRatio: 0.2, seed: seed
          };
          var score = G.generateScore(cfg);
          var want = t.num * (4 / t.den);
          var st = G.scoreStats(score);
          if (st.badBars.length) {
            beatFail.push(t.label + ' ' + JSON.stringify(ds) + ' dot=' + dot + ' seed=' + seed +
              ' -> ' + JSON.stringify(st.badBars.slice(0, 2)));
          }
          if (score.bars.length !== 4) beatFail.push('小节数不对');
        }
      });
    });
  });
});
ok('全部 ' + cases + ' 组配置下每个小节拍数都精确（覆盖 ' + TIMES.length + ' 种拍号 × ' + DUR_SETS.length + ' 种时值组合 × 附点/休止）',
  beatFail.length === 0, beatFail.slice(0, 6).join(' ; '));

/* 浮点脏数据检查 */
var dirty = 0;
for (var s = 1; s <= 200; s++) {
  var sc = G.generateScore({ bars: 4, durations: [0.5, 0.25, 1], useDotted: true, useRests: true, time: { num: 6, den: 8 }, seed: s });
  sc.bars.forEach(function (b) { if (b.beats !== 3) dirty++; });
}
ok('6/8 小节 beats 严格等于 3（无 2.9999999 之类的浮点脏值）', dirty === 0, 'dirty=' + dirty);

/* ---------- 2. 只使用被勾选的时值 ---------- */
console.log('2. 时值白名单');
var durBad = [];
[[1], [2, 1], [0.5], [0.25, 0.5]].forEach(function (ds) {
  for (var seed = 1; seed <= 40; seed++) {
    var score = G.generateScore({ bars: 3, durations: ds, useDotted: false, useRests: false, seed: seed, time: { num: 4, den: 4 } });
    score.bars.forEach(function (b) {
      b.notes.forEach(function (n) {
        if (ds.indexOf(n.dur) === -1) durBad.push('dur=' + n.dur + ' 不在 ' + JSON.stringify(ds));
      });
    });
  }
});
ok('只勾选四分音符时，输出里不会出现其他时值', durBad.length === 0, durBad.slice(0, 5).join(' ; '));

var dotBad = 0;
for (var s2 = 1; s2 <= 60; s2++) {
  var sc2 = G.generateScore({ bars: 4, durations: [1, 2], useDotted: false, useRests: true, seed: s2, time: { num: 4, den: 4 } });
  sc2.bars.forEach(function (b) { b.notes.forEach(function (n) { if (n.dotted) dotBad++; }); });
}
ok('未开启附点时不产生任何附点音符', dotBad === 0, 'dotted=' + dotBad);

/* ---------- 3. 音级白名单（只使用 1,2,3,4 这类需求） ---------- */
console.log('3. 音级白名单');
var pitchBad = [];
/* 只允许 1 2 3 4 级音 */
var DEGREES = [1, 2, 3, 4];
for (var s3 = 1; s3 <= 80; s3++) {
  var key = { tonic: [0, 2, 5, 7, 9, 10][s3 % 6], mode: (s3 % 4 === 0) ? 'minor' : 'major' };
  var score3 = G.generateScore({
    mode: 'melody', bars: 4, durations: [1, 2], useRests: true, seed: s3,
    key: key, degrees: DEGREES, range: { lowOct: 4, highOct: 4 }, useChromatic: false,
    time: { num: 4, den: 4 }
  });
  /* 用乐理内核独立算出该调的第 1-4 级音，生成结果必须都落在这个集合里 */
  var scaleType = key.mode === 'minor' ? 'harmonic' : 'major';
  var allowed = TH.scalePitches(key, 4, scaleType).slice(0, 4).map(function (p) { return TH.midiOf(p); });
  score3.bars.forEach(function (b) {
    b.notes.forEach(function (n) {
      if (!n.pitch) return;
      if (allowed.indexOf(TH.midiOf(n.pitch)) === -1) {
        pitchBad.push(TH.keyName(key) + ' ' + TH.pitchName(n.pitch) + ' (允许: ' +
          allowed.map(function (m) { return TH.pitchName(TH.pitchFromMidi(m, true)); }).join(',') + ')');
      }
    });
  });
}
ok('degrees=[1,2,3,4] 时只出现该调的第 1~4 级音（80 组随机种子 × 6 个调）', pitchBad.length === 0, pitchBad.slice(0, 6).join(' ; '));

/* 单独一级也应当可用 */
ok('degrees=[1] 时所有音都是主音', (function () {
  var k = { tonic: 2, mode: 'major', fifths: 2 };
  var allowed = [TH.midiOf(TH.scalePitches(k, 4)[0])];
  var s = G.generateScore({ mode: 'melody', bars: 3, durations: [1], useRests: false, seed: 3, key: k, degrees: [1], range: { lowOct: 4, highOct: 4 } });
  return s.bars.every(function (b) { return b.notes.every(function (n) { return allowed.indexOf(n.midi) !== -1; }); });
})());

/* 音域限制 */
var rangeBad = 0;
for (var s4 = 1; s4 <= 60; s4++) {
  var score4 = G.generateScore({ mode: 'melody', bars: 3, range: { lowOct: 4, highOct: 4 }, seed: s4, durations: [1], key: { tonic: 0, mode: 'major', fifths: 0 } });
  score4.bars.forEach(function (b) {
    b.notes.forEach(function (n) {
      if (n.pitch && n.pitch.oct !== 4) rangeBad++;
    });
  });
}
ok('range.lowOct=highOct=4 时所有音都在第 4 八度内', rangeBad === 0, 'oct 越界 ' + rangeBad);

/* 结尾落在主音 */
var endBad = 0;
for (var s5 = 1; s5 <= 40; s5++) {
  var score5 = G.generateScore({ mode: 'melody', bars: 2, durations: [1, 2], useRests: false, seed: s5, key: { tonic: 7, mode: 'major', fifths: 1 }, range: { lowOct: 4, highOct: 4 } });
  var lastBar = score5.bars[score5.bars.length - 1];
  var lastNote = lastBar.notes[lastBar.notes.length - 1];
  if (lastNote.pitch && lastNote.midi !== TH.midiOf(TH.tonicPitch({ tonic: 7, mode: 'major', fifths: 1 }, 4))) endBad++;
}
ok('旋律最后一个音落在主音上', endBad === 0, '未落在主音 ' + endBad + ' 次');

/* ---------- 4. 可复现性 ---------- */
console.log('4. 可复现性');
var a = JSON.stringify(G.generateScore({ bars: 6, seed: 20240607, durations: [1, 2, 0.5], useDotted: true, useRests: true, mode: 'melody', time: { num: 3, den: 4 } }));
var b = JSON.stringify(G.generateScore({ bars: 6, seed: 20240607, durations: [1, 2, 0.5], useDotted: true, useRests: true, mode: 'melody', time: { num: 3, den: 4 } }));
ok('相同 seed + 相同配置 -> 完全相同的乐段', a === b);
var c = JSON.stringify(G.generateScore({ bars: 6, seed: 20240608, durations: [1, 2, 0.5], useDotted: true, useRests: true, mode: 'melody', time: { num: 3, den: 4 } }));
ok('不同 seed -> 不同乐段', a !== c);
/* 不传 seed 必须每次不同 */
var d1 = JSON.stringify(G.generateScore({ bars: 4, durations: [1, 2] }));
var d2 = JSON.stringify(G.generateScore({ bars: 4, durations: [1, 2] }));
var anyDiff = false;
for (var k = 0; k < 6; k++) {
  if (JSON.stringify(G.generateScore({ bars: 4, durations: [1, 2] })) !== JSON.stringify(G.generateScore({ bars: 4, durations: [1, 2] }))) anyDiff = true;
}
ok('不传 seed 时每次结果随机（不再复现）', anyDiff);

/* ---------- 5. 节奏型库 ---------- */
console.log('5. 节奏型');
var pat = G.makePattern('测试型', [
  { dur: 1, dotted: false, rest: false },
  { dur: 1, dotted: false, rest: false },
  { dur: 2, dotted: false, rest: false }
]);
ok('makePattern 拍数 = 4', Math.abs(G.patternBeats(pat.items) - 4) < 1e-9);

var scoreP = G.generateScore({
  mode: 'rhythm', seed: 7, bars: 8, durations: [0.5, 1], usePatterns: [pat], patternVariation: 0,
  time: { num: 4, den: 4 }
});
var allMatch = scoreP.bars.every(function (bar) {
  return bar.notes.length === 3 &&
    bar.notes[0].dur === 1 && bar.notes[1].dur === 1 && bar.notes[2].dur === 2;
});
ok('usePatterns 且 patternVariation=0 时，每小节严格等于给定节奏型', allMatch,
  JSON.stringify(scoreP.bars.map(function (b) { return b.notes.map(function (n) { return n.dur; }); })));

/* 变奏不改变拍数（重要：否则小节就废了） */
var varOk = true;
for (var v = 0; v < 300; v++) {
  var vp = G.variatePattern(pat, global.APP.util.rngFrom(v));
  var vpBeats = G.patternBeats(vp.items);
  /* 变奏允许改变时值分布，但本实现里必须仍能填满 4 拍 */
  if (Math.abs(vpBeats - 4) > 1e-9) { varOk = false; console.log('    变奏后拍数变了: ' + vpBeats + ' items=' + JSON.stringify(vp.items)); break; }
}
ok('300 次变奏后拍数始终 = 4（变奏不会破坏小节完整性）', varOk);

/* 拍号不符的节奏型不能生成错误小节 */
var scoreM = G.generateScore({
  mode: 'rhythm', seed: 3, bars: 4, durations: [1, 2], usePatterns: [pat], patternVariation: 0.5,
  time: { num: 3, den: 4 }
});
var mStat = G.scoreStats(scoreM);
ok('节奏型拍号与小节不符时，退回自由生成而不是产出错误小节', mStat.badBars.length === 0,
  JSON.stringify(mStat.badBars));

/* 自动生成的节奏型池 */
var pool = G.buildPatternPool(G.defaultConfig({ durations: [1, 2, 0.5], time: { num: 4, den: 4 } }), global.APP.util.rngFrom(1));
ok('buildPatternPool 生成的每个节奏型都恰好 4 拍（' + pool.length + ' 个）',
  pool.length > 0 && pool.every(function (p) { return Math.abs(G.patternBeats(p.items) - 4) < 1e-9; }));

/* ---------- 6. 延音线语义 ---------- */
console.log('6. 延音线');
var tieOk = true, tieCount = 0;
for (var t2 = 1; t2 <= 120; t2++) {
  var sc6 = G.generateScore({ mode: 'melody', bars: 4, durations: [0.5, 1], useSyncopation: true, useRests: true, seed: t2, key: { tonic: 0, mode: 'major', fifths: 0 } });
  sc6.bars.forEach(function (bar) {
    bar.notes.forEach(function (n, i) {
      if (!n.tie) return;
      tieCount++;
      var nx = bar.notes[i + 1];
      /* 打了延音线的音，后一个必须是同音高（否则乐理上讲不通） */
      if (!nx || !nx.pitch || !n.pitch || nx.midi !== n.midi) tieOk = false;
    });
  });
}
ok('延音线只出现在「后一个音同音高」的位置（共 ' + tieCount + ' 处）', tieOk);

/* ---------- 7. 移调工具 ---------- */
console.log('7. 与乐理内核的衔接');
var sc7 = G.generateScore({ mode: 'melody', bars: 2, seed: 5, key: { tonic: 2, mode: 'major', fifths: 2 }, range: { lowOct: 4, highOct: 4 } });
var allSpelled = sc7.bars.every(function (b) {
  return b.notes.every(function (n) {
    if (!n.pitch) return true;
    return n.midi === TH.midiOf(n.pitch) && n.pos === TH.staffPos(n.pitch, 'treble');
  });
});
ok('生成结果里的 midi / pos 冗余字段与乐理内核一致', allSpelled);

var rp = G.derivePatternFromScore(sc7.bars[0]);
ok('derivePatternFromScore 反推出的节奏型拍数 = 4', Math.abs(G.patternBeats(rp.items) - 4) < 1e-9);

/* ---------- 8. 边界 ---------- */
console.log('8. 边界情况');
ok('bars=1 可用', G.generateScore({ bars: 1, durations: [1], seed: 1 }).bars.length === 1);
ok('durations=[] 时不会崩溃且仍有内容', (function () {
  try { var x = G.generateScore({ durations: [], seed: 1 }); return x.bars.length === 4 && x.bars[0].notes.length > 0; }
  catch (e) { return false; }
})());
ok('useRests=false 时没有任何休止符', (function () {
  var x = G.generateScore({ bars: 4, durations: [1, 2], useRests: false, seed: 11 });
  return x.bars.every(function (b) { return b.notes.every(function (n) { return !!n.pitch; }); });
})());
ok('默认配置（新手档：四分+二分，C 大调，60 PBM）可用', (function () {
  var x = G.generateScore({ seed: 12 });
  var st = G.scoreStats(x);
  return st.badBars.length === 0 && x.tempo === 60 && x.time.num === 4;
})());

console.log('\n=== 结果：' + pass + ' 通过, ' + fail + ' 失败 ===');
if (msgs.length) console.log(msgs.join('\n'));
process.exit(fail ? 1 : 0);
