// ─── 生成模式管理 ──────────────────────────────────────
//
// normal → 模块级 spawnSimulatedPlayer（完全体态控制，无常加载）
// chunkload → test.spawnSimulatedPlayer（强加载区块，不可转向）
//
// ⚠️ 重名防护：任何生成必须先确保名称唯一可用（异步轮询 +
//    残留实体清理），否则旧实体尚未释放时立即 spawn，引擎会
//    生成 "sim001(2)" 重名假人，事件按 Player.name 查注册表
//    全部失配 → 状态保存失败 → 数据丢失。

import { GameMode, Player, system, world } from "@minecraft/server";
import { SimulatedPlayer, spawnSimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { finalizeBotSpawn } from "./spawn";
import { globalTest } from "../bootstrap/gametestContext";
import { color } from "@yinxe/toolkit";

export type SpawnMode = "normal" | "chunkload";

export interface SpawnModeInfo {
  value: SpawnMode;
  label: string;
  desc: string;
  limitations: string[];
}

const MODE_NORMAL = "normal" as const;
const MODE_CHUNKLOAD = "chunkload" as const;

export const MODE_NORMAL_INFO: SpawnModeInfo = {
  value: MODE_NORMAL,
  label: `${color.success}普通模式`,
  desc: "完全体态可操控",
  limitations: [],
};

export const MODE_CHUNKLOAD_INFO: SpawnModeInfo = {
  value: MODE_CHUNKLOAD,
  label: `${color.accent}强加载模式`,
  desc: "区块持续加载，但不可转向",
  limitations: [
    "不支持体态同步",
    "TP 时不会设置朝向",
    "扭头不可用（GameTest 限制）",
    "异地上线仅加载当前区块附近，需玩家靠近后补足模拟距离",
    "假人重新上线后，之前辅助加载的区块会失效，需玩家再次靠近",
  ],
};

export function getSpawnModeInfo(mode?: SpawnMode): SpawnModeInfo {
  return mode === MODE_CHUNKLOAD ? MODE_CHUNKLOAD_INFO : MODE_NORMAL_INFO;
}

// ─── 重名防护：确保名称唯一后再真正生成 ────────────────
// disconnect 后旧实体需异步清理，立即重生成会得到 "sim001(2)"
// 重名假人（Player.name ≠ record.name → 事件查表失配 → 数据丢失）。
// 因此任何 spawn 前都先轮询名称可用，并对残留实体做强制释放；
// 生成后还会二次校验名称，仍重名则销毁重试，绝不留下 "(2)" 实体。

const NAME_WAIT_TICKS = 2; // 每 2 tick 轮询一次
const NAME_WAIT_LIMIT = 120; // 120 × 2 tick ≈ 12 秒超时
const nameSpawnLocks = new Map<string, Promise<unknown>>();

/** 该实体当前是否被某个在线 record 认领（在线假人，不能误杀） */
function isTrackedEntity(entityId: string): boolean {
  for (const r of botRegistry.all()) {
    if (r.entityId === entityId) return true;
  }
  return false;
}

/** 找到阻碍 `name` 可用的实体：同名实体 + 历史残留的同名 "(N)" 幽灵 */
function findNameBlockers(name: string): Player[] {
  const exact = world.getPlayers({ name });
  const suffixGhosts = world
    .getPlayers({ tags: [BOT_TAG] })
    .filter((p) => p.name.startsWith(`${name}(`));
  return exact.length > 0 ? [exact[0], ...suffixGhosts] : suffixGhosts;
}

/** 等待名称可用：放行条件=无同名实体且无残留 "(N)" 幽灵。超时也 resolve，交给生成后校验兜底 */
function waitNameFree(name: string): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;

    function check(): void {
      const blockers = findNameBlockers(name);
      if (blockers.length === 0) { resolve(); return; }

      // 可安全释放的残留实体（无 record 认领）→ 强制 disconnect 以加速
      for (const p of blockers) {
        if (isTrackedEntity(p.id)) continue; // 在线假人，不碰
        // ⚠️ 真实玩家同名（改名撞名边缘场景）不可 disconnect（会把真人踢下线），等超时兜底
        if (!p.hasTag(BOT_TAG)) continue;
        try { (p as unknown as SimulatedPlayer).disconnect(); } catch { /* 实体可能刚消失 */ }
      }

      attempts++;
      if (attempts >= NAME_WAIT_LIMIT) {
        console.warn(`[MockPlayer] 等待名称释放超时 ${name}，交由生成后校验兜底`);
        resolve();
        return;
      }
      system.runTimeout(check, NAME_WAIT_TICKS);
    }

    // 首轮也延迟调度，确保在任意调用上下文都安全
    system.runTimeout(check, NAME_WAIT_TICKS);
  });
}

/**
 * 生成结果：bot + 名称校验通过后才执行的收尾。
 * finalize 再写 entityId / 打标签 / 注册，避免失败重试留下脏记录。
 */
