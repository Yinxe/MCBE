// ─── playerJoin — 假人加入世界 → 恢复背包/装备/经验 ────
//
// playerJoin 是恢复背包的正确时机，因为它只在首次加入世界时触发：
//   死亡重生（respawn）不走 playerJoin，不会错误覆盖背包
//
// ⚠️ 踩坑：PlayerJoinAfterEvent 只有 playerName，没有 player 实体
// 需要用 world.getPlayers({ name, tags }) 查找对应的 Player 对象
// 不能只用 name 过滤——加 tags 确保只操作假人，避免误操作同名的真实玩家

import { world, PlayerJoinAfterEvent, EntityInventoryComponent, EntityEquippableComponent } from "@minecraft/server";

import { BOT_TAG } from "../features/core/tags";
import { botRegistry, saveBotRecord, loadBotInventory, loadBotEquipment, markBotRestored } from "../features/core/persistence";
import { deserializeContainer, deserializeEquipment, getTotalXpForLevels } from "../features/core/utils";

export function onPlayerJoin(event: PlayerJoinAfterEvent): void {
  const record = botRegistry.get(event.playerName);
  if (!record) return;

  console.warn(`[MockPlayer] 事件 playerJoin ${event.playerName}`);
  record.online = true;
  saveBotRecord(record);

  // 恢复背包/装备/经验（仅首次加入世界时，死亡重生不走这）
  // ⚠️ 用 name + tags 双重过滤防止误操作
  const players = world.getPlayers({ name: event.playerName, tags: [BOT_TAG] });
  const player = players[0];
  if (player) {
    const savedInv = loadBotInventory(record.name);
    if (savedInv) {
      const inv = player.getComponent("minecraft:inventory") as EntityInventoryComponent;
      if (inv?.container) {
        deserializeContainer(inv.container, savedInv);
      }
    }

    const savedEquip = loadBotEquipment(record.name);
    if (savedEquip) {
      const equip = player.getComponent("minecraft:equippable") as EntityEquippableComponent;
      if (equip) {
        deserializeEquipment(equip, savedEquip);
      }
    }

    // 恢复经验（一次性设置 totalXp，比分步 addLevels + addExperience 更精确）
    const exp = record.experience;
    if (exp.totalXp > 0) {
      try {
        const current = getTotalXpForLevels(player.level) + player.xpEarnedAtCurrentLevel;
        player.addExperience(exp.totalXp - current);
      } catch {
        // 经验恢复失败不影响上线
      }
    }
  }

  // 标记恢复完成，此后 saveBotFullState / 周期保存 才允许写入持久化
  // ⚠️ 必须放在 if(player) 块内：只有确实恢复成功才标记，防止空背包被误保存
  if (player) {
    markBotRestored(record.name);
  }
  world.sendMessage(`§7[§a假人§7] §a${record.name} 加入了游戏`);
}
