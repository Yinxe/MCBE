// ─── 在线管理表单 ──────────────────────────────────────

import { Player, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

import { BOT_TAG } from "../features/types";
import { getTagDef } from "../features/tags";
import { formatPos, formatDimensionId } from "../features/utils";
import { botRegistry } from "../features/persistence";
import { onlineBot, offlineBot } from "../features/operations";

/** 获取状态图标 */
function getStatusIcon(death: boolean, online: boolean): string {
  if (death) return "§c💀";
  if (online) return "§a✔";
  return "§7❌";
}

/** 获取位置摘要 */
function getPosSummary(record: import("../features/types").BotRecord): string {
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

  const form = new ModalFormData().title("§l在线管理");

  for (const record of records) {
    const icon = getStatusIcon(record.death, record.online);
    const posSummary = getPosSummary(record);
    const tagSummary = record.tags
      .filter((t) => t !== BOT_TAG)
      .map((t) => {
        const def = getTagDef(t);
        return def ? def.label : t;
      })
      .join(" ");
    const label = `${icon} §e${record.name} §7| ${posSummary}${tagSummary ? ` §7[${tagSummary}]` : ""}`;
    form.toggle(label, { defaultValue: record.online });
  }

  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return;

    const formValues = response.formValues as boolean[];

    for (let i = 0; i < records.length; i++) {
      if (formValues[i] === initialState[i]) continue;
      const record = botRegistry.get(records[i].name);
      if (!record) continue;

      system.run(() => {
        try {
          if (formValues[i] && !record.online) {
            onlineBot(record);
          } else if (!formValues[i] && record.online) {
            offlineBot(record);
          }
        } catch (e: any) {
          player.sendMessage(`§c${record.name} 状态切换失败: ${e.message}`);
        }
      });
    }

    player.sendMessage("§a在线状态已更新");
  });
}
