/* 读谱训练器 — 一键准备：快捷方式 + 上传包 + 使用说明
 * 运行： node tools/prepare.js
 *
 * 做四件事：
 *   1. 在桌面与开始菜单创建 3 个快捷方式（本地服务 / 离线版 / 自检）
 *   2. 生成 upload/yuedu-trainer-source.zip（要上传到 GitHub 的源码包）
 *   3. 生成 upload/yuedu-trainer-site.zip（dist/site 的静态站点包，可选部署用）
 *   4. 生成 使用说明.txt 与 GitHub-网页上传图文说明.md
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');
var ZipWriter = require(path.join(__dirname, 'zipwriter.js')).ZipWriter;

var ROOT = path.join(__dirname, '..');
var TOOLS = __dirname;
var UPLOAD = path.join(ROOT, 'upload');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  [ok]   ' + name); }
  else { fail++; console.log('  [失败] ' + name + (detail ? '  → ' + detail : '')); }
}
function kb(n) { return Math.round(n / 1024) + ' KB'; }

console.log('读谱训练器 · 一键准备\n');
console.log('项目目录： ' + ROOT + '\n');

if (!fs.existsSync(UPLOAD)) fs.mkdirSync(UPLOAD, { recursive: true });

/* ---------------- 3. 使用说明 ---------------- */

console.log('【1/4】生成说明文件');

var usage = [
  '读谱训练器 — 使用说明',
  '========================================',
  '',
  '【在线版（最省事，推荐）】',
  '  https://naizzoazhasas.github.io/yuedu-trainer/',
  '  用浏览器直接打开即可，不需要安装任何东西。',
  '  因为在线版是 https，所以【调音器可以正常使用麦克风】。',
  '  还可以装成应用：Chrome / Edge 地址栏右侧点「安装」，',
  '  手机浏览器里选「添加到主屏幕」，之后从桌面图标就能启动。',
  '',
  '【最快的打开方式：桌面快捷方式】',
  '  桌面上有 3 个快捷方式（也可以从开始菜单的「读谱训练器」文件夹找）：',
  '',
  '  1) 读谱训练器（本地服务）   ← 推荐日常使用',
  '     双击后会自动打开浏览器，地址是 http://127.0.0.1:8099/',
  '     这种方式下【调音器可以正常使用麦克风】。',
  '     用完关掉那个黑色命令行窗口即可停止。',
  '     需要电脑上装有 Node.js（没有会给出提示和下载地址）。',
  '',
  '  2) 读谱训练器（离线版）',
  '     不需要 Node.js、不需要联网，直接用浏览器打开 dist/yuedu-trainer.html。',
  '     注意：浏览器规定 file:// 不是安全上下文，所以这种方式下【调音器不能用麦克风】。',
  '     其他功能（生成、五线谱、简谱、节拍器、音阶对照、导出、练习、听辨）都正常。',
  '     五线谱排版用的是内置的 VexFlow，排版质量与在线版一致。',
  '',
  '  3) 读谱训练器（运行自检）',
  '     跑一遍全部自动化测试，用来确认文件完好（也可作为「这软件靠谱吗」的检查）。',
  '',
  '【把快捷方式固定到任务栏 / 开始屏幕】',
  '  右键点击快捷方式 → 「固定到任务栏」或「固定到开始屏幕」。',
  '',
  '【如果快捷方式失效了】',
  '  说明项目文件夹被移动或改名了。请在这个项目文件夹里重新运行：',
  '      node tools\\prepare.js',
  '  它会重新在桌面和开始菜单创建快捷方式。',
  '',
  '【为什么弹出的黑窗口里是英文？】',
  '  Windows 的命令行程序在读取含中文的批处理文件时会因代码页不一致而报错，',
  '  所以启动脚本（start-server.cmd / start-offline.cmd / run-tests.cmd）内部只用英文，',
  '  中文说明就放在这份文件里。功能完全一样，不影响使用。',
  '',
  '【手动打开（不想用快捷方式）】',
  '  方式一（调音器可用）：在项目文件夹打开命令行，执行',
  '      node tools\\serve.js',
  '    然后浏览器访问 http://127.0.0.1:8099/',
  '',
  '  方式二（最简单）：直接双击 dist\\yuedu-trainer.html',
  '',
  '【键盘快捷键】',
  '  空格      播放 / 停止（在「听辨练习」页，空格是敲拍作答）',
  '  N         生成新乐段',
  '  1 到 7    切换标签页',
  '',
  '【七大功能一句话说明】',
  '  生成 / 练习   随机生成节奏或旋律，可限定只出现哪些音符与节奏型，五线谱 / 简谱任选；',
  '                速度 PBM 既能拖滑块，也能直接在数字框里输入精确值（30-240）',
  '  节拍器        20-240 PBM（可直接输入数字）、8 种拍号、重音、细分、敲拍测速',
  '  调音器        麦克风检测音高，吉他 / 尤克里里调弦模式，A4 基准可调',
  '  调号与音阶    15 个调的调号、音名、首调与固定调简谱、频率，还有五度圈',
  '  乐器音阶表    吉他 / 尤克里里 / 贝斯指板、十孔口琴、竖笛、钢琴',
  '  听辨练习      节奏模仿、音程辨识、和弦性质，自动打分',
  '  音型库 / 导出 自定义节奏型、导出 PNG / MIDI / MusicXML、练习统计',
  '',
  '【数据安全】',
  '  全部计算都在你自己的电脑上完成，不联网、不上传。',
  '  自定义节奏型和练习记录只存在浏览器本地（localStorage），清浏览器数据会一起清掉。',
  '',
  '【在线版】',
  '  https://naizzoazhasas.github.io/yuedu-trainer/',
  '  这是本项目的正式在线地址，https 下调音器也能用。',
  '  部署步骤见项目里的 uploads-guide.md（网页上传图文说明）。',
  ''
].join('\r\n');

