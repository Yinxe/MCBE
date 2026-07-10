// ─── 保存假人完整状态 ──────────────────────────────────

import { Player } from "@minecraft/server";

import { BotRecord } from "./core/types";
import { isBotRestored, saveBotInventory, saveBotEquipment, saveBotRecord } from "./core/persistence";
import { serializeContainer, serializeEquipment, captureExperience } from "./core/utils";

/**
 * 保存假人的全部运行时状态到持久化
 * - 背包 36 格 → saveBotInventory（每格独立 key）
 * - 装备 5 槽 → saveBotEquipment（每槽独立 key）
 * - 经验值 → record.experience + saveBotRecord
 *
 * ⚠️ 注意：改了 record.experience 后必须 saveBotRecord，否则不持久化
 * 此函数在以下场景被调用：
 *   - offlineBot（主动下线）
 *   - entityDie（死亡，无论是否自动重生）
 *   - playerLeave（尽力保存，实体可能已不可访问）
 *   - reclaimBot（在线回收前保存当前状态）
 */
export function saveBotFullState(bot: Player, record: BotRecord): void {
  // ⚠️ 高危防护：假人刚生成时背包为空，恢复完成前禁止保存
  // 否则空背包会覆盖持久化的真实数据
  if (!isBotRestored(record.name)) {
    console.warn(`[MockPlayer] ⛔ 全量保存被拦截 ${record.name}——尚未恢复完成`);
    return;
  }

  const inv = bot.getComponent("minecraft:inventory") as any;
  if (inv?.container) {
    saveBotInventory(record.name, serializeContainer(inv.container));
  }
  const equip = bot.getComponent("minecraft:equippable") as any;
  if (equip) {
    saveBotEquipment(record.name, serializeEquipment(equip));
  }
  record.experience = captureExperience(bot);
  saveBotRecord(record);
  console.warn(`[MockPlayer] 全量状态保存完成 ${record.name}`);
}
