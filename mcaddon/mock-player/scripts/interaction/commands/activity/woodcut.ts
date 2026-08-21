// ─── 砍树流程测试命令（管理员） ────────────────────────
// /mp:woodcut [radius] [mode] —— 扫描树资源并展示砍伐计划（单树 flow 诊断）：
//   - 扫描玩家为中心默认 16 格内的树（scanTreesFromSets）
//   - 对最近的树按模式生成 ChopPlan（计划 + 拾取范围）逐条展示
//   - mode: logs（原木模式，默认）/ collect（收集模式，完整破整树）
// /mp:woodcutmode <bot> <logs|collect> —— 设置假人砍树子模式（枚举，持久化）
// 仅管理员可用（对齐 /mp:scantree 测试命令先例）。

import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { scanTreesFromSets } from "../../../features/flow";
import { describeChopPlan } from "../../../features/flow/woodcutFlow";
import { planChop } from "../../../rules/woodcut/ChopPlan";
import { CHOP_MODE_LABEL, normalizeChopMode, type ChopMode } from "../../../rules/woodcut/WoodcutRules";
import { isAdmin, resolveBotForCommand } from "../auth";
import { saveCoordinator } from "../../../bootstrap/context";

/** 默认半径（格） */
const DEFAULT_RADIUS = 16;
/** 半径上限 */
const MAX_RADIUS = 32;

/** 解析模式参数：logs=原木模式 / collect=收集模式（非法回退 logs，core 规格化） */
function resolveMode(params: Record<string, unknown> | undefined): ChopMode {
  return normalizeChopMode(String(params?.mode ?? "logs").toLowerCase());
}

/**
 * 解析模式参数：非法值返回 undefined（命令校验用，拒绝静默回退）。
 * 校验复用 core 枚举入口——避免命令层手抄枚举漏同步。
 */
function parseMode(strict: string): ChopMode | undefined {
  const normalized = normalizeChopMode(String(strict).toLowerCase());
  // normalizeChopMode 会把非法值回退 logs——这里需要区分"用户显式传 logs"与"非法回退"
  return String(strict).toLowerCase() === normalized ? normalized : undefined;
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

  // ── /mp:woodcutmode <bot> <logs|collect> 设置假人砍树子模式 ──
  defineCommand(registry, {
    name: "mp:woodcutmode",
    description: "设置假人砍树子模式（logs=原木模式 / collect=收集模式，持久化）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "mode", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const mode = parseMode(String(params?.mode ?? "logs"));
    if (!mode) {
      player.sendMessage(`${color.error}模式参数非法：仅支持 ${CHOP_MODE_LABEL["logs"]}（logs）/ ${CHOP_MODE_LABEL["collect"]}（collect）`);
      return;
    }
    bot.record.woodcutMode = mode;
    saveCoordinator.saveRecord(bot.record);
    player.sendMessage(
      `${color.success}已设置 ${color.playerName}${bot.record.name}${color.success} 的砍树子模式为 ${color.info}${CHOP_MODE_LABEL[mode]}${color.success}` +
        `（workMode 为 woodcut 时生效）`,
    );
  });
}
