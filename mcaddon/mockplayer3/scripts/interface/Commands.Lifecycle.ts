// ─── 生命周期命令组 ────────────────────────────────────────────────
// 处理器只做一跳翻译：守卫在 CmdKit 包装器（玩家身份/admin/ctx.bot 管理权），
// 业务规则在 Lifecycle/Modes——此处零规则零持久化。

import { world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import { stateFlags } from "../domain/State";
import { services } from "../Composition";
import type { CommandSpec } from "./CmdKit";
import { Param } from "./CmdKit";

/**
 * 实时在线判定（状态机权威，record.declaredOnline 只是持久声明）。
 * @param botId 假人 id
 * @returns 当前会话是否在线
 */
export function isOnline(botId: number): boolean {
  const st = services.runtime.stateOf(botId);
  return st !== null && stateFlags(st).online;
}

/** 实时死亡判定（在线但处于 DYING 态） */
function isDying(botId: number): boolean {
  const st = services.runtime.stateOf(botId);
  return st !== null && stateFlags(st).death;
}

export const LIFECYCLE_COMMANDS: CommandSpec[] = [
  {
    name: "mp:create",
    description: "创建一个模拟玩家（假人）",
    usage: "mp:create [名称] [坐标] [维度]",
    args: [
      { name: "name", type: Param.String, optional: true },
      { name: "location", type: Param.Location, optional: true },
      { name: "dimension", type: Param.String, optional: true },
    ],
    async execute(ctx, a) {
      const botName = String(a.name ?? "").trim();
      if (!botName) {
        ctx.say(`${color.error}请填写假人名字：${color.muted}/mp:create <名字> [坐标] [维度]`);
        return;
      }
      const pos = ctx.coord(a.location, ctx.player.location);
      let dimensionId = ctx.player.dimension.id;
      const dimRaw = a.dimension === undefined ? "" : String(a.dimension).trim();
      if (dimRaw) {
        try {
          dimensionId = world.getDimension(dimRaw).id;
        } catch {
          ctx.say(`${color.error}维度无效：${color.playerName}${dimRaw}`);
          return;
        }
      }
      const rot = ctx.player.getRotation();
      const created = services.lifecycle.create(
        ctx.viewer,
        botName,
        { position: pos, yaw: rot.y, pitch: rot.x },
        dimensionId
      );
      if (!created.ok) {
        ctx.say(`${color.error}${created.reason}`);
        return;
      }
      if (created.botId === undefined) {
        ctx.say(`${color.error}建档回执异常（缺少 botId）`);
        return;
      }
      services.lifecycle.setSwitch(created.botId, "sneaking", ctx.player.isSneaking);
      const on = await services.lifecycle.online(ctx.viewer, created.botId);
      ctx.say(
        on.ok
          ? `${color.success}成功创建假人 ${color.playerName}${created.name}${color.accent} [自动重生]`
          : `${color.error}假人 ${color.playerName}${created.name}${color.error} 已建档但上线失败: ${on.reason ?? "unknown"}`
      );
    },
  },
  {
    name: "mp:online",
    description: "将一个已创建的假人上线并恢复所有状态",
    usage: "mp:online <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      if (isOnline(t.botId)) {
        ctx.say(`${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 已经在线`);
        return;
      }
      const res = await services.lifecycle.online(ctx.viewer, t.botId);
      ctx.say(
        res.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已上线`
          : `${color.error}${t.record.name} 上线失败: ${res.reason ?? "unknown"}`
      );
    },
  },
  {
    name: "mp:offline",
    description: "将假人下线，保留所有状态记录",
    usage: "mp:offline <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      if (!isOnline(t.botId)) {
        ctx.say(`${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 已经离线`);
        return;
      }
      ctx.say(`${color.muted}正在安全下线 ${color.playerName}${t.record.name}${color.muted} ...`);
      const res = await services.lifecycle.offline(t.botId, "command");
      ctx.say(
        res.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已安全下线`
          : `${color.error}${t.record.name} 下线失败: ${res.reason ?? "unknown"}`
      );
    },
  },
  // 安全上下线命令对：名字释放与区块就绪排队语义由上线管线承接
  {
    name: "mp:safeonline",
    description: "安全上线（等待名字释放与区块就绪后上线并恢复所有状态）",
    usage: "mp:safeonline <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      if (isOnline(t.botId)) {
        ctx.say(`${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 已经在线`);
        return;
      }
      ctx.say(`${color.muted}正在为 ${color.playerName}${t.record.name}${color.muted} 安全上线（排队中）...`);
      const res = await services.lifecycle.online(ctx.viewer, t.botId);
      ctx.say(
        res.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已安全上线`
          : `${color.error}${t.record.name} 安全上线失败: ${res.reason ?? "unknown"}`
      );
    },
  },
  {
    name: "mp:safeoffline",
    description: "安全下线（导出存档后下线，保留所有状态记录）",
    usage: "mp:safeoffline <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      if (!isOnline(t.botId)) {
        ctx.say(`${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 已经离线`);
        return;
      }
      ctx.say(`${color.muted}正在为 ${color.playerName}${t.record.name}${color.muted} 安全下线（排队中）...`);
      const res = await services.lifecycle.offline(t.botId, "command");
      ctx.say(
        res.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已安全下线`
          : `${color.error}${t.record.name} 安全下线失败: ${res.reason ?? "unknown"}`
      );
    },
  },
  {
    name: "mp:reconnect",
    description: "重连假人（下线+名字释放+重新上线，刷新躯体状态）",
    usage: "mp:reconnect <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      ctx.say(`${color.muted}正在重连 ${color.playerName}${t.record.name}${color.muted} ...`);
      const res = await services.lifecycle.reconnect(ctx.viewer, t.botId);
      ctx.say(
        res.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已重连上线`
          : `${color.error}${t.record.name} 重连失败: ${res.reason ?? "unknown"}`
      );
    },
  },
  {
    name: "mp:delete",
    description: "删除指定假人",
    usage: "mp:delete <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      const res = await services.lifecycle.remove(ctx.viewer, t.botId);
      ctx.say(
        res.ok
          ? `${color.success}已删除假人 ${color.playerName}${t.record.name}${color.success}，物品和经验已回收`
          : `${color.error}${res.reason}`
      );
    },
  },
  {
    name: "mp:killbot",
    description: "杀死一个在线的假人",
    usage: "mp:killbot <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      // 不可用提示用信息色而非错误色
      if (!isOnline(t.botId)) {
        ctx.say(`${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 不在线，无法杀死`);
        return;
      }
      if (isDying(t.botId)) {
        ctx.say(
          `${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 已经死亡，无需重复杀死`
        );
        return;
      }
      const r = services.ops.kill(t.botId);
      ctx.say(
        r.ok
          ? `${color.success}已杀死假人 ${color.playerName}${t.record.name}`
          : `${color.error}杀死假人失败: ${r.reason}`
      );
    },
  },
  {
    name: "mp:respawn",
    description: "切换假人的自动重生开关",
    usage: "mp:respawn <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      const next = !t.record.switches.autoRespawn;
      const r = services.lifecycle.setSwitch(t.botId, "autoRespawn", next);
      if (!r.ok) {
        ctx.say(`${color.error}${r.reason}`);
        return;
      }
      ctx.say(
        next
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已开启自动重生`
          : `${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 已关闭自动重生`
      );
    },
  },
  {
    name: "mp:setrespawn",
    description: "将假人的重生点设为玩家当前位置（不改变保存的视角）",
    usage: "mp:setrespawn <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      const t = ctx.bot(String(a.name));
      if (!t) return;
      const r = services.lifecycle.setRespawnHere(ctx.viewer, t.botId);
      ctx.say(
        r.ok
          ? `${color.success}已更新 ${color.playerName}${t.record.name}${color.success} 的重生点`
          : `${color.error}${r.reason}`
      );
    },
  },
  {
    name: "mp:reclaim",
    description: "回收假人全部背包装备和经验到玩家",
    usage: "mp:reclaim <假人>",
    args: [{ name: "name", type: Param.String }],
    async execute(ctx, a) {
      const name = String(a.name ?? "").trim();
      if (!name) {
        ctx.say(`${color.error}用法: /mp:reclaim <假人名>`);
        return;
      }
      const t = ctx.bot(name);
      if (!t) return;
      const r = await services.lifecycle.reclaim(ctx.viewer, t.botId);
      if (!r.ok) {
        ctx.say(`${color.error}回收失败: ${r.reason}`);
        return;
      }
      const parts: string[] = [];
      if (r.items > 0) parts.push(`${color.success}${r.items}${color.muted} 件物品`);
      if (r.overflow > 0) parts.push(`${color.playerName}${r.overflow}${color.muted} 件溢出掉落`);
      if (r.xp > 0) parts.push(`${color.accent}${r.xp} XP${color.muted}（Lv.${r.xpLevel}）`);
      ctx.say(
        parts.length
          ? `${color.success}已从 ${color.playerName}${t.record.name}${color.success} 回收: ${parts.join("、")}`
          : `${color.playerName}假人 ${color.playerName}${t.record.name}${color.playerName} 背包是空的`
      );
    },
  },
  {
    name: "mp:recover",
    description: "从持久化强制恢复假人的背包/装备/经验",
    usage: "mp:recover <假人>",
    args: [{ name: "name", type: Param.String, optional: true }],
    execute(ctx, a) {
      const name = a.name === undefined ? "" : String(a.name).trim();
      if (!name) {
        ctx.say(`${color.error}用法: /mp:recover <假人名>`);
        return;
      }
      const t = ctx.bot(name);
      if (!t) return;
      if (!isOnline(t.botId)) {
        ctx.say(`${color.error}假人 ${color.playerName}${name} ${color.error}不在线，请先上线`);
        return;
      }
      const hadData = services.ops.vaultHasData(t.botId);
      const r = services.lifecycle.recover(ctx.viewer, t.botId);
      if (!r.ok) {
        ctx.say(`${color.error}恢复数据失败: ${r.reason}`);
        return;
      }
      ctx.say(hadData ? `${color.success}背包/装备恢复成功` : `${color.muted}无可恢复的背包/装备数据`);
      const exp = t.record.experience;
      if (exp.totalXp > 0) ctx.say(`${color.success}经验恢复成功 (Lv.${exp.level} 总经验 ${exp.totalXp})`);
      ctx.say(
        hadData || exp.totalXp > 0
          ? `${color.success}恢复完成！请检查假人 ${color.playerName}${name} ${color.success}的背包`
          : `${color.error}未找到任何可恢复的数据`
      );
    },
  },
];
