// ─── /mp:recover <name> — 从持久化强制恢复假人背包/装备 ──
//
// 当假人因 "(2)" 重复名 bug 导致 playerJoin 恢复失败时，
// 背包/装备数据仍保留在 NBT 木桶阵列中未被覆盖。
// 此命令手动从存储恢复（真实 ItemStack，完整 NBT）并写回假人实体。

import {
  Player,
  world,
  CustomCommandParamType,
  CommandPermissionLevel,
} from "@minecraft/server";
import { defineCommand, color } from "@yinxe/toolkit";

import { botRegistry, inventoryStorage } from "../../../bootstrap/context";
import { resolveBotForCommand } from "../auth";

export function registerRecoverCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:recover",
    description: "从持久化强制恢复假人的背包/装备/经验",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const nameInput = params.name as string | undefined;
    if (!nameInput) {
      player.sendMessage(`${color.error}用法: /mp:recover <假人名>`);
      return;
    }

    const bot = resolveBotForCommand(player, nameInput);
    if (!bot) return;
    if (!bot.isAvailable || !bot.record.entityId) {
      player.sendMessage(`${color.error}假人 ${color.playerName}${nameInput} ${color.error}不在线，请先上线`);
      return;
    }

    const entity = world.getEntity(bot.record.entityId);
    if (!entity?.isValid) {
      player.sendMessage(`${color.error}假人 ${color.playerName}${nameInput} ${color.error}实体无效`);
      return;
    }

    const entityPlayer = entity as Player;
    const record = bot.record;
    let restored = false;

    // ── 恢复背包/装备/经验（复用 InventoryStorage 统一恢复入口，避免逻辑散落） ──
    try {
      const itemRestored = inventoryStorage.restoreInto(entityPlayer, record);
      const xpRestored = inventoryStorage.restoreExperience(entityPlayer, record);
      restored = itemRestored || xpRestored;

      if (itemRestored) {
        player.sendMessage(`${color.success}背包/装备恢复成功`);
      } else {
        player.sendMessage(`${color.muted}无可恢复的背包/装备数据`);
      }
      if (xpRestored) {
        player.sendMessage(`${color.success}经验恢复成功 (Lv.${record.experience.level} 总经验 ${record.experience.totalXp})`);
      }
    } catch (e: any) {
      player.sendMessage(`${color.error}恢复数据失败: ${e?.message ?? e}`);
    }

    // 标记恢复完成，后续自动保存不再跳过
    botRegistry.markRestored(record.name);

    if (restored) {
      player.sendMessage(`${color.success}恢复完成！请检查假人 ${color.playerName}${nameInput} ${color.success}的背包`);
    } else {
      player.sendMessage(`${color.error}未找到任何可恢复的数据`);
    }
  });
}
