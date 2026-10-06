#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — 一键打包 Android APK（零 npm 依赖，只用 node 内置模块）
 *
 * 特点：
 *   - 不用 Gradle、不用 Android Studio，直接调 JDK 与 Android build-tools 命令行；
 *   - 网页资源清单从 index.html 里解析（<script src> / <link href>），
 *     以后新增模块不需要改这个脚本；
 *   - 每一步都有中文日志，失败时给出「怎么修」的中文提示。
 *
 * 用法：
 *   node tools/build-apk.js                 # 完整流程：准备资源 → 编译 → 打包 → 签名 → 校验
 *   node tools/build-apk.js --keep-build    # 保留 android/build/ 中间产物（默认也保留，便于排查）
 *   node tools/build-apk.js --skip-sign     # 只产出未签名 APK（调试用）
 *   node tools/build-apk.js --tools <目录>  # 指定 _tools/android 位置
 *   node tools/build-apk.js --help
 *
 * 需要的工具链（默认在 <工作区>/_tools/android/ 下，可用 --tools 或环境变量 YUEDU_ANDROID_TOOLS 覆盖）：
 *   jdk/bin/{java,javac,keytool}.exe
 *   build-tools/{aapt2.exe,d8.bat,lib/d8.jar,zipalign.exe,apksigner.bat,lib/apksigner.jar,android.jar}
 *
 * 流程：
 *   1) 准备 assets：从 dist/site（优先，若已构建过）或项目根复制网页资源到 android/assets/
 *   2) aapt2 compile 编译 res/** → .flat；aapt2 link 产出 resources.ap_ 与 R.java
 *   3) javac -source 8 -target 8 -bootclasspath android.jar 编译 Java → android/classes/
 *   4) d8 把 class 转成 classes.dex
 *   5) 用纯 node ZIP 写入器把 resources.ap_ + classes.dex + assets/** 组装成 APK
 *   6) 首次运行生成自签名 keystore（已存在则跳过）
 *   7) zipalign → apksigner 签名
 *   8) apksigner verify + ZIP 内容断言
 *   9) 输出 dist/android/yuedu-trainer.apk
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { ZipWriter } = require('./zipwriter');
const { readZipFile, listZipEntries } = require('./zipreader');

/* ==================== 应用信息（必须与 android/AndroidManifest.xml 保持一致） ==================== */
const APP = {
  packageName: 'com.yuedu.trainer',
  appName: '读谱训练器',
  versionName: '1.1.0',
  versionCode: 2,
  minSdk: 21,      // Android 5.0
  targetSdk: 34    // Android 14
};

/* ==================== 签名口令（自签名，仅供调试分发） ====================
 * 这是一个「自签名证书」：不是从 CA 买的，只用于让你自己（或小范围分发）能装上 APK。
 * Android 只要求同一应用后续升级用同一把钥匙签名，不要求证书由谁签发。
 * 口令写死在脚本里是有意为之 —— 纯本地离线项目、无需保密；
 * 若要上架应用商店，请自行生成并妥善保管 keystore，不要把口令提交到公开仓库。
 * ========================================================================= */
const KEYSTORE_FILE_NAME = 'yuedu-release.jks';
const KEYSTORE_ALIAS = 'yuedu';
const KEYSTORE_PASSWORD = 'yuedu-trainer';
const KEY_PASSWORD = 'yuedu-trainer';
const KEY_VALIDITY_DAYS = 10000;
const KEY_DNAME = 'CN=YueDu Trainer, OU=YueDu Trainer, O=YueDu Trainer, L=Beijing, ST=Beijing, C=CN';

/* ==================== 路径 ==================== */
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(PROJECT_ROOT, 'android');
const RES_DIR = path.join(ANDROID_DIR, 'res');
const SRC_DIR = path.join(ANDROID_DIR, 'src');
const MANIFEST_PATH = path.join(ANDROID_DIR, 'AndroidManifest.xml');
const ASSETS_DIR = path.join(ANDROID_DIR, 'assets');
const BUILD_DIR = path.join(ANDROID_DIR, 'build');
const CLASSES_DIR = path.join(ANDROID_DIR, 'classes');
const KEYSTORE_DIR = path.join(ANDROID_DIR, 'keystore');
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, KEYSTORE_FILE_NAME);
const FLAT_DIR = path.join(BUILD_DIR, 'compiled');
const GEN_DIR = path.join(BUILD_DIR, 'gen');
const RES_AP_PATH = path.join(BUILD_DIR, 'resources.ap_');
const DEX_DIR = path.join(BUILD_DIR, 'dexout');
const APK_TMP_DIR = path.join(BUILD_DIR, 'apk');
const UNALIGNED_APK = path.join(APK_TMP_DIR, 'yuedu-trainer-unaligned.apk');
const ALIGNED_APK = path.join(APK_TMP_DIR, 'yuedu-trainer-aligned.apk');
const OUT_DIR = path.join(PROJECT_ROOT, 'dist', 'android');
const OUT_APK = path.join(OUT_DIR, 'yuedu-trainer.apk');

