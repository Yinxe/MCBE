const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('../src/png');

const ASSET_PATH = path.resolve(__dirname, '../assets/minecraft-icon-sprites.png');
const FALLBACK_PATH = '/home/yinxin/Downloads/我的世界风格方块图标合集.png';
const SRC_PATH = fs.existsSync(ASSET_PATH) ? ASSET_PATH : FALLBACK_PATH;
const ROOT_DIR = path.resolve(__dirname, '../../..');

console.log('正在读取源图:', SRC_PATH);
const srcBuf = fs.readFileSync(SRC_PATH);
const srcImg = decodePng(srcBuf);
console.log(`解码完成: ${srcImg.W}x${srcImg.H}`);

// 真实的 5 列与 7 行投影区间（包含 1~2px 余量，各徽章互不接触）
const colIntervals = [
  [15, 210],
  [226, 418],
  [432, 625],
  [641, 834],
  [849, 1043],
];

const rowIntervals = [
  [10, 206],
  [222, 416],
  [429, 624],
  [638, 832],
  [846, 1032],
  [1044, 1236],
  [1250, 1444],
];

function extractBadge(row, col) {
  const [c0, c1] = colIntervals[col];
  const [r0, r1] = rowIntervals[row];
  const minX = Math.max(0, c0 - 2);
  const maxX = Math.min(srcImg.W - 1, c1 + 2);
  const minY = Math.max(0, r0 - 2);
  const maxY = Math.min(srcImg.H - 1, r1 + 2);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // 1. 从四边开始泛洪消除外部暗黑背景
  const mask = new Uint8Array(w * h); // 1 = 外部背景
  const queue = [];

  function push(lx, ly) {
    const idx = ly * w + lx;
    if (mask[idx]) return;
    const gx = minX + lx;
    const gy = minY + ly;
    const pi = (gy * srcImg.W + gx) * 4;
    const r = srcImg.px[pi];
    const g = srcImg.px[pi + 1];
    const b = srcImg.px[pi + 2];
    if (r < 28 && g < 28 && b < 28) {
      mask[idx] = 1;
      queue.push(lx, ly);
    }
  }

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  let head = 0;
  while (head < queue.length) {
    const qx = queue[head++];
    const qy = queue[head++];
    const neighbors = [
      [qx - 1, qy],
      [qx + 1, qy],
      [qx, qy - 1],
      [qx, qy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        push(nx, ny);
      }
    }
  }

  // 2. 连通域标记：提取最大前景连通块，彻底剔除孤岛、相邻残渣
  const visited = new Uint8Array(w * h);
  const components = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] || visited[idx]) continue;
      const comp = [];
      const cq = [x, y];
      visited[idx] = 1;
      let chead = 0;
      while (chead < cq.length) {
        const cx = cq[chead++];
        const cy = cq[chead++];
        comp.push([cx, cy]);
        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nidx = ny * w + nx;
            if (!mask[nidx] && !visited[nidx]) {
              visited[nidx] = 1;
              cq.push(nx, ny);
            }
          }
        }
      }
      components.push(comp);
    }
  }

  components.sort((a, b) => b.length - a.length);
  const main = components[0];
  if (!main || main.length < 500) {
    return null;
  }

  // 只把最大连通块内的像素记作前景
  const foreground = new Uint8Array(w * h);
  for (const [fx, fy] of main) {
    foreground[fy * w + fx] = 1;
  }

  // 3. 统计最大连通块的紧凑包围盒
  let bMinX = w, bMaxX = 0, bMinY = h, bMaxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (foreground[y * w + x]) {
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
    }
  }

  const bw = bMaxX - bMinX + 1;
  const bh = bMaxY - bMinY + 1;

  // 4. 等比缩放并完美居中渲染到 256x256 透明画布
  const TARGET_SIZE = 256;
  const TARGET_CONTENT = 236; // 留 10px 边距获得最佳视觉呼吸感
  const scale = TARGET_CONTENT / Math.max(bw, bh);
  const outW = Math.round(bw * scale);
  const outH = Math.round(bh * scale);
  const offsetX = Math.floor((TARGET_SIZE - outW) / 2);
  const offsetY = Math.floor((TARGET_SIZE - outH) / 2);

  const outBuf = Buffer.alloc(TARGET_SIZE * TARGET_SIZE * 4);

  for (let dy = 0; dy < outH; dy++) {
    const sy = Math.min(bh - 1, Math.floor(dy / scale));
    const srcY = bMinY + sy;
    for (let dx = 0; dx < outW; dx++) {
      const sx = Math.min(bw - 1, Math.floor(dx / scale));
      const srcX = bMinX + sx;

      if (foreground[srcY * w + srcX]) {
        const spi = ((minY + srcY) * srcImg.W + (minX + srcX)) * 4;
        const dpi = ((offsetY + dy) * TARGET_SIZE + (offsetX + dx)) * 4;
        outBuf[dpi] = srcImg.px[spi];
        outBuf[dpi + 1] = srcImg.px[spi + 1];
        outBuf[dpi + 2] = srcImg.px[spi + 2];
        outBuf[dpi + 3] = 255;
      }
    }
  }

  return encodePng(outBuf, TARGET_SIZE, TARGET_SIZE);
}

