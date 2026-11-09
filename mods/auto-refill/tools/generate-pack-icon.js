// 生成 auto-refill 行为包图标:32×32 逻辑像素画 → 4 倍最近邻放大为 128×128 RGBA PNG
//
// 用法(在 mods/auto-refill 下):
//   npm run generate:icon
// 或直接指定输出路径:
//   node tools/generate-pack-icon.js <输出路径>
//
// 图标是静态资源,不在构建期生成;本脚本用于重新生成或调整构图后重出图。
// 构图语义:中央一把镐,外围一圈「循环箭头」表示「用尽即自动换新」。
// 构图刻意保持单一主体 + 单一符号,避免在小尺寸下糊成一团。
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const SIZE = 32;
const SCALE = 4;
// 9 色色板(控制在 design 约定的 8–12 色)
const C = {
  bg: [0x1b, 0x1e, 0x26, 255],
  ring: [0x4e, 0xc9, 0x4a, 255], // 循环箭头:绿
  ringLight: [0x8e, 0xf0, 0x7f, 255], // 箭头高光
  headTop: [0x9f, 0xe8, 0xf0, 255], // 镐头亮面:钻石青
  headSide: [0x5c, 0xb8, 0xc8, 255], // 镐头暗面
  handle: [0xa9, 0x71, 0x3a, 255], // 木柄亮面
  handleDark: [0x6b, 0x4a, 0x2a, 255], // 木柄暗面
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
    for (let x = x0; x <= x1; x += 1) {
      setPixel(x, y, color);
    }
  }
}
/** 画一段圆弧(角度用度,0°=右,逆时针为正;y 轴向下故取负) */
function drawArc(cx, cy, radius, fromDeg, toDeg, color) {
  const step = 1;
  const sign = fromDeg <= toDeg ? 1 : -1;
  for (let t = fromDeg; sign > 0 ? t <= toDeg : t >= toDeg; t += sign * step) {
    const rad = (t * Math.PI) / 180;
    const x = Math.round(cx + radius * Math.cos(rad));
    const y = Math.round(cy - radius * Math.sin(rad));
    setPixel(x, y, color);
    // 加粗:沿半径方向补一个像素
    const x2 = Math.round(cx + (radius + 1) * Math.cos(rad));
    const y2 = Math.round(cy - (radius + 1) * Math.sin(rad));
    setPixel(x2, y2, color);
  }
}
// ---- 背景 ----
fillRect(0, 0, SIZE - 1, SIZE - 1, C.bg);

// ---- 外围循环箭头(半径 12,分上下两段,各带一个箭头) ----
const CX = 16;
const CY = 16;
const R = 12;
// 上段:从左(150°)经顶部扫到右(30°)
drawArc(CX, CY, R, 150, 30, C.ring);
// 下段:从右(-30°)经底部扫到左(-150°)
drawArc(CX, CY, R, -30, -150, C.ring);
// 右上箭头:指向上方(接上段终点)
setPixel(28, 10, C.ringLight);
setPixel(29, 11, C.ringLight);
setPixel(28, 11, C.ring);
setPixel(27, 11, C.ringLight);
// 左下箭头:指向下方(接下段终点)
setPixel(4, 22, C.ringLight);
setPixel(3, 21, C.ringLight);
setPixel(4, 21, C.ring);
setPixel(5, 21, C.ringLight);

// ---- 中央镐(斜柄 + 顶部镐头) ----
// 斜柄:从左下 (11,23) 向右上到 (18,16)
for (let i = 0; i < 8; i += 1) {
  setPixel(11 + i, 23 - i, C.handle);
  setPixel(12 + i, 23 - i, C.handleDark);
}
// 镐头:横条 + 两端下弯,形成弧形镐头
fillRect(12, 11, 19, 12, C.headTop);
fillRect(12, 13, 19, 13, C.headSide);
// 两端各收一个像素,做出弧形的视觉
setPixel(11, 12, C.headSide);
setPixel(20, 12, C.headSide);
setPixel(11, 13, C.headSide);
setPixel(20, 13, C.headSide);
// 镐头与柄的连接
setPixel(15, 14, C.headSide);
setPixel(16, 14, C.handleDark);
setPixel(15, 15, C.handle);
setPixel(16, 15, C.handleDark);

// ---- 光点:强调「焕新」 ----
setPixel(23, 8, C.spark);
setPixel(9, 20, C.spark);

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
const target =
  process.argv[2] ?? path.join(__dirname, "..", "behavior_packs", "auto-refill", "pack_icon.png");
fs.writeFileSync(target, png);
console.log(`已写入 ${target}(${png.length} 字节,${outWidth}×${outHeight} RGBA)`);
