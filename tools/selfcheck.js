#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — 一键自检（零依赖，仅 node 内置模块 child_process/fs/path）
 *
 * 用途：依次运行 tools/ 下的所有测试脚本，汇总通过 / 失败，最后给出总表与总结论。
 *       逐个运行的脚本为：
 *         test-theory.js   test-generator.js   test-render.js
 *         以及所有匹配 tools/_t_*.js 的脚本（例如 _t_engine.js）
 *       文件不存在时打印 [缺失] 并跳过，不视为失败。
 *
 * 已知环境怪癖：本机 node 在 child_process 使用默认 stdio:'pipe' 捕获子进程输出时
 * 可能因沙箱限制报 EPERM。因此这里**优先**用 stdio:'inherit' 直接透传输出；
 * 只有在需要拿到失败脚本的「最后几行输出」时才尝试捕获，且捕获失败会自动降级，
 * 绝不让自检本身因为捕获不到输出而崩溃。
 *
 * 用法： node tools/selfcheck.js
 * 退出码：全部通过 0，有失败 1。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(__dirname);
const NODE = process.execPath;
const TIMEOUT_MS = 180000;

const NAMED = ['test-theory.js', 'test-generator.js', 'test-render.js', 'test-app.js',
  'verify-build.js', 'verify-single.js', 'verify-vexflow.js', 'verify-apk.js'];

/* 扫描 tools/_t_*.js 以及其它 test-*.js（glob 风格：以 _t_ 或 test- 开头、以 .js 结尾） */
function scanUnderscoreTests() {
  let names = [];
  try {
    names = fs.readdirSync(TOOLS);
  } catch (e) {
    return [];
  }
  return names
    .filter(function (n) { return /^(_t_|test-).*\.js$/.test(n); })
    .filter(function (n) { return fs.statSync(path.join(TOOLS, n)).isFile(); })
    .sort();
}

function listTests() {
  const out = [];
  NAMED.forEach(function (n) { out.push(n); });
  scanUnderscoreTests().forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
  return out;
}

/* 主运行：输出直接透传（最稳，不会触发 EPERM） */
function runInherit(file) {
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(NODE, [file], { cwd: ROOT, stdio: 'inherit', env: process.env, timeout: TIMEOUT_MS });
  } catch (e) {
    return { file: file, name: path.basename(file), ok: false, code: null, ms: Date.now() - t0, note: 'spawn 异常：' + e.message, tail: [] };
  }
  const ms = Date.now() - t0;
  if (r.error) {
    return { file: file, name: path.basename(file), ok: false, code: null, ms: ms, note: 'spawn 失败：' + r.error.message, tail: [] };
  }
  const timedOut = r.signal === 'SIGTERM' || r.status === null;
  const code = timedOut ? null : r.status;
  return {
    file: file,
    name: path.basename(file),
    ok: code === 0,
    code: code,
    ms: ms,
    note: timedOut ? '超时或异常终止（' + (r.signal || 'no-status') + '）' : '',
    tail: []
  };
}

/* 仅在需要失败详情时才尝试捕获输出；捕获不可用时返回 null，由调用方降级 */
function captureTail(file) {
  try {
    const r = spawnSync(NODE, [file], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (r.error) return null;
    const text = String(r.stdout || '') + String(r.stderr || '');
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    return lines.slice(-8);
  } catch (e) {
    /* 典型情况：沙箱下 pipe 报 EPERM —— 直接降级 */
    return null;
  }
}

function pad(s, n) {
  s = String(s);
  let w = 0;
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}

function main() {
  console.log('=== 读谱训练器 · 一键自检 ===');
  console.log('用途：依次运行 tools/ 下的测试脚本（test-*.js 与 _t_*.js），汇总结果。\n');

  const tests = listTests();
  if (tests.length === 0) {
    console.log('  [缺失] tools/ 下没有找到任何测试脚本，无事可做。');
    return 0;
  }

  const missing = [];
  const results = [];

  tests.forEach(function (name, i) {
    const abs = path.join(TOOLS, name);
    console.log('\n──────── [' + (i + 1) + '/' + tests.length + '] ' + name + ' ────────');
    if (!fs.existsSync(abs)) {
      console.log('  [缺失] ' + name + ' —— 跳过');
      missing.push(name);
      return;
    }
    const res = runInherit(abs);
    if (!res.ok) {
      /* 失败时才尝试拿「最后几行输出」用于汇总；捕获失败就只报退出码 */
      const tail = captureTail(abs);
      res.tail = tail || [];
      res.note = res.note || (tail === null ? '（本机不支持捕获子进程输出，请看上方实时日志）' : '');
    }
    console.log('  → ' + (res.ok ? '通过 ✓' : '失败 ✗') + '  退出码 ' + (res.code === null ? '无' : res.code) + '  用时 ' + res.ms + 'ms');
    results.push(res);
  });

  /* ---------- 总表 ---------- */
  const failed = results.filter(function (r) { return !r.ok; });
  console.log('\n\n==================== 自检总表 ====================');
  console.log('  ' + pad('脚本', 26) + pad('结果', 10) + pad('退出码', 10) + '耗时');
  console.log('  ' + '-'.repeat(56));
  results.forEach(function (r) {
    console.log('  ' + pad(r.name, 26) + pad(r.ok ? '通过 ✓' : '失败 ✗', 10) +
      pad(r.code === null ? '-' : r.code, 10) + r.ms + 'ms');
  });
  missing.forEach(function (m) {
    console.log('  ' + pad(m, 26) + pad('缺失 -', 10) + pad('-', 10) + '-');
  });

  if (failed.length) {
    console.log('\n---------------- 失败详情（最后几行输出） ----------------');
    failed.forEach(function (r) {
      console.log('\n  ✗ ' + r.name + '  退出码 ' + (r.code === null ? '无' : r.code) + (r.note ? '  ' + r.note : ''));
      if (r.tail.length) r.tail.forEach(function (l) { console.log('      ' + l); });
      else if (!r.note) console.log('      （无输出）');
    });
  }

  const totalMs = results.reduce(function (s, r) { return s + r.ms; }, 0);
  console.log('\n==================== 结论 ====================');
  console.log('  运行 ' + results.length + ' 个，通过 ' + (results.length - failed.length) +
    ' 个，失败 ' + failed.length + ' 个' + (missing.length ? '，缺失跳过 ' + missing.length + ' 个' : ''));
  console.log('  总耗时：' + totalMs + 'ms');
  console.log('  ' + (failed.length ? '自检未通过 ✗' : '全部通过 ✓'));
  return failed.length ? 1 : 0;
}

process.exit(main());