/* 各类中间产物的固定清单（用于启动时检查工具链是否齐全） */
const TOOL_FILES = [
  ['JDK java', 'jdk/bin/java.exe'],
  ['JDK javac', 'jdk/bin/javac.exe'],
  ['JDK keytool', 'jdk/bin/keytool.exe'],
  ['aapt2', 'build-tools/aapt2.exe'],
  ['d8 脚本', 'build-tools/d8.bat'],
  ['d8 jar', 'build-tools/lib/d8.jar'],
  ['zipalign', 'build-tools/zipalign.exe'],
  ['apksigner 脚本', 'build-tools/apksigner.bat'],
  ['apksigner jar', 'build-tools/lib/apksigner.jar']
];

/* ==================== 小工具 ==================== */
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function toPosix(p) { return p.split(path.sep).join('/'); }
function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }
function quoteArg(a) { return /[\s"]/.test(a) ? '"' + a + '"' : a; }

/** 递归列出目录下的所有文件（返回绝对路径数组） */
function walkFiles(dir) {
  const out = [];
  if (!isDir(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) Array.prototype.push.apply(out, walkFiles(full));
    else if (ent.isFile()) out.push(full);
  });
  return out;
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); return p; }

/* ==================== 参数解析 ==================== */
function parseArgs(argv) {
  const opt = {
    tools: process.env.YUEDU_ANDROID_TOOLS || path.resolve(PROJECT_ROOT, '..', '_tools', 'android'),
    skipSign: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tools') opt.tools = argv[++i] || opt.tools;
    else if (a.indexOf('--tools=') === 0) opt.tools = a.slice(8);
    else if (a === '--skip-sign') opt.skipSign = true;
    else if (a === '--keep-build') { /* 中间产物本来就保留，兼容这个参数 */ }
    else if (a === '--help' || a === '-h') opt.help = true;
    else console.log('  [提示] 未知参数已忽略：' + a);
  }
  return opt;
}

function usage() {
  console.log([
    '用法：node tools/build-apk.js [选项]',
    '  --tools <目录>   指定 Android 工具链根目录（默认 ../_tools/android）',
    '  --skip-sign      只产出未签名 APK（调试用，装不上安卓设备）',
    '  --help           显示本帮助',
    '',
    '产物：dist/android/yuedu-trainer.apk'
  ].join('\n'));
}

/* ==================== 工具链定位 ==================== */
function makeToolchain(toolsRoot) {
  const tc = {
    root: toolsRoot,
    jdk: path.join(toolsRoot, 'jdk'),
    buildTools: path.join(toolsRoot, 'build-tools')
  };
  tc.java = path.join(tc.jdk, 'bin', 'java.exe');
  tc.javac = path.join(tc.jdk, 'bin', 'javac.exe');
  tc.keytool = path.join(tc.jdk, 'bin', 'keytool.exe');
  tc.aapt2 = path.join(tc.buildTools, 'aapt2.exe');
  tc.d8Bat = path.join(tc.buildTools, 'd8.bat');
  tc.d8Jar = path.join(tc.buildTools, 'lib', 'd8.jar');
  tc.zipalign = path.join(tc.buildTools, 'zipalign.exe');
  tc.apksignerBat = path.join(tc.buildTools, 'apksigner.bat');
  tc.apksignerJar = path.join(tc.buildTools, 'lib', 'apksigner.jar');
  /* android.jar：优先 build-tools 下（用户提供的工具链布局），
     否则退回到 platforms/android-XX/android.jar（标准 SDK 布局） */
  tc.androidJar = path.join(tc.buildTools, 'android.jar');
  if (!exists(tc.androidJar)) {
    const platforms = path.join(toolsRoot, 'platforms');
    if (isDir(platforms)) {
      const cands = fs.readdirSync(platforms)
        .filter(function (n) { return /^android-\d+$/.test(n); })
        .sort(function (a, b) { return parseInt(b.slice(8), 10) - parseInt(a.slice(8), 10); });
      for (const c of cands) {
        const p = path.join(platforms, c, 'android.jar');
        if (exists(p)) { tc.androidJar = p; break; }
      }
    }
  }
  return tc;
}

