/* 读谱训练器 — 生成 Windows 图标 icons/yuedu.ico
 *
 * 纯 node，不依赖任何第三方库：
 *   1. 解码源 PNG（zlib.inflateSync + 逐行反滤波，支持 8 位灰度/RGB/调色板/灰度+Alpha/RGBA）；
 *   2. 用盒式（box）滤波缩放到 16/24/32/48/64/128/256；
 *   3. 重新编码为 PNG（zlib.deflateSync）；
 *   4. 按 ICONDIR / ICONDIRENTRY 结构包成 .ico。
 *
 * Windows 的 .ico 允许直接内嵌 PNG（Vista 之后），所以不需要 BMP/DIB 那套。
 * 宽高字段是单字节，256 记作 0。
 *
 * 运行： node tools/gen-ico.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.join(__dirname, '..');
var ICONS = path.join(ROOT, 'icons');
var OUT = path.join(ICONS, 'yuedu.ico');

var TARGET_SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ==================== PNG 解码 ==================== */

function pngSize(buf) {
  if (buf.length < 24) return null;
  var sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (var i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) return null;
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** 解码 PNG -> { w, h, rgba: Buffer(w*h*4) } */
function decodePng(buf) {
  if (!pngSize(buf)) throw new Error('不是 PNG');
  var pos = 8;
  var width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  var idat = [];
  var palette = null, trns = null;

  while (pos + 8 <= buf.length) {
    var len = buf.readUInt32BE(pos);
    var type = buf.toString('latin1', pos + 4, pos + 8);
    var data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;           // 4 长度 + 4 类型 + 数据 + 4 CRC
  }

  if (interlace !== 0) throw new Error('不支持隔行扫描（interlace）的 PNG');
  if (bitDepth !== 8) throw new Error('只支持 8 位深的 PNG，实际 ' + bitDepth);

  var channels;
  if (colorType === 0) channels = 1;        // 灰度
  else if (colorType === 2) channels = 3;   // RGB
  else if (colorType === 3) channels = 1;   // 调色板
  else if (colorType === 4) channels = 2;   // 灰度 + Alpha
  else if (colorType === 6) channels = 4;   // RGBA
  else throw new Error('不支持的颜色类型 ' + colorType);

  var raw = zlib.inflateSync(Buffer.concat(idat));
  var stride = width * channels;
  var out = Buffer.alloc(height * stride);
  var prev = Buffer.alloc(stride);

  var p = 0;
  for (var y = 0; y < height; y++) {
    var filter = raw[p++];
    var line = raw.slice(p, p + stride);
    p += stride;
    var cur = Buffer.from(line);
    var bpp = channels;

    for (var i = 0; i < stride; i++) {
      var a = i >= bpp ? cur[i - bpp] : 0;
      var b = prev[i];
      var c = i >= bpp ? prev[i - bpp] : 0;
      var x = cur[i];
      if (filter === 1) x = (x + a) & 0xFF;
      else if (filter === 2) x = (x + b) & 0xFF;
      else if (filter === 3) x = (x + ((a + b) >> 1)) & 0xFF;
      else if (filter === 4) {
        var pp = a + b - c;
        var pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        var pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        x = (x + pr) & 0xFF;
      }
      cur[i] = x;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }

  /* 统一转成 RGBA */
  var rgba = Buffer.alloc(width * height * 4);
  for (var q = 0; q < width * height; q++) {
    var r, g, bl, al = 255;
    if (colorType === 0) {
      r = g = bl = out[q];
    } else if (colorType === 2) {
      r = out[q * 3]; g = out[q * 3 + 1]; bl = out[q * 3 + 2];
    } else if (colorType === 3) {
      var idx = out[q];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; bl = palette[idx * 3 + 2];
      if (trns && idx < trns.length) al = trns[idx];
    } else if (colorType === 4) {
      r = g = bl = out[q * 2]; al = out[q * 2 + 1];
    } else {
      r = out[q * 4]; g = out[q * 4 + 1]; bl = out[q * 4 + 2]; al = out[q * 4 + 3];
    }
    rgba[q * 4] = r; rgba[q * 4 + 1] = g; rgba[q * 4 + 2] = bl; rgba[q * 4 + 3] = al;
  }
  return { w: width, h: height, rgba: rgba };
}

/* ==================== 缩放（盒式滤波，带 Alpha 加权） ==================== */

function resize(src, sw, sh, dw, dh) {
  var out = Buffer.alloc(dw * dh * 4);
  var xr = sw / dw, yr = sh / dh;
  for (var y = 0; y < dh; y++) {
    var y0 = Math.floor(y * yr), y1 = Math.min(sh, Math.ceil((y + 1) * yr));
    for (var x = 0; x < dw; x++) {
      var x0 = Math.floor(x * xr), x1 = Math.min(sw, Math.ceil((x + 1) * xr));
      var r = 0, g = 0, b = 0, a = 0, n = 0, wsum = 0;
      for (var sy = y0; sy < y1; sy++) {
        for (var sx = x0; sx < x1; sx++) {
          var i = (sy * sw + sx) * 4;
          var al = src[i + 3] / 255;
          /* 预乘 Alpha 后再平均，避免边缘出现黑边 */
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al;
          a += src[i + 3];
          wsum += al;
          n++;
        }
      }
      var o = (y * dw + x) * 4;
      if (n === 0) { out[o] = out[o + 1] = out[o + 2] = 0; out[o + 3] = 0; continue; }
      out[o] = wsum > 0 ? Math.round(r / wsum) : 0;
      out[o + 1] = wsum > 0 ? Math.round(g / wsum) : 0;
      out[o + 2] = wsum > 0 ? Math.round(b / wsum) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ==================== PNG 编码 ==================== */

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var typeBuf = Buffer.from(type, 'latin1');
  var crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, w, h) {
  /* 每行前面加一个 filter 字节 0（None） */
  var stride = w * 4;
  var raw = Buffer.alloc(h * (stride + 1));
  for (var y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // color type: RGBA
  ihdr[10] = 0;     // compression
  ihdr[11] = 0;     // filter
  ihdr[12] = 0;     // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ==================== 主流程 ==================== */

function main() {
  if (!fs.existsSync(ICONS)) {
    console.error('找不到 icons/ 目录');
    process.exit(1);
  }
  var files = fs.readdirSync(ICONS).filter(function (f) { return /\.png$/i.test(f); });
  /* 选最大的那张作为源（缩小时质量最好） */
  var src = null;
  files.forEach(function (f) {
    var buf = fs.readFileSync(path.join(ICONS, f));
    var s = pngSize(buf);
    if (!s) { console.log('  跳过（不是合法 PNG）：' + f); return; }
    if (!src || s.w > src.w) { src = { file: f, buf: buf, w: s.w, h: s.h }; }
  });
  if (!src) {
    console.error('icons/ 里没有可用的 PNG');
    process.exit(1);
  }
  console.log('源图：' + src.file + '  ' + src.w + 'x' + src.h);

  var decoded = decodePng(src.buf);
  console.log('已解码为 RGBA：' + decoded.w + 'x' + decoded.h);

  var images = [];
  TARGET_SIZES.forEach(function (size) {
    if (size > decoded.w) return;             // 不放大
    var rgba = (size === decoded.w)
      ? decoded.rgba
      : resize(decoded.rgba, decoded.w, decoded.h, size, size);
    images.push({ size: size, png: encodePng(rgba, size, size) });
  });
  if (!images.length) {
    var one = encodePng(decoded.rgba, decoded.w, decoded.h);
    images.push({ size: decoded.w, png: one });
  }

  var count = images.length;
  var header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  var offset = 6 + 16 * count;
  var entries = [];
  images.forEach(function (im) {
    var e = Buffer.alloc(16);
    e.writeUInt8(im.size >= 256 ? 0 : im.size, 0);
    e.writeUInt8(im.size >= 256 ? 0 : im.size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(im.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += im.png.length;
    entries.push(e);
  });

  var out = Buffer.concat([header].concat(entries).concat(images.map(function (i) { return i.png; })));
  fs.writeFileSync(OUT, out);

  console.log('已生成 ' + path.relative(ROOT, OUT));
  console.log('  内嵌尺寸：' + images.map(function (i) { return i.size + 'x' + i.size; }).join('、'));
  console.log('  文件大小：' + (out.length / 1024).toFixed(1) + ' KB');
}

main();
