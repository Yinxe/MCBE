// ─── /mp:list — 列出模拟玩家 ──────────────────────────

import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { BotRecord, PositionState } from "../rules/Types";
import { BOT_TAG, TAG_IDLE, getTagDef } from "../rules/tags/BotTags";
import { formatPos } from "../ui/format";
import { formatDimensionId } from "../rules/format/Format";
import { botRegistry } from "../bootstrap/context";
import { savePoseToRecord } from "../features/basic/PoseGateway";
import { isAdmin } from "./auth";
import { ownerLabel } from "../ui/ownerLabel";

/** 格式化点位状态（仅列表显示用） */
function formatState(state: PositionState): string {
  return `${formatPos(state.location)} ${color.darkGray}${formatDimensionId(state.dimension)} ${color.muted}旋转(${Math.floor(state.rotation.x)},${Math.floor(state.rotation.y)})`;
}

/** 构建列表消息 */
function buildListMessage(records: BotRecord[], isAdminPlayer: boolean, filterOnline?: boolean, filterDeath?: boolean): string {
  let filtered = records;
  if (filterOnline !== undefined) filtered = filtered.filter((r) => r.online === filterOnline);
  if (filterDeath !== undefined) filtered = filtered.filter((r) => r.death === filterDeath);
  if (filtered.length === 0) return `${color.playerName}没有匹配的假人`;

  const lines = filtered.map((r) => {
    const icon = r.death ? `${color.error}💀` : r.online ? `${color.success}✔` : `${color.muted}❌`;
    const txt = r.death ? `${color.error}死亡` : r.online ? `${color.success}在线` : `${color.muted}离线`;
    const pos =
      r.death && r.deathPoint
        ? `${formatPos(r.deathPoint.location)} ${color.darkGray}${formatDimensionId(r.deathPoint.dimension)} ${color.muted}(死亡点)`
        : r.lastPoint
          ? formatState(r.lastPoint)
          : formatState(r.respawnPoint) + ` ${color.muted}(重生点)`;
    const displayTags = r.tags
      .filter((t) => t !== BOT_TAG && t !== TAG_IDLE.value)
      .map((t) => {
        const def = getTagDef(t);
        return def ? `${color.accent}${def.label}${color.muted}` : t;
      });
    const tagHint = displayTags.length > 0 ? ` ${color.muted}[${displayTags.join(` ${color.muted}| `)}]` : "";
    // 主人/无主标签（管理员全览需归属信息）
    const owner = ownerLabel(r, isAdminPlayer);
    return `${icon} ${color.playerName}${r.name}${owner ? ` ${owner}` : ""}${color.muted} — ${txt}${color.muted} | ${pos}${tagHint}`;
  });

  lines.unshift(`${color.success}假人列表 (${color.accent}${filtered.length}${color.success}/${records.length}${color.success}):`);
  return lines.join("\n");
}

export function registerListCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:list",
    description: "列出所有已创建的假人（可按在线/死亡筛选）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "online", type: CustomCommandParamType.Boolean },
      { name: "death", type: CustomCommandParamType.Boolean },
    ],
  }, ({ player, params }) => {
    const filterOnline = params.online as boolean | undefined;
    const filterDeath = params.death as boolean | undefined;

    // 刷新在线假人的最新位置
    for (const bot of world.getPlayers({ tags: [BOT_TAG] })) {
      const record = botRegistry.get(bot.name);
      if (record && record.lastPoint) {
        savePoseToRecord(record, bot.location, bot.dimension.id, bot.getRotation());
      }
    }
    player.sendMessage(buildListMessage(botRegistry.all(), isAdmin(player), filterOnline, filterDeath));
  });
}
