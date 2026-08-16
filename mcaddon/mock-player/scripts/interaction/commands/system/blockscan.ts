// ─── 坐标集扫描测试命令（管理员） ──────────────────────
// 直接 getBlocks 扫大范围（默认半径 32 空间体），每次只扫一种方块：
//   /mp:scanlogs   —— 只扫原木坐标集（数量/高度分布/耗时）
//   /mp:scanleaves —— 只扫树叶坐标集
//   /mp:scantree   —— 两坐标集 + 纯算术评估（logs/leaves 关系算树，评估零世界查询）
// 用途：验证"坐标集纯算术评估"可行性——原木/树叶坐标集能否直接作为树判定条件。

import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { buildTreeSetReport, collectCoordinateSet, scanTreesFromSets, VALID_LOG_TYPE_IDS, VALID_LEAF_TYPE_IDS } from "../../../features/task/treeScan";
import { isAdmin } from "../auth";

/** 默认扫描半径（格，空间体半边长） */
const DEFAULT_RADIUS = 32;
/** 半径上限 */
const MAX_RADIUS = 64;
/** 高度范围（下探 10 上探 40，覆盖树底到树顶） */
const SCAN_BELOW = 10;
const SCAN_ABOVE = 40;

/** 解析半径参数（缺省 32，1-64） */
function resolveRadius(params: Record<string, unknown> | undefined): number {
  return Math.min(Math.max((params?.radius as number | undefined) ?? DEFAULT_RADIUS, 1), MAX_RADIUS);
}

/** 坐标集采集公共执行体 */
function runCollect(
  player: import("@minecraft/server").Player,
  radius: number,
  typeIds: readonly string[],
  name: string,
): void {
  const pos = player.location;
  const fromY = Math.max(-64, pos.y - SCAN_BELOW);
  const toY = Math.min(320, pos.y + SCAN_ABOVE);
  player.sendMessage(`${color.muted}[坐标集] 开始扫描 ${color.info}${name}${color.muted}（半径 ${color.info}${radius}${color.muted}，Y ${fromY}..${toY}）…`);
  system.run(() => {
    try {
      const result = collectCoordinateSet(player.dimension, pos, radius, typeIds, name, fromY, toY);
      console.warn(
        `[MockPlayer][坐标集] ${name}：${result.count} 个（Y ${result.minY}..${result.maxY}）耗时 ${result.ms}ms｜` +
          `体积 ${(2 * radius + 1)}×${(toY - fromY + 1)}×${(2 * radius + 1)}`
      );
      player.sendMessage(
        `${color.accent}[坐标集] ${color.success}${name} ${color.info}${result.count}${color.success} 个` +
          `${color.muted}（Y ${color.info}${result.minY}..${result.maxY}${color.muted}）耗时 ${color.info}${result.ms}${color.muted}ms` +
          `${color.muted}——已写入内容日志`
      );
    } catch (e: any) {
      player.sendMessage(`${color.error}[坐标集] ${name} 扫描失败: ${e?.message ?? e}`);
    }
  });
}

export function registerScanlogsCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:scanlogs", description: "直接扫描大范围内全部原木坐标集（默认半径 32 空间体）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "radius", type: CustomCommandParamType.Integer }],
  }, ({ player, params }) => {
    if (!isAdmin(player)) { player.sendMessage(`${color.error}该命令仅管理员可用`); return; }
    runCollect(player, resolveRadius(params), VALID_LOG_TYPE_IDS, "原木");
  });
}

export function registerScanleavesCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:scanleaves", description: "直接扫描大范围内全部树叶坐标集（默认半径 32 空间体）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "radius", type: CustomCommandParamType.Integer }],
  }, ({ player, params }) => {
    if (!isAdmin(player)) { player.sendMessage(`${color.error}该命令仅管理员可用`); return; }
    runCollect(player, resolveRadius(params), VALID_LEAF_TYPE_IDS, "树叶");
  });
}

export function registerScantreeCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:scantree", description: "两坐标集纯算术树评估：原木+树叶坐标集 → logs/leaves 关系算树（评估零世界查询）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "radius", type: CustomCommandParamType.Integer }],
  }, ({ player, params }) => {
    if (!isAdmin(player)) { player.sendMessage(`${color.error}该命令仅管理员可用`); return; }
    const radius = resolveRadius(params);
    const pos = player.location;
    player.sendMessage(`${color.muted}[坐标集] 开始树评估（半径 ${color.info}${radius}${color.muted}：原木集 + 树叶集 → 纯算术）…`);
    system.run(async () => {
      try {
        const r = await scanTreesFromSets(pos, player.dimension, radius);
        const fromY = Math.max(-64, pos.y - 10);
        const toY = Math.min(320, pos.y + 40);
        // ⚠️ 日志 IO 性能：console.warn 是同步 IO（写日志系统/文件，每次调用 ~几十 ms）——
        //    报告 100+ 行若逐行调用 = 数秒卡顿；合并为**一次调用**（\n 拼接）输出整份报告
        const reportText = buildTreeSetReport(r, radius, fromY, toY).join("\n");
        console.warn(`[MockPlayer][坐标集][树] ${reportText}`);
        player.sendMessage(
          `${color.accent}[坐标集][树] ${color.success}接受 ${r.trees.length} ${color.muted}/ ${color.warn}拒绝 ${r.rejected.length}` +
            `${color.muted}（原木 ${color.info}${r.logs.count}${color.muted} 叶 ${color.info}${r.leaves.count}${color.muted} 总 ${color.info}${r.ms}${color.muted}ms）` +
            `${color.muted}——已写入内容日志`
        );
      } catch (e: any) {
        player.sendMessage(`${color.error}[坐标集][树] 扫描失败: ${e?.message ?? e}`);
      }
    });
  });
}
