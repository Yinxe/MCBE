// ─── 导航命令组 ────────────────────────────────────────────────────
// mover 返回 NavOutcome 枚举，播报文案由 navigateMessage 单点映射。

import { color } from "@yinxe/toolkit";
import type { Vec3 } from "../domain/Coords";
import type { NavOutcome } from "../domain/NavRules";
import { mover } from "../engine/Mover";
import { services } from "../Composition";
import type { CommandSpec } from "./CmdKit";
import { Param } from "./CmdKit";
import { TELEPORT_DISABLED_NOTICE, teleportEnabled } from "./Kit";

/** 寻路结果 → 播报文案；pos=目标坐标取整 */
function navigateMessage(targetName: string, loc: Vec3, outcome: NavOutcome, nearby = false): string {
  const pos = `${color.playerName}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`;
  switch (outcome) {
    case "arrived":
      return nearby
        ? `${color.success}假人 ${color.playerName}${targetName}${color.success} 已在目标点附近停下（nearby=true，视为到达）${pos}`
        : `${color.success}假人 ${color.playerName}${targetName}${color.success} 已到达 ${pos}`;
    case "too_far":
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 拒绝寻路：目标 ${pos} 超出最远距离（>16 格）`;
    case "no_path":
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 无法到达 ${pos}：无路径可达（障碍/距离过远）`;
    case "still_timeout":
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 移动超时：0.5 秒内位置未变化（可能卡住）`;
    case "timeout":
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 30 秒未到达 ${pos}（仍在移动或路径过长）`;
    case "unavailable":
      return `${color.error}假人 ${color.playerName}${targetName}${color.error} 不可用（不在线或已死亡）`;
    case "entity_invalid":
      return `${color.error}假人 ${color.playerName}${targetName}${color.error} 移动中实体失效（死亡/下线）`;
    default:
      return `${color.error}移动假人 ${color.playerName}${targetName}${color.error} 失败（异常）`;
  }
}

export const NAVIGATION_COMMANDS: CommandSpec[] = [
  {
    name: "mp:teleportbot",
    description: "传送到假人身边",
    usage: "mp:teleportbot <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      if (!teleportEnabled()) {
        ctx.say(`${color.error}${TELEPORT_DISABLED_NOTICE}`);
        return;
      }
      const t = ctx.bot(String(a.name));
      if (!t) return;
      const pose = services.ops.readPose(t.botId);
      if (!pose) {
        ctx.say(`${color.error}假人 ${color.playerName}${t.record.name}${color.error} 不在线，无法传送`);
        return;
      }
      const r = services.ops.tpPlayerTo(ctx.player.name, pose.position, pose.dimensionId);
      ctx.say(
        r.ok
          ? `${color.success}已传送到假人 ${color.playerName}${t.record.name}${color.success} 身边`
          : `${color.error}传送失败: ${r.reason}`
      );
    },
  },
  {
    name: "mp:tphere",
    description: "让假人传送到玩家身边",
    usage: "mp:tphere <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      if (!teleportEnabled()) {
        ctx.say(`${color.error}${TELEPORT_DISABLED_NOTICE}`);
        return;
      }
      const t = ctx.bot(String(a.name));
      if (!t) return;
      const pose = services.ops.readPose(t.botId);
      const yaw = pose?.yaw ?? 0;
      const pitch = pose?.pitch ?? 0;
      if (!pose) {
        ctx.say(`${color.error}假人 ${color.playerName}${t.record.name}${color.error} 不在线，无法传送`);
        return;
      }
      const l = ctx.player.location;
      const r = services.ops.teleportTo(t.botId, { x: l.x, y: l.y, z: l.z }, ctx.player.dimension.id, yaw, pitch);
      ctx.say(
        r.ok
          ? `${color.success}假人 ${color.playerName}${t.record.name}${color.success} 已传送到你身边`
          : `${color.error}传送失败: ${r.reason}`
      );
    },
  },
  {
    name: "mp:move",
    description: "让模拟玩家自动寻路到指定坐标（nearby=true 目标点附近停下也算到达）",
    usage: "mp:move <假人> [坐标] [nearby]",
    args: [
      { name: "name", type: Param.String },
      { name: "location", type: Param.Location, optional: true },
      { name: "nearby", type: Param.Boolean, optional: true },
    ],
    async execute(ctx, a) {
      const name = String(a.name ?? "").trim();
      if (!name) {
        ctx.say(`${color.error}用法: /mp:move <假人> [坐标] [nearby]`);
        return;
      }
      const t = ctx.bot(name);
      if (!t) return;
      const loc = ctx.coord(a.location, ctx.player.location);
      const nearby = a.nearby === true;
      // 异步等待寻路终态（监测在 engine），只发终态一行
      const outcome = await mover.navigate(t.botId, loc, { nearby });
      ctx.say(navigateMessage(t.record.name, loc, outcome, nearby));
    },
  },
];
