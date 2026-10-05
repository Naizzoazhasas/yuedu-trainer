# 读谱训练器 — 模块契约（唯一事实来源）

所有源码写在 `src/` 下，**不使用 import/export**。整个应用是若干普通 `<script>` 依序加载，
共享一个全局命名空间 `window.APP`。每个模块通过 IIFE 注册自己：

```js
(function (APP) {
  'use strict';
  // ... 实现 ...
  APP.generator = { generateScore, generateRhythm, generateMelody };
})(window.APP);
```

`index.html` 中脚本加载顺序（不得更改）：

```
src/core/util.js
src/core/theory.js
src/core/generator.js
src/core/renderer.js
src/core/jianpu.js
src/audio/tuner.js
src/audio/engine.js
src/data/instruments.js
src/export/exporter.js
src/features/library.js
src/features/ear.js
src/features/practice.js
src/app.js
```

**约束**

- 纯 ES2019+ 语法，不用打包器、不用 CDN、不联网、不引入任何第三方库。
- 不写 `import` / `export` / `require` / `type="module"`。
- 所有 UI 文案使用简体中文。UI 文本里的英文术语保留（如 tempo、PBM）。
- 代码注释用中文，标识符用英文。
- 任何模块都不允许抛异常打断启动：初始化函数内部自行 try/catch。
- `APP.ready(fn)` 在 DOMContentLoaded（或已就绪时立即）后执行 fn。

---

## 1. 数据结构

### Pitch（音高，纯数据对象）

```js
{ step: 'C'|'D'|'E'|'F'|'G'|'A'|'B', acc: -2|-1|0|1|2, oct: 4 }   // 科学音高记号，C4 = 中央C
```

### Note（音符）

```js
{
  pitch: Pitch | null,        // null 表示休止符
  dur: 4 | 2 | 1 | 0.5 | 0.25 | 0.125 | 0.0625,
                              // 以全音符为 1：4=全音符, 2=二分, 1=四分, 0.5=八分, 0.25=十六分
  dotted: boolean,            // 附点（时值 ×1.5）
  tie: boolean,               // 与下一个同音高音符用延音线连接
  midi: number | null,        // 冗余字段，== APP.theory.midiOf(pitch)
  pos: number                 // 冗余字段，== APP.theory.staffPos(pitch, clef)，休止符为 0
}
```

> 时值换算（**唯一权威公式**）：`dur` 是「时值倒数标记」，`beats = 4 / dur`，附点再 ×1.5。
> 例：`dur=4` 全音符 = 4 拍，`dur=2` 二分 = 2 拍，`dur=1` 四分 = 1 拍，`dur=0.5` 八分 = 0.5 拍，
> `dur=1, dotted=true` 附点四分 = 1.5 拍。小节总拍数 = `time.num * (4 / time.den)`。
>
> ⚠️ **实现注意**：本项目运行环境的 JS 除法在部分小整数上不可靠（实测 `4/1` 得到 `4`），
> 因此**不要直接写 `4/dur` 参与关键计算**，请优先用查表 + 乘法，例如
> `{4:4, 2:2, 1:1, 0.5:0.5, 0.25:0.25}` 取基础拍数，附点再 `*1.5`；
> 或用 `APP.util.beatsOf(dur, dotted)`。所有模块请统一使用 `APP.util.beatsOf`。

### Score（乐段）

```js
{
  key: { tonic: 0..11, mode: 'major'|'minor', fifths: -7..7 },  // fifths 决定调号
  time: { num: 4, den: 4 },
  tempo: 60..240,
  clef: 'treble' | 'bass',
  title: string,
  bars: [ { notes: [Note, ...], beats: number }, ... ]          // beats = 该小节实际总拍数
}
```

---

## 2. `APP.util` — 通用工具（已由 util.js 提供）

