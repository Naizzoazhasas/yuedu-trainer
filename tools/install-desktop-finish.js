/* 桌面安装的收尾步骤：写中文 README + 创建快捷方式
 *
 * 由 tools/install-desktop.ps1 调用（那边是纯 ASCII 的 PowerShell，
 * 中文交给 node 处理，避免 Windows PowerShell 5 读无 BOM 文件时乱码）。
 *
 * 需要的环境变量：
 *   YDT_INSTALL_DEST     应用文件夹（例如 D:\新建文件夹\读谱训练器）
 *   YDT_INSTALL_DESKTOP  桌面目录
 *   YDT_INSTALL_ROOT     项目根（用来找 make-shortcut.js）
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var execFileSync = require('child_process').execFileSync;

var DEST = process.env.YDT_INSTALL_DEST;
var DESKTOP = process.env.YDT_INSTALL_DESKTOP;
var ROOT = process.env.YDT_INSTALL_ROOT || path.join(__dirname, '..');

if (!DEST || !DESKTOP) {
  console.error('缺少 YDT_INSTALL_DEST / YDT_INSTALL_DESKTOP 环境变量');
  process.exit(2);
}

var SHELL = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';

/* ---------------- 1. 写中文 README ---------------- */

var readme = [
  '# 读谱训练器（放在桌面的完整版）',
  '',
  '这个文件夹就是可以直接用的完整软件，**不需要 Node.js**，也不需要联网。',
  '',
  '## 怎么打开',
  '',
  '| 想做什么 | 双击这个 |',
  '|---|---|',
  '| **电脑上正常使用（推荐）** | 桌面上的快捷方式 **「读谱训练器（应用窗口）」**，或本文件夹里的 `Start YueDu Trainer.cmd` |',
  '| 只看看界面、不装任何东西 | `读谱训练器.html`（会直接用浏览器打开；**调音器不可用**，见下） |',
  '| 装到安卓手机 | `android-apk\\YueDuTrainer.apk`（传到手机上点开安装） |',
  '',
  '「应用窗口」方式会打开一个**没有地址栏、没有标签页**的独立窗口，任务栏是单独图标，',
  '并且内置了一个本机服务，所以**调音器可以正常用麦克风**。关掉窗口即完全退出。',
  '',
  '> 为什么不能直接双击 HTML 用调音器？',
  '> 浏览器规定：麦克风只在「安全上下文」（https 或 http://127.0.0.1 / localhost）里可用，',
  '> 而 `file://` 不算。所以直接双击 HTML 时，其它功能都正常，只有调音器会提示不可用。',
  '',
  '## 文件夹里有什么',
  '',
  '```',
  '读谱训练器/',
  '├── Start YueDu Trainer.cmd   ← 双击这个启动应用（推荐）',
  '├── 读谱训练器.html            ← 单文件版主程序（约 1.4 MB，全部代码都在这一个文件里）',
  '├── YueDuTrainer.html         ← 同上（ASCII 文件名的副本，方便命令行/脚本引用）',
  '├── 桌面版说明.txt             ← 你正在看的这个文件',
  '├── 使用说明.txt               ← 功能使用说明',
  '├── README.md                 ← 完整技术文档',
  '├── site/                     ← 多文件版（想改代码/自己部署时用）',
  '├── tools/desktop-app.ps1     ← 应用窗口启动器（Start 那个 .cmd 会调用它）',
  '├── icons/                    ← 图标（含 Windows 用的 .ico）',
  '└── android-apk/',
  '    └── YueDuTrainer.apk      ← 安卓安装包',
  '```',
  '',
  '## 想发给别人',
  '',
  '把整个「读谱训练器」文件夹打包发过去即可（也可以用桌面上的 `YueDuTrainer-portable.zip`）。',
  '对方解压后双击 `Start YueDu Trainer.cmd` 就能用，**不需要装任何东西**——',
  '只要电脑上有 Microsoft Edge（Win10/11 自带）或 Google Chrome。',
  '',
  '## 系统要求',
  '',
  '- 电脑：Windows 10 / 11（需要 Edge 或 Chrome；两个都没有时会让 `YueDuTrainer.html` 用默认浏览器打开）',
  '- 手机：Android 5.0 及以上',
  '',
  '## 常见问题',
  '',
  '| 现象 | 处理 |',
  '|---|---|',
  '| 双击 `Start YueDu Trainer.cmd` 一闪而过 | 说明启动器报错了。右键它 → 编辑，或在本文件夹里按住 Shift 右键 → 「在此处打开 PowerShell」，执行 `powershell -ExecutionPolicy Bypass -File tools\\desktop-app.ps1` 就能看到具体错误 |',
  '| 弹窗提示「无法连接」 | 关掉那个窗口重开；如果反复出现，说明上一次的窗口没退干净，任务管理器里结束所有 Microsoft Edge 进程后重试 |',
  '| 调音器显示不可用 | 说明用的是双击 HTML 的方式。请改用 `Start YueDu Trainer.cmd` |',
  '| 手机上点 APK 装不上 | 系统提示「未知来源」时允许一次；已有同名旧版本请先卸载再装 |',
  '',
  '---',
  '',
  '在线版：<https://naizzoazhasas.github.io/yuedu-trainer/>　',
  '手机 APK 最新版：<https://github.com/Naizzoazhasas/yuedu-trainer/releases/latest/download/yuedu-trainer.apk>',
  ''
].join('\r\n');

