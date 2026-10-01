// ─── 删除确认 ───
// UI 删除有确认框、/mp:delete 命令直通无确认（双口径勿合并）。
// 删除=全量回收：下线 + 仓内物品与经验整体交付操作者，面板不逐项勾。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, MessageFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import type { BotRecord } from "../../domain/Record";
import { uiViewer } from "../Kit";
import { services } from "../../Composition";

export function confirmDelete(player: Player, record: BotRecord): Promise<boolean> {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  return MessageFormBuilder.confirm(
    player,
    `${color.bold}确认删除`,
    `${style("确定要删除模拟玩家", color.warn)} ${color.playerName}${record.name}${color.warn} 吗？\n\n${color.gold}背包、装备和经验将被回收。\n${color.error}此操作不可撤销！`,
    () => {
      void system.run(async () => {
        try {
          const live = services.runtime.record(record.botId);
          if (!live) {
            say(`${color.error}模拟玩家 ${color.playerName}${record.name}${color.error} 已被删除`);
            return;
          }
          const r = await services.lifecycle.remove(viewer, live.botId);
          system.run(() =>
            say(
              r.ok
                ? `${color.success}已删除模拟玩家 ${color.playerName}${record.name}${color.success}，物品和经验已回收`
                : `${color.error}删除失败: ${r.reason}`
            )
          );
        } catch (e) {
          system.run(() => say(`${color.error}删除失败: ${(e as Error).message}`));
        }
      });
    }
  );
}
