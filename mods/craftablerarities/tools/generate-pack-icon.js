// 生成 craftablerarities 行为包图标:32×32 逻辑像素画 → 4 倍最近邻放大为 128×128 RGBA PNG
//
// 用法(在 mods/craftablerarities 下):
//   node tools/generate-pack-icon.js
// 或直接指定输出路径:
//   node tools/generate-pack-icon.js <输出路径>
//
// 图标是静态资源,不在构建期生成;本脚本用于重新生成或调整构图后重出图。
// 构图:深色工作台台面 + 中央合成格 + 一颗稀有的下界之星,表达「用配方合成稀有物品」。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 32;
const SCALE = 4;

// 10 色色板(控制在 8–12 色)
const C = {
  bg: [0x1b, 0x1e, 0x26, 255],
  tableTop: [0xa9, 0x71, 0x3a, 255],
  tableTopDark: [0x8b, 0x5a, 0x2b, 255],
  tableEdge: [0x5c, 0x3a, 0x1a, 255],
  gridLine: [0x3a, 0x2a, 0x18, 255],
  slot: [0x2a, 0x2e, 0x38, 255],
  slotLight: [0x3c, 0x42, 0x50, 255],
  star: [0xff, 0xe9, 0x7a, 255],
  starCore: [0xff, 0xff, 0xff, 255],
  starGlow: [0xd8, 0x9c, 0x2a, 255],
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

/** 画一个实心圆 */
function fillCircle(cx, cy, radius, color) {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius + radius * 0.5) {
        setPixel(x, y, color);
      }
    }
  }
}

/** 画一条水平线(含端点) */
function hLine(x0, x1, y, color) {
  for (let x = x0; x <= x1; x += 1) setPixel(x, y, color);
}

/** 画一条垂直线(含端点) */
function vLine(x, y0, y1, color) {
  for (let y = y0; y <= y1; y += 1) setPixel(x, y, color);
}

// ---- 背景 ----
fillRect(0, 0, SIZE - 1, SIZE - 1, C.bg);

// ---- 工作台台面(3×3 合成格) ----
const gridX0 = 3;
const gridY0 = 6;
const gridX1 = 28;
const gridY1 = 25;
fillRect(gridX0, gridY0, gridX1, gridY1, C.tableTop);
// 台面顶部高光与底部阴影
hLine(gridX0, gridX1, gridY0, C.tableTop);
hLine(gridX0, gridX1, gridY1, C.tableEdge);
// 3×3 格的槽位与格线
const cell = 8;
for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    const x0 = gridX0 + col * cell + 1;
    const y0 = gridY0 + row * cell + 1;
    fillRect(x0, y0, x0 + cell - 3, y0 + cell - 3, C.slot);
    // 槽位左上高光,做出凹陷感
    hLine(x0, x0 + cell - 3, y0, C.slotLight);
    vLine(x0, y0, y0 + cell - 3, C.slotLight);
  }
}
// 格线
for (let i = 1; i < 3; i += 1) {
  vLine(gridX0 + i * cell - 1, gridY0, gridY1, C.gridLine);
  hLine(gridX0, gridX1, gridY0 + i * cell - 1, C.gridLine);
}

// ---- 中央的下界之星(稀有产物) ----
const starCx = 16;
const starCy = 16;
// 外圈微光
fillCircle(starCx, starCy, 6, C.starGlow);
fillCircle(starCx, starCy, 5, C.star);
// 十字星芒
hLine(starCx - 7, starCx + 7, starCy, C.star);
vLine(starCx, starCy - 7, starCy + 7, C.star);
// 核心高光
fillCircle(starCx, starCy, 2, C.starCore);

// ---- 输出:最近邻 4 倍放大 ----
const outWidth = SIZE * SCALE;
const outHeight = SIZE * SCALE;
const raw = Buffer.alloc(outHeight * (1 + outWidth * 4));
let cursor = 0;
for (let y = 0; y < outHeight; y += 1) {
  raw[cursor] = 0; // 过滤类型 0 = None
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

const target =
  process.argv[2] ?? path.join(__dirname, "..", "behavior_packs", "craftablerarities", "pack_icon.png");
fs.writeFileSync(target, png);
console.log(`已写入 ${target}(${png.length} 字节,${outWidth}×${outHeight} RGBA)`);