interface SpawnResult {
  bot: SimulatedPlayer;
  finalize: () => void;
}

// ─── 普通模式（含 chunkload 失败回退） ────────────────

function normalResult(
  record: BotRecord,
  location: any,
  dimension: any,
  rotation: { x: number; y: number },
  lookTarget?: any,
  noPose?: boolean,
): SpawnResult {
  const rot2 = noPose ? { x: 0, y: 0 } : rotation;
  const target = noPose ? undefined : lookTarget;
  const bot = spawnSimulatedPlayer(
    { x: location.x, y: location.y, z: location.z, dimension },
    record.name,
    GameMode.Survival,
  );
  return {
    bot,
    finalize: (): void => {
      bot.teleport(location, { dimension });
      record.entityId = bot.id;
      finalizeBotSpawn(bot, record, rot2, target, noPose);
    },
  };
}

function chunkloadResult(
  record: BotRecord,
  location: any,
  dimension: any,
): SpawnResult {
  if (!globalTest) {
    console.warn(`[MockPlayer] GameTest 未就绪，${record.name} 改用普通模式`);
    return normalFallbackResult(record, location, dimension);
  }

  const bot = globalTest.spawnSimulatedPlayer({ x: 0, y: 8, z: 0 }, record.name, GameMode.Survival);
  const okTeleport = ((): boolean => {
    try {
      (bot as any).setSpawnPoint({ ...location, dimension });
      bot.teleport(location, { dimension });
      return true;
    } catch (e: any) {
      console.warn(`[MockPlayer] chunkload 传送失败 ${record.name}，改普通模式`);
      return false;
    }
  })();

  if (!okTeleport) {
    try { bot.disconnect(); } catch { /* ignore */ }
    return normalFallbackResult(record, location, dimension);
  }

  return {
    bot,
    finalize: (): void => {
      record.entityId = bot.id;
      finalizeBotSpawn(bot, record, { x: 0, y: 0 }, undefined, true);
    },
  };
}

function normalFallbackResult(
  record: BotRecord,
  location: any,
  dimension: any,
): SpawnResult {
  return normalResult(record, location, dimension, { x: 0, y: 0 }, undefined, true);
}

// ─── 生成入口（异步 + 重名防护） ───────────────────────

/**
 * 生成假人。串行化同名的并发请求（双发不再重名竞争），流程：
 *   1. 等待名称唯一（旧实体释放 / 幽灵清理）
 *   2. 真正 spawn
 *   3. 生成后校验 bot.name === record.name——若引擎仍给了 "(N)" 后缀，
 *      销毁重试一次；仍失败则销毁并抛错（绝不留 "(2)" 假人）
 */
export function spawnBot(
  record: BotRecord,
  location: { x: number; y: number; z: number },
  dimension: any,
  rotation: { x: number; y: number },
  lookTarget?: { x: number; y: number; z: number },
): Promise<SimulatedPlayer> {
  const mode = record.spawnMode ?? MODE_NORMAL;
  const makeResult = (): SpawnResult => {
    if (mode === MODE_CHUNKLOAD) return chunkloadResult(record, location, dimension);
    return normalResult(record, location, dimension, rotation, lookTarget);
  };

  // 前一个任务失败（reject）也必须放行后续生成，否则同名假人会被永久卡死
  const prev = (nameSpawnLocks.get(record.name) ?? Promise.resolve()).catch(() => {});
  const run = prev.then(async () => {
    await waitNameFree(record.name);

    const first = makeResult();
    if (first.bot.name === record.name) {
      first.finalize();
      return first.bot;
    }

    // 名称校验未通过：销毁并重试一次
    console.warn(`[MockPlayer] 生成后检测到重名 ${first.bot.name}（目标 ${record.name}），清理重试`);
    try { first.bot.disconnect(); } catch { /* ignore */ }
    const retry = makeResult();
    if (retry.bot.name !== record.name) {
      console.error(`[MockPlayer] 重试后仍重名 ${retry.bot.name}，放弃生成 ${record.name}`);
      try { retry.bot.disconnect(); } catch { /* ignore */ }
      throw new Error(`无法为假人 ${record.name} 获得唯一名称，已取消生成（避免数据丢失）`);
    }
    retry.finalize();
    return retry.bot;
  });
  nameSpawnLocks.set(record.name, run);
  const clean = (): void => {
    if (nameSpawnLocks.get(record.name) === run) nameSpawnLocks.delete(record.name);
  };
  run.then(clean, clean);
  return run;
}

// ─── 模式切换 ──────────────────────────────────────────

export function switchSpawnMode(record: BotRecord, newMode: SpawnMode): void {
  record.spawnMode = newMode;
  // ⚠️ 离线路径（行为面板直接切换）无 playerJoin 兜底，必须显式写穿持久化
  saveCoordinator.saveRecord(record);
}