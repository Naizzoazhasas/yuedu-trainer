/* 导出模块自测脚本（node 环境，无浏览器）
 * 运行：node tools/_t_export.js
 *
 * 覆盖：
 *  1) 纯数据路径：toMIDI 字节解析校验（MThd / format / division / tempo / note on-off / VLQ / 延音线合并）
 *  2) toMusicXML 结构与小节时长校验
 *  3) 无 DOM 时 PNG 路径必须「安全失败」：不抛异常，返回 reject 的 Promise
 *
 * 注意：node 里没有 window，按题目要求补 global.window = global（不改产品代码）。
 */
'use strict';

global.window = global;
global.APP = global.APP || {};

var path = require('path');
var util = require(path.join(__dirname, '..', 'src', 'core', 'util.js'));
var theory = require(path.join(__dirname, '..', 'src', 'core', 'theory.js'));
var exporter = require(path.join(__dirname, '..', 'src', 'export', 'exporter.js'));

var failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  [ok]   ' + name);
  else {
    failed++;
    console.log('  [FAIL] ' + name + (extra !== undefined ? ('  => ' + extra) : ''));
  }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* 计时：四分音符 = 480 tick */
var TICKS_PER_QUARTER = 480;
/* 权威时值表（契约第 1 节）：dur 是「时值倒数标记」，基础拍数即 dur 本身 */
var BEATS_TABLE = { '4': 4, '2': 2, '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125, '0.0625': 0.0625 };

function noteTicks(dur, dotted) {
  return Math.round(BEATS_TABLE[String(dur)] * (dotted ? 1.5 : 1) * TICKS_PER_QUARTER);
}

/* ---------------- 测试用乐段：4 小节 4/4 ---------------- */

function P(step, acc, oct) { return { step: step, acc: acc, oct: oct }; }

function N(step, dur, opts) {
  opts = opts || {};
  var pitch = step === null ? null : P(step[0], opts.acc || 0, opts.oct === undefined ? 4 : opts.oct);
  return {
    pitch: pitch,
    dur: dur,
    dotted: !!opts.dotted,
    tie: !!opts.tie,
    midi: pitch ? theory.midiOf(pitch) : null,
    pos: 0
  };
}

function buildScore() {
  var bars = [
    { notes: [N('C', 2), N('E', 1), N('G', 0.5), N('A', 0.5)] },                                        // 2+1+0.5+0.5 = 4 拍
    { notes: [N('B', 1, { oct: 3, tie: true }), N('B', 1, { oct: 3 }), N(null, 1), N('D', 1)] },        // 1+1+1+1 = 4 拍（前两音延音线相连）
    { notes: [N(null, 2), N('F', 1, { dotted: true }), N('G', 0.5)] },                                  // 2+1.5+0.5 = 4 拍
    { notes: [N('C', 1, { oct: 5 }), N('B', 1), N('A', 1), N('G', 1)] }                                 // 1+1+1+1 = 4 拍
  ];
  bars.forEach(function (b) {
    b.beats = b.notes.reduce(function (s, n) { return s + BEATS_TABLE[String(n.dur)] * (n.dotted ? 1.5 : 1); }, 0);
  });
  return {
    key: { tonic: 2, mode: 'major', fifths: 2 },
    time: { num: 4, den: 4 },
    tempo: 120,
    clef: 'treble',
    title: '导出自测 & <检查>',
    bars: bars
  };
}

var score = buildScore();
var EXPECT_TOTAL = 4 * 4 * TICKS_PER_QUARTER;   // 7680
var EXPECT_NOTES = 15;
var EXPECT_NOTE_ON = 13;                        // 15 个音符 - 2 个休止符 - 1 次延音线合并 = 12？见下行计算
/* 逐条：bar1 4 个发声音；bar2 B3 两音合并为 1 + D4 = 2；bar3 F4,G4 = 2；bar4 = 4 → 12 个 note on */
EXPECT_NOTE_ON = 12;

/* 谱面自身时值合计（含休止符） */
var scoreTicks = 0;
var scoreSoundTicks = 0;
score.bars.forEach(function (b) {
  b.notes.forEach(function (n) {
    var t = noteTicks(n.dur, n.dotted);
    scoreTicks += t;
    if (n.pitch) scoreSoundTicks += t;
  });
});

/* ---------------- MIDI 解析器（自写，用于校验导出的字节） ---------------- */

function parseMidi(bytes) {
  var p = 0;
  function u8() { return bytes[p++]; }
  function u16() { return (u8() << 8) | u8(); }
  function u32() { return ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0; }
  function vlq() { var v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7F); } while (b & 0x80); return v; }
  function str(n) { var s = '', i; for (i = 0; i < n; i++) s += String.fromCharCode(u8()); return s; }

  if (str(4) !== 'MThd') throw new Error('缺少 MThd 魔数');
  var hlen = u32();
  var format = u16(), ntrks = u16(), division = u16();
  if (hlen > 6) p += (hlen - 6);

  var tracks = [];
  for (var t = 0; t < ntrks; t++) {
    if (str(4) !== 'MTrk') throw new Error('第 ' + t + ' 轨缺少 MTrk');
    var tlen = u32();
    var end = p + tlen;
    var tick = 0, running = 0, events = [];
    while (p < end) {
      var delta = vlq();
      tick += delta;
      var st = bytes[p];
      if (st & 0x80) { p++; if (st < 0xF0) running = st; }
      else { st = running; }
      if (st === 0xFF) {
        var meta = u8(), mlen = vlq(), data = [];
        for (var i = 0; i < mlen; i++) data.push(u8());
        events.push({ tick: tick, delta: delta, type: 'meta', meta: meta, data: data });
      } else if (st === 0xF0 || st === 0xF7) {
        var sl = vlq(); p += sl;
        events.push({ tick: tick, delta: delta, type: 'sysex' });
      } else {
        var hi = st & 0xF0, ch = st & 0x0F;
        if (hi === 0x90 || hi === 0x80) {
          var d1 = u8(), d2 = u8();
          var isOn = (hi === 0x90 && d2 > 0);
          events.push({ tick: tick, delta: delta, type: isOn ? 'on' : 'off', note: d1, vel: d2, ch: ch });
        } else if (hi === 0xA0 || hi === 0xB0 || hi === 0xE0) {
          u8(); u8(); events.push({ tick: tick, delta: delta, type: 'other' });
        } else if (hi === 0xC0 || hi === 0xD0) {
          u8(); events.push({ tick: tick, delta: delta, type: 'other' });
        } else {
          throw new Error('未知状态字节 0x' + st.toString(16) + ' @' + p);
        }
      }
    }
    p = end;
    tracks.push({ events: events, length: tlen, endTick: tick });
  }
  return { format: format, ntrks: ntrks, division: division, tracks: tracks, consumed: p, size: bytes.length };
}

