// ─── ir:delete 删除仓库命令（owner） ─────────────────────
// 按显示名解析仓库 → 校验 owner 权限 → 延迟一拍执行 WarehouseService.deleteWarehouse。
// 删除的副作用（loaded 剔除 / 停调度 / 清索引+统计+容器注册表键）全部由领域事件
// warehouseDeleted 的订阅者完成（events/Subscriptions.ts），本命令只负责触发删除。
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";

/**
 * 注册 `ir:delete <名称>`：按显示名删除仓库（仅 owner，owner 角色经 auth 校验）。
 * 解析不到仓库 / 权限不足 → 中文错误；成功经领域事件联动清内存与持久化键。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（含 WarehouseService）
 */
export function registerDelete(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:delete", "删除仓库（owner）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "owner")) {
      player.sendMessage(`${chat.error}需要 owner 权限`);
      return;
    }
    deps.warehouses.deleteWarehouse(warehouse.id);
    player.sendMessage(`${chat.success}仓库 "${warehouse.displayName}" 已删除`);
  });
}
