// ─── 拾取掉落物流程（mc 层：磁吸传送拾取） ────────────
// vacuumNearbyDrops（磁吸拾取，2026-09-03 用户规格——**废弃**旧"导航走近 +
// 等吸入"思路）：直接扫描假人半径 10 格内**感兴趣掉落物**（typeId 白名单），
// 把它们 **teleport 到假人脚下**，等待 ~0.5 秒自动入包：
//   - 零寻路零走动（旧思路：导航逐个靠近——慢、可能卡方块、多目标来回跑）
//   - 砍树模式（原木/收集）每棵树完成后、钓鱼模式每轮收竿后各扫一轮
//   - 兴趣白名单由调用方给定：砍树 = 圆木/树叶（rules/tree）；钓鱼 = 鱼获类
//     （rules/fishing/LootWhitelist——不误吸其他玩家/环境掉落）
//
// ⚠️ mc 适配层：按 flow 风格永不 reject。

import type { Entity } from "@minecraft/server";

import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { waitTicks } from "../utils";

// ─── 常量 ──────────────────────────────────────────────

/** 磁吸扫描半径（格） */
const VACUUM_RADIUS = 10;
/** 传送后等待自动入包（tick = 0.5 秒） */
const VACUUM_WAIT_TICKS = 10;
/** 单轮磁吸传送数量上限（防极端掉落物洪峰一次性挤爆） */
const VACUUM_CAP = 64;

// ─── 工具 ──────────────────────────────────────────────

/** 读掉落物物品 typeId（minecraft:item 组件；读取失败返回 "minecraft:item"） */
function dropTypeId(e: Entity): string {
  try {
    const comp = e.getComponent("minecraft:item") as { itemStack?: { typeId: string } } | undefined;
    return comp?.itemStack?.typeId ?? "minecraft:item";
  } catch {
    return "minecraft:item";
  }
}

// ─── 磁吸拾取 ──────────────────────────────────────────

/**
 * 磁吸拾取附近感兴趣的掉落物（永不 reject）：
 * 扫描假人半径 10 格内 `minecraft:item` 掉落物 → typeId 白名单过滤 →
 * **teleport 到假人脚下**（贴地位置，拾取半径内）→ 等 0.5 秒自动入包。
 *
 * 与旧导航式拾取（已删除）的区别：零寻路零走动——传送即达，速度快且不受
 * 地形卡阻；砍树/钓鱼每轮完成后的例行收尾。
 *
 * @param botName      假人名
 * @param includeTypes 感兴趣掉落物 typeId 白名单（空数组 = 全部掉落物）
 * @returns 传送的掉落物数量（0 = 附近无感兴趣掉落物）
 */
export async function vacuumNearbyDrops(botName: string, includeTypes: readonly string[]): Promise<number> {
  const bot = resolveBotPlayer(botName);
  if (!bot?.isValid) return 0;

  // ① 扫描半径内掉落物（getEntities 按位置过滤；白名单就地过滤）
  let drops: Entity[] = [];
  try {
    drops = bot.dimension.getEntities({
      type: "minecraft:item",
      location: bot.location,
      maxDistance: VACUUM_RADIUS,
    });
  } catch {
    return 0; // 扫描失败（区块未加载等）→ 本轮放弃
  }
  const wanted = includeTypes.length > 0 ? new Set(includeTypes) : undefined;
  const targets = drops.filter((e) => {
    try {
      if (!e.isValid) return false;
      const typeId = dropTypeId(e);
      return wanted ? wanted.has(typeId) : true;
    } catch {
      return false;
    }
  });

  // ② 传送掉落物到假人脚下（贴地：脚下 0.2 格——拾取半径内即自动吸入；
  //    多目标微散布 ±0.15 格，防全部叠同一点）
  let teleported = 0;
  const base = bot.location;
  for (const [i, e] of targets.entries()) {
    if (teleported >= VACUUM_CAP) break;
    try {
      const jitter = i % 4; // 0..3 微散布
      const d = (jitter & 1 ? 1 : -1) * 0.15 * (jitter >> 1);
      e.teleport({ x: base.x + d, y: base.y - 0.2, z: base.z + d });
      teleported++;
    } catch {
      /* 单个传送失败跳过（实体被捡/消失） */
    }
  }
  if (teleported === 0) return 0;

  // ③ 等待自动入包（传送即拾取半径内；0.5 秒兜底吸完）
  await waitTicks(VACUUM_WAIT_TICKS);
  return teleported;
}

