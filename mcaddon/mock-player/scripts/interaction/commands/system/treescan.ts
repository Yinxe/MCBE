// ─── /mp:treescan — 树资源扫描诊断命令（管理员） ──────
// 以玩家为中心扫描半径内原木 → core 树判定算法 → 输出树资源列表
// （大树/小树 + 概率 + 因子分解 + 距离）与拒绝诊断。
// 用途：游戏内验收——对照视野内真实树木核对漏报/误报（每个树型找一棵
// 对照），并对木屋/柱子/装饰树等确认拒绝。扫描范围为矩形立方体，
// 边界树评估区域完整（cellKind 直查真实世界，不截断）。

import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { scanTreesNear } from "../../../features/task/treeScan";
import { isAdmin } from "../auth";

/** 默认扫描半径（格，用户拍板：玩家周围 15 格） */
const DEFAULT_RADIUS = 15;
/** 半径上限（格，防超大扫描卡顿） */
const MAX_RADIUS = 30;

export function registerTreescanCommand(registry: any): void {
  defineCommand(
    registry,
    {
      name: "mp:treescan",
      description: "扫描玩家周围树资源（默认半径 15 格，可指定 1-30）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "radius", type: CustomCommandParamType.Integer }],
    },
    ({ player, params }) => {
      if (!isAdmin(player)) {
        player.sendMessage(`${color.error}该命令仅管理员可用`);
        return;
      }
      const radius = Math.min(Math.max((params.radius as number | undefined) ?? DEFAULT_RADIUS, 1), MAX_RADIUS);
      const pos = player.location;
      const detail = scanTreesNear(pos, player.dimension, radius);

      // ── 详细诊断全部走内容日志（console.warn，[MockPlayer][树资源] 前缀）──
      // 聊天只留一行汇总——大量行刷聊天不可复制，内容日志可整段复制回排障。
      const size = radius * 2 + 1;
      console.warn(
        `[MockPlayer][树资源] 中心(${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}) 半径${radius} ` +
          `立方体${size}×${size}×${size} 垂直原木${detail.logsFound} 水平过滤${detail.horizontalFiltered} 候选${detail.candidates.length}`
      );
      for (const line of detail.lines) {
        console.warn(`[MockPlayer][树资源] ${line}`);
      }
      console.warn(`[MockPlayer][树资源] 汇总：接受 ${detail.trees.length} / 拒绝 ${detail.rejected.length}`);
      for (const t of detail.trees) {
        const d = Math.hypot(t.base.x - pos.x, t.base.z - pos.z);
        console.warn(
          `[MockPlayer][树资源] ✓ ${t.kind === "big" ? "大树" : "小树"} P=${t.probability.toFixed(2)} 距离${Math.round(d)} @(${t.base.x},${t.base.y},${t.base.z})`
        );
      }
      player.sendMessage(
        `${color.accent}[树资源] ${color.success}接受 ${detail.trees.length} ${color.muted}/ ${color.warn}拒绝 ${detail.rejected.length}` +
          `${color.muted}——详细诊断已写入内容日志（前缀 [MockPlayer][树资源]）`
      );
    }
  );
}
