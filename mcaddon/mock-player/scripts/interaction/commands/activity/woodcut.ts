// ─── 砍树流程测试命令（管理员） ────────────────────────
// /mp:woodcut [radius] [mode] —— 扫描树资源并展示砍伐计划（单树 flow 诊断）：
//   - 扫描玩家为中心默认 16 格内的树（scanTreesFromSets）
//   - 对最近的树按模式生成 ChopPlan（计划 + 拾取范围）逐条展示
//   - mode: logs（原木模式，默认）/ collect（收集模式，完整破整树）
// 仅管理员可用（对齐 /mp:scantree 测试命令先例）。

import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { scanTreesFromSets } from "../../../features/flow";
import { describeChopPlan } from "../../../features/flow/woodcutFlow";
import { planChop } from "../../../rules/woodcut/ChopPlan";
import type { ChopMode } from "../../../rules/woodcut/WoodcutRules";
import { isAdmin } from "../auth";

/** 默认半径（格） */
const DEFAULT_RADIUS = 16;
/** 半径上限 */
const MAX_RADIUS = 32;

/** 解析模式参数：logs=原木模式 / collect=收集模式 */
function resolveMode(params: Record<string, unknown> | undefined): ChopMode {
  const m = String(params?.mode ?? "logs").toLowerCase();
  return m === "collect" ? "collect" : "logs";
}

export function registerWoodcutCommands(registry: any): void {
  defineCommand(registry, {
    name: "mp:woodcut",
    description: "扫描树资源并展示单树砍伐计划（默认半径 16；mode: logs/collect）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "radius", type: CustomCommandParamType.Integer },
      { name: "mode", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}该命令仅管理员可用`);
      return;
    }
    const radius = Math.min(Math.max((params?.radius as number | undefined) ?? DEFAULT_RADIUS, 1), MAX_RADIUS);
    const mode = resolveMode(params);
    const pos = player.location;
    player.sendMessage(
      `${color.muted}[树] 开始砍伐计划诊断（半径 ${color.info}${radius}${color.muted}，模式 ${color.info}${mode === "logs" ? "原木模式" : "收集模式"}${color.muted}）…`,
    );
    system.run(async () => {
      try {
        const r = await scanTreesFromSets(pos, player.dimension, radius);
        if (r.trees.length === 0) {
          player.sendMessage(`${color.error}[树] 附近 ${radius} 格内没有树资源（接受 ${r.trees.length} / 拒绝 ${r.rejected.length}）`);
          return;
        }
        player.sendMessage(
          `${color.accent}[树] 接受 ${color.success}${r.trees.length}${color.accent} 棵，展示最近一棵（${color.info}${r.trees[0]!.id}${color.accent}，${r.trees[0]!.logs.length} 圆木 / ${r.trees[0]!.leafs.length} 叶）`,
        );
        const plan = planChop(r.trees[0]!, mode);
        for (const line of describeChopPlan(plan)) {
          player.sendMessage(line.replace(/^\[树\] /, `${color.accent}[树] ${color.muted}`));
        }
      } catch (e: any) {
        player.sendMessage(`${color.error}[树] 砍伐计划诊断失败: ${e?.message ?? e}`);
      }
    });
  });
}