/** 检查工具链是否齐全，返回缺失项的中文描述数组 */
function checkToolchain(tc) {
  const missing = [];
  TOOL_FILES.forEach(function (pair) {
    const rel = pair[1];
    const abs = path.join(tc.root, rel.split('/').join(path.sep));
    if (!exists(abs)) missing.push(pair[0] + '（缺 ' + rel + '）');
  });
  if (!exists(tc.androidJar)) missing.push('android.jar（build-tools/android.jar 或 platforms/android-*/android.jar 都没有）');
  return missing;
}

/* ==================== 子进程执行 ==================== */
function childEnv(tc) {
  const env = Object.assign({}, process.env);
  env.JAVA_HOME = tc.jdk;
  env.PATH = path.join(tc.jdk, 'bin') + path.delimiter + (process.env.PATH || '');
  return env;
}

/**
 * 执行一个命令行工具并返回结果。
 * .bat/.cmd 在 Windows 上不能直接 spawn（Node 会 EINVAL），统一走 cmd /c。
 */
function execTool(tc, bin, args, opts) {
  opts = opts || {};
  const cmdLabel = path.basename(bin) + ' ' + args.map(quoteArg).join(' ');
  console.log('  $ ' + cmdLabel);

  let file = bin;
  let argv = args;
  if (/\.(bat|cmd)$/i.test(bin)) {
    file = process.env.ComSpec || 'cmd.exe';
    argv = ['/c', bin].concat(args);
  }
  const res = spawnSync(file, argv, {
    cwd: opts.cwd || PROJECT_ROOT,
    env: childEnv(tc),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true
  });
  const out = {
    status: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error || null,
    cmd: cmdLabel
  };
  if (res.error) {
    out.stderr += (out.stderr ? '\n' : '') + '无法启动进程：' + res.error.message;
  }
  const text = (out.stdout + out.stderr).trim();
  if (text && !opts.quiet) {
    text.split(/\r?\n/).forEach(function (line) { console.log('    | ' + line); });
  }
  return out;
}

/** 批处理失败时退回「直接用 java 调 jar」，绕开 cmd.exe 对中文/空格路径的编码坑 */
function execWithJavaFallback(tc, batPath, javaArgs, args, opts) {
  const first = execTool(tc, batPath, args, opts);
  if (first.status === 0) return first;
  console.log('  [重试] ' + path.basename(batPath) + ' 失败（退出码 ' + first.status + '），'
    + '改用 java 直接调用，避免 cmd.exe 路径编码问题…');
  const second = execTool(tc, tc.java, javaArgs.concat(args), opts);
  return second.status === 0 ? second : first;
}

/* ==================== 步骤 1：准备 assets ==================== */
/**
 * 从 index.html 里解析需要打包的网页资源：
 * 匹配 <script src="..."> 与 <link href="...">，去掉外链与 data:。
 * 这样以后往 index.html 里加模块，不需要改本脚本。
 */
function parseHtmlRefs(html) {
  const refs = [];
  const seen = Object.create(null);
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1] || m[2];
    if (!url) continue;
    if (/^(https?:)?\/\//i.test(url)) continue;       // 外链
    if (/^(data|blob|javascript|mailto|tel):/i.test(url)) continue; // 非文件资源
    const rel = url.replace(/^\.\//, '').split('?')[0].split('#')[0];
    if (!rel || seen[rel]) continue;
    seen[rel] = true;
    refs.push(rel);
  }
  return refs;
}