fs.writeFileSync(path.join(ROOT, '使用说明.txt'), usage, 'utf8');
/* 再写一份纯 ASCII 文件名（也带 BOM），方便在网页版 GitHub 上直接点开阅读 */
fs.writeFileSync(path.join(ROOT, 'USAGE-zh.txt'), '\uFEFF' + usage, 'utf8');
ok('生成 使用说明.txt 与 USAGE-zh.txt',
  fs.existsSync(path.join(ROOT, '使用说明.txt')) && fs.existsSync(path.join(ROOT, 'USAGE-zh.txt')));
console.log('');


/* ---------------- 4. 网页上传说明 ---------------- */

var guide = [
  '# 不用命令行：在 GitHub 网页上传本项目的完整步骤',
  '',
  '本说明假设你已经在浏览器里登录了自己的 GitHub 账号。全程只需要点鼠标，不需要安装任何软件。',
  '',
  '---',
  '',
  '## 第 0 步：准备上传包',
  '',
  '在项目文件夹里运行一次：',
  '',
  '```powershell',
  'node tools\\prepare.js',
  '```',
  '',
  '它会在项目下生成 `upload/yuedu-trainer-source.zip`，里面就是需要上传的全部文件（源码 + 工具 + 说明）。',
  '',
  '> 为什么不用上传整个文件夹？因为网页上传不支持「拖一整个目录树」，用 zip 最省事。',
  '',
  '---',
  '',
  '## 第 1 步：新建仓库',
  '',
  '1. 打开 <https://github.com/new>',
  '2. **Repository name** 填 `yuedu-trainer`',
  '3. **Description**（可选）填：`读谱训练器 — 随机节奏与旋律生成、五线谱/简谱对照、节拍器、调音器、音阶对照，纯前端离线可用`',
  '4. 选 **Public**（GitHub Pages 免费版需要公开仓库）',
  '5. **不要**勾选 `Add a README file`、`.gitignore`、`license`（本项目里已经有了，勾了反而会冲突）',
  '6. 点 **Create repository**',
  '',
  '---',
  '',
  '## 第 2 步：上传文件',
  '',
  '1. 在刚建好的仓库页面，点 **uploading an existing file**（或 `Add file` → `Upload files`）',
  '2. 把 `upload/yuedu-trainer-source.zip` **拖进去**',
  '3. 等它上传完，在下方 **Commit changes** 的输入框里写：',
  '   `读谱训练器 v1.0.0：随机节奏/旋律生成 + 五线谱与简谱渲染 + 节拍器 + 调音器`',
  '4. 点 **Commit changes**',
  '',
  '> ⚠️ 重要：网页上传 zip **不会**自动解压。上传完你要用第 3 步的方式解压，',
  '> 或者更省事：**先把 zip 在本机解压，再把解压出来的文件拖进去上传**。',
  '> 后者更直接，推荐这么做：解压后会有 `index.html`、`src/`、`tools/` 等，全选拖到 GitHub 上传框里即可。',
  '',
  '### 上传后检查文件结构',
  '',
  '仓库根目录应该长这样（`index.html` 必须在最外层）：',
  '',
  '```',
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'README.md',
  'LICENSE',
  '.gitignore',
  '.gitattributes',
  'start-server.cmd',
  'start-offline.cmd',
  'run-tests.cmd',
  '使用说明.txt',
  'USAGE-zh.txt',
  'uploads-guide.md',
  'src/',
  '  app.js  core/  audio/  data/  export/  features/',
  'tools/',
  'docs/',
  'icons/',
  '.github/workflows/deploy.yml',
  '```',
  '',
  '如果发现多了一层文件夹（例如 `yuedu-trainer-source/index.html`），',
  '那是不行的——**`index.html` 必须在仓库根目录**，否则 Pages 找不到首页。',
  '解决办法：进入那层文件夹，用右上角的 `Add file` → `Upload files` 重新上传里面的内容；',
  '或者干脆在本地解压后重传。',
  '',
  '---',
  '',
  '## 第 3 步：开启 GitHub Pages',
  '',
  '有两种方式，任选一种。',
  '',
  '### 方式 A：直接发布分支（最简单，推荐先试这个）',
  '',
  '1. 仓库页面 → **Settings**（顶部齿轮）',
  '2. 左侧 **Pages**',
  '3. **Source** 选 `Deploy from a branch`',
  '4. **Branch** 选 `main`，右边的文件夹选 `/ (root)`',
  '5. 点 **Save**',
  '6. 等 1–2 分钟，刷新页面，顶部会出现绿色提示，形如：',
  '   `Your site is live at https://<你的用户名>.github.io/yuedu-trainer/`',
  '',
  '### 方式 B：用 GitHub Actions 自动构建（本仓库已带工作流）',
  '',
  '仓库里的 `.github/workflows/deploy.yml` 会在每次推送时自动跑测试、构建并发布。',
  '用这种方式需要：',
  '',
  '1. **Settings → Actions → General → Workflow permissions**，选 **Read and write permissions**，保存',
  '2. **Settings → Pages → Source** 选 `GitHub Actions`',
  '3. 到 **Actions** 标签页，选 `构建并发布到 GitHub Pages`，点 **Run workflow** 手动跑一次',
  '',
  '> 注意：`.github/workflows/deploy.yml` 用网页上传的方式**可能传不上去**',
  '> （GitHub 网页界面对 `.github` 目录有的入口不显示）。传不上去也没关系，',
  '> 直接用**方式 A** 一样能上线；`.github` 那层不影响网站内容。',
  '',
  '---',
  '',
  '## 第 4 步：验证',
  '',
  '打开 `https://<你的用户名>.github.io/yuedu-trainer/`，检查：',
  '',
  '- [ ] 页面能打开，标题是「读谱训练器」',
  '- [ ] 点「生成新乐段」，五线谱和简谱都出现',
  '- [ ] 点「播放」，能听到声音',
  '- [ ] 「节拍器」页能出声、「调音器」页能请求麦克风权限（**https 下可以，这正是它的价值**）',
  '- [ ] 「乐器音阶表」页能看到指板图，点「保存为图片」能下载 PNG',
  '',
  '---',
  '',
  '## 常见问题',
  '',
  '**页面 404 或只有 README**',
  '`index.html` 不在仓库根目录。回到第 2 步检查文件结构。',
  '',
  '**页面打开是源码文本**',
  'Pages 的 Source 选错了分支或目录，重新按第 3 步设置。',
  '',
  '**样式全丢、控制台报 404**',
  '`src/` 目录没上传完整。检查仓库里有没有 `src/styles.css` 与 `src/app.js`。',
  '',
  '**调音器提示不支持**',
  '必须用 `https://`（GitHub Pages 就是 https）或 `http://127.0.0.1` 打开。',
  '如果你是自己双击 HTML 文件（`file://`），浏览器不允许用麦克风，这是浏览器的规定，不是 bug。',
  '',
  '**想更新网站内容**',
  '在仓库里直接点开某个文件 → 铅笔图标 → 改完提交即可，Pages 会自动重新发布。',
  '',
  '---',
  '',
  '## 附：以后想用命令行维护（可选）',
  '',
  '本机如果装了 Git，可以这样把改动推上去：',
  '',
  '```powershell',
  'cd <项目目录>',
  'git remote add origin https://github.com/<你的用户名>/yuedu-trainer.git',
  'git add -A',
  'git commit -m "更新说明"',
  'git push -u origin main',
  '```',
  '',
  '注意：GitHub 从 2021 年起不再接受账号密码推送，需要 Personal Access Token。',
  '在 <https://github.com/settings/tokens> 生成一个带 `repo` 权限的 token，推送时用户名填你的 GitHub 用户名，密码栏粘贴 token。',
  ''
].join('\n');

