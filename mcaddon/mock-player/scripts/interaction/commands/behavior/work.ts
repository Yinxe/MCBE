// ─── /mp:work —— 查看/切换假人工作模式 ────────────────────
// 合并自 v3 的 mp:work 思路（用我们自己的架构实现，不引入 v3 机制）：
//   无参数或 list → 列出工作模式目录（说明 + 是否启用 + 当前项）
//   带模式 id/别名 → 切换（复用 setWorkMode；未启用的模式拒绝并提示）
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { color, defineCommand } from "@yinxe/toolkit";
import { resolveBotForCommand } from "../auth";
import { configStore } from "../../../bootstrap/context";
import { setWorkMode } from "../../../features/state/behavior";
import {
  WORK_MODE_SPECS,
  workModeLabel,
  workModeSpec,
} from "../../../features/state/workModeCatalog";

/** 模式别名（中文简写 → id；id 本身也直接可用） */
const MODE_ALIASES: Record<string, string> = {
  无: "none",
  空闲: "none",
  闲逛: "wander",
  游走: "wander",
  挖掘: "mine",
  放置: "place",
  攻击: "attack",
  交互: "autoInteract",
  劫掠: "raid",
  钓鱼: "fishing",
  跟随: "follow",
  编程: "script",
  脚本: "script",
};

/** 注册 /mp:work 命令 */
export function registerWorkCommand(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(
    registry,
    {
      name: "mp:work",
      description: "查看/切换假人工作模式（无参数或 list 查看模式目录）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "mode", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      const botName = String(params.name ?? "").trim();
      const bot = resolveBotForCommand(player, botName);
      if (!bot) return;
      const record = bot.record;
      const raw = String(params.mode ?? "").trim();

      // ── 无参数 / list：列出模式目录 ──
      if (raw.length === 0 || raw.toLowerCase() === "list") {
        player.sendMessage(
          `${color.accent}━━━ 工作模式目录 ━━━${color.muted}（当前：${color.playerName}${workModeLabel(record.workMode)}${color.muted}）`,
        );
        for (const spec of WORK_MODE_SPECS) {
          const enabled = spec.id === "none" || configStore.isWorkModeEnabled(spec.id);
          const tag = enabled ? "" : `${color.error} [未启用]`;
          const cur = spec.id === record.workMode ? ` ${color.success}←当前` : "";
          player.sendMessage(
            `${color.playerName}${spec.label}${color.muted}（${spec.id}）${color.black}${spec.help}${tag}${cur}`,
          );
        }
        player.sendMessage(
          `${color.muted}用法：/mp:work ${botName} <模式id>（也支持中文，如 /mp:work ${botName} 钓鱼）`,
        );
        return;
      }

      // ── 切换模式 ──
      const id = MODE_ALIASES[raw] ?? raw;
      const spec = workModeSpec(id);
      if (!spec) {
        player.sendMessage(
          `${color.error}未知模式「${raw}」（用 /mp:work ${botName} list 查看目录）`,
        );
        return;
      }
      if (id !== "none" && !configStore.isWorkModeEnabled(id)) {
        player.sendMessage(
          `${color.error}模式「${spec.label}」未启用：请管理员在「管理员菜单 → 工作模式启用」里开启`,
        );
        return;
      }
      setWorkMode(record, spec.id);
      player.sendMessage(
        `${color.success}已将 ${color.playerName}${botName}${color.success} 切换到：${color.black}${spec.label}${color.muted}（${spec.id}）`,
      );
    },
  );
}