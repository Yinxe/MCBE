// ─── ir:organize 整理玩家所在仓库的全部容器（逐个单容器整理） ────
// v1 语义的容器整理：每个容器**就地**排序 + 合并可堆叠堆（不跨容器、不搬移分类）。
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { noParamCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { findWarehouseAt } from "../../core/model/Area";
import { containerShortName } from "../../core/model/ContainerId";
import { MoveJournal } from "../../core/routing/Move";
import { formatOrganizeResult } from "../ui/OrganizeFormatter";

/** 容器 ID → 可读短名（如 c@(1,2,3)@overworld → (1,2,3)@overworld） */
function shortName(id: string): string {
  return containerShortName(id);
}

/**
 * 注册 `ir:organize`：整理**玩家所在仓库**（就地定位，非按名）的全部容器。
 * 每个容器单容器就地整理：全程幂等、失败单项跳过、结果逐容器播报该容器名与合并数。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（含 OrganizeService、ensureContainersLoaded）
 */
export function registerOrganize(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, noParamCommand("ir:organize", "整理玩家所在仓库的全部容器"), ({ player }) => {
    const warehouse = findWarehouseAt(deps.loadedWarehouses(), player.dimension.id, {
      x: Math.floor(player.location.x),
      y: Math.floor(player.location.y),
      z: Math.floor(player.location.z),
    });
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}你不在任何仓库区域内`);
      return;
    }
    deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载后再整理
    let organized = 0;
    let totalMoves = 0;
    for (const container of warehouse.containers.values()) {
      const res = deps.organize.organizeContainer(warehouse, container, new MoveJournal());
      // 失败或**完全整齐**（messiness 归 0）→ 不展示；手动整理是强制整理，非 0 混乱度即使 0 合并也展示
      if (!res.ok || (res.moves === 0 && res.messiness.total === 0)) continue;
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
}
