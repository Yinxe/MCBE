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

import { botRegistry, inventoryStorage } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { getTotalXpForLevels } from "../../core/xp/XpMath";

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

    const denied = guardBotCommand(player, nameInput);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }

    const record = botRegistry.get(nameInput);
    if (!record) {
      player.sendMessage(`${color.error}未找到模拟玩家 ${color.playerName}${nameInput}`);
      return;
    }

    if (!record.online || !record.entityId) {
      player.sendMessage(`${color.error}假人 ${color.playerName}${nameInput} ${color.error}不在线，请先上线`);
      return;
    }

    const entity = world.getEntity(record.entityId);
    if (!entity?.isValid) {
      player.sendMessage(`${color.error}假人 ${color.playerName}${nameInput} ${color.error}实体无效`);
      return;
    }

    const bot = entity as Player;
    let restored = false;

    // ── 恢复背包/装备（复用 InventoryStorage.restoreInto：真实物品直写，占位跳过） ──
    try {
      restored = inventoryStorage.restoreInto(bot, record);
    } catch (e: any) {
      player.sendMessage(`${color.error}恢复数据失败: ${e?.message ?? e}`);
    }
    if (restored) {
      player.sendMessage(`${color.success}背包/装备恢复成功`);
    } else {
      player.sendMessage(`${color.muted}无可恢复的背包/装备数据`);
    }

    // ── 恢复经验 ──
    const exp = record.experience;
    if (exp.totalXp > 0) {
      try {
        const current = getTotalXpForLevels(bot.level) + bot.xpEarnedAtCurrentLevel;
        bot.addExperience(exp.totalXp - current);
        player.sendMessage(`${color.success}经验恢复成功 (Lv.${exp.level} 总经验 ${exp.totalXp})`);
        restored = true;
      } catch {
        player.sendMessage(`${color.muted}经验恢复失败，跳过`);
      }
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