fs.writeFileSync(path.join(ROOT, 'uploads-guide.md'), guide, 'utf8');
ok('生成 uploads-guide.md（网页上传图文说明）', fs.existsSync(path.join(ROOT, 'uploads-guide.md')));


/* ---------------- 1. 快捷方式 ---------------- */

function run(cmd, args) {
  var r = cp.spawnSync(cmd, args, { stdio: 'pipe', windowsHide: true });
  return {
    code: r.status,
    out: (r.stdout ? r.stdout.toString('utf8') : '') + (r.stderr ? r.stderr.toString('utf8') : '')
  };
}

var desktop = path.join(os.homedir(), 'Desktop');
if (!fs.existsSync(desktop)) desktop = path.join(os.homedir(), '桌面');
var startMenu = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs');
var startGroup = path.join(startMenu, '读谱训练器');
try { fs.mkdirSync(startGroup, { recursive: true }); } catch (e) { /* 忽略 */ }

var SHELL = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';

/* cscript 通过命令行读取含中文的脚本路径会因 OEM 代码页而失败，
 * 所以先把脚本复制到纯 ASCII 的临时路径，再用 UTF-8 的 JSON 参数文件传中文。 */
var ASCII_TMP = path.join(os.tmpdir(), 'yuedu-shortcut');
if (!fs.existsSync(ASCII_TMP)) fs.mkdirSync(ASCII_TMP, { recursive: true });
var asciiScript = path.join(ASCII_TMP, 'make-shortcut.js');
fs.copyFileSync(path.join(TOOLS, 'make-shortcut.js'), asciiScript);

