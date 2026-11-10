// ─── 128×128 包图标生成器（纯 Node,零依赖） ─────────────────────
// 模拟玩家III 的图标:深青灰底 + 中央假人剪影(头/躯干/双臂) + 右上角在线状态点,
// 表达「由脚本驱动的模拟玩家」。只用 Node 内置 zlib 手写 PNG,避免为一张图标引入图形库。
//
// 用法:node tools/generate-pack-icon.js
// 产物:behavior_packs/mockplayer3/pack_icon.png 与 resource_packs/mockplayer3/pack_icon.png

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 128;

/** 调色板 */
const PALETTE = {
  backgroundTop: [38, 48, 62],
  backgroundBottom: [18, 24, 32],
  bodyDark: [58, 84, 118],
  bodyMain: [82, 118, 160],
  bodyLight: [116, 156, 200],
  outline: [22, 30, 40],
  eye: [220, 236, 255],
  statusRing: [24, 40, 32],
  statusOn: [96, 214, 124],
  statusGlow: [168, 240, 180],
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

/** 圆内判定 */
function inCircle(x, y, centerX, centerY, radius) {
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

/** 圆环判定 */
function inRing(x, y, centerX, centerY, innerRadius, outerRadius) {
  const dx = x - centerX;
  const dy = y - centerY;
  const d2 = dx * dx + dy * dy;
  return d2 >= innerRadius * innerRadius && d2 <= outerRadius * outerRadius;
}

/**
 * 假人剪影:头部圆形 + 躯干梯形 + 两侧手臂。
 * 左侧打光(亮面),右侧压暗(暗面),外圈描边给出体积感。
 */
function figureAt(x, y) {
  const centerX = 64;
  const headCenterY = 44;
  const headRadius = 17;

  // 头部
  if (inCircle(x, y, centerX, headCenterY, headRadius + 2)) {
    if (inCircle(x, y, centerX, headCenterY, headRadius)) {
      // 眼睛:两条横缝,营造「面向玩家」的正脸
      if (inRect(x, y, 54, 41, 61, 45) || inRect(x, y, 67, 41, 74, 45)) {
        return PALETTE.eye;
      }
      // 左右半侧亮度差
      if (x < centerX - 4) return PALETTE.bodyLight;
      if (x > centerX + 5) return PALETTE.bodyDark;
      return PALETTE.bodyMain;
    }
    return PALETTE.outline;
  }

  // 躯干:上窄下宽的梯形
  const torsoTop = 63;
  const torsoBottom = 112;
  if (y >= torsoTop && y < torsoBottom) {
    const progress = (y - torsoTop) / (torsoBottom - torsoTop);
    const halfWidth = Math.round(15 + progress * 9);
    if (Math.abs(x - centerX) <= halfWidth + 2) {
      if (Math.abs(x - centerX) <= halfWidth) {
        if (x < centerX - 4) return PALETTE.bodyLight;
        if (x > centerX + 5) return PALETTE.bodyDark;
        return PALETTE.bodyMain;
      }
      return PALETTE.outline;
    }
  }

  // 手臂:躯干两侧的竖条,略短于躯干
  const armTop = 68;
  const armBottom = 100;
  if (y >= armTop && y < armBottom) {
    if (inRect(x, y, 26, armTop, 38, armBottom) || inRect(x, y, 90, armTop, 102, armBottom)) {
      return y < armTop + 4 ? PALETTE.bodyLight : PALETTE.bodyDark;
    }
  }

  return null;
}

/** 右上角在线状态点:外圈暗环 + 实心绿点 + 左上高光 */
function statusAt(x, y) {
  const centerX = 100;
  const centerY = 28;
  if (inRing(x, y, centerX, centerY, 11, 13)) return PALETTE.statusRing;
  if (inCircle(x, y, centerX, centerY, 11)) {
    // 左上高光:让圆点有球感
    if (inCircle(x, y, centerX - 4, centerY - 4, 4)) return PALETTE.statusGlow;
    return PALETTE.statusOn;
  }
  return null;
}

/** 计算单像素颜色 */
function colorAt(x, y) {
  const status = statusAt(x, y);
  if (status) return status;
  const figure = figureAt(x, y);
  if (figure) return figure;
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
  path.resolve(__dirname, "../behavior_packs/mockplayer3/pack_icon.png"),
  path.resolve(__dirname, "../resource_packs/mockplayer3/pack_icon.png"),
];

for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, png);
  console.log(`已生成 ${path.relative(path.resolve(__dirname, ".."), target)}(${png.length} 字节)`);
}
