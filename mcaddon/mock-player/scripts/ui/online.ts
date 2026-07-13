// ─── 在线管理表单 ──────────────────────────────────────

import { Player, system } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit/ui";

import { BOT_TAG, getTagDef } from "../features/core/tags";
import { formatPos, formatDimensionId } from "../features/core/utils";
import { botRegistry } from "../features/core/persistence";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";

function getStatusIcon(death: boolean, online: boolean): string {
  if (death) return "§4[死亡]";
  if (online) return "§a[在线]";
  return "§7[离线]";
}

function getPosSummary(record: import("../features/core/types").BotRecord): string {
  if (record.lastPoint) {
    return `${formatPos(record.lastPoint.location)} §8${formatDimensionId(record.lastPoint.dimension)}`;
  }
  if (record.death && record.deathPoint) {
    return `${formatPos(record.deathPoint.location)} §8${formatDimensionId(record.deathPoint.dimension)}`;
  }
  return `${formatPos(record.respawnPoint.location)} §8${formatDimensionId(record.respawnPoint.dimension)}`;
}

export function showOnlineManagement(player: Player): void {
  const records = Array.from(botRegistry.values());
  if (records.length === 0) {
    player.sendMessage("§e暂无模拟玩家");
    return;
  }

  const initialState: boolean[] = records.map((r) => r.online);

  const builder = new ModalFormBuilder().title("§l在线管理");

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const icon = getStatusIcon(record.death, record.online);
    const posSummary = getPosSummary(record);
    const tagSummary = record.tags
      .filter((t) => t !== BOT_TAG)
      .map((t) => { const d = getTagDef(t); return d ? d.label : t; })
      .join(" ");
    builder.toggle(`s${i}`, `${icon} §e${record.name} §7| ${posSummary}${tagSummary ? ` §7[${tagSummary}]` : ""}`, {
      defaultValue: record.online,
      tooltip: record.online ? "关闭此开关将下线该假人" : "开启此开关将上线该假人",
    });
  }

  builder.show(player).then((vals) => {
    if (!vals) return;
    let tickDelay = 0;
    let changedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const newVal = vals[`s${i}`] as boolean;
      if (newVal === initialState[i]) continue;
      const record = botRegistry.get(records[i].name);
      if (!record) continue;

      system.runTimeout(() => {
        try {
          if (newVal && !record.online) onlineBot(record);
          else if (!newVal && record.online) offlineBot(record);
        } catch (e: any) {
          player.sendMessage(`§c${record.name} 状态切换失败: ${e.message}`);
        }
      }, tickDelay);
      tickDelay += 4;
      changedCount++;
    }

    if (changedCount > 0) {
      player.sendMessage(`§a正在更新 ${changedCount} 个模拟玩家的在线状态...`);
    }
  });
}
