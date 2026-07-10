// ─── /mp:list — 列出模拟玩家 ──────────────────────────

import { defineCommand } from "@yinxe/toolkit/command";
import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { BotRecord, PositionState } from "../features/core/types";
import { BOT_TAG, TAG_IDLE, getTagDef } from "../features/core/tags";
import { formatPos, formatDimensionId } from "../features/core/utils";
import { botRegistry } from "../features/core/persistence";

/** 格式化点位状态（仅列表显示用） */
function formatState(state: PositionState): string {
  return `${formatPos(state.location)} §8${formatDimensionId(state.dimension)} §7旋转(${Math.floor(state.rotation.x)},${Math.floor(state.rotation.y)})`;
}

/** 构建列表消息 */
function buildListMessage(records: BotRecord[], filterOnline?: boolean, filterDeath?: boolean): string {
  let filtered = records;
  if (filterOnline !== undefined) filtered = filtered.filter((r) => r.online === filterOnline);
  if (filterDeath !== undefined) filtered = filtered.filter((r) => r.death === filterDeath);
  if (filtered.length === 0) return "§e没有匹配的假人";

  const lines = filtered.map((r) => {
    const icon = r.death ? "§c💀" : r.online ? "§a✔" : "§7❌";
    const txt = r.death ? "§c死亡" : r.online ? "§a在线" : "§7离线";
    const pos =
      r.death && r.deathPoint
        ? `${formatPos(r.deathPoint.location)} §8${formatDimensionId(r.deathPoint.dimension)} §7(死亡点)`
        : r.lastPoint
          ? formatState(r.lastPoint)
          : formatState(r.respawnPoint) + " §7(重生点)";
    const displayTags = r.tags
      .filter((t) => t !== BOT_TAG && t !== TAG_IDLE.value)
      .map((t) => {
        const def = getTagDef(t);
        return def ? `§b${def.label}§7` : t;
      });
    const tagHint = displayTags.length > 0 ? ` §7[${displayTags.join(" §7| ")}]` : "";
    return `${icon} §e${r.name}§7 — ${txt}§7 | ${pos}${tagHint}`;
  });

  lines.unshift(`§a假人列表 (§b${filtered.length}§a/${records.length}§a):`);
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
        record.lastPoint.location = bot.location;
        record.lastPoint.dimension = bot.dimension.id;
        record.lastPoint.rotation = bot.getRotation();
      }
    }
    player.sendMessage(buildListMessage(Array.from(botRegistry.values()), filterOnline, filterDeath));
  });
}
