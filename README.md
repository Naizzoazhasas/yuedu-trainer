# 读谱训练器（yuedu-trainer）

一个**零依赖、纯前端、可离线**的读谱（视奏）训练工具：随机生成五线谱 / 简谱练习，
支持音符与节奏型白名单、节拍器、调音器、调号音阶对照、乐器音阶表、移调、
导出 PNG / MIDI / MusicXML、练习模式、听辨训练与自定义音型库。

## 🌐 在线使用

**<https://naizzoazhasas.github.io/yuedu-trainer/>**

用浏览器直接打开即可，无需安装。在线版是 `https`，所以**调音器可以正常使用麦克风**，
也可以「添加到主屏幕 / 安装为应用」后离线使用（内置 Service Worker）。

- 不联网、不上传任何数据，全部计算在浏览器本地完成；
- 无需 `npm install`：没有打包器、没有 CDN，源码就是一堆普通 `<script>`；
  五线谱排版用的 [VexFlow](https://github.com/vexflow/vexflow) 已作为普通文件内置于 `vendor/`；
- 练习记录与自定义音型只保存在你自己的浏览器 `localStorage` 里。

---

## 一、四种打开方式

### 0. 桌面应用（Windows，双击即用，推荐）

双击项目根目录的 **`读谱训练器.cmd`**，或桌面上的快捷方式 **「读谱训练器（桌面应用）」**。

它会：

1. 用系统自带的 .NET 在 `http://127.0.0.1:<随机端口>` 上把单文件版提供出来
   —— 于是**是安全上下文，调音器可以正常用麦克风**（这正是不直接双击 HTML 的原因）；
2. 用 Edge / Chrome 的**应用模式**（`--app`）打开：**没有地址栏、没有标签页**，
   任务栏是独立图标（用的是 `icons/yuedu.ico`），看起来和用起来都跟原生应用一样；
3. 关掉窗口后本地服务自动结束，不留后台进程。

> 它不依赖 Node.js，也不需要那个 `_tools` 目录；只需要一个装了 Edge（Win10/11 自带）或 Chrome 的 Windows。
> 想发给别人：把 `dist/yuedu-trainer.html`、`tools/desktop-app.ps1`、`icons/yuedu.ico`
> 和 `读谱训练器.cmd` 这 4 个文件按原目录结构放一起即可。

### 1. 在线版（最省事）

直接打开 **<https://naizzoazhasas.github.io/yuedu-trainer/>**。
想装成应用：Chrome / Edge 地址栏右侧点「安装」，或在手机浏览器里「添加到主屏幕」，
之后就能像普通 app 一样从桌面图标启动，断网也能用。

### 2. 离线单文件（双击即用，但调音器不可用）

直接双击构建产物：

```
dist/yuedu-trainer.html
```

CSS 与全部 JS 都已经内联进这一个文件，`file://` 下也能正常用（生成、渲染、播放、导出、练习都行）。

> ⚠️ 唯一限制：**调音器不能用**。浏览器规定麦克风只在「安全上下文」可用，而 `file://` 不算。
> 需要调音器请用方式 0 或 3。

### 3. 自己起服务 / 部署到 GitHub Pages

```powershell
node tools/serve.js            # 然后访问 http://127.0.0.1:8099/
```

`http://127.0.0.1` 与 `http://localhost` 被浏览器视为安全上下文，**调音器可以正常调用麦克风**。

本仓库已经通过 **Settings → Pages → Source: Deploy from a branch → main / (root)** 上线，
因为根目录的 `index.html` 用的都是相对路径，不需要任何构建产物就能直接跑。

如果想放到自己的仓库：

1. 把本项目推到你的 GitHub 仓库
2. Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`
3. 等 1–2 分钟即可

也可以改用仓库里自带的 Actions 工作流（`.github/workflows/deploy.yml`），
它会在每次推送时自动跑测试、构建，再发布 `dist/site/`：

- Settings → Actions → General → Workflow permissions 选 **Read and write permissions**
- Settings → Pages → Source 选 **GitHub Actions**

| 方式 | 优点 | 注意 |
|---|---|---|
| 桌面应用（方式 0） | 独立窗口、有图标、调音器可用、不用 Node | 需要 Edge/Chrome |
| 分支发布（当前使用） | 零配置、立刻可用 | 发布的是源码目录 |
| Actions 工作流 | 自动构建、跑测试 | 需要开启 workflow 写权限 |

---

## 二、功能怎么用

界面顶部有 7 个标签页：**生成 / 练习**、**节拍器**、**调音器**、**调号与音阶**、
**乐器音阶表**、**听辨练习**、**音型库 / 导出**。

| 功能 | 说明 |
| --- | --- |
| **五线谱 / 简谱切换** | 同一段乐谱可随时切换五线谱与简谱。五线谱默认用 **VexFlow** 专业排版引擎（谱号、调号、拍号、符干方向、符杠、附点、加线、跨小节延音线全部按 engraving 规范绘制），也可在「五线谱渲染引擎」里切回**内置自绘**（零依赖、体积小）。简谱用 **SVG 排版**：所有数字严格同一基线、按小节画小节线与终止线、小节号、高低八度点、减时线（八分一条/十六分两条）、延长线，首调与固定调可切。两种渲染器都有失败自动降级，不会出现空白谱面。 |
| **音阶查找对照** | 简洁视图：大号调名 + 音名/升降/调式三个下拉 + 一排音阶音芯片 + 一台点亮的钢琴键盘。点音阶音或「播放音阶」可听；点「乐器」可看该调在吉他/口琴/竖笛等乐器上的位置；详细数据（调号位置、首调与固定调简谱、频率、五度圈）在折叠区。 |
| **只选某些音符与节奏型** | 在「时值」里勾选允许出现全音符 / 二分 / 四分 / 八分 / 十六分、是否允许附点、是否允许休止；在「旋律」里勾选允许使用的音级（1–7），只留 1 2 3 4 就是「四音练习」。也可以指定只用音型库里收藏的节奏型。 |
| **速度 PBM** | 滑块与**数字框**任选：可以直接键入精确值（如 63、117），支持上下方向键微调与 40/60/72/88/100/120/144/180 一键预设，并显示术语（Adagio / Andante / Allegro …）。手机上是数字键盘。 |
| **节拍器** | 独立节拍器，可选拍号、速度、重音、细分；跟谱播放时可叠加节拍器与预备拍（count-in）。速度同样支持直接输入，另有「敲拍测速」。 |
| **调音器** | 用麦克风实时检测音高，指针表盘显示偏差 cents、音名、目标音；支持半音阶 / 吉他 / 尤克里里调弦模式与 A4 基准频率调整。**需要 https 或 localhost**（手机 App 已内置本地服务器自动满足）。 |
| **乐器音阶表** | 吉他 / 尤克里里 / 贝斯指板音位、10 孔口琴吹吸音位、竖笛指法、钢琴键位可视化。 |
| **移调** | 降 B 调单簧管 / 小号、降 E 调中音萨克斯、降 B 调次中音萨克斯、F 调圆号等移调乐器，一键把谱面记谱音换算成实际音或反向换算。 |
| **导出 PNG / MIDI / MusicXML** | PNG 走 Canvas 手绘（`file://` 下也能导出），MIDI 为标准文件（含 tempo），MusicXML 可直接导入 MuseScore 等打谱软件。 |
| **练习模式** | 跟谱练习：预备拍倒计时、速度渐变（慢练→原速）、进度记录与统计。 |
| **听辨训练** | 播放随机节奏 / 音程 / 和弦，你用鼠标、键盘或敲拍作答；**作答后立即公布正确答案的谱面**（可对照「听到的」与「看到的」），并标注对错、可「再听一遍」。 |
| **音型库** | 把喜欢的节奏型收藏起来（可改名、删除），生成时直接指定只用这些音型；数据存在本机 `localStorage`。 |

**快捷键**：`空格` = 播放 / 停止，`N` = 重新生成一段，`1`–`7` = 切换到对应标签页。

---

## 三、调音器为什么必须走 https 或 localhost

浏览器的安全策略规定：`getUserMedia`（麦克风、摄像头）只在**安全上下文（Secure Context）**中可用。
被认定为安全上下文的情况有：

- `https://…`（任意域名）；
- `http://127.0.0.1`、`http://localhost`、`http://[::1]` —— 本机回环地址被特殊豁免；
- `file://` —— **不算**安全上下文，因此双击打开的单文件版**无法使用麦克风**。

所以：

- 想用调音器 → 用 `node tools/serve.js` 起服务后访问 <http://127.0.0.1:8099/>，或部署到 https 站点；
- 只是打谱、生成、播放、导出 → 双击 `dist/yuedu-trainer.html` 就够了。

---

## 四、目录结构

```
yuedu-trainer/
├── index.html                # 入口（按固定顺序加载各模块）
├── manifest.webmanifest      # PWA 清单
├── sw.js                     # Service Worker（预缓存 + 缓存优先/网络更新）
├── icons/                    # 图标（icon-192/512.png 程序化生成，yuedu.ico 给桌面快捷方式）
├── 读谱训练器.cmd             # 桌面应用入口（双击即用，见第一节方式 0）
├── vendor/
│   └── vexflow.js            # VexFlow 4.2.3（本地内置，MIT，五线谱专业排版引擎）
├── src/
│   ├── styles.css            # 全部样式（CSS 变量 + 通用组件类）
│   ├── core/                 # util 理论 生成器 五线谱渲染 VexFlow后端 简谱渲染
│   ├── audio/                # 调音器 音频引擎
│   ├── data/                 # 钢琴键盘 / 乐器音位数据
│   ├── export/               # PNG / MIDI / MusicXML 导出
│   ├── features/             # 音型库 / 听辨 / 练习模式
│   └── app.js                # 装配界面与事件
├── android/                  # Android 壳（WebView + 本地服务器 + 保存桥接），见第十节
├── docs/
│   └── CONTRACTS.md          # 模块契约（唯一事实来源）
├── tools/
│   ├── build.js              # 构建：单文件版 + 多文件站点版
│   ├── serve.js              # 本地开发服务器
│   ├── desktop-app.ps1       # 桌面应用：本地服务 + Edge/Chrome 应用窗口
│   ├── selfcheck.js          # 一键自检（跑所有测试脚本）
│   ├── gen-icons.js          # 程序化生成 PNG 图标（手写 PNG 字节）
│   ├── gen-ico.js            # 生成 Windows .ico（手写 PNG 编解码 + 缩放）
│   ├── prepare.js            # 一键准备：桌面快捷方式 + 上传包 + 使用说明
│   ├── build-apk.js          # 手工打包 Android APK（不用 Gradle）
│   ├── verify-apk.js         # 校验 APK（包名/版本/权限/签名/内容/体积）
│   ├── publish-apk.js        # 把 APK 发布到 GitHub Release
│   ├── browser-probe.js      # 用 CDP 连真实浏览器跑界面探针
│   ├── verify-build.js       # 构建产物校验（单文件版/站点版自包含性）
│   ├── verify-single.js      # 用无头浏览器验证单文件离线版
│   ├── verify-vexflow.js     # 用无头浏览器验证 VexFlow 后端 48 个用例
│   ├── zipwriter.js          # 纯 node 的 UTF-8 ZIP 打包器
│   ├── zipreader.js          # 纯 node 的 ZIP 读取器（读 APK 中央目录）
│   ├── test-*.js             # 单元测试
│   └── _t_*.js               # 专项/集成测试
└── dist/                     # 构建产物（已被 .gitignore 忽略）
    ├── yuedu-trainer.html    # 单文件离线版（约 1.4 MB，含 VexFlow）
    ├── site/                 # 多文件站点版（可直接部署）
    └── android/              # yuedu-trainer.apk
```

模块划分、数据结构与各模块 API 请见 [`docs/CONTRACTS.md`](docs/CONTRACTS.md)。

---

## 五、自己构建

```powershell
node tools/build.js                 # 输出到 dist/
node tools/build.js --out dist      # 显式指定输出根目录
node tools/build.js --root <目录>   # 指定项目根（一般不用）
```

构建做了什么：

1. 读 `index.html`，把 `<link rel="stylesheet" href="src/styles.css">` 换成 `<style>…</style>`，
   把每个 `<script src="…">` 换成 `<script>…</script>`，**顺序保持不变**；
2. 写出单文件版 `dist/yuedu-trainer.html`（可 `file://` 直开）；
3. 复制一份常规多文件版到 `dist/site/`（含 `index.html`、`src/`、`icons/`、
   `manifest.webmanifest`、`sw.js`），供 GitHub Pages 之类托管使用；
4. 生成 `dist/site/version.json`：`{ name, version, builtAt, files: [{ path, bytes, sha1 }] }`；
5. 自校验：读回产物，断言其中不再出现 `src="src/…"` 与 `href="src/styles.css"`，
   并检查内联 JS 中不含行首 `import` / `export` 语句。

脚本会打印每个被内联文件的大小、内联总量与最终产物大小；
若某个源文件还不存在，会打印醒目的 `[缺失]` 提示并继续（产物里用注释占位），不会崩溃。

重新生成图标（可选）：

```powershell
node tools/gen-icons.js
```

---

## 六、跑自检

```powershell
node tools/selfcheck.js
```

它会依次运行 `tools/test-theory.js`、`tools/test-generator.js`、`tools/test-render.js`
以及所有 `tools/_t_*.js`，打印每个脚本的耗时、总表和结论；
全部通过退出码为 `0`，有失败为 `1`。不存在的测试文件会打印 `[缺失]` 并跳过。
子进程输出直接透传到当前终端（避免本机 `child_process` 捕获输出时的 `EPERM` 限制）。

---

## 七、技术说明

- **自带依赖，但不装依赖**：项目源码不使用任何 npm 包、打包器或 CDN；
  `tools/` 下的脚本只用 node 内置模块（`fs` / `path` / `http` / `zlib` / `crypto` / `child_process`）。
  唯一的第三方库 **VexFlow 4.2.3**（MIT）已作为普通文件内置于 [`vendor/vexflow.js`](vendor/vexflow.js)，
  用 `<script>` 直接加载，不经过 npm、不联网、可离线。
- **五线谱双渲染后端**：默认 VexFlow（专业 engraving，符干/符杠/加线/延音线按规范绘制），
  内置自绘渲染器作为零依赖后备。可用 `#gen-renderer` 切换；VexFlow 加载失败时自动降级，
  不会出现空白谱面（`APP.vexrender.isAvailable()` + `renderScoreInto` 的错误回退）。
- **渲染后端选择逻辑**（`src/app.js` 的 `resolveRenderer()`）：
  `auto`（有 VexFlow 就用）→ `vexflow`（强制，失败回退）→ `builtin`（强制自绘）。
- **离线可用**：`sw.js` 预缓存整个应用外壳（含 `vendor/vexflow.js`），断网也能打开；
  导航请求走「网络优先、失败回退缓存」，静态资源走「缓存优先、网络更新」。
  缓存名带版本号，升级时自动清理旧缓存。
- **数据只存本地**：练习记录、自定义音型等全部写在浏览器 `localStorage`，不上传、不联网、
  没有账号与埋点。清除浏览器数据即可重置。
- **模块约定**：所有源码通过 IIFE 注册到全局 `window.APP`，不使用 `import` / `export` / `require`，
  因此可以按固定顺序用普通 `<script>` 加载，也可以被无损内联成单个 HTML 文件。
- **已知环境注意**：本项目的目标运行环境中整数除法在个别情况下不可靠，
  因此所有时值换算统一走 `APP.util.beatsOf(dur, dotted)`（查表 + 乘法），不要直接写 `4 / dur`。
  详见 `docs/CONTRACTS.md` 第 1 节。
- **谱面渲染的自动化验证**：`tools/verify-vexflow.js` 用无头 Edge/Chrome 跑 48 个渲染用例
  （15 个调号、8 种拍号、加线、十六分、附点、休止、延音线、1/8/16 小节分行、低音谱、纯节奏），
  `tools/verify-single.js` 用无头浏览器实际打开 `dist/yuedu-trainer.html` 验证「双击即用」路径。

---

## 八、第三方许可

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [VexFlow](https://github.com/vexflow/vexflow) | 4.2.3 | MIT | 五线谱专业排版（`vendor/vexflow.js`） |

VexFlow 以未修改的官方构建产物形式内置，版权归其作者所有，许可证文本见其仓库。
本项目自身的代码为 MIT（见下）。

---

## 八、第三方许可

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [VexFlow](https://github.com/vexflow/vexflow) | 4.2.3 | MIT | 五线谱专业排版（`vendor/vexflow.js`） |

VexFlow 以未修改的官方构建产物形式内置，版权归其作者所有，许可证文本见其仓库。
本项目自身的代码为 MIT（见下）。

---

## 九、许可证

MIT License，作者 `yuedu-trainer contributors`，年份 2026。详见 [LICENSE](LICENSE)。

---

## 十、Android APK

除了网页版，本项目还可以打包成**可以装在 Android 手机上的 APK**（WebView 外壳 + 打包进 APK 的离线网页资源），
安装后完全离线可用，调音器也能正常用麦克风。

### 直接下载（推荐给普通用户）

手机浏览器打开下面的链接即可下载安装（Release 资产，始终指向最新版）：

**<https://github.com/Naizzoazhasas/yuedu-trainer/releases/latest/download/yuedu-trainer.apk>**

安装时系统若提示「未知来源 / 禁止安装未知应用」，允许一次即可。
也可以把 APK 传到手机上再点开安装，或连数据线用 `adb install -r yuedu-trainer.apk`。

> 如果该链接提示 404，说明 APK 还没发布到 Release（发布命令见文末 `tools/publish-apk.js`）。

### 自己构建

```powershell
node tools/build-apk.js      # 产出 dist/android/yuedu-trainer.apk
node tools/verify-apk.js     # 校验包名/版本/权限/签名/内容/体积
node tools/publish-apk.js    # 发布到 GitHub Release（需要令牌）
```

- 不用 Gradle、不用 Android Studio：纯 node 脚本调用 JDK 与 Android build-tools 命令行；
- 构建工具链是**外部依赖**，脚本默认从 `D:\文档\deepseek-harness\default-workspace\_tools\android` 读取
  （`jdk\`、`build-tools\android-14\`、`platform\android-34\android.jar`），
  可用环境变量 `YUEDU_ANDROID_TOOLCHAIN` 指向别处；缺少时脚本会给出中文提示；
- 首次构建会自动生成自签名密钥 `android/keystore/yuedu-release.jks`（口令写在脚本常量里，仅供自用分发）；
- 包名 `com.yuedu.trainer`，版本 `1.4.0`，minSdk 21 / targetSdk 34，只申请麦克风权限、**不申请网络权限**。
- **调音器在 APK 里也能用**：浏览器规定只有安全上下文（https / `http://127.0.0.1` / localhost）才允许
  `getUserMedia` 采集麦克风，而 `file://` 不算。所以 APK 启动时会在本机起一个只监听回环地址的迷你
  HTTP 服务器（`android/src/com/yuedu/trainer/LocalAssetServer.java`），把资源通过
  `http://127.0.0.1:<随机端口>/` 提供给 WebView —— 于是调音器可以正常申请麦克风，
  而局域网访问不到它、也不需要网络权限。服务器异常时会自动回退到 `file://` 并提示。
- **手机上导出可用**：WebView 本身不会保存 `blob:` 下载，所以 APK 里带了一层文件保存桥接
  （`android/src/com/yuedu/trainer/WebBridge.java` + `android/bridge/bridge.js`，分块传输）。
  点「保存为图片 / 导出 MIDI / 导出 MusicXML」会写入 **相册/Pictures/读谱训练器**（图片）
  或 **下载/Download/读谱训练器**（其它），并弹出「已保存到 …」提示；不需要存储权限。
- 详细说明（安装、签名、改包名/版本号、手机上如何授权麦克风、常见问题）见 **[android/README.md](android/README.md)**。

完整说明（构建流程、签名与密钥、麦克风授权、改包名/版本号、常见问题）见 **[android/README.md](android/README.md)**。
