/* 临时自测脚本：验证 src/data/instruments.js（保留在 tools/）
 * 运行：node tools/_t_instruments.js
 * 说明：产品代码不含 module.exports，这里用 global.window = global 让 IIFE 正常挂载。
 */
global.window = global;
global.APP = {};

require('../src/core/theory.js');   // 挂到 window.APP.theory
require('../src/data/instruments.js');

const T = global.APP.theory;
const I = global.APP.instruments;

let fail = 0;
function ok(cond, msg, extra) {
  if (cond) console.log('  PASS  ' + msg);
  else { fail++; console.log('  FAIL  ' + msg + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

console.log('== list() ==');
const ls = I.list();
console.log(ls.map(x => `${x.id}(${x.kind})`).join(', '));
ok(ls.length >= 6, '乐器数量 >= 6', ls.length);
ok(new Set(ls.map(x => x.id)).size === ls.length, 'id 唯一');
ok(ls.every(x => x.id && x.name && x.kind && x.desc), 'list 字段齐全');
['guitar', 'ukulele', 'bass', 'harmonica', 'recorder', 'piano'].forEach(id =>
  ok(!!I.get(id), 'get("' + id + '") 存在'));

console.log('\n== 吉他音位（模块自己算出的 midi） ==');
const g = I.notesOf('guitar');
console.log('  音位总数 =', g.length, '(6 弦 × 0..15 品 = 96)');
ok(g.length === 6 * 16, '吉他音位总数 96', g.length);
const s6open = g.find(n => n.position.string === 6 && n.position.fret === 0);
const s1f12 = g.find(n => n.position.string === 1 && n.position.fret === 12);
ok(s6open && s6open.midi === 40, '6 弦空弦 midi = 40 (E2)', s6open && s6open.midi);
ok(s1f12 && s1f12.midi === 76, '1 弦 12 品 midi = 76 (E5)', s1f12 && s1f12.midi);
ok(s6open.name === 'E2', '6 弦空弦音名 E2', s6open.name);
ok(s1f12.name === 'E5', '1 弦 12 品音名 E5', s1f12.name);
const gD = I.notesOf('guitar', { key: 'D major' });
const d4 = gD.find(n => n.position.string === 3 && n.position.fret === 7); // G3+7 = D4
ok(d4 && d4.midi === 62 && d4.solfa === 'do' && d4.jianpu === '1', 'D 大调下 D4 = do/1', d4 && [d4.solfa, d4.jianpu]);

console.log('\n== 尤克里里 / 贝斯 ==');
const u = I.notesOf('ukulele');
const b = I.notesOf('bass');
ok(u.length === 4 * 13, '尤克里里 0..12 品共 52 个音位', u.length);
ok(b.length === 4 * 13, '贝斯 0..12 品共 52 个音位', b.length);
ok(u.find(n => n.position.string === 1 && n.position.fret === 0).midi === 69, '尤克里里 1 弦空弦 = 69 (A4)');
ok(b.find(n => n.position.string === 4 && n.position.fret === 0).midi === 28, '贝斯 4 弦空弦 = 28 (E1)');

console.log('\n== 口琴 ==');
const h = I.notesOf('harmonica');
const h1b = h.find(n => n.position.hole === 1 && n.position.blow && n.position.bend === '');
const h1d = h.find(n => n.position.hole === 1 && !n.position.blow && n.position.bend === '');
ok(h1b && h1b.midi === 60, '孔 1 吹 = C4 (60)', h1b && h1b.midi);
ok(h1d && h1d.midi === 62, '孔 1 吸 = D4 (62)', h1d && h1d.midi);
ok(h.filter(n => n.position.hole === 1 && n.position.type === 'drawBend').length === 1, '孔 1 吸有 1 个压音');
ok(h.filter(n => n.position.hole === 2 && n.position.type === 'drawBend').length === 2, '孔 2 吸有 2 个压音(F#4/F4)');
ok(h.filter(n => n.position.hole === 3 && n.position.type === 'drawBend').length === 3, '孔 3 吸有 3 个压音');
const h2 = h.filter(n => n.position.hole === 2 && n.position.type === 'drawBend').map(n => n.name);
ok(h2.join(',') === 'F#4,F4', '孔 2 吸压音到 F#4、F4', h2);
const h10d = h.find(n => n.position.hole === 10 && !n.position.blow && n.position.bend === '');
ok(h10d && h10d.midi === 93, '孔 10 吸 = A6 (93)', h10d && h10d.midi);
ok(h.filter(n => n.position.blow).length === 10 + 3, '吹音 10 个 + 吹压音 3 个');

console.log('\n== 竖笛（巴洛克指法） ==');
const r = I.notesOf('recorder');
console.log('  音域:', r[0].name, '..', r[r.length - 1].name, ' 共', r.length, '个音');
ok(r[0].midi === 72 && r[0].name === 'C5', '最低音 C5 (72)', r[0].name);
ok(r[r.length - 1].midi === 98 && r[r.length - 1].name === 'D7', '最高音 D7 (98)');
ok(r.length >= 24, '至少两个八度（>=24 个音高）', r.length);
ok(r.every(n => Array.isArray(n.position.holes) && n.position.holes.length === 8), 'position.holes 长度为 8');
const c5 = r.find(n => n.midi === 72);
ok(c5.position.holes.every(v => v === 1), 'C5 = 全按（8 孔全闭）', c5.position.holes);
const g5 = r.find(n => n.midi === 79);
ok(g5.position.holes.join('') === '11110000', 'G5 = 拇指+孔1..3 按住，孔4..7 放开', g5.position.holes);
ok(r.some(n => n.position.holes.indexOf(0.5) >= 0), '存在半孔指法');
ok(r.some(n => n.name === 'C6' && n.position.holes.join('') === '10100000'), 'C6 = 拇指 + 孔 2（叉指）');

console.log('\n== 钢琴 ==');
const p = I.notesOf('piano');
console.log('  键数 =', p.length, p[0].name, '..', p[p.length - 1].name);
ok(p.length === 88, '88 键', p.length);
ok(p[0].midi === 21 && p[0].name === 'A0', '起始 A0 (21)');
ok(p[p.length - 1].midi === 108 && p[p.length - 1].name === 'C8', '结束 C8 (108)');
ok(p.filter(n => n.position.black).length === 36, '黑键 36 个', p.filter(n => n.position.black).length);
ok(p.every(n => n.position.key === n.midi), 'position.key === midi');

console.log('\n== scaleOnInstrument ==');
const cMajor = T.scalePitches(T.parseKey('C major'), 4);
const onG = I.scaleOnInstrument(cMajor, 'guitar');
console.log('  C 大调 7 个音在吉他上的位置：');
onG.forEach((x, i) => console.log('   ', T.pitchName(cMajor[i]), '->', x ? `${x.name} ${x.position.string}弦${x.position.fret}品` : 'null'));
ok(onG.length === 7, '返回与输入等长');
ok(onG.filter(Boolean).length > 0, '吉他有映射的音位数量 > 0', onG.filter(Boolean).length);
ok(onG.every(x => x && x.position), 'C 大调 7 个音在吉他上全部找得到');
const lowHarp = I.scaleOnInstrument([T.pitchFromMidi(30)], 'harmonica'); // B1，远超口琴音域
ok(lowHarp[0] === null, '超出音域返回 null', lowHarp[0]);
const okR = I.scaleOnInstrument(T.scalePitches(T.parseKey('C major'), 5), 'recorder'); // 竖笛音域从 C5 起
ok(okR.filter(Boolean).length === 7, 'C 大调 7 个音在竖笛上全部找得到');
const okH = I.scaleOnInstrument(cMajor, 'harmonica');
ok(okH.filter(Boolean).length === 7, 'C 大调 7 个音在口琴上全部找得到');
const hC4 = I.scaleOnInstrument([60], 'harmonica')[0];
const hD4 = I.scaleOnInstrument([62], 'harmonica')[0];
const hG4 = I.scaleOnInstrument([67], 'harmonica')[0];
const hF4 = I.scaleOnInstrument([65], 'harmonica')[0]; // 口琴上只有压音能吹出 F4
ok(hC4.position.blow === true && hC4.position.bend === '', 'C4 优先取吹音孔 1');
ok(hD4.position.blow === false && hD4.position.bend === '', 'D4 优先取吸音孔 1');
ok(hG4.position.bend === '', 'G4 取不压音的位置');
ok(hF4 && hF4.position.bend === "''", 'F4 只能通过孔 2 吸压音两个半音得到', hF4 && hF4.position);

console.log('\n== renderChart（无 DOM，用最小 SVG stub 跑通绘制路径） ==');
ok(typeof I.renderChart === 'function', 'renderChart 存在');
ok(typeof I.scaleOnInstrument === 'function', 'scaleOnInstrument 存在');

/* 最小 DOM stub：只实现 renderChart 用到的接口，用来真实执行绘图代码 */
function StubEl(tag) { this.tagName = tag; this.attributes = {}; this.children = []; this.textContent = ''; }
StubEl.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
StubEl.prototype.appendChild = function (c) { this.children.push(c); return c; };
global.document = { createElementNS: (ns, tag) => new StubEl(tag) };

function serialize(node) {
  const a = Object.keys(node.attributes).map(k => ` ${k}="${String(node.attributes[k]).replace(/"/g, '&quot;')}"`).join('');
  if (!node.children.length) return `<${node.tagName}${a}>${node.textContent}</${node.tagName}>`;
  return `<${node.tagName}${a}>` + node.children.map(serialize).join('') + `</${node.tagName}>`;
}
const fs = require('fs');
const path = require('path');
const outDir = path.join(__dirname, '_out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const charts = [
  ['guitar', { key: 'D major' }],
  ['guitar', {}],
  ['ukulele', { key: 'C major' }],
  ['bass', { key: 'G major' }],
  ['harmonica', { key: 'C major' }],
  ['recorder', { key: 'D major' }],
  ['piano', { key: 'C major', lowMidi: 21, highMidi: 108 }],
  ['piano', { key: 'D major', lowMidi: 48, highMidi: 84 }]
];
charts.forEach(([id, o]) => {
  const svg = I.renderChart(null, id, o);
  const vb = svg.attributes.viewBox;
  const n = (serialize(svg).match(/<(circle|rect|path|line|text)\b/g) || []).length;
  ok(!!vb && n > 10, `renderChart(${id}, ${JSON.stringify(o)}) 生成 SVG`, { viewBox: vb, 元素数: n });
  const file = path.join(outDir, `inst-${id}${o.key ? '-' + o.key.split(' ')[0] : '-all'}.svg`);
  fs.writeFileSync(file, '<?xml version="1.0" encoding="UTF-8"?>\n' + serialize(svg), 'utf8');
  console.log('    -> ' + path.relative(path.join(__dirname, '..'), file) + '  viewBox=' + vb);
});
/* 容器为 null 时不得抛异常；未知 id 走降级分支 */
ok(!!I.renderChart(null, 'nope', {}), '未知 id 返回降级 SVG（不抛异常）');

console.log('\n结果：' + (fail === 0 ? '全部通过' : fail + ' 项失败'));
process.exit(fail === 0 ? 0 : 1);