fs.writeFileSync(path.join(DEST, '桌面版说明.txt'), '\ufeff' + readme, 'utf8');
console.log('  已写入 桌面版说明.txt');

/* ---------------- 2. 创建快捷方式（走 cscript，能正确写中文） ---------------- */

var shortcuts = [];

/* 应用窗口 */
var launcher = path.join(DEST, 'Start YueDu Trainer.cmd');
if (fs.existsSync(launcher)) {
  shortcuts.push({
    path: path.join(DESKTOP, '读谱训练器（应用窗口）.lnk'),
    target: SHELL,
    arguments: '/c "' + launcher + '"',
    workdir: DEST,
    icon: path.join(DEST, 'icons', 'yuedu.ico'),
    description: '读谱训练器：以独立应用窗口打开（调音器可用）'
  });
}

/* 文件夹本身 */
shortcuts.push({
  path: path.join(DESKTOP, '读谱训练器（文件夹）.lnk'),
  target: DEST,
  description: '打开读谱训练器的安装文件夹'
});

/* 手机 APK 所在目录 */
var apkDir = path.join(DEST, 'android-apk');
if (fs.existsSync(apkDir)) {
  shortcuts.push({
    path: path.join(DESKTOP, '读谱训练器（手机 APK）.lnk'),
    target: apkDir,
    description: '手机安装包所在文件夹（把它传到手机）'
  });
}

/* make-shortcut.js 必须从纯 ASCII 路径运行（cscript 读中文路径会失败） */
var ASCII_TMP = path.join(os.tmpdir(), 'yuedu-shortcut');
if (!fs.existsSync(ASCII_TMP)) fs.mkdirSync(ASCII_TMP, { recursive: true });
var asciiScript = path.join(ASCII_TMP, 'make-shortcut.js');
fs.copyFileSync(path.join(ROOT, 'tools', 'make-shortcut.js'), asciiScript);

var paramFile = path.join(ASCII_TMP, 'desktop-install.json');
fs.writeFileSync(paramFile, JSON.stringify({ shortcuts: shortcuts }), 'utf8');

var out;
try {
  out = execFileSync('cscript', ['//nologo', asciiScript, paramFile], { encoding: 'utf8' });
} catch (e) {
  console.error('  创建快捷方式失败：' + (e && e.message));
  process.exit(1);
}
console.log('  ' + String(out).trim());

var missing = shortcuts.filter(function (s) { return !fs.existsSync(s.path); });
if (missing.length) {
  console.error('  以下快捷方式没建成：' + missing.map(function (s) { return path.basename(s.path); }).join('、'));
  process.exit(1);
}
console.log('  已创建 ' + shortcuts.length + ' 个桌面快捷方式');
