#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — 最小 ZIP 读取器（纯 node，无第三方依赖）
 *
 * 为什么需要它：
 *   APK 本质上就是一个 ZIP。打包时我们要把 aapt2 产出的 resources.ap_
 *   （里面是二进制 AndroidManifest.xml、resources.arsc 与 res/**）取出来
 *   重新组装进最终 APK；校验时又要读中央目录来确认 assets/ 确实打进去了。
 *   项目约定「零 npm 依赖」，所以这里按 ZIP 规范手写一个最小实现。
 *
 * 支持范围（够用即可）：
 *   - 读中央目录（ZIP32，不支持 ZIP64 —— APK 远小于 4 GB）；
 *   - 存储（方法 0）与 deflate（方法 8）两种压缩方法；
 *   - UTF-8 文件名（第 11 位通用标志）。
 *
 * 用法：
 *   const { listZipEntries, readZipEntry, readZipFile } = require('./zipreader');
 *   listZipEntries('a.apk')                  // -> [{ name, method, size, ... }, ...]
 *   readZipEntry('a.apk', 'classes.dex')     // -> Buffer | null
 * ============================================================ */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;   // 中央目录结束记录
const CEN_SIG = 0x02014b50;    // 中央目录文件头
const LOC_SIG = 0x04034b50;    // 本地文件头

/** 从尾部向前查找「中央目录结束记录」（最多回退 64 KB + 22 字节的注释区） */
function findEndOfCentralDirectory(buf) {
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * 读取 ZIP 的条目列表（按中央目录顺序）。
 * @param {string|Buffer} file 文件路径，或已读入内存的 Buffer
 * @returns {Array<{name:string, method:number, compressedSize:number,
 *                 size:number, localHeaderOffset:number, crc:number}>}
 */
function listZipEntries(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('不是有效的 ZIP/APK：找不到中央目录结束记录');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) {
      throw new Error('ZIP 中央目录损坏（第 ' + i + ' 条记录签名不匹配）');
    }
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const nameBuf = buf.slice(offset + 46, offset + 46 + nameLen);
    const utf8 = (flags & 0x800) !== 0;
    const name = utf8 ? nameBuf.toString('utf8') : nameBuf.toString('utf8'); // APK 一律按 UTF-8 处理

    entries.push({
      name: name.replace(/\\/g, '/'),
      method: method,
      crc: crc,
      compressedSize: compressedSize,
      size: size,
      localHeaderOffset: localHeaderOffset,
      isDirectory: /\/$/.test(name)
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 取出单个条目的原始数据（已解压）。找不到返回 null。 */
function readZipEntry(file, name) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const entries = listZipEntries(buf);
  const want = String(name).replace(/\\/g, '/');
  const entry = entries.find(function (e) { return e.name === want; });
  if (!entry) return null;
  return extractEntry(buf, entry);
}

/** 按中央目录里记录的偏移与长度解出条目内容 */
function extractEntry(buf, entry) {
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error('ZIP 本地文件头损坏：' + entry.name);
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buf.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的 ZIP 压缩方法 ' + entry.method + '（' + entry.name + '）');
}

/** 一次性读出「条目名 -> Buffer」的映射，便于打包脚本整体搬运 */
function readZipFile(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const out = new Map();
  listZipEntries(buf).forEach(function (e) {
    if (e.isDirectory) return;
    out.set(e.name, extractEntry(buf, e));
  });
  return out;
}

module.exports = {
  listZipEntries: listZipEntries,
  readZipEntry: readZipEntry,
  readZipFile: readZipFile
};
