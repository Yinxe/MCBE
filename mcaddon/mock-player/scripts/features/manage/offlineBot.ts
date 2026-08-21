// ─── 假人下线（安全下线，含模拟4） ─────────────────
//
// 安全下线流程：
//   - 常加载模式：申请模拟4(固定名排队) → 下线假人 → 等待3秒 → 卸载模拟4
//   - 普通模式  ：下线假人 → 等待2秒
//   无论成功/失败，已申请的区域必定卸载。
//   固定名与上线不同（mockplayer:safe_offline vs mockplayer:safe_online）以减少并发冲突。
//   资源有限需排队，队列已内置，批量下线无需外部冷却。

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry, configStore, saveCoordinator } from "../../bootstrap/context";
import { TICKS_PER_SECOND, UNLIMITED_QUOTA } from "../../rules/Types";
import { trackBotOffline } from "../trident/tridentTracker";
import {
  createSim4Area,
  removeSim4Area,
  SAFE_OFFLINE_TICKING_AREA_NAME,
} from "./tickingArea";

/** 下线结果 */
export interface OfflineResult {
  ok: boolean;
  reason?: string;
}

function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}
function getCooldownTicks(): number {
  const sec = configStore.getSafeCooldownSeconds();
  return sec * TICKS_PER_SECOND;
}

/** 内部：原始下线（无模拟4、无排队、无等待） */
function rawOfflineBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  const online = entity as SimulatedPlayer | undefined;
  const oldEntityId = record.entityId;
  if (online && online.hasTag(BOT_TAG)) {
    record.lastPoint = {
      location: online.location,
      dimension: online.dimension.id,
      rotation: online.getRotation(),
      lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
    };
    record.isSneaking = online.isSneaking;
    console.info(
      `[MockPlayer] 下线保存 ${record.name}（${record.lastPoint.dimension} ${Math.floor(record.lastPoint.location.x)} ${Math.floor(record.lastPoint.location.y)} ${Math.floor(record.lastPoint.location.z)}）`,
    );
    saveCoordinator.saveFullState(online, record);
    online.disconnect();
  }
  record.online = false;
  record.entityId = undefined;
  saveCoordinator.saveRecord(record);
  if (oldEntityId) trackBotOffline(oldEntityId);
  BotEvents.botOffline.trigger({ botName: record.name });
}

/** 安全下线队列（固定名 mockplayer:safe_offline 互斥） */
let safeOfflineQueue: Promise<void> = Promise.resolve();

export function getSafeOfflineAreaName(): string {
  return SAFE_OFFLINE_TICKING_AREA_NAME;
}
export function isSafeOfflineBusy(): boolean {
  try {
    return world.tickingAreaManager.hasTickingArea(SAFE_OFFLINE_TICKING_AREA_NAME);
  } catch {
    return false;
  }
}

/**
 * 安全下线（统一入口，已替代原 offlineBot）。
 * - 常加载：排队 → 申请模拟4 → rawOffline → 等待3秒 → 卸载
 * - 普通  ：rawOffline → 等待2秒
 * 无论成功/失败，已申请的区域必定卸载。
 * ⚠️ 永不 throw，失败返回 {ok:false}
 */
