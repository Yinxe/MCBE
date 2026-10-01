// ─── /mp:reconnect —— 重连假人（下线 + 释放名字 + 重新上线） ──
// 合并自 v3 的 mp:reconnect：刷新躯体状态（假人卡住 / 姿态异常时的"重启"手段）。
// 复用既有 safeOffline / safeOnline（排队 + 冷却都走原逻辑）。
import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { color, defineCommand } from "@yinxe/toolkit";
import { botRegistry, botStore } from "../../../bootstrap/context";
import { guardBotCommand } from "../auth";
import { safeOffline } from "../../../features/manage/offlineBot";
import { safeOnline } from "../../../features/manage/onlineBot";

/** 注册 /mp:reconnect 命令 */
export function registerReconnectCommand(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(
    registry,
    {
      name: "mp:reconnect",
      description: "重连假人（下线 + 释放名字 + 重新上线，刷新躯体状态）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      const targetName = String(params.name ?? "").trim();
      if (!targetName) {
        player.sendMessage(`${color.error}请指定假人名字`);
        return;
      }
      const denied = guardBotCommand(player, targetName);
      if (denied) {
        player.sendMessage(`${color.error}${denied}`);
        return;
      }
      const record = botRegistry.get(targetName) ?? botStore.loadRecord(targetName);
      if (!record) {
        player.sendMessage(
          `${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`,
        );
        return;
      }
      player.sendMessage(`${color.muted}正在重连 ${color.playerName}${record.name}${color.muted} ...`);
      system.run(async () => {
        // ── 在线时先下线（释放名字与实体） ──
        if (record.online) {
          const off = await safeOffline(record);
          if (!off.ok) {
            player.sendMessage(
              `${color.error}${record.name} 重连失败（下线阶段）：${off.reason ?? "unknown"}`,
            );
            return;
          }
        }
        // ── 重新上线 ──
        const on = await safeOnline(record);
        if (!on.ok) {
          player.sendMessage(
            `${color.error}${record.name} 重连失败（上线阶段）：${on.reason ?? "unknown"}`,
          );
          return;
        }
        player.sendMessage(
          `${color.success}假人 ${color.playerName}${record.name}${color.success} 已重连上线`,
        );
      });
    },
  );
}