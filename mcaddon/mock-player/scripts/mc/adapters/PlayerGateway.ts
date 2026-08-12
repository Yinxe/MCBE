// ─── 玩家/世界网关（mc 层） ─────────────────────────────
// SimulatedPlayer 解析、名称占用检测、区块加载检测、名称可用性轮询。
// 全部强绑定 world/entity，core 层不涉及。

import { system, world } from "@minecraft/server";
import type { Dimension, Player, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BOT_TAG } from "../../core/tags/BotTags";
import { botRegistry } from "../bootstrap/context";

/**
 * 根据假人名解析 SimulatedPlayer 实体。
 * 共享函数，避免各 feature 文件重复。
 */
export function resolveBotPlayer(name: string): SimulatedPlayer | undefined {
  const record = botRegistry.get(name);
  if (!record || !record.entityId) return undefined;
  try {
    const e = world.getEntity(record.entityId);
    if (!e?.isValid) return undefined;
    return e.hasTag(BOT_TAG) ? (e as SimulatedPlayer) : undefined;
  } catch { return undefined; }
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
 * resolve 表示名称已可用；reject 表示超时（但仍可强制上线）。
 */
export function waitForNameAvailable(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
        console.warn(`[MockPlayer] waitForNameAvailable 超时 ${name}`);
        reject(new Error(`waitForNameAvailable 超时 ${name}`));
        return;
      }
      system.runTimeout(check, NAME_POLL_INTERVAL);
    }

    // 首轮由 system.runTimeout 调度，确保在任何调用上下文都安全
    system.runTimeout(check, NAME_POLL_INTERVAL);
  });
}