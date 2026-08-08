// ─── ir:resize 调整区域命令（owner） ─────────────────────
// 按名解析仓库 → 校验 owner → 两角归一化新区域 → WarehouseService.updateArea。
// 区域变化使仓库 ID 重算时（ID 编码初始区域），迁移由 warehouseAreaChanged 事件订阅者
// 处理（cids 索引 old→new + 调度器重注册，见 events/Subscriptions.ts）；新区域内的容器
// 由后续 /ir:rescan 或放块/惰性补注册收敛。
import { defineCommand, canManage } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { regionCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";

/**
 * 注册 `ir:resize <名称> <pos1> <pos2>`：调整仓库区域（仅 owner）。
 * 与 createWarehouse 同样跑建仓限制校验（体积/重叠/间距，排除自身）；失败返回中文错误。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（含 WarehouseService）
 */
export function registerResize(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, regionCommand("ir:resize", "调整仓库区域（owner）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.name, "owner", canManage(player))) {
      player.sendMessage(`${chat.error}需要拥有者权限`);
      return;
    }
    const p1 = params.pos1 as { x: number; y: number; z: number };
    const p2 = params.pos2 as { x: number; y: number; z: number };
    const area = {
      dimension: player.dimension.id,
      corner1: { x: Math.floor(p1.x), y: Math.floor(p1.y), z: Math.floor(p1.z) },
      corner2: { x: Math.floor(p2.x), y: Math.floor(p2.y), z: Math.floor(p2.z) },
    };
    const err = deps.warehouses.updateArea(warehouse, area);
    if (err !== undefined) {
      player.sendMessage(`${chat.error}${err}`);
      return;
    }
    player.sendMessage(`${chat.success}仓库 "${warehouse.displayName}" 区域已调整`);
    deps.bus.visualEffect.trigger({ type: "visual-effect", kind: "boundary-glow", warehouseId: warehouse.id });
  });
}
