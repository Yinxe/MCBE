// ─── /mp:menu — 打开 UI 菜单 ─────────────────────────

import { system, Player, CustomCommandStatus } from "@minecraft/server";
import { showMainMenu } from "../ui/menu";

export function registerMenuCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:menu",
      description: "打开模拟玩家管理菜单",
      cheatsRequired: false,
      permissionLevel: 0,
    },
    (origin: any) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "§c该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      system.run(() => {
        showMainMenu(player);
      });
      return { status: CustomCommandStatus.Success, message: "§a正在打开菜单..." };
    }
  );
}