// 缓存全部切片
const slices = {};
console.log('开始精确切片提取 35 个候选位点...');
for (let r = 0; r < rowIntervals.length; r++) {
  for (let c = 0; c < colIntervals.length; c++) {
    const key = `${r}_${c}`;
    const png = extractBadge(r, c);
    if (png) {
      slices[key] = png;
      console.log(`  切片 [${r}, ${c}] 成功 (${png.length} 字节)`);
    } else {
      console.log(`  切片 [${r}, ${c}] 空白跳过`);
    }
  }
}

function saveIcon(relPath, sliceKey) {
  const fullPath = path.join(ROOT_DIR, relPath);
  const png = slices[sliceKey];
  if (!png) {
    console.error(`错误: 切片 ${sliceKey} 不存在!`);
    return;
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, png);
  console.log(`已写入: ${relPath}`);
}

console.log('\n===== 1. 重新分发 7 个模组的 Pack Icons =====');
saveIcon('mods/auto-refill/behavior_packs/auto-refill/pack_icon.png', '0_0');
saveIcon('mods/craftablerarities/behavior_packs/craftablerarities/pack_icon.png', '0_1');
saveIcon('mods/item-route/behavior_packs/item-route/pack_icon.png', '3_3');
saveIcon('mods/item-route/resource_packs/item-route/pack_icon.png', '3_3');
saveIcon('mods/keepinventory/behavior_packs/keepinventory/pack_icon.png', '0_3');
saveIcon('mods/mockplayer3/behavior_packs/mockplayer3/pack_icon.png', '0_4');
saveIcon('mods/mockplayer3/resource_packs/mockplayer3/pack_icon.png', '0_4');
saveIcon('mods/spectator-mode/behavior_packs/spectator-mode/pack_icon.png', '4_2');
saveIcon('mods/teleporter/behavior_packs/teleporter/pack_icon.png', '1_1');

console.log('\n===== 2. 重新分发 item-route 界面菜单图标 =====');
const irDir = 'mods/item-route/resource_packs/item-route/textures/ui/item-route';
saveIcon(`${irDir}/create_warehouse.png`, '1_2');
saveIcon(`${irDir}/warehouse_list.png`, '1_3');
saveIcon(`${irDir}/organize.png`, '1_4');
saveIcon(`${irDir}/search.png`, '3_2');
saveIcon(`${irDir}/manage.png`, '2_4');
saveIcon(`${irDir}/config.png`, '3_3');
saveIcon(`${irDir}/help.png`, '6_1');
saveIcon(`${irDir}/role_source.png`, '0_2');
saveIcon(`${irDir}/role_target.png`, '2_1');
saveIcon(`${irDir}/role_overflow.png`, '2_2');
saveIcon(`${irDir}/item_family.png`, '2_3');
saveIcon(`${irDir}/stats.png`, '3_1');
saveIcon(`${irDir}/exit.png`, '6_2');

console.log('\n===== 3. 重新分发 teleporter 界面菜单图标 =====');
const tpDir = 'mods/teleporter/resource_packs/teleporter/textures/ui/teleporter';
saveIcon('mods/teleporter/resource_packs/teleporter/pack_icon.png', '1_1');
saveIcon(`${tpDir}/warp.png`, '1_0');
saveIcon(`${tpDir}/warp_manage.png`, '1_1');
saveIcon(`${tpDir}/warp_create.png`, '1_2');
saveIcon(`${tpDir}/public_warps.png`, '3_4');
saveIcon(`${tpDir}/death_points.png`, '5_1');
saveIcon(`${tpDir}/player_teleport.png`, '0_4');
saveIcon(`${tpDir}/admin_settings.png`, '3_3');
saveIcon(`${tpDir}/teleport_to.png`, '4_1');
saveIcon(`${tpDir}/teleport_bring.png`, '5_3');
saveIcon(`${tpDir}/back.png`, '6_2');
saveIcon(`${tpDir}/delete_all.png`, '6_0');

console.log('\n全部重新分发完成！');
