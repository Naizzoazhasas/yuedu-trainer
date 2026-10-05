/* 读谱训练器 — 最小 ZIP 打包器（纯 node，无第三方依赖）
 *
 * 为什么不用系统的 tar/Compress-Archive：
 *   - Windows 自带的 bsdtar 在写中文文件名时会落到当前 OEM 代码页，解压后变成乱码；
 *   - PowerShell 的 Compress-Archive 对大目录慢且同样有编码坑。
 * 这里直接按 ZIP 规范写字节，并设置通用位标志的第 11 位（EFS，UTF-8 文件名），
 * 解压工具就会按 UTF-8 解释文件名，中文不会再乱码。
 *
 * 用法：
 *   var zip = new ZipWriter();
 *   zip.addFile('src/app.js', buffer);
 *   zip.addDirectoryFiles(rootDir, '', { exclude: [...] });
 *   fs.writeFileSync('out.zip', zip.toBuffer());
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* 把 JS Date 转成 DOS 时间（ZIP 用） */
function dosDateTime(date) {
  var d = date || new Date();
  var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
  var day = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  return { time: time, date: day };
}

function ZipWriter(opts) {
  this.entries = [];
  this.compress = !(opts && opts.store);
  this.level = (opts && opts.level) !== undefined ? opts.level : 9;
}

ZipWriter.prototype.addFile = function (name, data, mtime) {
  var buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  var nameBuf = Buffer.from(name, 'utf8');
  var dt = dosDateTime(mtime);
  var method = 0;
  var stored = buf;
  if (this.compress && buf.length > 64) {
    var deflated = zlib.deflateRawSync(buf, { level: this.level });
    if (deflated.length < buf.length) {
      stored = deflated;
      method = 8;
    }
  }
  this.entries.push({
    name: name,
    nameBuf: nameBuf,
    crc: crc32(buf),
    size: buf.length,
    compressed: stored.length,
    method: method,
    data: stored,
    time: dt.time,
    date: dt.date
  });
};

ZipWriter.prototype.addText = function (name, text, mtime) {
  this.addFile(name, Buffer.from(String(text), 'utf8'), mtime);
};

/* 递归添加一个目录下的文件；rel 是相对顶层的前缀 */
ZipWriter.prototype.addDirectoryFiles = function (rootDir, rel, options) {
  options = options || {};
  var excludeDirs = options.excludeDirs || [];
  var excludeFiles = options.excludeFiles || [];
  var excludeRe = options.excludeRe || null;
  var self = this;
  var base = rel ? path.join(rootDir, rel) : rootDir;
  var entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); }
  catch (e) { return; }
  entries.forEach(function (ent) {
    var r = rel ? rel + '/' + ent.name : ent.name;
    if (excludeRe && excludeRe.test(r)) return;
    if (ent.isDirectory()) {
      if (excludeDirs.indexOf(r) >= 0 || excludeDirs.indexOf(ent.name) >= 0) return;
      self.addDirectoryFiles(rootDir, r, options);
    } else {
      if (excludeFiles.indexOf(r) >= 0 || excludeFiles.indexOf(ent.name) >= 0) return;
      var full = path.join(rootDir, r);
      var stat;
      try { stat = fs.statSync(full); } catch (e2) { return; }
      if (!stat.isFile()) return;
      self.addFile(r, fs.readFileSync(full), stat.mtime);
    }
  });
  return this;
};

ZipWriter.prototype.count = function () { return this.entries.length; };

ZipWriter.prototype.toBuffer = function () {
  var chunks = [];
  var central = [];
  var offset = 0;
  var self = this;

  this.entries.forEach(function (e) {
    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);          // 本地文件头签名
    local.writeUInt16LE(20, 4);                  // 解压所需版本 2.0
    local.writeUInt16LE(0x0800, 6);              // 通用位标志：第 11 位 = UTF-8 文件名
    local.writeUInt16LE(e.method, 8);            // 压缩方法
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compressed, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(e.nameBuf.length, 26);
    local.writeUInt16LE(0, 28);                  // 扩展字段长度
    chunks.push(local, e.nameBuf, e.data);

    var cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);            // 中央目录签名
    cen.writeUInt16LE(20, 4);                    // 创建版本
    cen.writeUInt16LE(20, 6);                    // 解压所需版本
    cen.writeUInt16LE(0x0800, 8);                // UTF-8 标志
    cen.writeUInt16LE(e.method, 10);
    cen.writeUInt16LE(e.time, 12);
    cen.writeUInt16LE(e.date, 14);
    cen.writeUInt32LE(e.crc, 16);
    cen.writeUInt32LE(e.compressed, 20);
    cen.writeUInt32LE(e.size, 24);
    cen.writeUInt16LE(e.nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);                    // 扩展字段
    cen.writeUInt16LE(0, 32);                    // 注释
    cen.writeUInt16LE(0, 34);                    // 磁盘号
    cen.writeUInt16LE(0, 36);                    // 内部属性
    cen.writeUInt32LE(0, 38);                    // 外部属性
    cen.writeUInt32LE(offset, 42);               // 本地头偏移
    central.push(cen, e.nameBuf);

    offset += local.length + e.nameBuf.length + e.data.length;
  });

  var centralBuf = Buffer.concat(central);
  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);             // 中央目录结束签名
  eocd.writeUInt16LE(0, 4);                      // 本磁盘号
  eocd.writeUInt16LE(0, 6);                      // 中央目录起始磁盘
  eocd.writeUInt16LE(self.entries.length, 8);
  eocd.writeUInt16LE(self.entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);     // 中央目录大小
  eocd.writeUInt32LE(offset, 16);                // 中央目录偏移
  eocd.writeUInt16LE(0, 20);                     // 注释长度

  return Buffer.concat(chunks.concat([centralBuf, eocd]));
};

ZipWriter.prototype.writeTo = function (file) {
  fs.writeFileSync(file, this.toBuffer());
  return fs.statSync(file).size;
};

module.exports = {
  ZipWriter: ZipWriter,
  crc32: crc32,
  writeZip: function (file, addFn, opts) {
    var z = new ZipWriter(opts);
    addFn(z);
    return z.writeTo(file);
  }
};
