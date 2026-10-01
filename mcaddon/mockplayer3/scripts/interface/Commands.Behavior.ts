// ─── 行为命令组 ────────────────────────────────────────────────────
// mp:sneak 切潜行开关；mp:work 为工作模式统一切换入口（值表由 Catalog 派生）；
// mp:follow 双态（跟随目标持久化 + 模式互斥切换）。采集即模式，无独立命令。

import { color } from "@yinxe/toolkit";
import { WORK_MODES, modeAliasMap, modeSpec } from "../domain/Catalog";
import { services } from "../Composition";
import type { CommandSpec } from "./CmdKit";
import { Param } from "./CmdKit";
import { isOnline } from "./Commands.Lifecycle";

export const BEHAVIOR_COMMANDS: CommandSpec[] = [
  {
    name: "mp:sneak",
    description: "设置假人的潜行状态",
    usage: "mp:sneak <假人> [true|false]",
    args: [
      { name: "name", type: Param.String },
      { name: "sneak", type: Param.Boolean, optional: true },
    ],
    execute(ctx, a) {
      const name = String(a.name ?? "").trim();
      if (!name) {
        ctx.say(`${color.error}用法: /mp:sneak <假人> [true|false]`);
        return;
      }
      const t = ctx.bot(name);
      if (!t) return;
      // 裸命令默认潜行，站起须显式传 false
      const shouldSneak = a.sneak === undefined ? true : a.sneak === true;
      const r = services.lifecycle.setSwitch(t.botId, "sneaking", shouldSneak);
      if (!r.ok) {
        ctx.say(`${color.error}${r.reason}`);
        return;
      }
      ctx.say(
        shouldSneak
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已潜行`
          : `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已站起`
      );
    },
  },
  {
    name: "mp:work",
    description: "切换假人工作模式（模式=目录 id；无参或 list 查看目录与当前）",
    usage: "mp:work <假人> [模式id|list]",
    args: [
      { name: "name", type: Param.String },
      { name: "mode", type: Param.Enum, optional: true, enum: [...WORK_MODES.map((m) => m.id), "list"] },
    ],
    execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      const raw = a.mode === undefined ? "" : String(a.mode);
      const aliases = modeAliasMap();
      // 无参/list：渲染模式目录（当前高亮、禁用标注）
      if (!raw || raw === "list") {
        const enabled = services.runtime.config.workModeEnabled;
        const expOn = services.runtime.config.experimentalEnabled;
        ctx.say(
          `${color.accent}≡≡≡ 工作模式目录 ≡≡≡（当前：${color.playerName}${modeSpec(t.record.workMode).label}${color.accent}）`
        );
        for (const spec of WORK_MODES) {
          const tag =
            enabled[spec.id] === false ? " [已禁用]" : spec.experimental === true && !expOn ? " [未开放·实现中]" : "";
          ctx.say(
            ` ${color.playerName}${spec.label}${color.muted} (${spec.id}) ${spec.help}${tag ? color.error + tag : ""}`
          );
        }
        return;
      }
      // 枚举值表由目录派生、引擎已校验；查别名表收窄为 WorkMode
      const mode = aliases[raw];
      if (!mode) {
        ctx.say(
          `${color.error}未知模式：${color.playerName}${raw}${color.error}（mp:work ${t.record.name} list 查看目录）`
        );
        return;
      }
      const r = services.lifecycle.changeWorkMode(ctx.viewer, t.botId, mode);
      ctx.say(
        r.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已切换为 ${color.playerName}${modeSpec(mode).label}`
          : `${color.error}${r.reason}`
      );
    },
  },
  {
    name: "mp:follow",
    description: "让假人跟随/停止跟随执行者",
    usage: "mp:follow <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      if (t.record.workMode === "follow") {
        // 停止跟随时先清关系再切模式，避免离线记录残留 follow
        services.lifecycle.setFollowTarget(ctx.viewer, t.botId, null);
        services.lifecycle.changeWorkMode(ctx.viewer, t.botId, "none");
        ctx.say(`${color.success}已停止 ${color.playerName}${t.record.name}${color.success} 的跟随`);
        return;
      }
      const rel = services.lifecycle.setFollowTarget(ctx.viewer, t.botId, ctx.viewer.key);
      if (!rel.ok) {
        ctx.say(`${color.error}${rel.reason}`);
        return;
      }
      const r = services.lifecycle.changeWorkMode(ctx.viewer, t.botId, "follow");
      ctx.say(
        r.ok
          ? isOnline(t.botId)
            ? `${color.success}${color.playerName}${t.record.name}${color.success} 正在跟随你（已切至跟随模式）`
            : `${color.success}已为 ${color.playerName}${t.record.name}${color.success} 设定跟随你（离线假人下次上线生效）`
          : `${color.error}启动跟随失败：${r.reason}`
      );
    },
  },
];
