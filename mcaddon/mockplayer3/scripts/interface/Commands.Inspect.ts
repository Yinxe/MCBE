// ─── 查询命令组 ────────────────────────────────────────────────────
// 只读命令不写档：在线假人行显示 mover 实时坐标，离线显示家点。

import { color } from "@yinxe/toolkit";
import { canView } from "../domain/Permissions";
import { modeSpec } from "../domain/Catalog";
import { stateFlags } from "../domain/State";
import { mover } from "../engine/Mover";
import { services } from "../Composition";
import type { CommandSpec } from "./CmdKit";
import { Param } from "./CmdKit";

export const INSPECT_COMMANDS: CommandSpec[] = [
  {
    name: "mp:listbots",
    description: "列出所有可见假人（可按在线/死亡筛选）",
    usage: "mp:listbots [online] [death]",
    args: [
      { name: "online", type: Param.Boolean, optional: true },
      { name: "death", type: Param.Boolean, optional: true },
    ],
    execute(ctx, a) {
      const records = [...services.runtime.records.values()].filter((r) =>
        canView(ctx.viewer, r, services.runtime.config)
      );
      let filtered = records;
      if (a.online === true) {
        filtered = filtered.filter((r) => {
          const st = services.runtime.stateOf(r.botId);
          return st !== null && stateFlags(st).online;
        });
      }
      if (a.death === true) {
        filtered = filtered.filter((r) => {
          const st = services.runtime.stateOf(r.botId);
          return (st !== null && stateFlags(st).death) || r.deathMark;
        });
      }
      if (filtered.length === 0) {
        ctx.say(`${color.playerName}没有匹配的假人`);
        return;
      }
      const lines: string[] = [
        `${color.success}假人列表 (${color.accent}${filtered.length}${color.success}/${records.length}${color.success}):`,
      ];
      for (const r of filtered) {
        const st = services.runtime.stateOf(r.botId);
        const online = st !== null && stateFlags(st).online;
        const dead = (st !== null && stateFlags(st).death) || r.deathMark;
        const icon = dead ? `${color.error}💀` : online ? `${color.success}✔` : `${color.muted}❌`;
        const txt = dead
          ? `${color.error}死亡`
          : online
            ? `${color.success}${modeSpec(r.workMode).label}`
            : `${color.muted}离线`;
        const live = online ? mover.locationOf(r.botId) : null;
        const p = live ?? r.home.position;
        const pos = `${color.playerName}${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)} ${color.darkGray}${r.dimensionId}${live ? "" : ` ${color.muted}(家点)`}`;
        const owner = ctx.admin
          ? r.ownerKey
            ? `${color.accent}主人:${color.playerName}${r.ownerKey}`
            : `${color.muted}[${color.warn}无主${color.muted}]`
          : r.ownerKey === null
            ? `${color.muted}[${color.warn}无主${color.muted}]`
            : "";
        lines.push(
          `${icon} ${color.playerName}${r.name}${owner ? ` ${owner}` : ""}${color.muted} — ${txt}${color.muted} | ${pos}`
        );
      }
      ctx.say(lines.join("\n"));
    },
  },
];
