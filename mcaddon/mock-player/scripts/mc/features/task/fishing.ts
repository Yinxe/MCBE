// ─── 钓鱼能力（mc 层） ─────────────────────────────────
// 假人操纵鱼竿的原子能力：发杆（抛钩）与收竿（收回）。
// 前置条件由鱼钩存在性决定（用户规格）：
//   无鱼钩 → 才能发杆；有鱼钩 → 才能收竿。
//
// ⚠️ MCBE 鱼竿右键是切换式操作：引擎按投掷者的鱼钩实体存在自动决定
//   抛竿/收竿——有钩时右键=收竿，无钩时右键=抛竿。能力层**显式校验**
//   防误操作：有钩时发杆会误收竿，无钩时收竿会误抛竿。
//
// 鱼钩存在性按主人 tag 查询（生成时打 mp:fisher:<名字>，见
// fishingHookTracker + core/tasks/FishingRules）。

import { system, world, BlockVolume } from "@minecraft/server";
import type { Dimension, Entity } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { AIR_BLOCK_ID, ADJACENT_8, classifyFishingScan, collectFishingSpots, computeCastAim, FISHING_HOOK_ID, isFishingRod, isWaterBlock, judgeStandFishingSpot, makeFisherTag, sortFishingSpots, WATER_BLOCK_IDS, type FindSpotsFailure, type FishingSpot } from "../../../rules/FishingRules";
import type { Vec3 } from "../../../model/Types";
import { BOT_TAG } from "../../../tags/BotTags";
import { botRegistry } from "../../bootstrap/context";

// ─── 常量 ────────────────────────────────────────────────

/** 鱼钩查询半径（格）：基岩版鱼线最长 32 格，40 留足余量（含浮漂入水后偏移） */
const HOOK_QUERY_RADIUS = 40;

// ─── 结果类型（区分度：可重试 vs 拒绝执行） ────────────

/** 发杆结果：cast=已发杆 / already-cast=鱼钩已在（拒绝重复发杆）/ no-rod=无鱼竿 / offline=假人不可用 / error=执行失败（可重试） */
export type CastRodResult = "cast" | "already-cast" | "no-rod" | "offline" | "error";

/** 收竿结果：reeled=已收竿 / no-hook=无鱼钩（拒绝空收竿）/ no-rod=无鱼竿 / offline=假人不可用 / error=执行失败（可重试） */
export type ReelRodResult = "reeled" | "no-hook" | "no-rod" | "offline" | "error";

// ─── 假人解析 ────────────────────────────────────────────

/**
 * 取在线（且未死亡）的假人实体。
 * ⚠️ 用户规格：nameTag 精确匹配优先（world.getPlayers({ name, tags })——
 *   实体名稳定，entityId 重连/重启后失效），registry entityId 回退双保险。
 */
export function resolveBotPlayer(botName: string): SimulatedPlayer | undefined {
  try {
    const player = world.getPlayers({ name: botName, tags: [BOT_TAG] })[0];
    if (player) {
      // 死亡中的假人实体仍在世界但不可操控
      if (botRegistry.get(botName)?.death) return undefined;
      return player as SimulatedPlayer;
    }
  } catch {
    /* 查询失败走 entityId 回退 */
  }
  const record = botRegistry.get(botName);
  if (!record?.online || record.death || !record.entityId) return undefined;
  try {
    const e = world.getEntity(record.entityId);
    return e?.hasTag(BOT_TAG) ? (e as SimulatedPlayer) : undefined;
  } catch {
    return undefined;
  }
}