function prepareAssets() {
  console.log('\n[1/8] 准备网页资源 → android/assets/');

  /* 选择资源来源：dist/site 是构建产物、资源更完整（含 version.json 等），优先使用 */
  const siteDir = path.join(PROJECT_ROOT, 'dist', 'site');
  let baseDir = PROJECT_ROOT;
  if (exists(path.join(siteDir, 'index.html'))) {
    baseDir = siteDir;
    console.log('  资源来源：' + toPosix(path.relative(PROJECT_ROOT, siteDir)) + '/（已构建过的站点版，优先使用）');
  } else {
    console.log('  资源来源：项目根目录（未找到 dist/site/index.html，先用源码目录）');
  }

  const indexHtml = path.join(baseDir, 'index.html');
  if (!exists(indexHtml)) {
    throw new Error('找不到 ' + indexHtml + '：请先运行 node tools/build.js 生成 dist/site，或确认项目根目录完整。');
  }

  /* 清空旧 assets，保证幂等（不会残留上一次打包的旧文件） */
  fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
  mkdirp(ASSETS_DIR);

  const html = fs.readFileSync(indexHtml, 'utf8');
  const refs = parseHtmlRefs(html);
  console.log('  从 index.html 解析到 ' + refs.length + ' 个引用：');
  refs.forEach(function (r) { console.log('    - ' + r); });

  /* 必须打包的文件：index.html + 解析出的引用 + icons/ 全目录（PWA 图标可能没被 index.html 直接引用） */
  const wanted = ['index.html'].concat(refs);
  walkFiles(path.join(baseDir, 'icons')).forEach(function (f) {
    wanted.push(toPosix(path.relative(baseDir, f)));
  });

  const copied = [];
  const missing = [];
  const seen = Object.create(null);
  wanted.forEach(function (rel) {
    rel = rel.replace(/\\/g, '/');
    if (seen[rel]) return;
    seen[rel] = true;

    let from = path.join(baseDir, rel.split('/').join(path.sep));
    if (!exists(from)) {
      /* 站点版缺少的文件（例如未参与站点构建的）退回项目根再试一次 */
      const fallback = path.join(PROJECT_ROOT, rel.split('/').join(path.sep));
      if (exists(fallback)) {
        console.log('    [回退] ' + rel + ' 在站点版中缺失，改用项目根的文件');
        from = fallback;
      } else {
        missing.push(rel);
        return;
      }
    }
    const buf = fs.readFileSync(from);
    const dst = path.join(ASSETS_DIR, rel.split('/').join(path.sep));
    mkdirp(path.dirname(dst));
    fs.writeFileSync(dst, buf);
    copied.push({ path: rel, bytes: buf.length, sha1: sha1(buf) });
  });

  /* 关键文件强校验：少了任何一个，APK 装上去就是白屏/无五线谱 */
  const critical = ['index.html', 'vendor/vexflow.js', 'src/app.js', 'src/styles.css'];
  const lostCritical = critical.filter(function (r) { return !exists(path.join(ASSETS_DIR, r.split('/').join(path.sep))); });
  if (lostCritical.length) {
    throw new Error('关键资源缺失，无法继续打包：' + lostCritical.join('、')
      + '\n         请先运行 node tools/build.js 生成完整的 dist/site。');
  }
  if (missing.length) {
    console.log('  [警告] 以下被 index.html 引用的文件不存在，已跳过（网页可能功能不全）：');
    missing.forEach(function (r) { console.log('    - ' + r); });
  }

  const total = copied.reduce(function (s, f) { return s + f.bytes; }, 0);
  console.log('  ✓ 已复制 ' + copied.length + ' 个文件，共 ' + fmtBytes(total));

  /* 应用图标：android/res/mipmap/icon.png 若还没生成，就从项目图标复制一份 */
  const iconDst = path.join(RES_DIR, 'mipmap', 'icon.png');
  if (!exists(iconDst)) {
    const iconSrc = path.join(PROJECT_ROOT, 'icons', 'icon-192.png');
    if (exists(iconSrc)) {
      mkdirp(path.dirname(iconDst));
      fs.copyFileSync(iconSrc, iconDst);
      console.log('  [图标] 已从 icons/icon-192.png 生成 android/res/mipmap/icon.png');
    } else {
      throw new Error('缺少应用图标：既没有 android/res/mipmap/icon.png，也没有 icons/icon-192.png。');
    }
  }
  return copied;
}