var SHORTCUTS = [
  {
    name: '读谱训练器（本地服务）.lnk',
    cmd: path.join(ROOT, 'start-server.cmd'),
    desc: '启动本地服务器并打开浏览器（调音器可用）——开发用'
  },
  {
    name: '读谱训练器（离线版）.lnk',
    cmd: path.join(ROOT, 'start-offline.cmd'),
    desc: '直接用浏览器打开（无需 Node.js，调音器不可用）'
  },
  {
    name: '读谱训练器（运行自检）.lnk',
    cmd: path.join(ROOT, 'run-tests.cmd'),
    desc: '运行全部自动化测试'
  },
  {
    name: '读谱训练器（推送到 GitHub）.lnk',
    cmd: path.join(ROOT, 'start-push.cmd'),
    desc: '把本地提交推送到 GitHub（第一次会弹出浏览器登录）'
  }
];

var shortcutTargets = [];      // 收集所有要创建的 .lnk 绝对路径

SHORTCUTS.forEach(function (s) {
  shortcutTargets.push({
    path: path.join(desktop, s.name),
    target: SHELL,
    arguments: '/c "' + s.cmd + '"',
    workdir: ROOT,
    icon: s.icon,
    description: s.desc
  });
  shortcutTargets.push({
    path: path.join(startGroup, s.name),
    target: SHELL,
    arguments: '/c "' + s.cmd + '"',
    workdir: ROOT,
    icon: s.icon,
    description: s.desc
  });
});

/* OneDrive 同步桌面时，真实桌面往往在 OneDrive 下，两个都放一份 */
var oneDriveDesktop = path.join(process.env.OneDrive || '', 'Desktop');
if (process.env.OneDrive && fs.existsSync(oneDriveDesktop) && oneDriveDesktop !== desktop) {
  SHORTCUTS.forEach(function (s) {
    shortcutTargets.push({
      path: path.join(oneDriveDesktop, s.name),
      target: SHELL,
      arguments: '/c "' + s.cmd + '"',
      workdir: ROOT,
      description: s.desc
    });
  });
}

function createShortcuts() {
  try { fs.mkdirSync(startGroup, { recursive: true }); } catch (e) { /* 忽略 */ }
  var paramFile = path.join(ASCII_TMP, 'params.json');
  fs.writeFileSync(paramFile, JSON.stringify({ shortcuts: shortcutTargets }), 'utf8');
  var r = run('cscript', ['//nologo', asciiScript, paramFile]);
  return r;
}



/* ---------------- 2. 源码上传包 ---------------- */

console.log('【2/4】生成上传包');

/* 递归列出要打包的文件（原样传相对路径给 tar，避免中文名与目录展开的坑） */
var PACK_EXCLUDE_DIRS = ['dist', '.git', 'upload', 'node_modules', 'tools/_out'];
var PACK_EXCLUDE_FILES = ['USAGE-zh.txt'];

