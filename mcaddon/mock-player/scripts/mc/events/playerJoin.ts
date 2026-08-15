// ─── playerJoin — 假人加入世界 → 恢复背包/装备/经验 ────
//
// playerJoin 是恢复背包的正确时机，因为它只在首次加入世界时触发：
//   死亡重生（respawn）不走 playerJoin，不会错误覆盖背包
//
// ⚠️ 踩坑：PlayerJoinAfterEvent 只有 playerName，没有 player 实体
// 需要用 world.getPlayers({ name, tags }) 查找对应的 Player 对象
// 不能只用 name 过滤——加 tags 确保只操作假人，避免误操作同名的真实玩家
//
// 恢复数据来自 NBT 木桶阵列（InventoryStorage.restoreInto）：loadInventory/
// loadEquipment 返回**真实 ItemStack**（完整 NBT），直接 setItem/setEquipment
// 写入——潜影盒等嵌套容器内容随物品原样恢复（旧 JSON 视图无法做到）。

import { world, system, PlayerJoinAfterEvent } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { BOT_TAG } from "../../tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry, inventoryStorage, saveCoordinator } from "../bootstrap/context";
import { getTotalXpForLevels } from "../../xp/XpMath";
import { trackBotOnline } from "../features/trident/tridentTracker";

export function onPlayerJoin(event: PlayerJoinAfterEvent): void {
  const record = botRegistry.get(event.playerName);
  if (!record) return;

  console.info(`[MockPlayer] 事件 playerJoin ${event.playerName}`);
  record.online = true;
  saveCoordinator.saveRecord(record);

  // 恢复背包/装备/经验（仅首次加入世界时，死亡重生不走这）
  // ⚠️ 用 name + tags 双重过滤防止误操作
  const players = world.getPlayers({ name: event.playerName, tags: [BOT_TAG] });
  const player = players[0];
  if (player) {
    // ⚠️ 异常隔离：恢复链中任何一步失败（坏数据/物品 typeId 失效等）都不能中断
    // 其余步骤与 markRestored——否则该假人永远卡在"未恢复"状态，所有保存被守卫拦截
    try {
      inventoryStorage.restoreInto(player, record);

      // 恢复经验（一次性设置 totalXp，比分步 addLevels + addExperience 更精确）
      const exp = record.experience;
      if (exp.totalXp > 0) {
        try {
          const current = getTotalXpForLevels(player.level) + player.xpEarnedAtCurrentLevel;
          // 防御：当前经验多于存档时不再扣减（数据异常保护）
          if (exp.totalXp > current) {
            player.addExperience(exp.totalXp - current);
          }
        } catch {
          // 经验恢复失败不影响上线
        }
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] ⚠️ 恢复 ${record.name} 背包/装备失败（已跳过）：${e?.message ?? e}`);
    }
  }

  // 标记恢复完成，此后 saveBotFullState / 周期保存 才允许写入持久化
  // ⚠️ 必须放在 if(player) 块内：只有确实恢复成功才标记，防止空背包被误保存
  if (player) {
    botRegistry.markRestored(record.name);

    // 更新 entityId + 反查表
    record.entityId = player.id;
    trackBotOnline(player.id, record.name);

    // 上线领域事件：订阅方（三叉戟认主夺回/劫掠续药等）驱动
    BotEvents.botOnline.trigger({ botName: record.name });
  }
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 加入了游戏`);
}