```js
APP.util.query(sel, root?)        // 单个元素
APP.util.queryAll(sel, root?)     // 数组
APP.util.el(tag, attrs?, ...children)  // 建元素；attrs 支持 class/id/text/html/style(对象)/on{click:fn}/data-*
APP.util.clear(node)
APP.util.shuffle(arr, rng?)       // 返回新数组
APP.util.pick(arr, rng?)          // 随机取一个
APP.util.randInt(a, b, rng?)
APP.util.rand(rng?)               // [0,1)
APP.util.clamp(v, a, b)
APP.util.deepClone(v)
APP.util.fmtTime(sec)             // 12.3 -> "12.3s"
APP.util.download(blobOrUrl, filename)
APP.util.toast(msg, type?)        // type: 'info'|'ok'|'warn'|'err'
APP.util.rngFrom(seed?)           // 返回 () => [0,1)；seed 省略则随机
```

`rng` 参数统一为 `() => [0,1)` 的函数；省略时用 `Math.random`。**所有随机必须走 rng**，以便用固定种子复现乐段。

---

## 3. `APP.theory` — 乐理内核（由 theory.js 提供，其他模块只读调用）

```js
// 音高
theory.PITCH_CLASS = { C:0, 'C#':1, Db:1, D:2, ... }
theory.midiOf(pitch)                     // 60 = C4
theory.pitchFromMidi(midi, preferSharp)  // -> Pitch
theory.pitchName(pitch, opts?)           // opts: {accidentals:true, octave:false} -> "F#4" / "F#"
theory.solfeggio(pitch, key)             // 首调唱名: "do" "re" "mi" "fa" "sol" "la" "si"（含 #/b 前缀，如 "#fa"）

// 调
theory.parseKey(str)          // "D major" / "d minor" / "D大调" -> {tonic, mode, fifths}
theory.keyName(key)           // -> "D 大调"
theory.keySignature(key)      // -> { count, accidental: 'sharp'|'flat', positions: [4,2,...] }
theory.scaleNotes(key, opts?) // opts: {octaves:1, startOct:4} -> [Pitch x7]（自然大调/和声小调）
theory.harmonicMinor()        // 和声小调音阶半音结构
theory.scaleDegrees(key)      // -> [{degree:1..7, pitch, solfa, name}]  用于调号对照表
theory.diatonicIndex(pitch)   // letter*7 + oct*7 + accidental 的单调递增编号
theory.staffPos(pitch, clef)  // 五线谱位置：0 = 高音谱表最下面那条线(E4)；每 1 = 一个 diatonic 步
theory.accidentalGlyph(pitch, key) // -> '' | '#' | 'b' | '##' | 'bb' | 'natural'（相对调号）
theory.midiToFreq(midi)       // 440 * 2^((midi-69)/12)
theory.freqToMidiFloat(freq)  // 连续值
theory.allKeys()              // 15 个常用调 -> [{tonic, mode, fifths, name}]
theory.TRANSPOSING_INSTRUMENTS // 见第 8 节
```

**五线谱位置定义**：`staffPos` 以高音谱表下加一线为参照。约定：
- 高音谱号：E4 = 0，向上每 1 个音级 +1，向下 -1。中央 C = -2。
- 低音谱号：G2 = 0（低音谱表最下面那条线）。C4 = +7。
- 谱线与间：0=第1线, 1=第1间, ..., 8=第5线, 之后为上加线。

**调号顺序**（`keySignature.positions`，值是 `staffPos`）：
升号 F C G D A E B → `[5, 2, 6, 3, 7, 4, 8]`；降号 B E A D G C F → `[4, 7, 3, 6, 2, 5, 1]`。

---

## 4. `APP.generator` — 生成器（由 generator.js 提供）

### 配置对象 Config