/* ==================== 步骤 2：aapt2 编译资源 ==================== */
function compileResources(tc) {
  console.log('\n[2/8] 编译 Android 资源（aapt2 compile + link）');

  if (!exists(MANIFEST_PATH)) {
    throw new Error('找不到 AndroidManifest.xml：' + MANIFEST_PATH);
  }
  fs.rmSync(FLAT_DIR, { recursive: true, force: true });
  mkdirp(FLAT_DIR);
  fs.rmSync(GEN_DIR, { recursive: true, force: true });
  mkdirp(GEN_DIR);

  const resFiles = walkFiles(RES_DIR);
  if (!resFiles.length) {
    throw new Error('android/res/ 下没有任何资源文件（至少需要 values/strings.xml 与 mipmap/icon.png）。');
  }
  /* 逐个文件编译：aapt2 compile -o <dir> <file>，输出 <dir>/<name>.flat */
  resFiles.forEach(function (f) {
    const r = execTool(tc, tc.aapt2, ['compile', '-o', FLAT_DIR, f]);
    if (r.status !== 0) {
      throw new Error('aapt2 compile 失败（' + toPosix(path.relative(ANDROID_DIR, f)) + '，退出码 ' + r.status + '）。'
        + '\n         常见原因：资源文件放在非法目录（必须是 res/<类型>-<限定符>/）、PNG 损坏、XML 语法错误。');
    }
  });
  const flats = walkFiles(FLAT_DIR).filter(function (f) { return /\.flat$/.test(f); });
  console.log('  ✓ 编译出 ' + flats.length + ' 个 .flat：' + flats.map(function (f) { return path.basename(f); }).join('、'));

  /* link：产出 resources.ap_（含二进制 Manifest 与 resources.arsc），并用 --java 生成 R.java */
  const args = [
    'link',
    '-o', RES_AP_PATH,
    '-I', tc.androidJar,
    '--manifest', MANIFEST_PATH,
    '--java', GEN_DIR,
    '--min-sdk-version', String(APP.minSdk),
    '--target-sdk-version', String(APP.targetSdk),
    '--version-code', String(APP.versionCode),
    '--version-name', APP.versionName
  ].concat(flats);
  const link = execTool(tc, tc.aapt2, args);
  if (link.status !== 0) {
    throw new Error('aapt2 link 失败（退出码 ' + link.status + '）。'
      + '\n         常见原因：AndroidManifest.xml 里引用了不存在的资源（如 @mipmap/icon）、'
      + 'minSdk/targetSdk 与 android.jar 不匹配。');
  }
  if (!exists(RES_AP_PATH)) {
    throw new Error('aapt2 link 没有产出 ' + RES_AP_PATH);
  }
  const rJava = walkFiles(GEN_DIR).find(function (f) { return /R\.java$/.test(f); });
  if (!rJava) {
    throw new Error('aapt2 link 没有生成 R.java（应位于 ' + GEN_DIR + '）。缺少它 javac 会报「找不到符号: R」。');
  }
  console.log('  ✓ 资源包：' + toPosix(path.relative(PROJECT_ROOT, RES_AP_PATH)) + '（' + fmtBytes(fs.statSync(RES_AP_PATH).size) + '）');
  console.log('  ✓ R.java：' + toPosix(path.relative(PROJECT_ROOT, rJava)));
  return { rJava: rJava };
}

/* ==================== 步骤 3：javac 编译 Java ==================== */
function compileJava(tc, rJava) {
  console.log('\n[3/8] 编译 Java 源码（javac，目标 Java 8）');

  fs.rmSync(CLASSES_DIR, { recursive: true, force: true });
  mkdirp(CLASSES_DIR);

  const sources = walkFiles(SRC_DIR).filter(function (f) { return /\.java$/.test(f); });
  if (!sources.length) {
    throw new Error('android/src/ 下没有 .java 文件。');
  }
  const all = sources.concat([rJava]);
  console.log('  源文件：' + all.map(function (f) { return toPosix(path.relative(PROJECT_ROOT, f)); }).join('、'));

  /* -source/-target 8：Android 的 dex 对高版本字节码支持有限，统一压到 8；
     -bootclasspath android.jar：用 Android 的 API 而不是本机 JDK 的，
     否则会误用到 Android 上不存在的 JDK 类；
     -encoding UTF-8：源码里有中文注释，不指定会按系统代码页解码从而报错；
     -Xlint:-options / -nowarn：JDK 17 会抱怨「source 8 已过时」，这里明确忽略，不让它影响构建。 */
  const args = [
    '-source', '8', '-target', '8',
    '-bootclasspath', tc.androidJar,
    '-encoding', 'UTF-8',
    '-nowarn', '-Xlint:-options',
    '-d', CLASSES_DIR
  ].concat(all);
  const r = execTool(tc, tc.javac, args);
  if (r.status !== 0) {
    throw new Error('javac 编译失败（退出码 ' + r.status + '）。'
      + '\n         请检查 MainActivity.java 的 import 与语法；'
      + '若报「找不到符号 R」，通常是 android/res/ 里资源没编译成功。');
  }
  const classes = walkFiles(CLASSES_DIR).filter(function (f) { return /\.class$/.test(f); });
  console.log('  ✓ 生成 ' + classes.length + ' 个 .class：' + classes.map(function (f) {
    return toPosix(path.relative(CLASSES_DIR, f));
  }).join('、'));
  return classes;
}

