// ─── 删除假人 ──────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { reclaimBot } from "./reclaim";
import { color } from "@yinxe/toolkit";
import { trackBotOffline } from "./tridentTracker";

/**
 * 删除假人（可选回收物品和经验到指定玩家）
 * @param record 假人记录
 * @param reclaimTo 回收目标玩家（传 null/undefined 则不回收直接删除）
 */
export function deleteBot(record: BotRecord, reclaimTo?: Player): void {
  // 先回收物品和经验（如有指定玩家）
  if (reclaimTo) {
    try {
      const result = reclaimBot(reclaimTo, record);
      const parts: string[] = [];
      if (result.items > 0) parts.push(`${result.items} 件物品`);
      if (result.overflow > 0) parts.push(`${result.overflow} 件溢出掉落`);
      if (result.xp > 0) parts.push(`${result.xp} XP（Lv.${result.xpLevel}）`);
      if (parts.length > 0) {
        reclaimTo.sendMessage(`${color.muted}回收自 ${color.playerName}${record.name}${color.muted}: ${parts.join("、")}`);
      }
    } catch (e: any) {
      reclaimTo?.sendMessage(`${color.error}回收 ${record.name} 物品时出错: ${e.message}`);
    }
  }

  // 断开连接
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      trackBotOffline(record.entityId!);
      (entity as SimulatedPlayer).disconnect();
    }
  }
  // 删除：内存 + 持久化记录 + 背包/装备 + 恢复标记（registry.remove 一步完成）
  // 离线删除：disconnect() 不会触发 playerLeave，必须手动清除恢复标记
  // 否则同名新假人会被 isBotRestored 误判为已恢复，空背包覆盖持久化数据
  botRegistry.remove(record.name);
}