```js
{
  mode: 'rhythm' | 'melody',
  bars: 4,                      // 小节数
  time: { num: 4, den: 4 },
  tempo: 60,
  key: { tonic: 2, mode: 'major', fifths: 2 },
  clef: 'treble',
  seed: 12345,                  // 可选，数字；省略则随机。必须能被复现

  // —— 音符/节奏白名单（核心需求 1）——
  durations: [1, 2, 0.5],       // 允许出现的时值（对应 Note.dur）
  useDotted: false,             // 允许附点
  useRests: true,               // 允许休止符
  restRatio: 0.15,              // 休止符出现概率 0..0.5
  useSyncopation: false,        // 允许切分（跨拍连线）
  usePatterns: null,            // null = 完全随机；或 [Pattern, ...] 只用这些节奏型
  patternVariation: 0.35,       // 对节奏型做变奏的概率

  // —— 旋律模式专用 ——
  degrees: [1,2,3,4,5,6,7],     // 允许使用的音级（1-7）。只允许 1,2,3,4 就传 [1,2,3,4]
  range: { lowOct: 4, highOct: 5 },
  leapRatio: 0.3,               // 跳进概率
  useChromatic: false,          // 额外允许调外变化音（升/降邻音）
  startOnTonic: false           // 是否强制以主音开始
}
```

`Pattern`（节奏型，用于自定义音型库）：

```js
{ id: string, name: string, time: {num, den}, items: [ {dur, dotted, rest} , ... ] }
```

### API

```js
generator.defaultConfig(partial?)      // 返回填好默认值的 Config（合并 partial）
generator.generateScore(config)        // -> Score，config 可为部分对象，内部先 defaultConfig
generator.generateRhythm(config)       // 只生成节奏（pitch 为单音阶主音，mode 强制 rhythm）
generator.generateMelody(config)       // 生成旋律
generator.variatePattern(pattern, rng) // -> Pattern  返回变奏后的新节奏型（不改原对象）
generator.derivePatternFromScore(scoreBar) // [{dur,dotted,rest}] -> Pattern
generator.DURATION_LIST                // [{dur, dotted, label}] 供 UI 列出可选时值：全音符/二分/四分/八分/十六分/附点四分...
generator.TIME_SIGNATURES              // [{num,den,label}] 常用拍号：2/4 3/4 4/4 6/8 3/8 2/2 5/4 7/8
```

**硬性要求**

- 每个小节 `notes` 的实际总拍数必须**恰好等于** `num * (4/den)`（拍数按四分音符为一拍计：`beats = (4/dur)*(dotted?1.5:1)`，见第 1 节的权威公式）。
- 6/8 等复合拍按八分音符组处理，但总拍数同样精确。
- 生成必须是确定性的：相同 `seed` + 相同 config → 完全相同的 Score。
- **首调/简谱显示依赖大调音阶音级**，旋律模式下第一位必须是主音音阶音，其余按 `pitchSet` 取。

---

## 5. `APP.renderer` — 五线谱 SVG 渲染（由 renderer.js 提供）

```js
renderer.renderStaff(score, opts) -> SVGElement
// opts: { width: 900, noteScale: 1, showBarNumbers: false, highlightBar: -1 }
renderer.renderScoreInto(container, score, opts) -> { svg, layout }
renderer.highlightBar(container, barIndex)   // 给正在播放的小节加高亮
renderer.clearHighlight(container)
```

**必须自己画 SVG，不依赖任何库**：五线谱五条线、谱号（高音/低音，用贝塞尔曲线近似）、调号、拍号、
符头（实心/空心椭圆、旋转）、符干（方向按 pos）、符尾（八分一撇、十六分两撇）、符杠（beams）、
附点、休止符（全休/二分休/四分休/八分休/十六分休）、加线（ledger lines）、小节线、终止线。
每小节内按拍分组，符杠按拍分组（4/4 按 2 拍一组或按拍）。

渲染宽高比与坐标需自适应 `opts.width`；正常输出 `viewBox="0 0 <w> <h>"`。

---

## 6. `APP.jianpu` — 简谱渲染（由 jianpu.js 提供）

