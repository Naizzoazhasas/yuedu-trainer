#!/usr/bin/env node
/* ============================================================
 * 读谱训练器 — 图标生成脚本（零依赖，仅 node 内置模块 fs/path/zlib）
 *
 * 用途：程序化绘制并写出 PWA 图标
 *        icons/icon-192.png
 *        icons/icon-512.png
 *
 * 为什么手写 PNG：本项目不允许引入任何 npm 依赖，因此这里自己构造
 * PNG 字节流（签名 + IHDR + IDAT + IEND），像素用「超采样 + 平均」
 * 做抗锯齿，压缩用 node 内置 zlib.deflateSync，CRC32 自己算。
 *
 * 用法： node tools/gen-icons.js
 * 幂等： 重复运行会覆盖同名文件，结果完全一致。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'icons');

/* 配色（与 manifest / sw 中保持一致） */
const BG = [0x0f, 0x14, 0x20];      /* #0f1420 深色底 */
const INK = [0x4d, 0x8d, 0xff];     /* #4d8dff 亮蓝主色 */
const STAFF = [0x35, 0x5c, 0xa8];   /* 五线谱线：主色的暗一档 */

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- PNG 组装 ---------------- */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/* rgba: Buffer，长度 = w*h*4 */
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   /* 位深 */
  ihdr[9] = 6;   /* 颜色类型 6 = RGBA */
  ihdr[10] = 0;  /* 压缩方法 */
  ihdr[11] = 0;  /* 滤波方法 */
  ihdr[12] = 0;  /* 非隔行 */

  /* 每行前面加一个滤波字节 0（None） */
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- 几何辅助（全部用归一化 0..1 坐标） ---------------- */
function inRoundedRect(x, y, r) {
  /* 铺满画布的圆角方形：四角按半径 r 做圆角 */
  if (x >= r && x <= 1 - r) return true;
  if (y >= r && y <= 1 - r) return true;
  const cx = x < r ? r : 1 - r;
  const cy = y < r ? r : 1 - r;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/* 旋转椭圆的内部判定：把点反向旋转回轴对齐再判断 */
function inRotatedEllipse(x, y, cx, cy, rx, ry, angle) {
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const dx = x - cx, dy = y - cy;
  const ux = dx * cos - dy * sin;
  const uy = dx * sin + dy * cos;
  return (ux * ux) / (rx * rx) + (uy * uy) / (ry * ry) <= 1;
}

/* 用「点到折线距离」近似一条有粗细的曲线（符尾） */
function nearPolyline(x, y, pts, halfWidth) {
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
    const vx = bx - ax, vy = by - ay;
    const wx = x - ax, wy = y - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const px = ax + t * vx - x, py = ay + t * vy - y;
    if (px * px + py * py <= halfWidth * halfWidth) return true;
  }
  return false;
}

/* 二次贝塞尔采样 */
function quadBezier(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    out.push([
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
    ]);
  }
  return out;
}

/* ---------------- 图标绘制 ----------------
 * 图案：深色圆角方底 + 5 条五线谱线 + 一个带符干与符尾的音符
 * 返回 [r,g,b,a]，a 为 0..1 的覆盖度（超采样平均后使用）
 */
const FLAG = quadBezier([0.455, 0.315], [0.625, 0.245], [0.575, 0.435], 28);

function sample(x, y) {
  /* 背景（圆角方） */
  if (!inRoundedRect(x, y, 0.22)) return null;

  let color = BG;
  const lineX0 = 0.155, lineX1 = 0.845;
  const lineH = 0.016;

  /* 五线谱：5 条水平线，纵向居中分布 */
  for (let i = 0; i < 5; i++) {
    const cy = 0.335 + i * 0.0825;
    if (y >= cy - lineH / 2 && y <= cy + lineH / 2 && x >= lineX0 && x <= lineX1) color = STAFF;
  }

  /* 符干（矩形） */
  if (inRect(x, y, 0.452, 0.285, 0.487, 0.700)) color = INK;

  /* 符尾（一条短曲线） */
  if (nearPolyline(x, y, FLAG, 0.021)) color = INK;

  /* 符头（旋转椭圆） */
  if (inRotatedEllipse(x, y, 0.372, 0.700, 0.098, 0.070, -0.36)) color = INK;

  return color;
}

