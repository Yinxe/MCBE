// ── 玩家对象防御工具 ──
// world.getPlayers() 可能混入假人/无效对象：可能是 undefined、缺失属性、
// 或访问属性即抛错的对象。统一按"能读出 id / dimension / location"过滤。
// 不依赖 tag（他人假人模组不保证打我们的 tag），判据仅基于对象本身可用性。
import { Player, world } from "@minecraft/server";

/**
 * 判断对象是否为"可安全使用"的玩家。
 * 仅验证对象本身，不依赖任何 tag / 白名单。
 *
 * @param p - 待校验对象
 * @returns 可用（可读 id/location/dimension）为 true
 */
export function isUsablePlayer(p: unknown): p is Player {
  if (typeof p !== "object" || p === null || !(p instanceof Player)) return false;
  try {
    return typeof p.id === "string" && p.id.length > 0 && p.dimension !== undefined && p.location !== undefined;
  } catch {
    return false; // 访问抛错 → 视为失效对象
  }
}

/** 全部可用玩家（id → Player）；遍历异常时返回空表 */
export function allUsablePlayers(): Map<string, Player> {
  const map = new Map<string, Player>();
  try {
    for (const p of world.getPlayers()) {
      if (isUsablePlayer(p)) map.set(p.id, p);
    }
  } catch {
    // 世界遍历失败 → 返回空，调用方自行兜底
  }
  return map;
}

/** 按 id 查找可用玩家；不存在/无效返回 undefined */
export function findUsablePlayer(id: string): Player | undefined {
  return allUsablePlayers().get(id);
}

/**
 * 宽松查找：仅需实体在 getPlayers 列表且 id 匹配即可（加入早期 location/dimension
 * 可能尚未就绪，此时用本函数轮询到对象出现，再交由恢复流程安全操作）。
 */
export function findAnyPlayer(id: string): Player | undefined {
  try {
    return world.getPlayers().find((p) => p instanceof Player && p.id === id);
  } catch {
    return undefined;
  }
}