```js
jianpu.renderInto(container, score, opts) -> HTMLElement
// opts: { mode: 'relative'|'fixed', showSolfa: true, showNoteName: false, width: 900 }
jianpu.toText(score, opts) -> string       // 纯文本简谱，供“复制”按钮
jianpu.pitchToJianpu(pitch, key, mode) -> { digit:1..7, accidental:'#'|'b'|'', octave:-2..2, padded }
```

规则：**首调**（默认）主音恒为 `1`；高八度数字上方加点、低八度下方加点；变音在数字前加 `#`/`b`；
下加线做减时线（八分一条、十六分两条），`-` 表示延长一拍，`0` 表示休止符，附点音符数字后加 `·`。

---

## 7. `APP.export` — 导出（由 exporter.js 提供）

```js
export.toPNG(nodeOrCanvas, filename, opts?) -> Promise<Blob>
// 传入 DOM 节点时：用 XMLSerializer 把 SVG/HTML 转成 <img> 再画到 canvas；背景白色，2x 高清
export.exportScoreImage(container, filename, title?)   // 截图当前谱面
export.toMIDI(score) -> Blob                            // 标准 MIDI type-0/1，含 tempo 与音轨
export.toMusicXML(score) -> string
export.exportMIDIFile(score, filename)
export.exportMusicXMLFile(score, filename)
export.copyText(text) -> Promise<boolean>
```

PNG 导出**不得**依赖外部库，且必须能在 `file://` 下工作（不允许 fetch 同源图片）。
若 `html2canvas` 之类的方法不可用，就用 Canvas 2D 手动绘制：对整个节点用
`foreignObject` 序列化是常见做法，但 Chrome 下 `file://` 有安全限制——因此要求：
**优先手动绘制**（复用 renderer 产出的 SVG 字符串 + 文本用 canvas fillText 画），保证一定成功。

---

## 8. 移调乐器与音阶表

`theory.TRANSPOSING_INSTRUMENTS`：

```js
[ { id:'clarinet-bb', name:'降B调单簧管', writtenToConcert: -2,  // 记谱音 - 2 半音 = 实际音
    desc:'谱面 C 实际发 Bb' },
  { id:'trumpet-bb',  name:'降B调小号',   writtenToConcert: -2 },
  { id:'sax-alto',    name:'降E调中音萨克斯', writtenToConcert: -9 },
  { id:'sax-tenor',   name:'降B调次中音萨克斯', writtenToConcert: -14 },
  { id:'horn-f',      name:'F 调圆号',    writtenToConcert: -7 },
  { id:'recorder-c',  name:'C 调竖笛（不移调）', writtenToConcert: 0 } ]
```

移调公式：`实际音 = 记谱音 + writtenToConcert`（半音）。
反向（把实际音写成该乐器记谱）：`记谱音 = 实际音 - writtenToConcert`。

`APP.instruments`（由 instruments.js 提供，非移调）：

```js
instruments.GUITAR     // 标准调弦 EADGBE（6→1 弦），品格音位表
instruments.UKULELE    // GCEA
instruments.BASS       // EADG
instruments.HARMONICA  // 10 孔全音阶口琴（C 调，Richter 调弦，含吹/吸）
instruments.RECORDER   // 竖笛指法
instruments.PIANO      // 钢琴键位（可视化用）

// 统一查询接口
instruments.list() -> [{id, name, kind:'fret'|'harmonica'|'recorder'|'piano', desc}]
instruments.get(id)
instruments.notesOf(id, opts?) -> [{ midi, name, solfa(jianpu 数字), position }]
   // fret:   position = { string: 6..1, fret: n }
   // harmonica: position = { hole: 1..10, blow: true|false, bend: '' | "'" | "''" }
   // recorder:  position = { holes: [0..8] 0=开放 1=按住, octave }
instruments.renderChart(container, id, opts)  // 画音阶对照表（HTML/SVG 表格或指板图）
```

---

