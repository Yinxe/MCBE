// ─── 128×128 包图标生成器（纯 Node,零依赖） ─────────────────────
// 物品路由仓库的图标:暖棕底 + 木箱格纹 + 中央路由箭头,表达「物品按路由归位」。
// 只用 Node 内置 zlib 手写 PNG,避免为一张图标引入图形库依赖。
//
// 用法:node tools/generate-pack-icon.js
// 产物:behavior_packs/item-route/pack_icon.png 与 resource_packs/item-route/pack_icon.png

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 128;

/** 调色板(与 uiColor 的仓库主题色一致) */
const PALETTE = {
  backgroundTop: [58, 42, 28],
  backgroundBottom: [30, 21, 14],
  boxBody: [140, 96, 52],
  boxBodyDark: [104, 70, 38],
  boxPlank: [176, 128, 72],
  boxRim: [206, 162, 96],
  arrow: [255, 205, 92],
  arrowShadow: [196, 146, 44],
  highlight: [255, 236, 176],
};

/** 取背景渐变色:纵向线性插值 */
function backgroundAt(y) {
  const t = y / (SIZE - 1);
  return PALETTE.backgroundTop.map((channel, index) =>
    Math.round(channel + (PALETTE.backgroundBottom[index] - channel) * t)
  );
}

/** 判断点是否落在某个矩形内 */
function inRect(x, y, left, top, right, bottom) {
  return x >= left && x < right && y >= top && y < bottom;
}

/** 木箱区域:主体、四边包边、三条竖向木条 */
function boxColorAt(x, y) {
  const left = 18;
  const top = 38;
  const right = 110;
  const bottom = 106;

  if (!inRect(x, y, left, top, right, bottom)) return null;

  const rimThickness = 5;
  const isRim =
    inRect(x, y, left, top, right, top + rimThickness) ||
    inRect(x, y, left, bottom - rimThickness, right, bottom) ||
    inRect(x, y, left, top, left + rimThickness, bottom) ||
    inRect(x, y, right - rimThickness, top, right, bottom);
  if (isRim) return PALETTE.boxRim;

  // 竖向木条:等分三格
  const innerLeft = left + rimThickness;
  const innerRight = right - rimThickness;
  const plankWidth = Math.floor((innerRight - innerLeft) / 3);
  const offset = (x - innerLeft) % plankWidth;
  if (offset < 2) return PALETTE.boxBodyDark;

  // 底部三分之一压暗,给出体积感
  if (y > top + (bottom - top) * 0.66) return PALETTE.boxBodyDark;
  return PALETTE.boxBody;
}

/** 中央路由箭头:向右的折线箭头,带一像素阴影 */
function arrowAt(x, y) {
  const centerY = 30;
  const shaftLeft = 34;
  const shaftRight = 82;
  const thickness = 8;
  const headHalf = 20;

  // 箭杆
  if (inRect(x, y, shaftLeft, centerY - thickness / 2, shaftRight, centerY + thickness / 2)) {
    return y < centerY ? PALETTE.highlight : PALETTE.arrow;
  }
  // 箭头三角
  const triangleStart = shaftRight - 1;
  const triangleEnd = triangleStart + headHalf;
  if (x >= triangleStart && x < triangleEnd) {
    const progress = (x - triangleStart) / (triangleEnd - triangleStart);
    const half = Math.round(headHalf * (1 - progress));
    if (Math.abs(y - centerY) <= half) {
      return Math.abs(y - centerY) >= half - 1 ? PALETTE.arrowShadow : PALETTE.arrow;
    }
  }
  return null;
}

/** 计算单像素颜色 */
function colorAt(x, y) {
  const arrow = arrowAt(x, y);
  if (arrow) return arrow;
  const box = boxColorAt(x, y);
  if (box) return box;
  return backgroundAt(y);
}

/** 生成 RGBA 原始像素数据,每行前置 filter 字节 0 */
function buildRawPixels() {
  const bytesPerRow = SIZE * 4;
  const raw = Buffer.alloc((bytesPerRow + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = colorAt(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }
  return raw;
}

/** CRC32(PNG 分块校验) */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG 分块 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** 生成完整 PNG 文件字节 */
function buildPng() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(SIZE, 0); // width
  ihdrData.writeUInt32BE(SIZE, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const idatData = zlib.deflateSync(buildRawPixels(), { level: 9 });

  return Buffer.concat([signature, chunk("IHDR", ihdrData), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

const png = buildPng();
const targets = [
  path.resolve(__dirname, "../behavior_packs/item-route/pack_icon.png"),
  path.resolve(__dirname, "../resource_packs/item-route/pack_icon.png"),
];

for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, png);
  console.log(`已生成 ${path.relative(path.resolve(__dirname, ".."), target)}(${png.length} 字节)`);
}
