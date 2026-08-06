// ─── ir:create 建仓命令（按坐标精确建仓） ─────────────────
// 与信物交互的"选区建仓"（ToolInteractionController → interactionLogic）并列的第二种建仓入口：
// 玩家直接提供 `<名称> <pos1> <pos2>` 三个参数（坐标或望准方块），命令回调内用两对角
// 归一化出仓库区域 → WarehouseService.createWarehouse 校验建仓限制（体积/间距/同名/上限）
// → 成功后触发 boundary-glow 视觉反馈（边界光幕，见 BoundaryDisplay）。
// ⚠️ 与选区建仓的差异：本命令不经过选区会话，也不自动扫描容器——创建后容器由
//    后续 /ir:rescan 或仓库激活时的按需加载补齐（createWarehouse 只落 meta）。
// ⚠️ 回调由 toolkit defineCommand 包在 runSafeAsync（system.run + 错误捕获）内执行，不再手包 runTimeout。
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { regionCommand } from "./defs";
import type { CommandDeps } from "./deps";

/**
 * 注册 `ir:create <名称> <pos1> <pos2>`：按两对角坐标创建物品路由仓库。
 * 区域由两角点归一化（自动纠正乱序）；建仓失败返回中文错误（同名/重叠/超限/超量）。
 *
 * @param registry - startup 事件提供的自定义命令注册表
 * @param deps     - 命令共享依赖门面（含 WarehouseService）
 */
export function registerCreate(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, regionCommand("ir:create", "创建物品路由仓库区域"), ({ player, params }) => {
    const name = (params.name as string).trim();
    const p1 = params.pos1 as { x: number; y: number; z: number };
    const p2 = params.pos2 as { x: number; y: number; z: number };
    const area = {
      dimension: player.dimension.id,
      corner1: { x: Math.floor(p1.x), y: Math.floor(p1.y), z: Math.floor(p1.z) },
      corner2: { x: Math.floor(p2.x), y: Math.floor(p2.y), z: Math.floor(p2.z) },
    };
    const result = deps.warehouses.createWarehouse(name, player.id, area);
    if (!result.ok) {
      player.sendMessage(`${chat.error}${result.error}`);
      return;
    }
    player.sendMessage(`${chat.success}仓库 "${result.warehouse.displayName}" 创建成功！可 /ir:rescan 扫描容器`);
    deps.bus.visualEffect.trigger({
      type: "visual-effect",
      kind: "boundary-glow",
      warehouseId: result.warehouse.id,
    });
  });
}
