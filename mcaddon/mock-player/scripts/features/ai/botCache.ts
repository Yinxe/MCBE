// ─── 假人实体解析缓存（性能：行为 step 避免重复世界查询） ──
// resolveBotPlayer 每次调用都是 world.getPlayers 全量查询（遍历在线玩家
// 过滤）——引擎周期内行为多次调用（canActivate/step/lookAround/停止移动）
// 会造成多次查询。本缓存：每 TTL（= 引擎周期 10 tick）最多一次真实查询/
// 假人，期内共享同一实体引用；过期自动重查（实体替换/死亡最迟一个周期
// 内感知）；假人下线（botOffline）立即失效。

import { system, world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { resolveBotPlayer } from "../../bot/PlayerGateway";

/** 缓存有效期（tick）：对齐引擎周期——每周期最多一次真实查询/假人 */
const CACHE_TTL_TICKS = 10;

/** 缓存条目（实体 + 解析时刻） */
interface CacheEntry {
  bot: SimulatedPlayer | undefined;
  tick: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * 解析假人实体（带缓存）：TTL 期内共享缓存实体；过期/未命中 → 真实查询。
 * @param name 假人名
 * @returns 假人实体（离线/死亡/无效 → undefined）
 */
export function resolveBotCached(name: string): SimulatedPlayer | undefined {
  const entry = cache.get(name);
  if (entry && system.currentTick - entry.tick < CACHE_TTL_TICKS) {
    return entry.bot;
  }
  const bot = resolveBotPlayer(name);
  cache.set(name, { bot, tick: system.currentTick });
  return bot;
}

/** 立即失效（假人下线/删除——实体引用不可再复用） */
export function invalidateBotCache(name: string): void {
  cache.delete(name);
}

/** 清空全部缓存（重置/测试用） */
export function clearBotCache(): void {
  cache.clear();
}

// 引用 world 保持模块加载语义（缓存条目使用 world 查询结果，无副作用）
void world;
