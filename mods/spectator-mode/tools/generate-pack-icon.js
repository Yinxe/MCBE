// 生成 spectator-mode 行为包图标:32×32 逻辑像素画 → 4 倍最近邻放大为 128×128 RGBA PNG
//
// 用法(在 mods/spectator-mode 下):
//   npm run generate:icon
// 或直接指定输出路径:
//   node tools/generate-pack-icon.js <输出路径>
//
// 图标是静态资源,不在构建期生成;本脚本用于重新生成或调整构图后重出图。
// 构图语义:下方人形(真身)+ 上方飘离的幽灵(灵魂)+ 中间渐隐光点(移动轨迹)+
// 外围虚线圆环(最大距离)。刻意保持「一主体 + 一符号」,小尺寸下不糊。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const SIZE = 32;
const SCALE = 4;
// 11 色色板(控制在 design 约定的 8–12 色)
const C = {
  bg: [0x15, 0x16, 0x1f, 255], // 背景:暗靛
  bgGlow: [0x22, 0x24, 0x33, 255], // 背景微光(近主体,衬托轮廓)
  ring: [0x3a, 0x55, 0x80, 255], // 距离环:暗蓝
  ringLight: [0x6f, 0x9f, 0xd8, 255], // 距离环高亮段
  body: [0xcf, 0xd6, 0xe4, 255], // 真身:浅灰白
  bodyDark: [0x8b, 0x96, 0xac, 255], // 真身暗面
  soul: [0x7f, 0xe8, 0xd8, 255], // 灵魂:青
  soulLight: [0xcc, 0xff, 0xf4, 255], // 灵魂高光
  trail: [0x4f, 0xb8, 0xad, 255], // 轨迹:中青
  trailDim: [0x2c, 0x74, 0x6f, 255], // 轨迹:暗青
  spark: [0xff, 0xe9, 0x8a, 255], // 光点:暖黄
};
const pixels = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) setPixel(x, y, color);
  }
}

/** 实心圆(cx, cy 为中心,整数格点) */
function fillCircle(cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(x, y, color);
    }
  }
}

/** 虚线圆环:每 2 度采样,连续 2 段实、2 段空,交替两种颜色 */
function dashedRing(cx, cy, radius, colorA, colorB) {
  for (let deg = 0; deg < 360; deg += 2) {
    const dashIndex = Math.floor(deg / 2) % 8;
    if (dashIndex >= 4) continue; // 空隙
    const rad = (deg * Math.PI) / 180;
    const x = Math.round(cx + radius * Math.cos(rad));
    const y = Math.round(cy + radius * Math.sin(rad));
    setPixel(x, y, dashIndex < 2 ? colorA : colorB);
  }
}

// ---- 背景 ----
fillRect(0, 0, SIZE - 1, SIZE - 1, C.bg);

// ---- 外围虚线距离环(半径 13,靠近边缘但不裁切) ----
dashedRing(16, 16, 13, C.ringLight, C.ring);

// ---- 背景微光:主体周围一圈淡色,让轮廓从暗背景里跳出来 ----
fillCircle(16, 24, 4, C.bgGlow);
fillCircle(16, 10, 4, C.bgGlow);

// ---- 真身(下方人形,背影) ----
// 头
fillCircle(16, 22, 2.2, C.body);
// 头左缘暗面
setPixel(14, 21, C.bodyDark);
setPixel(14, 22, C.bodyDark);
setPixel(14, 23, C.bodyDark);
// 肩与躯干(上窄下宽)
fillRect(14, 25, 18, 26, C.body);
fillRect(13, 27, 19, 28, C.body);
// 躯干两侧暗面
for (let y = 25; y <= 28; y += 1) setPixel(13, y, C.bodyDark);
setPixel(19, 27, C.bodyDark);
setPixel(19, 28, C.bodyDark);

// ---- 灵魂(上方幽灵) ----
// 圆头
fillCircle(16, 9, 2.4, C.soul);
// 身体
fillRect(14, 10, 18, 12, C.soul);
// 下摆波浪(三个尖角),做出"飘"的感觉
setPixel(14, 13, C.soul);
setPixel(15, 13, C.soul);
setPixel(17, 13, C.soul);
setPixel(18, 13, C.soul);
// 高光:左上受光
setPixel(15, 8, C.soulLight);
setPixel(14, 9, C.soulLight);
setPixel(15, 9, C.soulLight);
// 眼睛(深色,给幽灵一点"表情")
setPixel(15, 10, C.trailDim);
setPixel(17, 10, C.trailDim);

// ---- 移动轨迹:真身 → 灵魂 之间渐隐的光点 ----
setPixel(16, 15, C.trail);
setPixel(16, 16, C.trailDim);
setPixel(15, 17, C.trailDim);

// ---- 光点:强调"离体" ----
setPixel(20, 7, C.spark);
setPixel(11, 12, C.spark);
setPixel(21, 14, C.trail);

// ---- 最近邻放大 ----
const outWidth = SIZE * SCALE;
const outHeight = SIZE * SCALE;
const raw = Buffer.alloc((outWidth * 4 + 1) * outHeight);
let cursor = 0;
for (let y = 0; y < outHeight; y += 1) {
  raw[cursor] = 0; // 过滤器类型:None
  cursor += 1;
  const sourceY = Math.floor(y / SCALE);
  for (let x = 0; x < outWidth; x += 1) {
    const sourceX = Math.floor(x / SCALE);
    const offset = (sourceY * SIZE + sourceX) * 4;
    raw[cursor] = pixels[offset];
    raw[cursor + 1] = pixels[offset + 1];
    raw[cursor + 2] = pixels[offset + 2];
    raw[cursor + 3] = pixels[offset + 3];
    cursor += 4;
  }
}

// ---- 组装 PNG ----
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(outWidth, 0);
ihdr.writeUInt32BE(outHeight, 4);
ihdr[8] = 8; // 位深
ihdr[9] = 6; // 色彩类型 6 = RGBA
ihdr[10] = 0; // 压缩方法
ihdr[11] = 0; // 过滤方法
ihdr[12] = 0; // 隔行扫描

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const target = process.argv[2] ?? path.join(__dirname, "..", "behavior_packs", "spectator-mode", "pack_icon.png");
fs.writeFileSync(target, png);
console.log(`已写入 ${target}(${png.length} 字节,${outWidth}×${outHeight} RGBA)`);
