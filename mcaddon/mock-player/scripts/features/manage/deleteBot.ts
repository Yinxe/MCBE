// ─── 删除假人 ──────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry, inventoryStorage, saveCoordinator } from "../../bootstrap/context";
import { reclaimBot } from "./reclaim";
import { cleanupRaidMode } from "../raid/raidMode";
import { color } from "@yinxe/toolkit";
import { trackBotOffline } from "../trident/tridentTracker";

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

  // 断开连接（删除在线假人场景）
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      // entity 已由 record.entityId 解析成功，entity.id 即同一实体（免断言）
      trackBotOffline(entity.id);
      (entity as SimulatedPlayer).disconnect();
    }
    // 下线领域事件（订阅方：三叉戟回退第一任等）——删除路径 disconnect 不派发 playerLeave 前的事件链，
    // 必须显式触发，否则被删假人的投掷物第二任 tag 悬空、owner 指向已移除实体
    BotEvents.botOffline.trigger({ botName: record.name });
  }
  // 删除：内存 + 持久化记录 + 背包/装备 + 恢复标记（registry.remove 一步完成）
  // 离线删除：disconnect() 不会触发 playerLeave，必须手动清除恢复标记
  // 否则同名新假人会被 isBotRestored 误判为已恢复，空背包覆盖持久化数据
  saveCoordinator.removeRecord(record.name);
  // 清空库存存储的指纹快照（防内存残留）
  inventoryStorage.forget(record.name);

  // 清理劫掠内存状态（胜利计数/饮用互斥），防止同名重建假人继承
  cleanupRaidMode(record.name);
}
