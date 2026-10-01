// ─── 玩家/世界网关（mc 层） ─────────────────────────────
// SimulatedPlayer 解析、名称占用检测、区块加载检测、名称可用性轮询。
// 全部强绑定 world/entity，core 层不涉及。

import { system, world } from "@minecraft/server";
import type { Dimension, Player, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BOT_TAG } from "../rules/tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { BotEvents } from "../events/DomainEvents";

/**
 * 假人实体解析（**唯一入口，含缓存**）：
 * 两路解析：先按"名字+假人标签"查世界玩家（快路径），失败回退注册表
 * entityId；死亡假人返回 undefined（实体不可操控）。查询全程 try-catch
 * 防御（受限上下文/未加载返回 undefined）。
 *
 * ⚠️ 缓存（数据单源约定）：本函数是全部调用方（BotCore.entity / 行为
 * 能力 / features 端口）唯一的实体访问入口——缓存内聚于此，**禁止在
 * 别处再建实体缓存**（数据位置多了不一致难维护）。TTL = 10 tick（引擎
 * 周期）内共享同一实体引用；生命周期事件（上线/下线/死亡/复活）立即失效。
 */
const ENTITY_CACHE_TTL_TICKS = 10;
const entityCache = new Map<string, { bot: SimulatedPlayer | undefined; tick: number }>();

function invalidateEntityCache(name: string): void {
  entityCache.delete(name);
}

// 生命周期事件 → 缓存立即失效（重连/复活 = 新实体，强制重解析）
BotEvents.botOffline.subscribe((e) => invalidateEntityCache(e.botName));
BotEvents.botDeath.subscribe((e) => invalidateEntityCache(e.botName));
BotEvents.botOnline.subscribe((e) => invalidateEntityCache(e.botName));
BotEvents.botRespawn.subscribe((e) => invalidateEntityCache(e.botName));

/** 清空实体缓存（重置/测试用） */
export function clearEntityCache(): void {
  entityCache.clear();
}

/** 安全读取当前 tick（early execution 时 system.currentTick 会抛——返回 0，
 *  缓存按"差值 < TTL"视为未过期，early 期实体也不变化） */
function safeCurrentTick(): number {
  try {
    return system.currentTick;
  } catch {
    return 0;
  }
}

export function resolveBotPlayer(name: string): SimulatedPlayer | undefined {
  // 缓存命中（TTL 内）→ 直接返回（每假人每引擎周期最多一次真实世界查询）
  const cached = entityCache.get(name);
  if (cached && safeCurrentTick() - cached.tick < ENTITY_CACHE_TTL_TICKS) {
    return cached.bot;
  }
  let bot: SimulatedPlayer | undefined;
  try {
    const player = world.getPlayers({ name, tags: [BOT_TAG] })[0];
    if (player) {
      if (botRegistry.get(name)?.death) {
        bot = undefined;
      } else {
        bot = player as SimulatedPlayer;
      }
    }
  } catch {
    /* 查询失败走 entityId 回退 */
  }
  if (!bot) {
    const record = botRegistry.get(name);
    if (record?.online && !record.death && record.entityId) {
      try {
        const e = world.getEntity(record.entityId);
        if (e?.isValid && e.hasTag(BOT_TAG)) bot = e as SimulatedPlayer;
      } catch {
        /* 回退失败按无实体 */
      }
    }
  }
  entityCache.set(name, { bot, tick: safeCurrentTick() });
  return bot;
}

/**
 * 世界中是否已有同名玩家实体（在线假人 / 真人）。
 * 判定是否会生成 "name(2)" 重名假人的【权威依据】是世界中在线的玩家实体，
 * 而非 botRegistry（注册表可能残留与真实世界不同步的名字）。
 * 受限上下文拿不到世界查询时降级返回 false，交由 spawn 阶段的校验兜底。
 */
export function isNameOccupiedInWorld(name: string): boolean {
  try {
    return world.getPlayers({ name }).length > 0;
  } catch {
    return false;
  }
}

/**
 * 检测指定位置的区块是否已加载
 * 通过访问 Block.typeId 迫使引擎加载区块，以 catch 判断状态
 */
export function isChunkLoaded(dimension: Dimension, pos: Vector3): boolean {
  try {
    const block = dimension.getBlock({
      x: Math.floor(pos.x),
      y: Math.max(Math.floor(pos.y), -64),
      z: Math.floor(pos.z),
    });
    if (!block) return false;
    const _ = block.typeId;
    return true;
  } catch {
    return false;
  }
}

// ─── 名称可用性轮询 ──────────────────────────────────────

const NAME_POLL_INTERVAL = 2;
const NAME_POLL_MAX = 60 / 2; // 60 tick 超时 ≈ 3 秒

/**
 * 轮询等待假人名称在世界上完全释放（无同名实体）。
 * disconnect 后旧实体需异步清理，提前 spawn 会导致 "(2)" 重名后缀。
 * ⚠️ 永不 reject：超时也 resolve（调用方可强制上线，由生成后校验兜底）。
 * 异步环境纪律：最外层 Promise 一律 resolve，错误不抛异常（防游戏崩溃）。
 */
export function waitForNameAvailable(name: string): Promise<void> {
  return new Promise((resolve) => {
    let polls = 0;

    function check(): void {
      try {
        const players = world.getPlayers({ name });
        if (players.length === 0) { resolve(); return; }
      } catch {
        // 降级：遍历所有维度扫 player 实体
        try {
          let found = false;
          for (const dimId of ["overworld", "nether", "the_end"]) {
            try {
              const dim = world.getDimension(dimId);
              const entities = dim.getEntities({ type: "minecraft:player" });
              for (const e of entities) {
                if ((e as Player).name === name) { found = true; break; }
              }
            } catch { /* skip */ }
            if (found) break;
          }
          if (!found) { resolve(); return; }
        } catch { resolve(); return; }
      }

      polls++;
      if (polls >= NAME_POLL_MAX) {
        console.warn(`[MockPlayer] waitForNameAvailable 超时 ${name}（超时仍 resolve，强制上线由生成后校验兜底）`);
        resolve();
        return;
      }
      system.runTimeout(check, NAME_POLL_INTERVAL);
    }

    // 首轮由 system.runTimeout 调度，确保在任何调用上下文都安全
    system.runTimeout(check, NAME_POLL_INTERVAL);
  });
}