function notesOf(track) {
  var on = [], off = [];
  track.events.forEach(function (e) {
    if (e.type === 'on') on.push(e);
    else if (e.type === 'off') off.push(e);
  });
  return { on: on, off: off };
}

/* ==================== 1. 模块注册 ==================== */

section('1. 模块注册与 API 完整性');
var need = ['toPNG', 'exportScoreImage', 'toMIDI', 'toMusicXML', 'exportMIDIFile',
  'exportMusicXMLFile', 'copyText', 'saveNodeImage', 'downloadBlob', 'toDataURL', 'mountPanel'];
check('已注册到 global.APP.export', global.APP['export'] === exporter);
need.forEach(function (k) {
  check('typeof export.' + k + ' === "function"', typeof exporter[k] === 'function');
});
check('saveNodeImage 与 toPNG 是同一个函数（等价别名）', exporter.saveNodeImage === exporter.toPNG);
check('midiBytes 存在（导出 Uint8Array 便于测试）', typeof exporter.midiBytes === 'function');

/* ==================== 2. 谱面时值自检 ==================== */

section('2. 测试谱面时值（4 小节 4/4）');
check('每小节 4 拍 = ' + EXPECT_TOTAL + ' tick', scoreTicks === EXPECT_TOTAL, scoreTicks);
check('发声总时值 = ' + (EXPECT_TOTAL - 1440) + ' tick（休止 3 拍）', scoreSoundTicks === EXPECT_TOTAL - 1440, scoreSoundTicks);
check('音符总数 = ' + EXPECT_NOTES, score.bars.reduce(function (s, b) { return s + b.notes.length; }, 0) === EXPECT_NOTES);

/* ==================== 3. MIDI ==================== */