export async function safeOffline(record: BotRecord): Promise<OfflineResult> {
  if (!record.online) {
    return { ok: false, reason: `假人 ${record.name} 已离线` };
  }
  const isChunkload = (record.spawnMode ?? "normal") === "chunkload";
  if (!isChunkload) {
    try {
      rawOfflineBot(record);
      await delayTicks(getCooldownTicks());
      return { ok: true };
    } catch (e: any) {
      console.error(`[MockPlayer] offline 失败 ${record.name}: ${e?.message ?? e}`);
      await delayTicks(getCooldownTicks());
      return { ok: false, reason: e?.message ?? "unknown" };
    }
  }

  // 常加载：排队独占
  let release!: () => void;
  const current = new Promise<void>((res) => (release = res));
  const prev = safeOfflineQueue;
  safeOfflineQueue = prev.then(() => current).catch(() => current);
  try {
    await prev;
  } catch {}

  let areaCreated = false;
  let areaDim: any = undefined;
  let waited = false;
  // 预先确定申请中心与维度：优先活体位置，否则记录位置
  let center: any = undefined;
  let targetDim: any = undefined;
  // 尝试活体
  if (record.entityId) {
    try {
      const e = world.getEntity(record.entityId);
      if (e && (e as any).hasTag?.(BOT_TAG)) {
        center = (e as any).location;
        targetDim = (e as any).dimension;
      }
    } catch {}
  }
  if (!center || !targetDim) {
    const state = record.lastPoint ?? record.respawnPoint;
    if (!state) {
      release();
      return { ok: false, reason: "无可用位置" };
    }
    center = state.location;
    try {
      targetDim = world.getDimension(state.dimension);
    } catch (e: any) {
      release();
      return { ok: false, reason: `维度无效 ${state.dimension}: ${e?.message ?? e}` };
    }
  }
  areaDim = targetDim;

  try {
    const createRes = await createSim4Area(center, targetDim, SAFE_OFFLINE_TICKING_AREA_NAME);
    if (!createRes.ok) {
      console.warn(`[MockPlayer] 安全下线创建模拟4失败 ${record.name}: ${createRes.reason}`);
      return { ok: false, reason: `创建常加载失败: ${createRes.reason}` };
    }
    areaCreated = true;
    console.info(
      `[MockPlayer] 安全下线已申请模拟4 ${SAFE_OFFLINE_TICKING_AREA_NAME} @ ${targetDim.id} ${Math.floor(center.x)} ${Math.floor(center.y)} ${Math.floor(center.z)} for ${record.name}`,
    );

    // 下线
    try {
      rawOfflineBot(record);
    } catch (e: any) {
      console.error(`[MockPlayer] 安全下线 raw 失败 ${record.name}: ${e?.message ?? e}`);
      // 仍需等待再卸载
      await delayTicks(getCooldownTicks());
      waited = true;
      const rr = removeSim4Area(SAFE_OFFLINE_TICKING_AREA_NAME, targetDim);
      if (!rr.ok) console.warn(`[MockPlayer] 安全下线移除失败 ${record.name}: ${rr.reason}`);
      else console.info(`[MockPlayer] 安全下线已移除模拟4 ${SAFE_OFFLINE_TICKING_AREA_NAME} for ${record.name}`);
      areaCreated = false;
      return { ok: false, reason: e?.message ?? "unknown" };
    }

    await delayTicks(getCooldownTicks());
    waited = true;
    const removeRes = removeSim4Area(SAFE_OFFLINE_TICKING_AREA_NAME, targetDim);
    if (!removeRes.ok) {
      console.warn(`[MockPlayer] 安全下线移除模拟4失败 ${record.name}: ${removeRes.reason}`);
    } else {
      console.info(`[MockPlayer] 安全下线已移除模拟4 ${SAFE_OFFLINE_TICKING_AREA_NAME} for ${record.name}`);
    }
    areaCreated = false;
    return { ok: true };
  } catch (e: any) {
    console.error(`[MockPlayer] safeOffline 异常 ${record.name}: ${e?.message ?? e}`);
    if (areaCreated && !waited) {
      try {
        await delayTicks(getCooldownTicks());
      } catch {}
      waited = true;
    }
    if (areaCreated) {
      try {
        const r = removeSim4Area(SAFE_OFFLINE_TICKING_AREA_NAME, areaDim);
        if (!r.ok) console.warn(`[MockPlayer] 安全下线兜底移除失败 ${record.name}: ${r.reason}`);
      } catch (ee: any) {
        console.warn(`[MockPlayer] 安全下线兜底异常 ${record.name}: ${ee?.message ?? ee}`);
      }
      areaCreated = false;
    }
    return { ok: false, reason: e?.message ?? "unknown" };
  } finally {
    if (areaCreated) {
      if (!waited) {
        try {
          await delayTicks(getCooldownTicks());
        } catch {}
      }
      try {
        const r = removeSim4Area(SAFE_OFFLINE_TICKING_AREA_NAME, areaDim);
        if (!r.ok) console.warn(`[MockPlayer] 安全下线 finally 兜底移除失败 ${record.name}: ${r.reason}`);
      } catch (e: any) {
        console.warn(`[MockPlayer] 安全下线 finally 兜底异常 ${record.name}: ${e?.message ?? e}`);
      }
    }
    release();
  }
}

// 注意：不再提供 offlineBot 别名，请直接使用 safeOffline

/** 清理残留安全下线区域（worldLoad 幂等） */
export function cleanupSafeOfflineArea(): void {
  try {
    const r = removeSim4Area(SAFE_OFFLINE_TICKING_AREA_NAME);
    if (r.ok) console.info(`[MockPlayer] 已清理残留下线常加载区域 ${SAFE_OFFLINE_TICKING_AREA_NAME}`);
  } catch {}
  try {
    if (world.tickingAreaManager.hasTickingArea(SAFE_OFFLINE_TICKING_AREA_NAME)) {
      world.tickingAreaManager.removeTickingArea(SAFE_OFFLINE_TICKING_AREA_NAME);
      console.info(`[MockPlayer] 已清理残留 Manager 区域 ${SAFE_OFFLINE_TICKING_AREA_NAME}`);
    }
  } catch {}
}
