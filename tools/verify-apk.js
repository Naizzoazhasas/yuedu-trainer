#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — APK 自动化校验（零 npm 依赖，只用 node 内置模块）
 *
 * 校验项：
 *   1) aapt2 dump badging：包名 / versionCode / versionName / minSdk / targetSdk / 权限
 *   2) apksigner verify：签名有效（退出码必须为 0）
 *   3) 直接读 APK 的 ZIP 中央目录（不依赖任何第三方库）：
 *      必须含 assets/index.html 与 assets/vendor/vexflow.js
 *   4) APK 体积 < 20 MB
 *
 * 用法：
 *   node tools/verify-apk.js
 *   node tools/verify-apk.js --apk dist/android/yuedu-trainer.apk
 *   node tools/verify-apk.js --tools <工具链根目录>
 *
 * 退出码：全部通过 0；任一断言失败 1；
 *         工具链不存在时「优雅跳过」并返回 0（不会因为没装 SDK 就报错崩掉）。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { listZipEntries } = require('./zipreader');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/* 期望值：必须与 android/AndroidManifest.xml 和 tools/build-apk.js 里的常量一致 */
const EXPECT = {
  packageName: 'com.yuedu.trainer',
  versionName: '1.2.0',
  versionCode: 3,
  minSdk: 21,
  targetSdk: 34,
  permissions: ['android.permission.RECORD_AUDIO'],
  requiredEntries: ['AndroidManifest.xml', 'classes.dex', 'resources.arsc',
    'assets/index.html', 'assets/vendor/vexflow.js', 'assets/bridge.js'],
  maxBytes: 20 * 1024 * 1024
};

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

function parseArgs(argv) {
  const opt = {
    apk: path.join(PROJECT_ROOT, 'dist', 'android', 'yuedu-trainer.apk'),
    tools: process.env.YUEDU_ANDROID_TOOLCHAIN || process.env.YUEDU_ANDROID_TOOLS
      || path.resolve(PROJECT_ROOT, '..', '_tools', 'android')
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apk') opt.apk = argv[++i] || opt.apk;
    else if (a.indexOf('--apk=') === 0) opt.apk = a.slice(6);
    else if (a === '--tools') opt.tools = argv[++i] || opt.tools;
    else if (a.indexOf('--tools=') === 0) opt.tools = a.slice(8);
    else if (a === '--help' || a === '-h') {
      console.log('用法：node tools/verify-apk.js [--apk <路径>] [--tools <工具链根目录>]');
      process.exit(0);
    } else console.log('  [提示] 未知参数已忽略：' + a);
  }
  return opt;
}

/* ---------------- 工具链定位（与 tools/build-apk.js 一样自适应查找） ---------------- */
function findFirst(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    if (exists(candidates[i])) return candidates[i];
  }
  return null;
}
function subDirs(dir) {
  if (!isDir(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory(); })
      .map(function (e) { return path.join(dir, e.name); });
  } catch (e) { return []; }
}

function resolveTools(root) {
  const t = { root: root, missing: [] };

  /* JDK：jdk/bin 或 jdk/jdk-17.x.x/bin 或 <root>/jdk-17.x.x/bin */
  const jdkCands = [path.join(root, 'jdk', 'bin', 'java.exe')];
  subDirs(path.join(root, 'jdk')).forEach(function (d) { jdkCands.push(path.join(d, 'bin', 'java.exe')); });
  subDirs(root).filter(function (d) { return /^jdk/i.test(path.basename(d)); }).forEach(function (d) {
    jdkCands.push(path.join(d, 'bin', 'java.exe'));
    subDirs(d).forEach(function (s) { jdkCands.push(path.join(s, 'bin', 'java.exe')); });
  });
  t.javaExe = findFirst(jdkCands);
  t.jdkDir = t.javaExe ? path.dirname(path.dirname(t.javaExe)) : null;

  /* build-tools：build-tools/ 或 build-tools/<版本>/ */
  const btCands = [path.join(root, 'build-tools')];
  subDirs(path.join(root, 'build-tools')).forEach(function (d) { btCands.push(d); });
  subDirs(root).filter(function (d) { return /^build-tools/i.test(path.basename(d)); }).forEach(function (d) {
    btCands.push(d);
    subDirs(d).forEach(function (s) { btCands.push(s); });
  });
  const btDir = btCands.find(function (d) { return exists(path.join(d, 'aapt2.exe')); }) || null;
  if (btDir) {
    t.aapt2 = path.join(btDir, 'aapt2.exe');
    t.apksignerBat = path.join(btDir, 'apksigner.bat');
    t.apksignerJar = path.join(btDir, 'lib', 'apksigner.jar');
  }

  if (!t.aapt2) t.missing.push('build-tools/aapt2.exe');
  if (!t.apksignerBat && !(t.apksignerJar && t.javaExe)) {
    t.missing.push('apksigner（apksigner.bat 或 lib/apksigner.jar + java 都没有）');
  }
  return t;
}