section('3. toMIDI 字节校验');
var blob = exporter.toMIDI(score);
check('返回 Blob', typeof Blob !== 'undefined' && blob instanceof Blob);
check('字节数 > 0（' + blob.size + ' 字节）', blob.size > 0);
check('MIME = audio/midi', blob.type === 'audio/midi', blob.type);

var bytes = new Uint8Array(exporter.midiBytes(score));
check('midiBytes 返回 Uint8Array 且长度与 Blob 一致', bytes.length === blob.size, bytes.length + ' vs ' + blob.size);
check('魔数 MThd', String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'MThd');

var mid = parseMidi(bytes);
check('format === 1', mid.format === 1, mid.format);
check('ntrks === 2', mid.ntrks === 2, mid.ntrks);
check('division === 480', mid.division === 480, mid.division);
check('解析器读完整个文件', mid.consumed === bytes.length, mid.consumed + '/' + bytes.length);

/* 轨 0：速度 / 拍号 / 调号 */
var meta = mid.tracks[0].events.filter(function (e) { return e.type === 'meta'; });
var tempoEv = meta.filter(function (e) { return e.meta === 0x51; })[0];
var timeEv = meta.filter(function (e) { return e.meta === 0x58; })[0];
var keyEv = meta.filter(function (e) { return e.meta === 0x59; })[0];
var eot0 = meta.filter(function (e) { return e.meta === 0x2F; })[0];
check('轨 0 含 tempo 事件 (FF 51 03)', !!tempoEv);
check('轨 0 含拍号事件 (FF 58 04)', !!timeEv);
check('轨 0 含调号事件 (FF 59 02)', !!keyEv);
check('轨 0 含 EOT (FF 2F 00)', !!eot0);

if (tempoEv) {
  var us = (tempoEv.data[0] << 16) | (tempoEv.data[1] << 8) | tempoEv.data[2];
  check('tempo = 60000000/bpm = ' + Math.round(60000000 / 120),
    us === Math.round(60000000 / score.tempo), us);
}
if (timeEv) {
  check('拍号 nn=4 dd=2 (4/4)', timeEv.data[0] === 4 && timeEv.data[1] === 2,
    timeEv.data.join(','));
  check('拍号 cc=24 bb=8', timeEv.data[2] === 24 && timeEv.data[3] === 8, timeEv.data.join(','));
}
if (keyEv) {
  var sf = keyEv.data[0] > 127 ? keyEv.data[0] - 256 : keyEv.data[0];
  check('调号 fifths=2 / mode=major', sf === 2 && keyEv.data[1] === 0, sf + ',' + keyEv.data[1]);
}

/* 轨 1：音符 */
var track1 = mid.tracks[1];
var nn = notesOf(track1);
check('note on 数量 = ' + EXPECT_NOTE_ON, nn.on.length === EXPECT_NOTE_ON, nn.on.length);
check('note off 数量 = ' + EXPECT_NOTE_ON, nn.off.length === EXPECT_NOTE_ON, nn.off.length);
check('note on 状态字节均为 0x90', nn.on.every(function (e) { return e.vel > 0; }));

var b3On = nn.on.filter(function (e) { return e.note === 59; });
var b3Off = nn.off.filter(function (e) { return e.note === 59; });
check('B3(midi 59) 延音线被合并：只有 1 次 note on', b3On.length === 1, b3On.length);
check('B3 只有 1 次 note off', b3Off.length === 1, b3Off.length);
if (b3On.length === 1 && b3Off.length === 1) {
  check('B3 合并后时值 = 960 tick（1 拍 + 1 拍）', (b3Off[0].tick - b3On[0].tick) === 960,
    b3Off[0].tick - b3On[0].tick);
}

/* 最后一个事件（EOT）应落在乐曲总长上 */
var lastTick = track1.events[track1.events.length - 1].tick;
check('末事件 tick = 4 小节 × 4 拍 × 480 = ' + EXPECT_TOTAL, lastTick === EXPECT_TOTAL, lastTick);

/* 所有 delta 之和 == 总长度（VLQ 多字节正确性） */
var deltaSum = track1.events.reduce(function (s, e) { return s + e.delta; }, 0);
check('delta 之和 = ' + EXPECT_TOTAL, deltaSum === EXPECT_TOTAL, deltaSum);
check('存在多字节 VLQ（有 delta > 127）', track1.events.some(function (e) { return e.delta > 127; }),
  track1.events.map(function (e) { return e.delta; }).join(','));

