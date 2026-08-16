// ─── /mp:treescan — 树资源扫描诊断命令（管理员） ──────
// 以玩家为中心扫描半径内原木 → core 树判定算法 → 输出树资源列表
// （大树/小树 + 概率 + 因子分解 + 距离）与拒绝诊断。
// 两种扫描模式（对比用）：
//   algo  —— 两阶段算法（粗扫一次性定位 + 细扫工作队列，默认）
//   naive —— 朴素全扫（一次性扫描全部区域块，对比基准）
// 缺省 mode 时两种都跑并输出耗时对比。
// 用途：游戏内验收——对照视野内真实树木核对漏报/误报（每个树型找一棵
// 对照），并对木屋/柱子/装饰树等确认拒绝。扫描范围为矩形立方体，
// 边界树评估区域完整（cellKind 直查真实世界，不截断）。

import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { scanTreesNear, scanTreesNearNaive } from "../../../features/task/treeScan";
import { isAdmin } from "../auth";

/** 默认扫描半径（格，用户拍板：玩家周围 15 格） */
const DEFAULT_RADIUS = 15;
/** 半径上限（格，防超大扫描卡顿） */
const MAX_RADIUS = 30;

/** 单模式扫描：跑指定模式并输出汇总（耗时 + 结果） */
async function runMode(
  mode: "algo" | "naive",
  center: import("@minecraft/server").Vector3,
  dimension: import("@minecraft/server").Dimension,
  radius: number,
): Promise<{ trees: number; rejected: number; ms: number; lines: string[] }> {
  const t0 = Date.now();
  const detail = mode === "algo"
    ? await scanTreesNear(center, dimension, radius)
    : await scanTreesNearNaive(center, dimension, radius);
  const ms = Date.now() - t0;
  // 诊断日志（前缀区分模式）
  for (const line of detail.lines) {
    console.warn(`[MockPlayer][树资源][${mode}] ${line}`);
  }
  for (const t of detail.trees) {
    console.warn(
      `[MockPlayer][树资源][${mode}] ✓ ${t.kind === "big" ? "大树" : "小树"} P=${t.probability.toFixed(2)} ` +
        `@(${t.base.x},${t.base.y},${t.base.z})`
    );
  }
  console.warn(
    `[MockPlayer][树资源][${mode}] 汇总：接受 ${detail.trees.length} / 拒绝 ${detail.rejected.length}，耗时 ${ms}ms` +
      `（原木${detail.logsFound} 水平过滤${detail.horizontalFiltered} 候选${detail.candidates.length}）`
  );
  return { trees: detail.trees.length, rejected: detail.rejected.length, ms, lines: detail.lines };
}

/** 耗时对比消息 */
function compareMessage(algo: { ms: number }, naive: { ms: number }): string {
  if (naive.ms <= 0) return "";
  const ratio = (naive.ms / Math.max(algo.ms, 1)).toFixed(1);
  return algo.ms <= naive.ms
    ? `${color.success}对比：algo 比 naive 快 ${color.info}${ratio}${color.success} 倍`
    : `${color.warn}对比：naive 反而快 ${color.info}${ratio}${color.warn} 倍（algo 开销在细扫调度）`;
}

export function registerTreescanCommand(registry: any): void {
  defineCommand(
    registry,
    {
      name: "mp:treescan",
      description: "扫描玩家周围树资源：/mp:treescan [algo|naive] [半径 1-30]（缺省双模式对比）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "mode", type: CustomCommandParamType.String },
        { name: "radius", type: CustomCommandParamType.Integer },
      ],
    },
    ({ player, params }) => {
      if (!isAdmin(player)) {
        player.sendMessage(`${color.error}该命令仅管理员可用`);
        return;
      }
      // 解析：mode（algo/naive/缺省=双跑；纯数字=旧用法半径）
      let mode: "algo" | "naive" | "both" = "both";
      let radius = (params.radius as number | undefined) ?? DEFAULT_RADIUS;
      const rawMode = (params.mode as string | undefined)?.toLowerCase();
      if (rawMode) {
        if (rawMode === "algo" || rawMode === "naive") {
          mode = rawMode;
        } else if (/^\d+$/.test(rawMode)) {
          radius = parseInt(rawMode, 10); // 旧用法 /mp:treescan 20
        } else {
          player.sendMessage(`${color.error}未知模式 "${color.playerName}${rawMode}${color.error}"，可用: algo / naive（缺省双模式对比）`);
          return;
        }
      }
      radius = Math.min(Math.max(radius, 1), MAX_RADIUS);
      const pos = player.location;

      const label = mode === "both" ? "双模式对比" : `模式 ${mode}`;
      player.sendMessage(`${color.muted}[树资源] 开始${label}扫描 ${color.info}${radius}${color.muted} 格范围…`);

      system.run(async () => {
        try {
          if (mode === "both") {
            const a = await runMode("algo", pos, player.dimension, radius);
            player.sendMessage(
              `${color.accent}[树资源][algo] ${color.success}接受 ${a.trees} ${color.muted}/ ${color.warn}拒绝 ${a.rejected}` +
                `${color.muted} 耗时 ${color.info}${a.ms}ms`
            );
            const n = await runMode("naive", pos, player.dimension, radius);
            player.sendMessage(
              `${color.accent}[树资源][naive] ${color.success}接受 ${n.trees} ${color.muted}/ ${color.warn}拒绝 ${n.rejected}` +
                `${color.muted} 耗时 ${color.info}${n.ms}ms`
            );
            player.sendMessage(
              `${color.accent}[树资源] ${compareMessage(a, n)}` +
                `${color.muted}（algo ${color.info}${a.ms}ms${color.muted} / naive ${color.info}${n.ms}ms${color.muted}）`
            );
          } else {
            const r = await runMode(mode, pos, player.dimension, radius);
            player.sendMessage(
              `${color.accent}[树资源][${mode}] ${color.success}接受 ${r.trees} ${color.muted}/ ${color.warn}拒绝 ${r.rejected}` +
                `${color.muted} 耗时 ${color.info}${r.ms}ms${color.muted}——详细诊断已写入内容日志（前缀 [MockPlayer][树资源][${mode}]）`
            );
          }
        } catch (e: any) {
          player.sendMessage(`${color.error}[树资源] 扫描失败: ${e?.message ?? e}`);
        }
      });
    }
  );
}