/* ==================== 步骤 4：d8 → classes.dex ==================== */
function dexClasses(tc, classFiles) {
  console.log('\n[4/8] 转换为 Dalvik 字节码（d8 → classes.dex）');

  fs.rmSync(DEX_DIR, { recursive: true, force: true });
  mkdirp(DEX_DIR);

  const args = [
    '--lib', tc.androidJar,
    '--min-api', String(APP.minSdk),
    '--release',
    '--output', DEX_DIR
  ].concat(classFiles);
  const r = execWithJavaFallback(tc, tc.d8Bat, ['-cp', tc.d8Jar, 'com.android.tools.r8.D8'], args);
  if (r.status !== 0) {
    throw new Error('d8 转换失败（退出码 ' + r.status + '）。'
      + '\n         常见原因：JAVA_HOME 未生效、classes 目录里混进了非 Android 的类、minApi 低于所用 API。');
  }
  const dex = path.join(DEX_DIR, 'classes.dex');
  if (!exists(dex)) {
    throw new Error('d8 没有产出 ' + dex);
  }
  console.log('  ✓ classes.dex（' + fmtBytes(fs.statSync(dex).size) + '）');
  return dex;
}

/* ==================== 步骤 5：组装 APK（ZIP） ==================== */
function packageApk(dexPath) {
  console.log('\n[5/8] 组装 APK（ZIP：AndroidManifest.xml + resources.arsc + classes.dex + assets/）');

  fs.rmSync(APK_TMP_DIR, { recursive: true, force: true });
  mkdirp(APK_TMP_DIR);

  /* 注意：这里刻意使用「全部不压缩（store）」模式。
     Android 11（targetSdk 30）起要求 resources.arsc 必须以未压缩且 4 字节对齐的形式存在，
     全量 store 最省心，zipalign 也能把所有条目对齐；
     代价只是 APK 大一点（本应用约 1.5 MB，远低于手机安装限制）。 */
  const zip = new ZipWriter({ store: true });

  /* 5.1 从 resources.ap_ 里搬出 aapt2 产出的条目（二进制 AndroidManifest.xml / resources.arsc / res/**） */
  const resEntries = readZipFile(RES_AP_PATH);
  let resCount = 0;
  resEntries.forEach(function (buf, name) {
    zip.addFile(name, buf);
    resCount++;
  });
  console.log('  ✓ 从 resources.ap_ 搬入 ' + resCount + ' 个条目：' + Array.from(resEntries.keys()).join('、'));

  /* 5.2 classes.dex */
  zip.addFile('classes.dex', fs.readFileSync(dexPath));

  /* 5.3 assets/**（网页资源，路径前缀必须是 assets/） */
  zip.addDirectoryFiles(ANDROID_DIR, 'assets');
  const assetCount = zip.count() - resCount - 1;
  console.log('  ✓ 打入 assets/ 下 ' + assetCount + ' 个文件');

  const bytes = zip.writeTo(UNALIGNED_APK);
  console.log('  ✓ 未对齐 APK：' + toPosix(path.relative(PROJECT_ROOT, UNALIGNED_APK)) + '（' + fmtBytes(bytes) + '）');

  /* 自检：路径必须是 Android 认识的布局 */
  const names = zip.entries.map(function (e) { return e.name; });
  ['AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'assets/index.html'].forEach(function (need) {
    if (names.indexOf(need) < 0) {
      throw new Error('打包结果里缺少 ' + need + '（ZIP 内路径必须放在根目录，不能多套一层文件夹）。');
    }
  });
  return UNALIGNED_APK;
}

