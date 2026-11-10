// ─── ir:search 搜索命令（member+） ──────────────────────
// 命令入口：就近取玩家有权限（owner/member）的**最近**仓库，只搜该仓（不跨仓），
// 命中物品发消息 + 粒子标记（SearchUI）。带仓库下拉的选择入口见 `ir:menu`→容器搜索。
// 权限：member+（COMMAND_MIN_ROLE.search，v1 语义）；非成员无法搜。
import type { CustomCommandRegistry } from "@minecraft/server";
import { registerPlayerCommand } from "./register";
import { chat } from "../ui/uiColor";
import { queryCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { nearestWarehouseByPermission } from "../../core/model/Area";
import { runSearchAndDisplay } from "../ui/SearchUI";
import { playerGuard } from "../util/playerGuard";

/**
 * 注册 `ir:search <查询词>`：就近取有权限的最近仓库，搜索并标记匹配物品所在容器。
 * 搜索内容经 runSearchAndDisplay（其内先 ensureContainersLoaded，仓库可能未激活）。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（member 权限判定用）
 */
export function registerSearch(registry: CustomCommandRegistry, deps: CommandDeps): void {
  registerPlayerCommand(
    registry,
    queryCommand("ir:search", "在你有权限的最近仓库搜索物品（member+）"),
    ({ player, playerName, params }) => {
      // ⚠️ 位置读取包守卫：命令推迟后句柄可能失效，裸读 `.dimension` / `.location` 即 TypeError
      const snapshot = playerGuard.safePlayerCall(player, (p) => ({
        dimensionId: p.dimension.id,
        position: { x: p.location.x, z: p.location.z },
      }));
      if (snapshot === undefined) {
        player.sendMessage(`${chat.error}无法读取你的位置，请稍后重试`);
        return;
      }
      // 权限：仅 owner/member 可搜；就近取该玩家有权限的仓库（v1 filterNearbyOwned 同义）
      const warehouse = nearestWarehouseByPermission(
        deps.loadedWarehouses(),
        snapshot.dimensionId,
        snapshot.position,
        (w) => deps.members.can(w, playerName, "member")
      );
      if (warehouse === undefined) {
        player.sendMessage(`${chat.error}附近没有你有权限（成员）的仓库`);
        return;
      }
      runSearchAndDisplay(player, deps, warehouse, params.query as string);
    }
  );
}