/** 找鱼竿槽位：主手优先，其次热键栏 0-8；无鱼竿返回 undefined */
function findRodSlot(bot: SimulatedPlayer): number | undefined {
  try {
    const container = (bot.getComponent("minecraft:inventory") as
      | { container?: { getItem: (i: number) => { typeId?: string } | undefined } }
      | undefined)?.container;
    const selected = bot.selectedSlotIndex ?? 0;
    const candidates = [selected, ...Array.from({ length: 9 }, (_, i) => i).filter((i) => i !== selected)];
    for (const slot of candidates) {
      const item = container?.getItem(slot);
      if (item?.typeId && isFishingRod(item.typeId)) return slot;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 假人是否持有鱼竿（主手或热键栏；AI 感知/缺因判定用） */
export function hasFishingRod(botName: string): boolean {
  const bot = resolveBotPlayer(botName);
  return bot !== undefined && findRodSlot(bot) !== undefined;
}

// ─── 鱼钩存在性查询 ─────────────────────────────────────

/**
 * 查询假人自己的鱼钩实体（按主人 tag 匹配，生成时打 mp:fisher:<名字>）。
 * 维度/实体不可访问时返回空数组（安全降级）。
 */
export function findOwnHooks(botName: string): Entity[] {
  const bot = resolveBotPlayer(botName);
  if (!bot) return [];
  try {
    const { x, y, z } = bot.location;
    return bot.dimension.getEntities({
      type: FISHING_HOOK_ID,
      tags: [makeFisherTag(botName)],
      location: { x, y, z },
      maxDistance: HOOK_QUERY_RADIUS,
    });
  } catch (e) {
    console.warn(`[MockPlayer] findOwnHooks(${botName}) error: ${e}`);
    return [];
  }
}

/** 假人当前是否有自己的鱼钩 */
export function hasFishingHook(botName: string): boolean {
  return findOwnHooks(botName).length > 0;
}

// ─── 钓鱼状态查询 ────────────────────────────────────────

/** 钓鱼状态（查询用） */
export type FishingStatus = "fishing" | "idle";

/**
 * 查询假人钓鱼状态：**优先看鱼钩实体是否还在**（世界状态真值，最准确——
 * 抛竿即有钩、收竿/超时/失败后钩消失；不用流程内存锁判定，流程异常
 * 残留会永久误报 fishing）。
 */
export function getFishingStatus(botName: string): FishingStatus {
  return hasFishingHook(botName) ? "fishing" : "idle";
}

// ─── 寻找钓鱼点 ──────────────────────────────────────────

/** 寻找钓鱼点结果：spots=候选（按距离升序，失败时为空）+ reason=失败原因（undefined=成功） */
export interface FindFishingSpotsResult {
  /** 钓鱼点候选（按到中心坐标距离升序；失败时为空数组） */
  spots: FishingSpot[];
  /** 失败原因：no-water=范围内没有水面 / no-spot=有水面但无满足条件的钓鱼点 / error=扫描异常；undefined=成功 */
  reason?: FindSpotsFailure;
}

/**
 * 寻找钓鱼点（用户规格）：
 *   ① getBlocks 扫描以 center 为中心 radius 半径范围内的水方块
 *   ② 只留**水面**（水方块上方一定是空气）
 *   ③ 对每个水面检查水平 8 邻位置——钓鱼点条件：安全的实心方块（非岩浆块/
 *      岩浆，站上不掉血）+ **上方两格都是空气**（假人安全站立）
 *   ④ 同一站立格被多个水面共享时去重（相邻水面坐标全部收集）
 *   ⑤ 按到 center 的平方距离升序排序
 * 异常：没有水面 → no-water；有水面但无钓鱼点 → no-spot；扫描失败 → error
 *
 * @param center - 中心坐标（排序基准，也是扫描中心）
 * @param dimension - 扫描维度
 * @param radius - 扫描半径（格，正方体半边长）
 * @returns 候选钓鱼点（含坐标与全部相邻水面）+ 失败原因
 */
export function findFishingSpots(center: Vec3, dimension: Dimension, radius: number): FindFishingSpotsResult {
  // ① ② getBlocks 扫描水方块 + 水面筛选（水方块上方 1 格是空气）
  let surfaces: Vec3[] = [];
  try {
    const volume = new BlockVolume(
      { x: center.x - radius, y: center.y - radius, z: center.z - radius },
      { x: center.x + radius, y: center.y + radius, z: center.z + radius }
    );
    const intersection = dimension.getBlocks(volume, { includeTypes: [...WATER_BLOCK_IDS] });
    for (const loc of intersection.getBlockLocationIterator()) {
      const above = dimension.getBlock({ x: loc.x, y: loc.y + 1, z: loc.z });
      if (above && above.typeId === AIR_BLOCK_ID) {
        surfaces.push(loc);
      }
    }
  } catch (e) {
    console.warn(`[MockPlayer] findFishingSpots scan error: ${e}`);
    return { spots: [], reason: "error" };
  }

  // ③④⑤ 8 邻候选 + 条件过滤 + 多水面去重（core 纯逻辑）→ 距离升序
  const candidates = collectFishingSpots(
    surfaces,
    (loc) => dimension.getBlock(loc)?.typeId,
    (loc) => {
      // 实体实心判定：非空气非液体（MCBE 无 Block.isSolid，近似判定）
      const block = dimension.getBlock(loc);
      return block ? !block.isAir && !block.isLiquid : false;
    }
  );
  const spots = sortFishingSpots(candidates, center);
  const reason = classifyFishingScan(surfaces.length, spots.length);
  if (reason) console.warn(`[MockPlayer] findFishingSpots: ${reason} (surfaces=${surfaces.length})`);
  return { spots, reason };
}

// ─── 发杆 / 收竿 ─────────────────────────────────────────

/**
 * 执行鱼竿右键（异步：system.run 调度到下一 tick，Promise 返回真实执行结果）。
 * ⚠️ 实体有效性防护：死亡/下线/重连瞬间实体失效，useItemInSlot 会抛错 → resolve false。
 */
function useRod(bot: SimulatedPlayer, botName: string, slot: number): Promise<boolean> {
  return new Promise((resolve) => {
    system.run(() => {
      try {
        if (!bot.isValid) {
          resolve(false);
          return;
        }
        bot.selectedSlotIndex = slot;
        const used = bot.useItemInSlot(slot);
        console.warn(`[MockPlayer] useRod ${botName} slot=${slot}: ${used ? "ok" : "failed"}`);
        resolve(used);
      } catch (e) {
        console.warn(`[MockPlayer] useRod ${botName} error: ${e}`);
        resolve(false);
      }
    });
  });
}

/**
 * 发杆（抛钩）：**仅当假人无鱼钩时**使用鱼竿。
 * ⚠️ 有鱼钩时拒绝（MCBE 右键会变成收竿，误操作）。
 */
export async function castFishingRod(botName: string): Promise<CastRodResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return "offline";
  if (hasFishingHook(botName)) return "already-cast";
  const slot = findRodSlot(bot);
  if (slot === undefined) return "no-rod";
  const used = await useRod(bot, botName, slot);
  return used ? "cast" : "error";
}

/**
 * 收竿（收回钩子）：**仅当假人有鱼钩时**使用鱼竿。
 * ⚠️ 无鱼钩时拒绝（MCBE 右键会变成抛竿，误操作）。
 */
export async function reelFishingRod(botName: string): Promise<ReelRodResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return "offline";
  if (!hasFishingHook(botName)) return "no-hook";
  const slot = findRodSlot(bot);
  if (slot === undefined) return "no-rod";
  const used = await useRod(bot, botName, slot);
  return used ? "reeled" : "error";
}

// ─── 钓鱼点状态检测（AI 行为用：点位判定/实体占用/可用性） ──

/** 钓鱼点占用判定半径（格，用户规格：点位半径 1 内任何实体都算占用） */
const SPOT_OCCUPY_RADIUS = 1;

/**
 * 轻量判定某坐标是否构成钓鱼点（AI 选点/就位用）：读支撑块 + 上方两格 +
 * 同层 8 邻水面（~11 次 getBlock，替代 getBlocks 全扫描——高精度计算能避免
 * 就避免）。构成钓鱼点时附带 waters/aim（瞄准点计算复用 computeCastAim）。
 */
export function spotAtStand(dimension: Dimension, stand: Vec3): FishingSpot | undefined {
  try {
    const supportLoc = { x: stand.x, y: stand.y - 1, z: stand.z };
    const support = dimension.getBlock(supportLoc);
    if (!support || support.isAir || support.isLiquid) return undefined; // 支撑必须实体实心
    const above1 = dimension.getBlock({ x: stand.x, y: stand.y, z: stand.z });
    const above2 = dimension.getBlock({ x: stand.x, y: stand.y + 1, z: stand.z });
    // 同层 8 邻水面收集（支撑块与水相邻）
    const waters: Vec3[] = [];
    for (const { dx, dz } of ADJACENT_8) {
      const w = dimension.getBlock({ x: supportLoc.x + dx, y: supportLoc.y, z: supportLoc.z + dz });
      if (w && isWaterBlock(w.typeId)) {
        waters.push({ x: supportLoc.x + dx, y: supportLoc.y, z: supportLoc.z + dz });
      }
    }
    if (!judgeStandFishingSpot(stand, support.typeId, above1?.typeId ?? "", above2?.typeId ?? "", waters.length)) {
      return undefined;
    }
    const aim =
      computeCastAim(stand, waters, (loc) => {
        const b = dimension.getBlock(loc);
        return b !== undefined && isWaterBlock(b.typeId);
      }) ?? { target: waters[0]!, level: 1 };
    return { stand, support: supportLoc, waters, aim };
  } catch {
    return undefined;
  }
}

/**
 * 钓鱼点是否被实体占用（用户规格：**任何实体**占用点位半径 1 都导致不可用——
 * 实体占用的点鱼钩抛不出去（会勾中实体 → snagged 失败））。排除查询者自己
 * （excludeEntityId）与 **fishing_hook 鱼钩**（钓具不阻挡抛竿——其他假人的
 * 浮漂常在岸边 1 格内水面，若算占用会导致点位被误判不可用）。
 * 实时检测天然实现"释放"：实体离开 → 自动释放。
 */
export function isSpotOccupiedByEntity(
  dimension: Dimension,
  stand: Vec3,
  excludeEntityId?: string,
  radius: number = SPOT_OCCUPY_RADIUS
): boolean {
  try {
    return dimension
      .getEntities({ location: stand, maxDistance: radius })
      .some((e) => e.id !== excludeEntityId && e.typeId !== FISHING_HOOK_ID);
  } catch {
    return true; // 维度不可访问按占用处理（保守）
  }
}

/**
 * 钓鱼点当前是否可被假人使用（用户规格："用起来更直接"）：点位仍有效
 * （spotAtStand 判定） **且** 未被任何实体占用。
 */
export function isSpotUsable(dimension: Dimension, stand: Vec3, excludeEntityId?: string): boolean {
  if (isSpotOccupiedByEntity(dimension, stand, excludeEntityId)) return false;
  return spotAtStand(dimension, stand) !== undefined;
}