/* 发声总时值（所有 note off - note on 之和） */
var sound = 0;
nn.on.forEach(function (on, i) { sound += (nn.off[i].tick - on.tick); });
check('解析回来的发声总时值 = ' + scoreSoundTicks, sound === scoreSoundTicks, sound);

/* 同一 tick 上 note off 必须排在 note on 之前：on 之后不允许再出现同 tick 的 off */
var orderBad = [];
for (var i = 0; i < track1.events.length; i++) {
  if (track1.events[i].type !== 'on') continue;
  var j = i + 1;
  while (j < track1.events.length && track1.events[j].tick === track1.events[i].tick) {
    if (track1.events[j].type === 'off') { orderBad.push(track1.events[i].tick); break; }
    j++;
  }
}
check('同一 tick 上 note off 排在 note on 之前', orderBad.length === 0, orderBad.join(','));
check('tick 960 处同时有 off 与 on（该规则实际被触发）',
  track1.events.some(function (e) { return e.tick === 960 && e.type === 'off'; }) &&
  track1.events.some(function (e) { return e.tick === 960 && e.type === 'on'; }));

/* 音高序列与谱面一致（休止符跳过；前一个音带延音线且同音高时合并为一个音） */
var expectSeq = [];
var prevNote = null;
score.bars.forEach(function (b) {
  b.notes.forEach(function (n) {
    if (!n.pitch) { prevNote = null; return; }
    var m = theory.midiOf(n.pitch);
    if (prevNote && prevNote.tie && theory.midiOf(prevNote.pitch) === m) { prevNote = n; return; }
    expectSeq.push(m);
    prevNote = n;
  });
});
check('音高序列与谱面一致', JSON.stringify(nn.on.map(function (e) { return e.note; })) === JSON.stringify(expectSeq),
  nn.on.map(function (e) { return e.note; }).join(',') + ' vs ' + expectSeq.join(','));

/* ==================== 4. MusicXML ==================== */

section('4. toMusicXML 校验');
var xml = exporter.toMusicXML(score);
check('返回字符串', typeof xml === 'string');
check('包含 <?xml 声明', xml.indexOf('<?xml version="1.0" encoding="UTF-8"?>') === 0);
check('包含 <score-partwise', xml.indexOf('<score-partwise') !== -1);
check('包含 <work-title>', xml.indexOf('<work-title>') !== -1);
check('包含 <software>读谱训练器</software>', xml.indexOf('<software>读谱训练器</software>') !== -1);
check('包含 <part-list>/<score-part id="P1">',
  xml.indexOf('<part-list>') !== -1 && xml.indexOf('<score-part id="P1">') !== -1);
check('包含 <divisions>480</divisions>', xml.indexOf('<divisions>480</divisions>') !== -1);
check('包含 <fifths>2</fifths>', xml.indexOf('<fifths>2</fifths>') !== -1);
check('包含 <time> / <beats>4</beats> / <beat-type>4</beat-type>',
  xml.indexOf('<time>') !== -1 && xml.indexOf('<beats>4</beats>') !== -1 &&
  xml.indexOf('<beat-type>4</beat-type>') !== -1);
check('包含 <clef> / <sign>G</sign> / <line>2</line>',
  xml.indexOf('<clef>') !== -1 && xml.indexOf('<sign>G</sign>') !== -1 &&
  xml.indexOf('<line>2</line>') !== -1);

var noteEls = xml.match(/<note>/g) || [];
check('<note> 数量 = ' + EXPECT_NOTES, noteEls.length === EXPECT_NOTES, noteEls.length);

var durations = (xml.match(/<duration>(\d+)<\/duration>/g) || []).map(function (s) {
  return parseInt(/<duration>(\d+)<\/duration>/.exec(s)[1], 10);
});
var durSum = durations.reduce(function (a, b) { return a + b; }, 0);
check('<duration> 总和 = ' + EXPECT_TOTAL + ' tick（= 4 小节 × 4 拍 × 480）',
  durSum === EXPECT_TOTAL, durSum + ' [ ' + durations.join(',') + ' ]');

var measures = xml.match(/<measure number="\d+">/g) || [];
check('<measure> 数量 = 4', measures.length === 4, measures.length);

