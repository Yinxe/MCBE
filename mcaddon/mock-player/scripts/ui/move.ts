// ─── 移动表单 + 删除确认 ──────────────────────────────

import { Player, system } from "@minecraft/server";
import { ModalFormBuilder, MessageFormBuilder } from "@yinxe/toolkit/ui";

import { botRegistry } from "../features/core/persistence";
import { moveBot } from "../features/move";
import { deleteBot } from "../features/deleteBot";
import { parseCoordinateInput } from "../features/core/utils";

/**
 * 移动至坐标表单
 *
 * @deprecated 已从假人操作面板移除，仅在命令 /mp:move 中可用。
 *   菜单中不再暴露此入口，保留代码以兼容外部调用。
 */
export function showMoveForm(player: Player, botName: string): void {
  ModalFormBuilder.showQuick(player, "§l移动至坐标", (f) => {
    f.textField("coord", "目标坐标（留空则移动到你位置）", { defaultValue: "" });
  }).then((vals) => {
    if (!vals) return;
    const coordInput = vals.coord as string;
    const targetPos = parseCoordinateInput(coordInput) ?? player.location;

    const record = botRegistry.get(botName);
    if (!record) {
      player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
      return;
    }
    if (!record.online || record.death) {
      player.sendMessage("§c模拟玩家不在线或已死亡");
      return;
    }

    system.run(() => {
      try {
        const fullPath = moveBot(record, targetPos);
        if (!fullPath) {
          player.sendMessage(`§e${botName}§e 无法完全到达目标位置（路径不完整）`);
        } else {
          player.sendMessage(
            `§a${botName}§a 正在前往 §e${Math.floor(targetPos.x)} ${Math.floor(targetPos.y)} ${Math.floor(targetPos.z)}`
          );
        }
      } catch (e: any) {
        player.sendMessage(`§c移动失败: ${e.message}`);
      }
    });
  });
}

// ─── 删除确认 ─────────────────────────────────────────

export function confirmDelete(player: Player, botName: string): void {
  MessageFormBuilder.confirm(
    player,
    "§l确认删除",
    `§7确定要删除模拟玩家 §e${botName}§7 吗？\n\n§6背包、装备和经验将被回收。\n§c此操作不可撤销！`,
    () => {
      const record = botRegistry.get(botName);
      if (!record) {
        player.sendMessage(`§c模拟玩家 §e${botName}§c 不存在`);
        return;
      }
      system.run(() => {
        try {
          deleteBot(record, player);
          player.sendMessage(`§a已删除模拟玩家 §e${botName}，物品和经验已回收`);
        } catch (e: any) {
          player.sendMessage(`§c删除失败: ${e.message}`);
        }
      });
    }
  );
}