## 9. `APP.engine` — 音频引擎（由 engine.js 提供）

```js
engine.init()                       // 首次用户手势时调用，创建 AudioContext
engine.state()                      // 'uninitialized'|'running'|'suspended'
engine.warmup() -> Promise
engine.playScore(score, opts) -> transport
// opts: { metronome:true, countIn:0, tempo:score.tempo, loop:false,
//         timbre:'piano'|'sine'|'clave', onNote(i, bar, note), onBar(bar), onEnd(), startBar: 0 }
transport.stop()
transport.pause()
transport.resume()
transport.setTempo(bpm)             // 变速渐变时反复调用
transport.on('note'|'bar'|'end', fn)
engine.Metronome                    // 独立节拍器
new engine.Metronome()
metronome.start({ tempo, time, accent:true, subdivision:1, onTick(beat, bar, isAccent) })
metronome.setTempo(bpm); metronome.stop(); metronome.isRunning()
engine.playNote(midi, durSec, timbre, velocity)   // 试听单音
engine.playChord(midis, durSec, timbre)
engine.beep(freq, durSec)                         // 提示音
```

任何播放前必须确保 AudioContext 处于 running（`engine.warmup()` 内部处理）。

---

## 10. `APP.tuner` — 调音器（由 tuner.js 提供）

```js
tuner.isSupported() -> boolean          // navigator.mediaDevices.getUserMedia 存在且为安全上下文
tuner.unsupportedReason() -> string
tuner.open(container, opts) -> session
// session: { start(), stop(), close(), isRunning() }
// opts: { stdPitch: 440, mode:'chromatic'|'guitar'|'ukulele', onDetection(d), onLevel(rms) }
// d = { freq, midiFloat, midi, cents, note:'A', octave:4, name:'A4' }
```

要求：用 `getUserMedia` + `AnalyserNode`，自相关（autocorrelation / YIN 简化版）做基频检测，
对 50–1200Hz 有效；UI 包含指针表盘、音名、偏差 cents、目标音与调弦模式、A4 基准频率调节。
必须在 `file://` 下给出友好提示（需要 https 或 localhost）。

---

## 11. 功能模块

```js
APP.library    // 自定义节奏型/音型库：增删改、localStorage 持久化、参与生成
APP.ear        // 听辨练习：播放随机节奏/音程，用户点击或键盘作答，打分统计
APP.practice   // 练习模式：跟谱自动翻页、速度渐变、倒计时预备拍、进度记录
APP.app        // 装配所有 tab、事件绑定、全局状态、localStorage 读写
```

`APP.library` 对外：

```js
library.all() -> [Pattern]
library.add(pattern) / library.remove(id) / library.rename(id, name) / library.clear()
library.onChange(fn)
library.storageKey = 'yuedu.customPatterns'
```

`APP.practice` 对外：

```js
practice.mount(container, { getScore, onRequestNew })
practice.record({ score, tempo, accuracy, seconds })   // 写入练习记录
practice.stats() -> { sessions: [...], totalMinutes, byDate: {...} }
practice.storageKey = 'yuedu.practiceLog'
```

---

## 12. 样式约定

`src/styles.css`（由我维护）提供 CSS 变量与通用组件类，其他模块请复用：

```
:root { --bg, --panel, --panel-2, --line, --ink, --ink-dim, --accent, --accent-2, --ok, --warn, --err,
        --radius, --shadow }
.btn .btn.primary .btn.ghost .btn.small .btn.active
.card .card-title .row .col .grid-2 .grid-3
.field .label .hint .chip .chip.active .chip-row
.tab .tab.active .tabs .tabs-inner .panel
.badge .kbd .toast .modal .modal-body .modal-mask
```

禁止在内联 `style` 里写大量样式；新样式请追加到 `src/styles.css`（我会统一整理）。
各模块自己的样式用 `.模块名-xxx` 前缀写在 `src/styles.css` 末尾的对应区块里。