/* ==================== 步骤 6：zipalign + 生成 keystore ==================== */
function alignApk(tc, inputApk) {
  console.log('\n[6/8] 4 字节对齐（zipalign）');
  fs.rmSync(ALIGNED_APK, { force: true });
  const r = execTool(tc, tc.zipalign, ['-p', '-f', '4', inputApk, ALIGNED_APK]);
  if (r.status !== 0 || !exists(ALIGNED_APK)) {
    throw new Error('zipalign 失败（退出码 ' + r.status + '）。'
      + '\n         常见原因：输入 APK 损坏；或目标文件被占用（关掉正在预览它的程序后重试）。');
  }
  console.log('  ✓ 已对齐：' + toPosix(path.relative(PROJECT_ROOT, ALIGNED_APK)) + '（' + fmtBytes(fs.statSync(ALIGNED_APK).size) + '）');
  return ALIGNED_APK;
}

function ensureKeystore(tc) {
  if (exists(KEYSTORE_PATH)) {
    console.log('  · keystore 已存在，跳过生成：' + toPosix(path.relative(PROJECT_ROOT, KEYSTORE_PATH)));
    return KEYSTORE_PATH;
  }
  console.log('  · 首次构建，生成自签名 keystore（alias=' + KEYSTORE_ALIAS + '，有效期 ' + KEY_VALIDITY_DAYS + ' 天）');
  mkdirp(KEYSTORE_DIR);
  const args = [
    '-genkeypair',
    '-keystore', KEYSTORE_PATH,
    '-alias', KEYSTORE_ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', String(KEY_VALIDITY_DAYS),
    '-storetype', 'JKS',
    '-storepass', KEYSTORE_PASSWORD,
    '-keypass', KEY_PASSWORD,
    '-dname', KEY_DNAME
  ];
  const r = execTool(tc, tc.keytool, args);
  if (r.status !== 0 || !exists(KEYSTORE_PATH)) {
    throw new Error('keytool 生成 keystore 失败（退出码 ' + r.status + '）。'
      + '\n         常见原因：keystore 目录不可写、已存在同名但口令不同的文件（删掉 android/keystore/ 后重试）。');
  }
  console.log('  ✓ 已生成：' + toPosix(path.relative(PROJECT_ROOT, KEYSTORE_PATH))
    + '\n    （自签名证书，仅供本地调试与自用分发；口令写在 tools/build-apk.js 顶部常量里）');
  return KEYSTORE_PATH;
}

/* ==================== 步骤 7：签名 ==================== */
function signApk(tc, inputApk, keystorePath) {
  console.log('\n[7/8] 签名（apksigner sign）');
  mkdirp(OUT_DIR);
  fs.rmSync(OUT_APK, { force: true });

  const args = [
    'sign',
    '--ks', keystorePath,
    '--ks-key-alias', KEYSTORE_ALIAS,
    '--ks-pass', 'pass:' + KEYSTORE_PASSWORD,
    '--key-pass', 'pass:' + KEY_PASSWORD,
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--out', OUT_APK,
    inputApk
  ];
  const r = execWithJavaFallback(tc, tc.apksignerBat, ['-jar', tc.apksignerJar], args);
  if (r.status !== 0 || !exists(OUT_APK)) {
    throw new Error('apksigner 签名失败（退出码 ' + r.status + '）。'
      + '\n         常见原因：keystore 口令/别名不对；输入 APK 不是有效 ZIP（先看第 5 步输出）。');
  }
  console.log('  ✓ 已签名：' + toPosix(path.relative(PROJECT_ROOT, OUT_APK)) + '（' + fmtBytes(fs.statSync(OUT_APK).size) + '）');
  return OUT_APK;
}

