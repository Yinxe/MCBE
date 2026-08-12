// ─── 在线管理表单 ──────────────────────────────────────

import { Player, system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BOT_TAG, getTagDef } from "../../core/tags/BotTags";
import { formatPos } from "../format";
import { formatDimensionId } from "../../core/format/Format";
import { botRegistry } from "../bootstrap/context";
import { canManageBot } from "../commands/auth";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";

function getStatusIcon(death: boolean, online: boolean): string {
  if (death) return style("[死亡]", color.error);
  if (online) return style("[在线]", color.success);
  return style("[离线]", color.warn);
}

function getPosSummary(record: import("../../core/model/Types").BotRecord): string {
  if (record.lastPoint) {
    return `${formatPos(record.lastPoint.location)} ${color.gold}${formatDimensionId(record.lastPoint.dimension)}`;
  }
  if (record.death && record.deathPoint) {
    return `${formatPos(record.deathPoint.location)} ${color.gold}${formatDimensionId(record.deathPoint.dimension)}`;
  }
  return `${formatPos(record.respawnPoint.location)} ${color.gold}${formatDimensionId(record.respawnPoint.dimension)}`;
}

export function showOnlineManagement(player: Player): void {
  const records = botRegistry.all();
  if (records.length === 0) {
    player.sendMessage(`${color.warn}暂无模拟玩家`);
    return;
  }

  const initialState: boolean[] = records.map((r) => r.online);

  const builder = new ModalFormBuilder().title(`${color.bold}在线管理`);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const icon = getStatusIcon(record.death, record.online);
    const posSummary = getPosSummary(record);
    const tagSummary = record.tags
      .filter((t) => t !== BOT_TAG)
      .map((t) => { const d = getTagDef(t); return d ? d.label : t; })
      .join(" ");
    builder.toggle(`s${i}`, `${icon} ${color.playerName}${record.name} ${color.accent}| ${posSummary}${tagSummary ? ` ${color.accent}[${tagSummary}]` : ""}`, {
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

      // ── 管理权限：只有主人或管理员可以切换他人的假人上下线 ──
      if (!canManageBot(player, record)) {
        player.sendMessage(`${color.error}${record.name} 只允许主人或管理员操作，已跳过`);
        continue;
      }

      system.runTimeout(() => {
        try {
          if (newVal && !record.online) {
            onlineBot(record).catch((e: any) => {
              player.sendMessage(`${color.error}${record.name} 上线失败: ${e.message}`);
            });
          } else if (!newVal && record.online) {
            offlineBot(record);
          }
        } catch (e: any) {
          player.sendMessage(`${color.error}${record.name} 状态切换失败: ${e.message}`);
        }
      }, tickDelay);
      tickDelay += 20;
      changedCount++;
    }

    if (changedCount > 0) {
      player.sendMessage(`${color.success}正在更新 ${changedCount} 个模拟玩家的在线状态...`);
    }
  });
}
