import { system, CommandPermissionLevel, type CustomCommand } from "@minecraft/server";
import type { EntityInventoryComponent } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { SlotOrganizer } from "../organize/SlotOrganizer";
import { formatOrganizeResult } from "../organize/OrganizeFormatter";

export function registerOrganize(registry: any): void {
  defineCommand(registry, {
    name: "sw:organize", description: "整理玩家背包物品",
    permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
    mandatoryParameters: [],
  }, ({ player }) => {
    system.runTimeout(() => {
      try {
        const inv = player.getComponent("inventory") as EntityInventoryComponent | undefined;
        if (!inv?.container) { player.sendMessage("§c无法获取背包容器"); return; }
        const org = new SlotOrganizer();
        const a = org.analyze(inv.container, { startSlot: 9, endSlot: 36 });
        const m = a.messiness;
        const chaos = `§7混乱度: §f${(m.total * 100).toFixed(0)}% §7(顺序 §e${(m.order * 100).toFixed(0)}% §7堆叠 §e${(m.stack * 100).toFixed(0)}%)`;
        player.sendMessage(chaos);
        if (m.total < 0.05) { player.sendMessage("§e背包已经很整齐了，无需整理"); return; }
        const r = org.apply(inv.container, a);
        if (!r.success) { player.sendMessage(`§c整理失败: ${r.error}`); return; }
        for (const line of formatOrganizeResult(r, "背包")) player.sendMessage(line);
      } catch (e) { player.sendMessage(`§c整理失败: ${(e as Error).message}`); }
    });
  });
}
