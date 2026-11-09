// 生成 teleporter 行为包图标:32×32 逻辑像素画 → 4 倍最近邻放大为 128×128 RGBA PNG
//
// 用法(在 mods/teleporter 下):
//   npm run generate:icon
// 或直接指定输出路径:
//   node tools/generate-pack-icon.js <输出路径>
//
// 图标是静态资源,不在构建期生成;本脚本用于重新生成或调整构图后重出图。
// 构图语义:中央一个「位置锚点」(地图针),左右两侧各一个向内指的箭头,
// 表示「把你送到这个点」。刻意保持单一主体 + 单一符号,避免小尺寸下糊成一团。
// 不使用任何文字:图标在游戏内会被缩到很小,文字必然不可读。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 32;
const SCALE = 4;

// 6 色色板(控制在 design 约定的 8–12 色以内)
const C = {
  bg: [0x14, 0x1a, 0x24, 255], // 深蓝灰背景
  pinBody: [0x3f, 0xb8, 0xd8, 255], // 锚点主体:青
  pinLight: [0x8e, 0xe8, 0xff, 255], // 锚点受光面
  pinEdge: [0x24, 0x7a, 0x96, 255], // 锚点背光面
  arrow: [0xff, 0xd1, 0x66, 255], // 箭头:暖黄
  arrowLight: [0xff, 0xf0, 0xb8, 255], // 箭头高光
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
    for (let x = x0; x <= x1; x += 1) {
      setPixel(x, y, color);
    }
  }
}

/** 从 (x,y) 沿主方向画一条粗线,用于箭头斜边。 */
function drawThickLine(x0, y0, x1, y1, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    setPixel(x, y, color);
  }
}

// ── 背景 ──────────────────────────────────────────────────────────
fillRect(0, 0, SIZE - 1, SIZE - 1, C.bg);

// ── 位置锚点(水滴形:上半圆 + 下方收尖) ──────────────────────────
const CX = 16;
const HEAD_Y = 12;
const HEAD_R = 6;
const TAIL_END_Y = 27;

for (let y = HEAD_Y - HEAD_R; y <= TAIL_END_Y; y += 1) {
  let halfWidth;
  if (y <= HEAD_Y) {
    const dy = y - HEAD_Y;
    halfWidth = Math.sqrt(HEAD_R * HEAD_R - dy * dy);
  } else {
    // 收尖:越靠下越窄
    halfWidth = (HEAD_R * (TAIL_END_Y - y)) / (TAIL_END_Y - HEAD_Y);
  }
  const left = Math.round(CX - halfWidth);
  const right = Math.round(CX + halfWidth);
  for (let x = left; x <= right; x += 1) {
    // 左侧受光、右侧背光,给出体积感
    let color = C.pinBody;
    if (x <= left + 1) color = C.pinLight;
    else if (x >= right - 1) color = C.pinEdge;
    setPixel(x, y, color);
  }
}

// 中心孔:挖空成背景色,让「锚点」可辨识
const HOLE_R = 3;
for (let dy = -HOLE_R; dy <= HOLE_R; dy += 1) {
  for (let dx = -HOLE_R; dx <= HOLE_R; dx += 1) {
    if (dx * dx + dy * dy > HOLE_R * HOLE_R + 1) continue;
    setPixel(CX + dx, HEAD_Y + dy, C.bg);
  }
}

// ── 左右向内箭头 ──────────────────────────────────────────────────
// 左箭头:尖端在 x=7,指向右
const ARROW_TOP = 10;
const ARROW_BOTTOM = 16;
const ARROW_MID = 13;
drawThickLine(4, ARROW_TOP, 7, ARROW_MID, C.arrow);
drawThickLine(4, ARROW_BOTTOM, 7, ARROW_MID, C.arrow);
drawThickLine(3, ARROW_MID, 7, ARROW_MID, C.arrow);
// 箭头尖端高光
setPixel(7, ARROW_MID, C.arrowLight);
setPixel(6, ARROW_MID, C.arrowLight);

// 右箭头:尖端在 x=24,指向左
drawThickLine(27, ARROW_TOP, 24, ARROW_MID, C.arrow);
drawThickLine(27, ARROW_BOTTOM, 24, ARROW_MID, C.arrow);
drawThickLine(24, ARROW_MID, 28, ARROW_MID, C.arrow);
setPixel(24, ARROW_MID, C.arrowLight);
setPixel(25, ARROW_MID, C.arrowLight);

// ── 最近邻放大 ────────────────────────────────────────────────────
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

// ── 组装 PNG ──────────────────────────────────────────────────────
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

const target = process.argv[2] ?? path.join(__dirname, "..", "behavior_packs", "teleporter", "pack_icon.png");
fs.writeFileSync(target, png);
console.log(`已写入 ${target}(${png.length} 字节,${outWidth}×${outHeight} RGBA)`);