function renderRGBA(size, ss) {
  const w = size, h = size;
  const buf = Buffer.alloc(w * h * 4);
  const inv = 1 / (ss * ss);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / w;
          const y = (py + (sy + 0.5) / ss) / h;
          const c = sample(x, y);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const o = (py * w + px) * 4;
      if (a > 0) {
        /* 颜色按覆盖像素数求平均，alpha 为覆盖率 */
        buf[o] = Math.round(r / a);
        buf[o + 1] = Math.round(g / a);
        buf[o + 2] = Math.round(b / a);
        buf[o + 3] = Math.round(255 * a * inv);
      }
    }
  }
  return buf;
}

/* ---------------- 反向校验 ---------------- */
function verifyPNG(file, expectSize) {
  const buf = fs.readFileSync(file);
  const problems = [];
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) problems.push('PNG 签名不正确');

  /* 遍历 chunk，取出 IHDR 与 IDAT */
  let pos = 8, w = 0, h = 0, colorType = -1, idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (w !== expectSize || h !== expectSize) problems.push('尺寸不是 ' + expectSize + '×' + expectSize + '（实际 ' + w + '×' + h + '）');
  if (colorType !== 6) problems.push('颜色类型不是 RGBA(6)');

  /* 用 zlib 反解 IDAT，核对像素字节数 */
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const expectBytes = h * (1 + w * 4);
  if (raw.length !== expectBytes) problems.push('解压后字节数 ' + raw.length + ' ≠ 期望 ' + expectBytes);

  /* 抽查像素：中心偏左上（符干附近）应为亮蓝，最左上角应为透明 */
  const px = (x, y) => {
    const o = y * (1 + w * 4) + 1 + x * 4;
    return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]];
  };
  const stem = px(Math.round(w * 0.468), Math.round(h * 0.5));
  if (!(stem[3] > 200 && stem[2] > 150)) problems.push('符干位置像素不是亮蓝（got ' + stem.join(',') + '）');
  const corner = px(1, 1);
  if (corner[3] > 8) problems.push('左上角应为透明圆角（got alpha=' + corner[3] + '）');

  return { problems: problems, bytes: buf.length, w: w, h: h };
}

/* ---------------- 主流程 ---------------- */
function main() {
  console.log('=== 读谱训练器 · 图标生成 ===');
  console.log('用途：程序化手写 PNG（零依赖），生成 PWA 所需的两枚图标。\n');

  fs.mkdirSync(ICON_DIR, { recursive: true });

  const targets = [
    { size: 192, file: path.join(ICON_DIR, 'icon-192.png'), ss: 4 },
    { size: 512, file: path.join(ICON_DIR, 'icon-512.png'), ss: 3 }
  ];

  let bad = 0;
  targets.forEach(function (t) {
    const t0 = Date.now();
    const rgba = renderRGBA(t.size, t.ss);
    const png = encodePNG(t.size, t.size, rgba);
    fs.writeFileSync(t.file, png);
    const v = verifyPNG(t.file, t.size);
    const rel = path.relative(ROOT, t.file).split(path.sep).join('/');
    console.log('  ' + rel + '  ' + v.w + '×' + v.h + '  ' + png.length + ' 字节  用时 ' + (Date.now() - t0) + 'ms');
    if (v.problems.length) {
      bad++;
      v.problems.forEach(function (p) { console.log('    ✗ ' + p); });
    } else {
      console.log('    ✓ PNG 签名 / IHDR / IDAT(zlib 反解) / 像素抽查 全部通过');
    }
    if (png.length <= 200) { bad++; console.log('    ✗ 文件过小（≤200 字节）'); }
  });

  console.log('\n=== ' + (bad ? '失败 ' + bad + ' 项 ✗' : '全部通过 ✓') + ' ===');
  process.exit(bad ? 1 : 0);
}

main();