/* ==================== 步骤 8：验证 ==================== */
function verifyApk(tc, apkPath) {
  console.log('\n[8/8] 验证签名与内容');

  const names = readZipFileList(apkPath);
  const required = ['AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'assets/index.html', 'assets/vendor/vexflow.js'];
  let ok = true;
  required.forEach(function (n) {
    const has = names.indexOf(n) >= 0;
    console.log('  ' + (has ? '✓' : '✗') + ' 包含 ' + n);
    if (!has) ok = false;
  });

  const verifyArgs = ['verify', '--verbose', '--print-certs', apkPath];
  const r = execWithJavaFallback(tc, tc.apksignerBat, ['-jar', tc.apksignerJar], verifyArgs);
  if (r.status !== 0) {
    console.log('  ✗ apksigner verify 未通过（退出码 ' + r.status + '）');
    ok = false;
  } else {
    console.log('  ✓ apksigner verify 通过（签名有效）');
  }

  /* 顺带打印 aapt2 dump badging 的关键行，方便肉眼核对 */
  const dump = execTool(tc, tc.aapt2, ['dump', 'badging', apkPath], { quiet: false });
  if (dump.status === 0) {
    const keep = /^(package:|sdkVersion:|targetSdkVersion:|uses-permission:|application-label:|application-icon-160:|launchable-activity:)/;
    const lines = dump.stdout.split(/\r?\n/).filter(function (l) { return keep.test(l.trim()); });
    if (lines.length) {
      console.log('  --- aapt2 dump badging 关键行 ---');
      lines.forEach(function (l) { console.log('    ' + l.trim()); });
    }
  } else {
    console.log('  [提示] aapt2 dump badging 未成功（不影响签名结论）');
  }
  return ok;
}

function readZipFileList(apkPath) {
  return listZipEntries(apkPath).map(function (e) { return e.name; });
}

/* ==================== 主流程 ==================== */
function main() {
  const opt = parseArgs(process.argv.slice(2));
  console.log('=== 读谱训练器 · Android APK 打包（纯手工构建，不用 Gradle） ===');
  console.log('应用：' + APP.appName + '   包名：' + APP.packageName
    + '   版本：' + APP.versionName + '（versionCode ' + APP.versionCode + '）'
    + '   minSdk ' + APP.minSdk + ' / targetSdk ' + APP.targetSdk);

  if (opt.help) { usage(); return 0; }

  const tc = makeToolchain(path.resolve(opt.tools));
  console.log('工具链根目录：' + tc.root);

  const missing = checkToolchain(tc);
  if (missing.length) {
    console.log('\n[错误] Android 工具链尚未就绪，缺少以下组件：');
    missing.forEach(function (m) { console.log('  ✗ ' + m); });
    console.log('\n  怎么修：');
    console.log('    1) 等待工具链下载/解压完成，然后用 Test-Path 确认上述文件都存在；');
    console.log('    2) 或者用 --tools <目录> 指定已有的工具链根目录；');
    console.log('    3) 期望的目录结构：');
    console.log('         <工具链根>/jdk/bin/java.exe, javac.exe, keytool.exe');
    console.log('         <工具链根>/build-tools/aapt2.exe, d8.bat, zipalign.exe, apksigner.bat, android.jar');
    console.log('         <工具链根>/build-tools/lib/d8.jar, lib/apksigner.jar');
    return 1;
  }
  console.log('工具链检查：✓ 全部就位');
  if (tc.androidJar && path.normalize(tc.androidJar) !== path.normalize(path.join(tc.buildTools, 'android.jar'))) {
    console.log('  （android.jar 取自 ' + toPosix(path.relative(tc.root, tc.androidJar)) + '）');
  }

  const t0 = Date.now();
  try {
    const assets = prepareAssets();
    const res = compileResources(tc);
    const classes = compileJava(tc, res.rJava);
    const dex = dexClasses(tc, classes);
    const unaligned = packageApk(dex);
    const aligned = alignApk(tc, unaligned);

    if (opt.skipSign) {
      const size = fs.statSync(aligned).size;
      console.log('\n=== 已按要求跳过签名（--skip-sign）===');
      console.log('  未签名 APK：' + aligned + '（' + fmtBytes(size) + '）');
      return 0;
    }

    console.log('\n[6b/8] 准备签名密钥');
    const keystore = ensureKeystore(tc);

    const signed = signApk(tc, aligned, keystore);
    const ok = verifyApk(tc, signed);

    const size = fs.statSync(signed).size;
    console.log('\n=== 构建结果 ===');
    console.log('  网页资源：' + assets.length + ' 个文件，' + fmtBytes(assets.reduce(function (s, f) { return s + f.bytes; }, 0)));
    console.log('  APK 体积：' + fmtBytes(size) + '（' + size + ' 字节）');
    console.log('  输出路径：' + signed);
    console.log('  用时：    ' + (Date.now() - t0) + 'ms');

    if (!ok) {
      console.log('\n=== 打包完成，但校验未全部通过 ✗ ===');
      return 1;
    }
    console.log('\n=== 打包成功 ✓ ===');
    console.log('  安装：adb install -r "' + signed + '"');
    console.log('  或把 APK 传到手机，在「设置 → 安全 → 未知来源」允许后点击安装。');
    return 0;
  } catch (err) {
    console.log('\n[错误] ' + (err && err.message ? err.message : err));
    console.log('  中间产物保留在 ' + toPosix(path.relative(PROJECT_ROOT, BUILD_DIR)) + '/，可据此排查。');
    return 1;
  }
}

process.exit(main());
