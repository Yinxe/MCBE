// ─── ir:rescan 重扫容器命令（member+） ──────────────────
// 按名解析仓库 → member 校验 → 先 ensureContainersLoaded（以现有容器为准去重）→
// scanWarehouseArea 遍历区域补注册新容器（最小单位：只持久化本次新增容器 + 一次索引同步）。
// 超限（MAX_SCAN_VOLUME）跳过提示；结果播报扫描格数/新注册数/总容器数。
import { world } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";
import { scanWarehouseArea } from "./scan";

/**
 * 注册 `ir:rescan <名称>`：重新扫描仓库区域，把区域内受支持容器补注册进仓库 + 索引（member+）。
 * 只写新增容器（最小单位），已注册容器保留原角色/几何；超限跳过。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面
 */
export function registerRescan(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:rescan", "重新扫描仓库区域容器（member+）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "member")) {
      player.sendMessage(`${chat.error}需要 member 及以上权限`);
      return;
    }
    const dim = world.getDimension(warehouse.area.dimension);
    if (dim === undefined) {
      player.sendMessage(`${chat.error}维度加载失败`);
      return;
    }
    deps.ensureContainersLoaded(warehouse); // 扫描以现有容器为准去重 → 先按需加载
    const result = scanWarehouseArea(
      dim,
      warehouse.area,
      deps.factory,
      deps.resolveIndex(warehouse.id),
      warehouse,
      (wh, added) => {
        // 最小单位：只持久化本次新增的容器 + 一次索引同步
        for (const c of added) deps.persistContainer(wh, c);
        deps.persistContainerIds(wh);
      }
    );
    if (result.skipped) {
      player.sendMessage(`${chat.warn}区域过大（>${40_000} 格）已跳过，请缩小区域或手动放置注册`);
      return;
    }
    player.sendMessage(
      `${chat.success}扫描完成：${result.scanned} 格，新注册 ${result.registered} 容器（共 ${warehouse.containers.size}）`
    );
  });
}
