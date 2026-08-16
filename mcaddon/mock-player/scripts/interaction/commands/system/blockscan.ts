// ─── 坐标集扫描测试命令（管理员） ──────────────────────
// 直接 getBlocks 扫大范围（默认半径 32 空间体），每次只扫一种方块：
//   /mp:scanlogs   [半径] [debug]   —— 只扫原木坐标集
//   /mp:scanleaves [半径] [debug]   —— 只扫树叶坐标集
//   /mp:scantree   [半径] [debug]   —— 两坐标集 + 纯算术评估（logs/leaves 关系算树）
// ⚠️ 日志纪律：默认只输出聊天汇总一行（sendMessage）；完整报告仅在
//    debug 参数（debug/d/1）时打印内容日志——console.warn 是同步 IO，
//    正常工作时零日志，呈现方式由调用方决定。

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

/** 调试开关：debug/d/1/true → 打印完整日志（默认关——正常工作时零日志） */
function isDebug(params: Record<string, unknown> | undefined): boolean {
  const d = (params?.debug as string | undefined)?.toLowerCase();
  return d === "debug" || d === "d" || d === "1" || d === "true";
}

/** 坐标集采集公共执行体（debug 才打内容日志） */
function runCollect(
  player: import("@minecraft/server").Player,
  radius: number,
  typeIds: readonly string[],
  name: string,
  debug: boolean,
): void {
  const pos = player.location;
  const fromY = Math.max(-64, pos.y - SCAN_BELOW);
  const toY = Math.min(320, pos.y + SCAN_ABOVE);
  player.sendMessage(`${color.muted}[坐标集] 开始扫描 ${color.info}${name}${color.muted}（半径 ${color.info}${radius}${color.muted}，Y ${fromY}..${toY}）…`);
  system.run(() => {
    try {
      const result = collectCoordinateSet(player.dimension, pos, radius, typeIds, name, fromY, toY);
      if (debug) {
        console.warn(
          `[MockPlayer][坐标集] ${name}：${result.count} 个（Y ${result.minY}..${result.maxY}）耗时 ${result.ms}ms｜` +
            `体积 ${(2 * radius + 1)}×${(toY - fromY + 1)}×${(2 * radius + 1)}`
        );
      }
      player.sendMessage(
        `${color.accent}[坐标集] ${color.success}${name} ${color.info}${result.count}${color.success} 个` +
          `${color.muted}（Y ${color.info}${result.minY}..${result.maxY}${color.muted}）耗时 ${color.info}${result.ms}${color.muted}ms` +
          (debug ? `${color.muted}——已写入内容日志` : "")
      );
    } catch (e: any) {
      player.sendMessage(`${color.error}[坐标集] ${name} 扫描失败: ${e?.message ?? e}`);
    }
  });
}

export function registerScanlogsCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:scanlogs", description: "直接扫描大范围内全部原木坐标集（默认半径 32；debug 参数打印详细日志）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "radius", type: CustomCommandParamType.Integer },
      { name: "debug", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) { player.sendMessage(`${color.error}该命令仅管理员可用`); return; }
    runCollect(player, resolveRadius(params), VALID_LOG_TYPE_IDS, "原木", isDebug(params));
  });
}

export function registerScanleavesCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:scanleaves", description: "直接扫描大范围内全部树叶坐标集（默认半径 32；debug 参数打印详细日志）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "radius", type: CustomCommandParamType.Integer },
      { name: "debug", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) { player.sendMessage(`${color.error}该命令仅管理员可用`); return; }
    runCollect(player, resolveRadius(params), VALID_LEAF_TYPE_IDS, "树叶", isDebug(params));
  });
}

export function registerScantreeCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:scantree", description: "两坐标集纯算术树评估（默认半径 32；debug 参数打印完整评估报告）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "radius", type: CustomCommandParamType.Integer },
      { name: "debug", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) { player.sendMessage(`${color.error}该命令仅管理员可用`); return; }
    const radius = resolveRadius(params);
    const debug = isDebug(params);
    const pos = player.location;
    player.sendMessage(`${color.muted}[坐标集] 开始树评估（半径 ${color.info}${radius}${color.muted}：原木集 + 树叶集 → 纯算术）…`);
    system.run(async () => {
      try {
        const r = await scanTreesFromSets(pos, player.dimension, radius);
        // ⚠️ 日志纪律：仅 debug 时输出完整报告（console.warn 是同步 IO，
        //    一次调用输出整份（\n 拼接）——正常工作时零日志，呈现由调用方决定）
        if (debug) {
          const fromY = Math.max(-64, pos.y - SCAN_BELOW);
          const toY = Math.min(320, pos.y + SCAN_ABOVE);
          const reportText = buildTreeSetReport(r, radius, fromY, toY).join("\n");
          console.warn(`[MockPlayer][坐标集][树] ${reportText}`);
        }
        player.sendMessage(
          `${color.accent}[坐标集][树] ${color.success}接受 ${r.trees.length} ${color.muted}/ ${color.warn}拒绝 ${r.rejected.length}` +
            `${color.muted}（原木 ${color.info}${r.logs.count}${color.muted} 叶 ${color.info}${r.leaves.count}${color.muted} 总 ${color.info}${r.ms}${color.muted}ms）` +
            (debug ? `${color.muted}——已写入内容日志` : "")
        );
      } catch (e: any) {
        player.sendMessage(`${color.error}[坐标集][树] 扫描失败: ${e?.message ?? e}`);
      }
    });
  });
}
