// ─── ir:search 搜索命令（member+） ──────────────────────
// 命令入口：就近取玩家有权限（owner/member）的**最近**仓库，只搜该仓（不跨仓），
// 命中物品发消息 + 粒子标记（SearchUI）。带仓库下拉的选择入口见 `ir:menu`→容器搜索。
// 权限：member+（COMMAND_MIN_ROLE.search，v1 语义）；非成员无法搜。
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { queryCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { nearestWarehouseByPermission } from "../../core/model/Area";
import { runSearchAndDisplay } from "../ui/SearchUI";

/**
 * 注册 `ir:search <查询词>`：就近取有权限的最近仓库，搜索并标记匹配物品所在容器。
 * 搜索内容经 runSearchAndDisplay（其内先 ensureContainersLoaded，仓库可能未激活）。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（member 权限判定用）
 */
export function registerSearch(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(
    registry,
    queryCommand("ir:search", "在你有权限的最近仓库搜索物品（member+）"),
    ({ player, params }) => {
      system.runTimeout(() => {
        // 权限：仅 owner/member 可搜；就近取该玩家有权限的仓库（v1 filterNearbyOwned 同义）
        const warehouse = nearestWarehouseByPermission(
          deps.loadedWarehouses(),
          player.dimension.id,
          { x: player.location.x, z: player.location.z },
          (w) => deps.members.can(w, player.id, "member")
        );
        if (warehouse === undefined) {
          player.sendMessage(`${chat.error}附近没有你有权限（成员）的仓库`);
          return;
        }
        runSearchAndDisplay(player, deps, warehouse, params.query as string);
      });
    }
  );
}
