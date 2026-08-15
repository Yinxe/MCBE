// ─── 移动表单 + 删除确认 ──────────────────────────────

import { Player, system, world, Vector3 } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder, MessageFormBuilder } from "@yinxe/toolkit";

import { BotUiEvent } from "../../../events/UiEvents";
import { navigateBot, NavigateResult } from "../../../features/basic/move";
import { ensureUiBotAvailable, resolveUiBotRecord } from "../helpers";
import { deleteBot } from "../../../features/manage/deleteBot";
import { parseCoordinateInput } from "../../../rules/coords/Coordinate";

// ─── UI 事件订阅（BOT 主菜单 → 感知删除动作） ──────────

/** 订阅 BOT 主菜单动作事件：删除假人 → 弹确认框（确认后直接调 deleteBot） */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "delete") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    confirmDelete(player, e.botName);
  });
}

/**
 * 移动至坐标表单
 *
 * @deprecated 已从假人操作面板移除，仅在命令 /mp:move 中可用。
 *   菜单中不再暴露此入口，保留代码以兼容外部调用。
 */
export function showMoveForm(player: Player, botName: string): void {
  ModalFormBuilder.showQuick(player, `${color.bold}移动至坐标`, (f) => {
    f.textField("coord", "目标坐标（留空则移动到你位置）", { defaultValue: "" });
  }).then((vals) => {
    if (!vals) return;
    const coordInput = vals.coord as string;
    const coordResult = parseCoordinateInput(coordInput, player.location);
    let targetPos: Vector3;
    if (coordResult.ok) {
      targetPos = coordResult.pos;
    } else {
      targetPos = player.location;
      if (coordResult.reason === "invalid") {
        player.sendMessage(`${color.warn}坐标解析失败：${coordResult.message}，已改为移动到你所在位置`);
      }
    }

    const record = resolveUiBotRecord(player, botName);
    if (!record) return;
    if (!ensureUiBotAvailable(player, record)) return;

    system.run(async () => {
      // navigateBot 闭包异步多状态（永不 reject）
      const result = await navigateBot(botName, targetPos);
      switch (result) {
        case NavigateResult.Arrived:
          player.sendMessage(`${color.success}${botName}${color.success} 已到达 ${color.warn}${Math.floor(targetPos.x)} ${Math.floor(targetPos.y)} ${Math.floor(targetPos.z)}`);
          break;
        case NavigateResult.NoPath:
          player.sendMessage(`${color.warn}${botName}${color.warn} 无法到达目标位置（无路径可达）`);
          break;
        case NavigateResult.StillTimeout:
          player.sendMessage(`${color.warn}${botName}${color.warn} 移动超时：2 秒内位置未变化（可能卡住）`);
          break;
        case NavigateResult.Timeout:
          player.sendMessage(`${color.warn}${botName}${color.warn} 30 秒未到达目标（仍在移动或路径过长）`);
          break;
        case NavigateResult.Unavailable:
          player.sendMessage(`${color.error}${botName}${color.error} 不可用（不在线或已死亡）`);
          break;
        case NavigateResult.EntityInvalid:
          player.sendMessage(`${color.error}${botName}${color.error} 移动中实体失效（死亡/下线）`);
          break;
        default:
          player.sendMessage(`${color.error}移动失败（异常）`);
      }
    });
  });
}

// ─── 删除确认 ─────────────────────────────────────────

export function confirmDelete(player: Player, botName: string): void {
  MessageFormBuilder.confirm(
    player,
    `${color.bold}确认删除`,
    `${style("确定要删除模拟玩家", color.warn)} ${color.playerName}${botName}${color.warn} 吗？\n\n${color.gold}背包、装备和经验将被回收。\n${color.error}此操作不可撤销！`,
    () => {
      const record = resolveUiBotRecord(player, botName);
      if (!record) return;
      system.run(() => {
        try {
          deleteBot(record, player);
          player.sendMessage(`${color.success}已删除模拟玩家 ${color.playerName}${botName}${color.success}，物品和经验已回收`);
        } catch (e: any) {
          player.sendMessage(`${color.error}删除失败: ${e.message}`);
        }
      });
    }
  );
}
