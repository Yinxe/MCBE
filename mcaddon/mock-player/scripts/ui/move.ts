// ─── 移动表单 + 删除确认 ──────────────────────────────

import { Player, system } from "@minecraft/server";
import { ModalFormData, MessageFormData } from "@minecraft/server-ui";

import { botRegistry } from "../features/persistence";
import { moveBot, deleteBot } from "../features/operations";
import { parseCoordinateInput } from "../features/utils";

// ─── 移动至坐标 ───────────────────────────────────────

export function showMoveForm(player: Player, botName: string): void {
  const form = new ModalFormData()
    .title("§l移动至坐标")
    .textField("目标坐标（留空则移动到你位置）", "x y z", { defaultValue: "" });

  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return;

    const coordInput = response.formValues[0] as string;
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
  const form = new MessageFormData()
    .title("§l确认删除")
    .body(`§7确定要删除模拟玩家 §e${botName}§7 吗？\n\n§6背包、装备和经验将被回收。\n§c此操作不可撤销！`)
    .button1("§c确认删除")
    .button2("§7取消");

  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection !== 0) return;

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
  });
}