check('延音线：含 <tie type="start"/>', xml.indexOf('<tie type="start"/>') !== -1);
check('延音线：含 <tie type="stop"/>', xml.indexOf('<tie type="stop"/>') !== -1);
check('延音线：含 <notations><tied .../></notations>',
  /<notations>\s*<tied type="start"\/>/.test(xml) && /<tied type="stop"\/>/.test(xml));
check('附点：含 <dot/>', xml.indexOf('<dot/>') !== -1);
check('休止符：含 <rest/> 两次', (xml.match(/<rest\/>/g) || []).length === 2,
  (xml.match(/<rest\/>/g) || []).length);
check('包含 <type>half</type>/<type>quarter</type>/<type>eighth</type>',
  xml.indexOf('<type>half</type>') !== -1 && xml.indexOf('<type>quarter</type>') !== -1 &&
  xml.indexOf('<type>eighth</type>') !== -1);

/* 附点四分 = 720 tick，半休止 = 960 tick */
check('附点四分 <duration>720</duration> 存在', xml.indexOf('<duration>720</duration>') !== -1);
check('半休止符 <duration>960</duration> 存在', xml.indexOf('<duration>960</duration>') !== -1);

/* 音高元素 */
check('包含 <pitch>/<step>/<octave>',
  xml.indexOf('<pitch>') !== -1 && xml.indexOf('<step>B</step>') !== -1 && xml.indexOf('<octave>3</octave>') !== -1);
check('升降号用 <alter> 表达（本谱面无变化音）', xml.indexOf('<alter>') === -1);

/* XML 转义与非法字符 */
check('标题中的 & < > 已转义', xml.indexOf('<work-title>导出自测 &amp; &lt;检查&gt;</work-title>') !== -1,
  (/<work-title>([^]*?)<\/work-title>/.exec(xml) || [])[0]);
check('输出中不存在裸 & （除实体）', !/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(xml));

var badXml = exporter.toMusicXML(Object.assign({}, score, { title: 'a\u0001b\u0007c' }));
check('非法控制字符被清除', badXml.indexOf('\u0001') === -1 && badXml.indexOf('\u0007') === -1);

/* ==================== 5. 无 DOM 环境下的安全失败 ==================== */

section('5. PNG 路径在 node（无 document）下必须安全失败');
check('global.window 已设置，但确实没有 document', typeof document === 'undefined');

var threw = null, ret = null;
try { ret = exporter.toPNG(null, 'x.png'); } catch (e) { threw = e; }
check('toPNG 不抛异常', threw === null, threw && threw.stack);
check('toPNG 返回 thenable（Promise）', !!(ret && typeof ret.then === 'function'));

var pngOutcome = null;
ret.then(function () { pngOutcome = 'resolved'; }, function (e) {
  pngOutcome = 'rejected';
  check('reject 的是 Error', e instanceof Error, String(e));
  check('reject 消息为中文', /[\u4e00-\u9fa5]/.test(String(e && e.message)), String(e && e.message));
  console.log('  message = ' + (e && e.message));
});

var threw2 = null, ret2 = null;
try { ret2 = exporter.toDataURL(null); } catch (e) { threw2 = e; }
check('toDataURL 不抛异常', threw2 === null, threw2 && threw2.stack);
check('toDataURL 返回 thenable', !!(ret2 && typeof ret2.then === 'function'));
ret2.then(function () { }, function () { });

var threw3 = null, panel = null;
try { panel = exporter.mountPanel(null, {}); } catch (e) { threw3 = e; }
check('mountPanel(null) 不抛异常', threw3 === null, threw3 && threw3.stack);
check('mountPanel(null) 返回 null', panel === null, String(panel));

var threw4 = null, cp = null;
try { cp = exporter.copyText('测试'); } catch (e) { threw4 = e; }
check('copyText 不抛异常', threw4 === null, threw4 && threw4.stack);
check('copyText 返回 Promise', !!(cp && typeof cp.then === 'function'));
if (cp) cp.then(function (v) { check('copyText 在 node 下 resolve 为 false（不崩）', v === false, String(v)); });

