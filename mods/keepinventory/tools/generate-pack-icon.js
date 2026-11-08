// 生成 keepinventory 行为包图标:32×32 逻辑像素画 → 4 倍最近邻放大为 128×128 RGBA PNG
//
// 用法(在 mods/keepinventory 下):
//   npm run generate:icon
// 或直接指定输出路径:
//   node tools/generate-pack-icon.js <输出路径>
//
// 图标是静态资源,不在构建期生成;本脚本用于重新生成或调整构图后重出图。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 32;
const SCALE = 4;

// 12 色色板(控制在 design 约定的 8–12 色)
const C = {
  bg: [0x1b, 0x1e, 0x26, 255],
  ground: [0x12, 0x14, 0x1a, 255],
  stone: [0x7d, 0x83, 0x8f, 255],
  stoneLight: [0x9a, 0xa1, 0xae, 255],
  stoneDark: [0x56, 0x5b, 0x66, 255],
  stoneEngrave: [0x3a, 0x3e, 0x47, 255],
  packBrown: [0x8b, 0x5a, 0x2b, 255],
  packLight: [0xa9, 0x71, 0x3a, 255],
  packDark: [0x5c, 0x3a, 0x1a, 255],
  gold: [0xe0, 0xb1, 0x3c, 255],
  green: [0x4e, 0xc9, 0x4a, 255],
  greenLight: [0x8e, 0xf0, 0x7f, 255],
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

/** 画一个实心圆(用于绿色徽章与光点) */
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

// ---- 背景与地面 ----
fillRect(0, 0, SIZE - 1, SIZE - 1, C.bg);
fillRect(0, 27, SIZE - 1, SIZE - 1, C.ground);

// ---- 墓碑(死亡) ----
// 拱顶:逐行加宽,形成圆头墓碑
const tombstoneCap = [
  [6, 10, 12],
  [7, 9, 13],
  [8, 8, 14],
  [9, 7, 15],
];
for (const [y, x0, x1] of tombstoneCap) {
  fillRect(x0, y, x1, y, C.stone);
}
fillRect(6, 10, 16, 25, C.stone);
// 底座
fillRect(5, 26, 17, 26, C.stoneDark);

// 石材明暗:左侧高光、右侧暗部
for (const [y, x0] of tombstoneCap) {
  setPixel(x0, y, C.stoneLight);
}
for (let y = 10; y <= 25; y += 1) {
  setPixel(6, y, C.stoneLight);
  setPixel(16, y, C.stoneDark);
}

// 墓碑上的十字刻痕
fillRect(10, 11, 11, 20, C.stoneEngrave);
fillRect(8, 13, 13, 14, C.stoneEngrave);

// ---- 背包(物品保留) ----
const packLeft = 17;
const packRight = 28;
const packTop = 17;
const packBottom = 26;

// 提手
fillRect(22, 14, 23, 14, C.packDark);
fillRect(21, 15, 24, 16, C.packDark);

// 绿色保护光晕:在包体外侧描一圈,表达「物品被保留住」
for (let y = packTop - 1; y <= packBottom + 1; y += 1) {
  setPixel(packLeft - 1, y, C.green);
  setPixel(packRight + 1, y, C.green);
}
for (let x = packLeft - 1; x <= packRight + 1; x += 1) {
  setPixel(x, packTop - 1, C.green);
  setPixel(x, packBottom + 1, C.green);
}

// 包体与包盖
fillRect(packLeft, packTop, packRight, packBottom, C.packBrown);
fillRect(packLeft, packTop, packRight, packTop + 3, C.packLight);

// 圆角:去掉四个直角像素
setPixel(packLeft, packTop, C.bg);
setPixel(packRight, packTop, C.bg);
setPixel(packLeft, packBottom, C.bg);
setPixel(packRight, packBottom, C.bg);

// 包体轮廓
for (let y = packTop; y <= packBottom; y += 1) {
  setPixel(packLeft, y, C.packDark);
  setPixel(packRight, y, C.packDark);
}

// 竖直背带
for (let y = packTop + 4; y <= packBottom - 1; y += 1) {
  setPixel(20, y, C.packDark);
  setPixel(25, y, C.packDark);
}

// 金色搭扣(闭合状态,表达「东西还在包里」)
fillRect(22, 21, 23, 22, C.gold);
setPixel(22, 21, C.gold);

// ---- 绿色对勾徽章(保留/安全) ----
fillCircle(26, 24, 3, C.green);
fillCircle(26, 24, 2, C.greenLight);
// 对勾:用深色描边,在浅绿底上才看得清
setPixel(24, 24, C.bg);
setPixel(25, 25, C.bg);
setPixel(26, 24, C.bg);
setPixel(27, 23, C.bg);
setPixel(28, 22, C.bg);
setPixel(25, 24, C.bg);
setPixel(26, 23, C.bg);
setPixel(27, 22, C.bg);

// ---- 光点(强化「仍存在」的语义) ----
const sparkles = [
  [4, 12],
  [3, 17],
  [29, 12],
  [12, 3],
];
for (const [sx, sy] of sparkles) {
  setPixel(sx, sy, C.greenLight);
  setPixel(sx - 1, sy, C.green);
  setPixel(sx + 1, sy, C.green);
  setPixel(sx, sy - 1, C.green);
  setPixel(sx, sy + 1, C.green);
}

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

const target = process.argv[2] ?? path.join(__dirname, "..", "BP", "keepinventory", "pack_icon.png");
fs.writeFileSync(target, png);
console.log(`已写入 ${target}(${png.length} 字节,${outWidth}×${outHeight} RGBA)`);
