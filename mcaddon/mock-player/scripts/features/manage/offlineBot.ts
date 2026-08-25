// ─── 假人下线（安全下线，单区块辅助） ─────────────
// 新流程：下线前申请 per-bot 单区块（Manager 255 并发）→ 下线 → 延迟 → 单次卸载
// 宝库模式跳过辅助，直接 rawOffline

import { world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { trackBotOffline } from "../trident/tridentTracker";
import { createSingleChunkArea, removeSingleChunkArea } from "./tickingArea/singleChunk";
import { delayTicks, getAuxAreaName, getCooldownTicks, getPerBotQueue, isVaultMode, setPerBotQueue } from "./auxiliary";

/** 下线结果 */
export interface OfflineResult {
  ok: boolean;
  reason?: string;
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
      `[MockPlayer] 下线保存 ${record.name}（${record.lastPoint.dimension} ${Math.floor(record.lastPoint.location.x)} ${Math.floor(record.lastPoint.location.y)} ${Math.floor(record.lastPoint.location.z)}）`
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

/**
 * 安全下线（新流程：下线前申请/刷新 per-bot 模拟4，下线后延迟再卸载）。
 * - 宝库模式跳过辅助与安全机制（直接 rawOffline）
 * - 非宝库：下线前刷新 per-bot 辅助区块 → rawOffline → 延迟 → 卸载
 * ⚠️ 永不 throw，失败返回 {ok:false}
 */
export async function safeOffline(record: BotRecord): Promise<OfflineResult> {
  if (!record.online) {
    return { ok: false, reason: `假人 ${record.name} 已离线` };
  }
  // 宝库模式跳过辅助
  if (isVaultMode(record)) {
    console.info(`[MockPlayer] 宝库模式 ${record.name} 跳过模拟4辅助与安全下线`);
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

  // per-bot 串行防同名并发（单 try-finally 单次卸载）
  const prev = getPerBotQueue(record.name);
  let release!: () => void;
  const cur = new Promise<void>((res) => (release = res));
  setPerBotQueue(record.name, cur);
  try {
    try {
      await prev;
    } catch {}
    // 预先确定中心与维度（优先活体，否则记录）
    let center: any = undefined;
    let targetDim: any = undefined;
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
        return { ok: false, reason: "无可用位置" };
      }
      center = state.location;
      try {
        targetDim = world.getDimension(state.dimension);
      } catch (e: any) {
        return { ok: false, reason: `维度无效 ${state.dimension}: ${e?.message ?? e}` };
      }
    }

    const areaName = getAuxAreaName(record.name);
    // 下线前申请单区块常加载（Manager，支持 255 并发）
    console.info(
      `[MockPlayer] safeOffline 下线前申请单区块 ${areaName} @ ${targetDim.id} ${Math.floor(center.x)},${Math.floor(center.z)} for ${record.name}`
    );
    try {
      const cr = await createSingleChunkArea(center, targetDim, areaName);
      if (!cr.ok) {
        console.warn(`[MockPlayer] 下线前单区块申请失败 ${record.name}: ${cr.reason}（仍尝试下线）`);
      } else {
        console.info(
          `[MockPlayer] 下线前单区块成功 ${areaName} @ ${targetDim.id} ${Math.floor(center.x)},${Math.floor(center.z)} for ${record.name} (chunk ${Math.floor(center.x / 16)},${Math.floor(center.z / 16)})`
        );
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] 下线前单区块异常 ${record.name}: ${e?.message ?? e}`);
    }

    // 下线（try-finally 单次卸载）
    let offlineOk = true;
    let offlineReason: string | undefined;
    try {
      console.info(`[MockPlayer] → rawOffline ${record.name} entityId=${record.entityId ?? "无"}`);
      rawOfflineBot(record);
      console.info(`[MockPlayer] rawOffline 成功 ${record.name} 已置 offline`);
    } catch (e: any) {
      console.error(`[MockPlayer] 安全下线 raw 失败 ${record.name}: ${e?.message ?? e}`);
      offlineOk = false;
      offlineReason = e?.message ?? "unknown";
    } finally {
      console.info(`[MockPlayer] → 延迟 ${getCooldownTicks()}t 后卸载单区块 ${areaName}`);
      await delayTicks(getCooldownTicks());
      console.info(`[MockPlayer] → removeSingleChunkArea ${areaName}`);
      try {
        const rr = removeSingleChunkArea(areaName);
        if (!rr.ok) console.warn(`[MockPlayer] 安全下线移除失败 ${record.name}: ${rr.reason}`);
        else console.info(`[MockPlayer] 安全下线已延迟卸载单区块 ${areaName} for ${record.name}`);
      } catch (e: any) {
        console.warn(`[MockPlayer] 安全下线卸载异常 ${record.name}: ${e?.message ?? e}`);
      }
    }
    return offlineOk ? { ok: true } : { ok: false, reason: offlineReason };
  } finally {
    release();
  }
}

// 注意：不再提供 offlineBot 别名，请直接使用 safeOffline
