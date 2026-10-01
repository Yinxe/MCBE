// ─── 原子层公共基元（各原子共享的解析/读块/射线/等待件） ────────────
// 全部原子以 botId 寻址（句柄只经 EntityGateway 解析）、结果枚举化不抛穿、
// 协程节拍走 clock.sleep、世界读全部 try-catch（区块瞬态）、零日志输出。

import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { Container, Block, Dimension, ItemStack } from "@minecraft/server";
import { world } from "@minecraft/server";
import type { CancelToken } from "../domain/Cancellation";
import type { Vec3 } from "../domain/Coords";
import { clock } from "./Clock";
import { entityGateway } from "./EntityGateway";

/** 方块观测三元组（domain 判定纯逻辑统一喂这个形状） */
export interface BlockInfo {
  id: string;
  air: boolean;
  liquid: boolean;
}

/** 物品附魔清单（enchantable 组件；无组件/读取瞬态一律空表——指纹退化到裸 typeId） */
export function itemEnchantments(item: ItemStack): { id: string; level: number }[] {
  try {
    const ench = item.getComponent("minecraft:enchantable") as
      { getEnchantments(): { type: { id: string }; level: number }[] } | undefined;
    return ench?.getEnchantments().map((e) => ({ id: e.type.id, level: e.level })) ?? [];
  } catch {
    return [];
  }
}

/** 维度解析（无效/未登记返回 undefined——调用方按失败处理，绝不抛穿） */
export function dimensionOf(dimId: string): Dimension | undefined {
  try {
    return world.getDimension(dimId);
  } catch {
    return undefined;
  }
}

/**
 * 读方块观测；未加载/越界返回 undefined（不可读≠不存在，调用方各自保守处理）。
 * @param loc 已 floor 的整数格坐标
 * @returns 方块观测三元组或 undefined
 */
export function readBlock(dimId: string, loc: Vec3): BlockInfo | undefined {
  const dim = dimensionOf(dimId);
  if (!dim) return undefined;
  return readBlockIn(dim, loc);
}

/** 已有维度句柄时的读块（同语义） */
export function readBlockIn(dim: Dimension, loc: Vec3): BlockInfo | undefined {
  try {
    const b: Block | undefined = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
    if (!b) return undefined;
    return { id: b.typeId, air: b.isAir, liquid: b.isLiquid };
  } catch {
    return undefined;
  }
}

/** 引擎权威方块中心；瞄准必须用它，自算 +0.5 有精度坑 */
export function blockCenterIn(dim: Dimension, loc: Vec3): Vec3 | undefined {
  try {
    const b = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
    if (!b) return undefined;
    const c = b.center();
    return { x: c.x, y: c.y, z: c.z };
  } catch {
    return undefined;
  }
}

/** 原子用实体解析（离线/瞬态失效统一 null，调用方回 Offline 结果） */
export function botOf(botId: number, knownEntityId?: string): SimulatedPlayer | null {
  return entityGateway.resolveBot(botId, knownEntityId);
}

/** 句柄有效性回读；死亡/断连瞬间 isValid 会抛，必须 try 包裹 */
export function botValid(bot: SimulatedPlayer): boolean {
  try {
    return bot.isValid;
  } catch {
    return false;
  }
}

/** 背包容器取句柄（组件不可用/瞬态异常 undefined——调用方按失败处理） */
export function inventoryContainer(entity: SimulatedPlayer): Container | undefined {
  try {
    return entity.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

/**
 * 可取消的 tick 等待；cancel 后经 token.signal 提前返回，不等定时器到期。
 * @param ticks 等待 tick 数
 * @param token 可选取消令牌
 * @returns 到期或被取消时 resolve 的 Promise
 */
export function sleepTicks(ticks: number, token?: CancelToken): Promise<void> {
  const t = clock.sleep(ticks);
  return token ? Promise.race([t, token.signal]) : t;
}

/** 坐标 floor 取整（F-25：方块瞄准一律 floor，round 在负半轴错位） */
export function blockFloor(p: Vec3): Vec3 {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/** 射线命中观测（格坐标已 floor；center 为引擎权威中心） */
export interface RayHit {
  id: string;
  location: Vec3;
  center: Vec3;
}

/** 引擎准星射线（破坏 LOS / 放置回读共用；未命中/瞬态失效 undefined） */
export function rayHit(bot: SimulatedPlayer, maxDistance: number): RayHit | undefined {
  try {
    const hit = bot.getBlockFromViewDirection({ maxDistance });
    if (!hit) return undefined;
    const b = hit.block;
    return { id: b.typeId, location: blockFloor(b.location), center: b.center() };
  } catch {
    return undefined;
  }
}

/** 任意格子的引擎权威中心（能力瞄准候选格用，同防自算 +0.5 精度坑） */
export function blockCenter(dimId: string, loc: Vec3): Vec3 | undefined {
  const dim = dimensionOf(dimId);
  return dim ? blockCenterIn(dim, loc) : undefined;
}