/* ---------------- 命令行工具执行（.bat 走 cmd /c） ---------------- */
function childEnv(jdkDir) {
  const env = Object.assign({}, process.env);
  if (jdkDir) {
    env.JAVA_HOME = jdkDir;
    env.PATH = path.join(jdkDir, 'bin') + path.delimiter + (process.env.PATH || '');
  }
  return env;
}

function execTool(tools, bin, args) {
  let file = bin;
  let argv = args;
  if (/\.(bat|cmd)$/i.test(bin)) {
    file = process.env.ComSpec || 'cmd.exe';
    argv = ['/c', bin].concat(args);
  }
  const res = spawnSync(file, argv, {
    cwd: PROJECT_ROOT,
    env: childEnv(tools.jdkDir),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  return {
    status: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error || null
  };
}

/** 校验结果收集器 */
function makeReport() {
  const failures = [];
  const passes = [];
  return {
    ok: function (label) { passes.push(label); console.log('  ✓ ' + label); },
    bad: function (label) { failures.push(label); console.log('  ✗ ' + label); },
    assert: function (cond, label, detail) {
      if (cond) this.ok(label);
      else this.bad(label + (detail ? '　→ ' + detail : ''));
      return !!cond;
    },
    failures: failures,
    passes: passes
  };
}

/** 解析 aapt2 dump badging 的关键信息 */
function parseBadging(text) {
  const info = { permissions: [] };
  text.split(/\r?\n/).forEach(function (raw) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^package:\s+name='([^']*)'(.*)$/))) {
      info.packageName = m[1];
      const rest = m[2] || '';
      const vc = rest.match(/versionCode='([^']*)'/);
      const vn = rest.match(/versionName='([^']*)'/);
      if (vc) info.versionCode = vc[1];
      if (vn) info.versionName = vn[1];
    } else if ((m = line.match(/^sdkVersion:'([^']*)'/))) {
      info.minSdk = m[1];
    } else if ((m = line.match(/^targetSdkVersion:'([^']*)'/))) {
      info.targetSdk = m[1];
    } else if ((m = line.match(/^uses-permission:\s+name='([^']*)'/))) {
      info.permissions.push(m[1]);
    } else if ((m = line.match(/^application-label:'([^']*)'/))) {
      info.label = m[1];
    } else if ((m = line.match(/^launchable-activity:\s+name='([^']*)'/))) {
      info.launchableActivity = m[1];
    }
  });
  return info;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  console.log('=== 读谱训练器 · APK 校验 ===');
  console.log('  APK：' + opt.apk);

  const tools = resolveTools(path.resolve(opt.tools));

  /* ---------- 工具链不齐全：优雅跳过（不算失败） ---------- */
  if (tools.missing.length) {
    console.log('\n[跳过] 本机没有可用的 Android 工具链，跳过校验（这不是失败）：');
    tools.missing.forEach(function (t) { console.log('  - 缺少 ' + t); });
    console.log('  工具链根目录：' + tools.root);
    console.log('  原因：校验需要 aapt2 与 apksigner；工具链就绪后重新运行本脚本即可，');
    console.log('       也可以用 --tools <目录> 或环境变量 YUEDU_ANDROID_TOOLCHAIN 指定位置。');
    console.log('\n=== 校验跳过（exit 0）===');
    return 0;
  }

  /* ---------- APK 不存在：这是真失败 ---------- */
  if (!exists(opt.apk)) {
    console.log('\n[错误] 找不到 APK：' + opt.apk);
    console.log('  请先运行：node tools/build-apk.js');
    return 1;
  }

  const report = makeReport();
  const size = fs.statSync(opt.apk).size;

  /* ---------- 1) ZIP 内容（自己读中央目录，不依赖第三方库） ---------- */
  console.log('\n--- 1. APK 内容（读 ZIP 中央目录）---');
  let entries = [];
  try {
    entries = listZipEntries(opt.apk);
  } catch (e) {
    report.bad('APK 不是有效的 ZIP：' + e.message);
    console.log('\n=== 校验失败 ✗ ===');
    return 1;
  }
  const names = entries.map(function (e) { return e.name; });
  console.log('  ZIP 条目共 ' + names.length + ' 个');
  EXPECT.requiredEntries.forEach(function (need) {
    report.assert(names.indexOf(need) >= 0, '包含 ' + need, 'APK 里找不到该文件');
  });

  /* ---------- 2) 签名 ---------- */
  console.log('\n--- 2. 签名（apksigner verify）---');
  const verifyArgs = ['verify', '--verbose', '--print-certs', opt.apk];
  let sig;
  if (tools.apksignerBat && exists(tools.apksignerBat)) {
    sig = execTool(tools, tools.apksignerBat, verifyArgs);
  } else {
    sig = execTool(tools, tools.javaExe, ['-jar', tools.apksignerJar].concat(verifyArgs));
  }
  const sigText = (sig.stdout + sig.stderr).trim();
  if (sigText) sigText.split(/\r?\n/).forEach(function (l) { console.log('    | ' + l); });
  if (sig.error) console.log('    | 进程启动失败：' + sig.error.message);
  report.assert(sig.status === 0, 'apksigner verify 通过（退出码 0）', '退出码 ' + sig.status);
  if (/Verified using v2 scheme.*true/i.test(sigText)) report.ok('已使用 APK Signature Scheme v2 签名');

  /* ---------- 3) badging ---------- */
  console.log('\n--- 3. 清单信息（aapt2 dump badging）---');
  const dump = execTool(tools, tools.aapt2, ['dump', 'badging', opt.apk]);
  if (dump.status !== 0) {
    report.bad('aapt2 dump badging 执行失败（退出码 ' + dump.status + '）'
      + (dump.stderr ? '：' + dump.stderr.trim().split(/\r?\n/)[0] : ''));
  } else {
    const info = parseBadging(dump.stdout);
    console.log('  package=' + info.packageName + '  versionCode=' + info.versionCode
      + '  versionName=' + info.versionName);
    console.log('  minSdk=' + info.minSdk + '  targetSdk=' + info.targetSdk
      + '  label=' + (info.label || '（未读到）'));
    console.log('  权限：' + (info.permissions.length ? info.permissions.join('、') : '（无）'));

    report.assert(info.packageName === EXPECT.packageName, '包名是 ' + EXPECT.packageName,
      '实际 ' + info.packageName);
    report.assert(String(info.versionCode) === String(EXPECT.versionCode), 'versionCode 是 ' + EXPECT.versionCode,
      '实际 ' + info.versionCode);
    report.assert(String(info.versionName) === String(EXPECT.versionName), 'versionName 是 ' + EXPECT.versionName,
      '实际 ' + info.versionName);
    report.assert(String(info.minSdk) === String(EXPECT.minSdk), 'minSdkVersion 是 ' + EXPECT.minSdk,
      '实际 ' + info.minSdk);
    report.assert(String(info.targetSdk) === String(EXPECT.targetSdk), 'targetSdkVersion 是 ' + EXPECT.targetSdk,
      '实际 ' + info.targetSdk);
    EXPECT.permissions.forEach(function (p) {
      report.assert(info.permissions.indexOf(p) >= 0, '声明了权限 ' + p, '清单里没有这个权限');
    });
    /* 离线应用不该申请网络权限，这里只做提示，不算失败 */
    if (info.permissions.indexOf('android.permission.INTERNET') >= 0) {
      console.log('  [提示] 清单里声明了 INTERNET 权限（本应用离线运行并不需要）。');
    }
  }

  /* ---------- 4) 体积 ---------- */
  console.log('\n--- 4. 体积 ---');
  report.assert(size < EXPECT.maxBytes, 'APK 体积 < 20 MB（实际 ' + fmtBytes(size) + '）',
    '超过上限');

  /* ---------- 结论 ---------- */
  console.log('\n=== 校验结论 ===');
  console.log('  通过 ' + report.passes.length + ' 项，失败 ' + report.failures.length + ' 项');
  if (report.failures.length) {
    report.failures.forEach(function (f) { console.log('  ✗ ' + f); });
    console.log('\n=== 校验失败 ✗ ===');
    return 1;
  }
  console.log('  APK：' + opt.apk);
  console.log('  体积：' + fmtBytes(size) + '（' + size + ' 字节）');
  console.log('\n=== 校验全部通过 ✓ ===');
  return 0;
}

process.exit(main());