/* 空乐段也要能产出合法的 MIDI / XML，不抛异常 */
var emptyScore = { key: { tonic: 0, mode: 'major', fifths: 0 }, time: { num: 4, den: 4 }, tempo: 100, clef: 'treble', title: '', bars: [] };
var eErr = null, eBlob = null, eXml = null;
try { eBlob = exporter.toMIDI(null); eXml = exporter.toMusicXML(emptyScore); } catch (e) { eErr = e; }
check('toMIDI(null) / toMusicXML(空) 不抛异常', eErr === null, eErr && eErr.stack);
check('toMIDI(null) 仍产出非空字节', !!eBlob && eBlob.size > 0, eBlob && eBlob.size);
check('toMusicXML(空) 仍闭合 <score-partwise>', !!eXml && eXml.indexOf('</score-partwise>') !== -1);

/* ==================== 6. 与真实生成器的时值口径一致性 ==================== */

section('6. 与 APP.generator 的时值口径交叉校验');
var generator = require(path.join(__dirname, '..', 'src', 'core', 'generator.js'));
check('generator 与 util 的 beatsOf 口径一致',
  generator.beatsOf(1, false) === 1 && generator.beatsOf(4, false) === 4 &&
  generator.beatsOf(0.5, false) === 0.5 && generator.beatsOf(1, true) === 1.5,
  [generator.beatsOf(1, false), generator.beatsOf(4, false), generator.beatsOf(0.5, false), generator.beatsOf(1, true)].join(','));

var CASES = [
  { mode: 'melody', bars: 4, time: { num: 4, den: 4 }, tempo: 88, seed: 11, useDotted: true, useRests: true },
  { mode: 'melody', bars: 3, time: { num: 6, den: 8 }, tempo: 96, seed: 7, useDotted: true, useRests: true },
  { mode: 'rhythm', bars: 4, time: { num: 3, den: 4 }, tempo: 60, seed: 3, useDotted: false, useRests: true },
  { mode: 'melody', bars: 2, time: { num: 2, den: 2 }, tempo: 120, seed: 5, useDotted: true, useRests: true, clef: 'bass' }
];
CASES.forEach(function (cfg, ci) {
  var tag = '用例' + (ci + 1) + ' ' + cfg.time.num + '/' + cfg.time.den;
  var sc = generator.generateScore(cfg);
  var bad = [];
  sc.bars.forEach(function (b, bi) {
    var sum = b.notes.reduce(function (s, n) { return s + noteTicks(n.dur, n.dotted); }, 0);
    if (sum !== Math.round(b.beats * TICKS_PER_QUARTER)) bad.push('bar' + bi + ' 音符合计' + sum + '≠beats' + (b.beats * TICKS_PER_QUARTER));
  });
  check(tag + '：每小节音符 tick 合计 == bar.beats × 480', bad.length === 0, bad.join('; '));

  var x = exporter.toMusicXML(sc);
  var dsum = (x.match(/<duration>(\d+)<\/duration>/g) || []).reduce(function (a, s) {
    return a + parseInt(/<duration>(\d+)<\/duration>/.exec(s)[1], 10);
  }, 0);
  var expect = Math.round(sc.bars.reduce(function (a, b) { return a + b.beats; }, 0) * TICKS_PER_QUARTER);
  check(tag + '：MusicXML <duration> 总和 == 谱面总拍数 × 480', dsum === expect, dsum + ' vs ' + expect);
  check(tag + '：MusicXML 小节数正确',
    (x.match(/<measure number=/g) || []).length === sc.bars.length,
    (x.match(/<measure number=/g) || []).length);

  var m2 = parseMidi(new Uint8Array(exporter.midiBytes(sc)));
  var last = m2.tracks[1].events[m2.tracks[1].events.length - 1].tick;
  check(tag + '：MIDI 末事件 tick == 谱面总拍数 × 480', last === expect, last + ' vs ' + expect);
  check(tag + '：MIDI 全部 note on 都有配对的 note off',
    notesOf(m2.tracks[1]).on.length === notesOf(m2.tracks[1]).off.length,
    notesOf(m2.tracks[1]).on.length + '/' + notesOf(m2.tracks[1]).off.length);
  /* 每个音都必须落在合法音高范围内 */
  check(tag + '：所有音高在 0..127', m2.tracks[1].events.every(function (e) {
    return e.type !== 'on' || (e.note >= 0 && e.note <= 127);
  }));
});

/* ==================== 7. 面板 DOM 装配（极简 stub DOM） ==================== */

section('7. mountPanel 面板装配（stub DOM 冒烟）');

