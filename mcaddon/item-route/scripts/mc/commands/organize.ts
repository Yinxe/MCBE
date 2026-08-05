// ─── ir:organize 整理玩家所在仓库的全部容器（逐个单容器整理） ────
// v1 语义的容器整理：每个容器**就地**排序 + 合并可堆叠堆（不跨容器、不搬移分类）。
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { noParamCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { findWarehouseAt } from "../../core/model/Area";
import { MoveJournal } from "../../core/routing/Move";
import { formatOrganizeResult } from "../ui/OrganizeFormatter";

/** 容器 ID → 可读短名（取坐标段，如 c@(1,2,3)@overworld → (1,2,3)） */
function shortName(id: string): string {
  return id.split("@")[1] ?? id;
}

export function registerOrganize(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, noParamCommand("ir:organize", "整理玩家所在仓库的全部容器"), ({ player }) => {
    system.runTimeout(() => {
      const warehouse = findWarehouseAt(deps.loadedWarehouses(), player.dimension.id, {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z),
      });
      if (warehouse === undefined) {
        player.sendMessage(`${chat.error}你不在任何仓库区域内`);
        return;
      }
      let organized = 0;
      let totalMoves = 0;
      for (const container of warehouse.containers.values()) {
        const res = deps.organize.organizeContainer(warehouse, container, new MoveJournal());
        if (!res.ok || res.moves === 0) continue; // 失败/已整齐 → 不展示
        organized++;
        totalMoves += res.moves;
        for (const line of formatOrganizeResult(res, shortName(container.id))) {
          player.sendMessage(line);
        }
      }
      if (organized === 0) {
        player.sendMessage(`${chat.info}仓库已经很整齐了，无需整理`);
      } else {
        player.sendMessage(`${chat.success}共整理 ${organized} 个容器，合并 ${totalMoves} 组堆叠`);
      }
    });
  });
}
