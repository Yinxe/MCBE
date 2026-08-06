// ─── ir:rescan_preview 预览重扫命令（member+，只读不写） ──
// 与 ir:rescan 同口径遍历区域，但**只列出**当前区域内的受支持容器坐标/类型，
// 不注册、不写索引、不改持久化——供玩家在真正 rescan 前确认范围。
// 直接扫区块方块（不经 warehouse.containers），故无需 ensureContainersLoaded。
import { world } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";
import { MAX_SCAN_VOLUME } from "./scan";
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
import { Table } from "../ui/Table";
import { chat } from "../ui/uiColor";

/**
 * 注册 `ir:rescan_preview <名称>`：只读预览区域内容器清单（member+，不写任何状态）。
 * 超限（MAX_SCAN_VOLUME）跳过；空区域提示；结果以表格输出坐标/类型。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（成员权限判定用）
 */
export function registerRescanPreview(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:rescan_preview", "预览重扫容器清单（member+）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.name, "member")) {
      player.sendMessage(`${chat.error}需要成员及以上权限`);
      return;
    }
    const dim = world.getDimension(warehouse.area.dimension);
    if (dim === undefined) {
      player.sendMessage(`${chat.error}维度加载失败`);
      return;
    }
    // 体积上限保护：与 rescan 一致，超限跳过（否则超大区域三重循环卡顿）
    const minX = Math.min(warehouse.area.corner1.x, warehouse.area.corner2.x);
    const maxX = Math.max(warehouse.area.corner1.x, warehouse.area.corner2.x);
    const minY = Math.min(warehouse.area.corner1.y, warehouse.area.corner2.y);
    const maxY = Math.max(warehouse.area.corner1.y, warehouse.area.corner2.y);
    const minZ = Math.min(warehouse.area.corner1.z, warehouse.area.corner2.z);
    const maxZ = Math.max(warehouse.area.corner1.z, warehouse.area.corner2.z);
    const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (volume > MAX_SCAN_VOLUME) {
      player.sendMessage(`${chat.error}区域体积超限（最大 ${MAX_SCAN_VOLUME} 格），请缩小区域`);
      return;
    }
    // 收集结构化行（坐标/类型），避免在数据里混颜色码再 split 的脆弱写法
    const found: Array<{ coord: string; type: string }> = [];
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const block = dim.getBlock({ x, y, z });
          if (block !== undefined && isSupportedContainerType(block.typeId)) {
            found.push({ coord: `${x},${y},${z}`, type: block.typeId });
          }
        }
      }
    }
    if (found.length === 0) {
      player.sendMessage(`${chat.muted}区域内容器为空`);
      return;
    }
    const table = new Table().header("坐标", "类型");
    for (const row of found) table.row(row.coord, row.type);
    player.sendMessage(`${chat.warn}预览：${found.length} 个容器\n${table.render()}`);
  });
}
