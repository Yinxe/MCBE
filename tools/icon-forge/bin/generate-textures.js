// ─── 小尺寸纹理生成：物品 / 方块 16×16 像素画 ─────────────────
// 与 slice-all.js 并列的第二类产出：那个从 256×256 源图切徽章，这个从字符画
// 直接构造 16×16 纹理。两者都确定性、都可重复执行、都不读外部图片。
//
// 用法：node tools/icon-forge/bin/generate-textures.js
// 幂等：同一份字符画重复执行，产物逐字节一致（png.js 用固定 deflate level 9）。
const fs = require('fs');
const path = require('path');
const { renderPng } = require('../src/pixel-art');

const ROOT_DIR = path.resolve(__dirname, '../../..');

// ─── 调色板（全局共用，保持全仓纹理观感统一） ───────────────────
const PALETTE = {
  // 轮廓与阴影
  o: [0x2b, 0x21, 0x18, 255], // 深褐轮廓
  k: [0x1a, 0x14, 0x0e, 255], // 更深的内部轮廓
  // 金色系（信物主色）
  H: [0xff, 0xe9, 0xa3, 255], // 高光
  G: [0xe8, 0xb8, 0x3c, 255], // 主金
  D: [0xa9, 0x7b, 0x1d, 255], // 暗金
  // 木箱系（仓库语义）
  C: [0xc9, 0x8f, 0x52, 255], // 箱盖亮
  c: [0xa9, 0x71, 0x3c, 255], // 箱身暗
  K: [0x7a, 0x4f, 0x26, 255], // 箱体轮廓
  W: [0xff, 0xff, 0xff, 255], // 白高光
  // 铁灰系（仓库锚点的包角/外框）
  I: [0x8a, 0x93, 0x9c, 255], // 铁亮
  i: [0x5a, 0x62, 0x6b, 255], // 铁暗
};

// ─── 纹理清单 ─────────────────────────────────────────────────
// 每项：产出路径 + 16 行字符画（每行必须 16 字符，`.` = 全透明）
const TEXTURES = [
  {
    // 仓库信物：金色圆牌 + 中央木箱，与 pack 图标同为 3D 体素拟物风格的平面化
    path: 'mods/item-route/resource_packs/item-route/textures/itemroute/items/warehouse_token.png',
    rows: [
      '.....oooooo.....',
      '...ooHHHHHHoo...',
      '..oHHGGGGGGHHo..',
      '.oHWGGGGGGGGGGo.',
      '.oGGGGGGGGGGGGo.',
      'oGGGGKKKKKKGGGGo',
      'oGGGKCCCCCCKGGGo',
      'oGGGKCCCCCCKGGGo',
      'oGGGKccccccKGGGo',
      'oGGGKccccccKGGGo',
      'oGGGKccccccKGGGo',
      'oGGGGKKKKKKGGGGo',
      '.oGGGGGGGGGGGGo.',
      '.oDGGGGGGGGGGDo.',
      '..oDDDDDDDDDDo..',
      '...oooooooooo...',
    ],
  },
  {
    // 仓库锚点：铁框木箱 + 中央金色印记。
    // 语义上对应「仓库的一个角」：四边铁包边（角部结构）+ 木箱（仓库本体）
    // + 金色印记（与仓库信物同色系，暗示属于同一套东西）。
    path: 'mods/item-route/resource_packs/item-route/textures/itemroute/blocks/warehouse_anchor.png',
    rows: [
      'IIIIIIIIIIIIIIII',
      'IiiiiiiiiiiiiiiI',
      'IiCCCCCCCCCCCCiI',
      'IiCCCCCCCCCCCCiI',
      'IiCCGGGGGGGGCCiI',
      'IiCCGiiiiiiGCCiI',
      'IiCCGiWWWWiGCCiI',
      'IiCCGiWWWWiGCCiI',
      'IiCCGiWWWWiGCCiI',
      'IiCCGiWWWWiGCCiI',
      'IiCCGiiiiiiGCCiI',
      'IiCCGGGGGGGGCCiI',
      'IiCCCCCCCCCCCCiI',
      'IiCCCCCCCCCCCCiI',
      'IiiiiiiiiiiiiiiI',
      'IIIIIIIIIIIIIIII',
    ],
  },
];

function main() {
  let written = 0;
  for (const texture of TEXTURES) {
    const png = renderPng(texture.rows, PALETTE);
    const outPath = path.join(ROOT_DIR, texture.path);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, png);
    const size = `${texture.rows[0].length}×${texture.rows.length}`;
    console.log(`写出 ${size} 纹理: ${texture.path} (${png.length} 字节)`);
    written += 1;
  }
  console.log(`\n共写出 ${written} 份纹理。`);
}

main();