function listFilesForPack(dir, rel, out) {
  out = out || [];
  var entries;
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); }
  catch (e) { return out; }
  entries.forEach(function (ent) {
    var r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (PACK_EXCLUDE_DIRS.indexOf(r) >= 0) return;
      listFilesForPack(dir, r, out);
    } else {
      if (PACK_EXCLUDE_FILES.indexOf(r) >= 0) return;
      if (/\.log$/.test(ent.name)) return;
      out.push(r);
    }
  });
  return out;
}

/* 用自己写的 ZIP 打包器（UTF-8 文件名），保证中文文件名不会乱码 */
function buildZip(dest, rootDir, rels) {  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  var z = new ZipWriter();
  rels.forEach(function (rel) {
    var full = path.join(rootDir, rel);
    var st;
    try { st = fs.statSync(full); } catch (e) { return; }
    if (!st.isFile()) return;
    z.addFile(rel, fs.readFileSync(full), st.mtime);
  });
  var size = z.writeTo(dest);
  return { ok: fs.existsSync(dest), count: z.count(), size: size };
}

/* 要上传到 GitHub 的内容：源码 + 工具 + 文档 + 图标 + PWA 文件 + 启动器。
 * 同时额外放一份 ASCII 名的 USAGE-zh.txt，方便在网页上直接阅读。 */
var usageSrc = path.join(ROOT, '使用说明.txt');
var usageAscii = path.join(ROOT, 'USAGE-zh.txt');
if (fs.existsSync(usageSrc)) fs.copyFileSync(usageSrc, usageAscii);

var SOURCE_ITEMS = listFilesForPack(ROOT, '').concat(fs.existsSync(usageAscii) ? ['USAGE-zh.txt'] : []);

var srcZip = path.join(UPLOAD, 'yuedu-trainer-source.zip');
var zipR = buildZip(srcZip, ROOT, SOURCE_ITEMS);
ok('生成源码上传包 yuedu-trainer-source.zip', zipR.ok);
if (zipR.ok) {
  console.log('        大小： ' + kb(zipR.size) + '，共 ' + zipR.count + ' 个文件');
  var zh = SOURCE_ITEMS.filter(function (n) { return /[^\x00-\x7F]/.test(n); });
  if (zh.length) console.log('        含中文名的文件： ' + zh.join(', ') + '（按 UTF-8 写入，解压不会乱码）');
}

/* 站点版压缩包（如果只想上传构建产物） */
var siteDir = path.join(ROOT, 'dist', 'site');
var siteZip = path.join(UPLOAD, 'yuedu-trainer-site.zip');
if (fs.existsSync(siteDir)) {
  var siteRels = listFilesForPack(siteDir, '');
  var siteR = buildZip(siteZip, siteDir, siteRels);
  ok('生成站点包 yuedu-trainer-site.zip', siteR.ok);
  if (siteR.ok) console.log('        大小： ' + kb(siteR.size) + '，共 ' + siteR.count + ' 个文件');
} else {
  console.log('        （未找到 dist/site，跳过站点包；先运行 node tools/build.js）');
}
console.log('');


/* 快捷方式最后创建（说明文件与 zip 都已经生成好了） */
console.log('【4/4】创建快捷方式');
var scResult = createShortcuts();
var scOut = (scResult.out || '').trim();
console.log('  cscript 输出： ' + (scOut || '(空)') + '   退出码 ' + scResult.code);
var scMissing = shortcutTargets.filter(function (t) { return !fs.existsSync(t.path); });
ok('创建全部 ' + shortcutTargets.length + ' 个快捷方式', scMissing.length === 0,
  scMissing.map(function (t) { return t.path; }).join(' ; '));
console.log('  桌面目录： ' + desktop);
console.log('  开始菜单： ' + startGroup + '\n');
/* ---------------- 汇总 ---------------- */

console.log('');
console.log('==================== 汇总 ====================');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('');
console.log('  桌面快捷方式：');
SHORTCUTS.forEach(function (s) { console.log('    ' + s.name); });
console.log('');
console.log('  upload/ 目录：');
if (fs.existsSync(UPLOAD)) {
  fs.readdirSync(UPLOAD).forEach(function (n) {
    console.log('    ' + n + '  (' + kb(fs.statSync(path.join(UPLOAD, n)).size) + ')');
  });
}
console.log('');
console.log('  下一步：打开 uploads-guide.md，按里面的步骤在 GitHub 网页上传即可。');
console.log('');

process.exit(fail ? 1 : 0);
