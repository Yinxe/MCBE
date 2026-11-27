// ─── 像素画纹理构造：字符画 → RGBA 缓冲区 ────────────────────
// 供 16×16 物品/方块纹理使用。设计意图是「确定性」：纹理由代码里的字符画
// 与调色板定义，不读外部图片，因此任何机器、任何时间生成的字节完全一致。
//
// 与 slice-all.js 的分工：那个从版本受控的 256×256 源图切徽章；这个从字符画
// 直接构造小尺寸纹理。两者共用 src/png.js 的编码器。
const { encodePng } = require('./png');

/** 调色板键：单个字符 → [r, g, b, a] */
const TRANSPARENT = [0, 0, 0, 0];

/**
 * 把字符画转成 RGBA 缓冲区。
 *
 * @param rows     - 每行等长的字符串数组（长度 = 高度）
 * @param palette  - 字符 → [r, g, b, a]；未在调色板中出现的字符视为透明
 * @param options  - { allowSemiAlpha: boolean } 是否允许 alpha 取 0/255 之外的值
 * @returns { Buffer, width, height }
 * @throws 行宽不一致、调色板缺失、出现半透明像素（默认禁止）时抛错
 */
function buildTexture(rows, palette, options = {}) {
  if (rows.length === 0) throw new Error('字符画不能为空');
  const height = rows.length;
  const width = rows[0].length;

  for (let y = 0; y < height; y++) {
    if (rows[y].length !== width) {
      throw new Error(`字符画第 ${y} 行宽度 ${rows[y].length}，与第 0 行 ${width} 不一致`);
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const color = palette[ch] ?? (ch === '.' ? TRANSPARENT : undefined);
      if (color === undefined) {
        throw new Error(`字符画第 ${y} 行第 ${x} 列的字符 '${ch}' 不在调色板中`);
      }
      const alpha = color[3];
      if (options.allowSemiAlpha !== true && alpha !== 0 && alpha !== 255) {
        // 像素画要求 alpha 只有全透明/全不透明两种，半透明会产生抗锯齿观感
        throw new Error(`第 ${y} 行第 ${x} 列 alpha=${alpha}，像素画只允许 0 或 255`);
      }
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = alpha;
    }
  }

  return { rgba, width, height };
}

/**
 * 构造纹理并编码为 PNG 缓冲区。
 *
 * @param rows    - 字符画
 * @param palette - 调色板
 * @param options - 透传给 buildTexture
 * @returns PNG 文件内容
 */
function renderPng(rows, palette, options) {
  const { rgba, width, height } = buildTexture(rows, palette, options);
  return encodePng(rgba, width, height);
}

module.exports = { buildTexture, renderPng, TRANSPARENT };