function FakeNode(tag) {
  this.tagName = String(tag).toUpperCase();
  this.nodeType = 1;
  this.className = '';
  this.textContent = '';
  this.value = '';
  this.children = [];
  this.childNodes = [];
  this.attributes = {};
  this.listeners = {};
  this.parentNode = null;
  this.style = { setProperty: function () { }, display: '' };
  this.classList = { add: function () { }, remove: function () { }, contains: function () { return false; } };
}
FakeNode.prototype.appendChild = function (c) { this.children.push(c); this.childNodes.push(c); c.parentNode = this; return c; };
FakeNode.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1);
  var j = this.childNodes.indexOf(c); if (j >= 0) this.childNodes.splice(j, 1);
  c.parentNode = null; return c;
};
FakeNode.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
FakeNode.prototype.getAttribute = function (k) { return this.attributes[k] === undefined ? null : this.attributes[k]; };
FakeNode.prototype.addEventListener = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
FakeNode.prototype.click = function () { (this.listeners.click || []).forEach(function (fn) { fn({}); }); };
FakeNode.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 0, height: 0 }; };
FakeNode.prototype.querySelector = function () { return null; };

global.document = {
  createElement: function (t) { return new FakeNode(t); },
  createTextNode: function (t) { var n = new FakeNode('#text'); n.nodeType = 3; n.nodeValue = String(t); return n; },
  querySelector: function () { return null; },
  body: new FakeNode('body'),
  readyState: 'complete'
};
if (!global.URL) global.URL = {};
if (typeof global.URL.createObjectURL !== 'function') global.URL.createObjectURL = function () { return 'blob:stub'; };
if (typeof global.URL.revokeObjectURL !== 'function') global.URL.revokeObjectURL = function () { };

var host = new FakeNode('div');
var mounted = null, mErr = null;
try { mounted = exporter.mountPanel(host, { getScore: function () { return score; }, getTitle: function () { return '自测标题'; } }); }
catch (e) { mErr = e; }
check('mountPanel 不抛异常', mErr === null, mErr && mErr.stack);
check('返回对象含 el / buttons / refresh', !!mounted && !!mounted.el && isArrayish(mounted.buttons) && typeof mounted.refresh === 'function');
check('面板已挂到容器', host.children.length === 1 && host.children[0] === mounted.el);

var panel = mounted.el;
var head = panel.children[0];
var row = panel.children[1];
check('面板结构 exp-panel > (exp-head + exp-row)', panel.className === 'exp-panel' && !!head && !!row, panel.className);
check('exp-head 同时含标题与副标题（createEl 多子节点）',
  head.children.length === 2 && head.children[0].className === 'exp-title' && head.children[1].className === 'exp-sub',
  head.children.map(function (c) { return c.className; }).join('|'));
check('按钮数量 = 5', row.children.length === 5, row.children.length);
var labels = row.children.map(function (b) { return b.textContent; });
check('按钮文案为中文且齐全',
  labels.join(',') === '导出谱面 PNG,导出简谱 PNG,导出 MIDI,导出 MusicXML,复制简谱文本', labels.join(','));
check('每个按钮都绑定了 click', row.children.every(function (b) { return (b.listeners.click || []).length === 1; }));
check('按钮带 data-act', row.children.every(function (b) { return !!b.attributes['data-act']; }),
  row.children.map(function (b) { return b.attributes['data-act']; }).join(','));

/* 点击所有按钮：都必须走 toast 而不是抛异常（PNG 仍会安全失败） */
var clickErr = null;
try { row.children.forEach(function (b) { b.click(); }); } catch (e) { clickErr = e; }
check('点击全部按钮不抛异常', clickErr === null, clickErr && clickErr.stack);
check('toast 已挂到 stub document.body', global.document.body.children.length > 0,
  global.document.body.children.length);

function isArrayish(v) { return !!v && typeof v.length === 'number'; }

/* ==================== 汇总 ==================== */

setTimeout(function () {
  console.log('\n== 结果 ==');
  check('toPNG 的 Promise 最终 reject（安全失败）', pngOutcome === 'rejected', String(pngOutcome));
  console.log(failed === 0 ? '\n全部通过 ✔' : ('\n失败 ' + failed + ' 项 ✘'));
  process.exit(failed === 0 ? 0 : 1);
}, 60);
