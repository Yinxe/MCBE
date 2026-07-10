import { system } from "@minecraft/server";
import type { EntityInventoryComponent } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { SlotOrganizer } from "../organize/SlotOrganizer";
import { formatOrganizeResult } from "../organize/OrganizeFormatter";
import { cmdBase, msg } from "./helpers";

export function registerOrganize(registry: any): void {
  defineCommand(registry, { ...cmdBase("sw:organize", "整理玩家背包物品"), mandatoryParameters: [] },
    ({ player }) => {
      system.runTimeout(() => {
        try {
          const inv = player.getComponent("inventory") as EntityInventoryComponent | undefined;
          if (!inv?.container) { msg(player, "§c无法获取背包容器"); return; }
          const org = new SlotOrganizer();
          const a = org.analyze(inv.container, { startSlot: 9, endSlot: 36 });
          const m = a.messiness;
          msg(player, `§7混乱度: §f${(m.total * 100).toFixed(0)}% §7(顺序 §e${(m.order * 100).toFixed(0)}% §7堆叠 §e${(m.stack * 100).toFixed(0)}%)`);
          if (m.total < 0.05) { msg(player, "§e背包已经很整齐了，无需整理"); return; }
          const r = org.apply(inv.container, a);
          if (!r.success) { msg(player, `§c整理失败: ${r.error}`); return; }
          for (const line of formatOrganizeResult(r, "背包")) msg(player, line);
        } catch (e) { msg(player, `§c整理失败: ${e instanceof Error ? e.message : String(e)}`); }
      });
    });
}
