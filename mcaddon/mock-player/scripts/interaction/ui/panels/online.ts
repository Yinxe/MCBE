// ─── 在线管理表单 ──────────────────────────────────────

import { Player, system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BOT_TAG, getTagDef } from "../../../rules/tags/BotTags";
import { formatPos } from "../format";
import { formatDimensionId } from "../../../rules/format/Format";
import { botRegistry } from "../../../bootstrap/context";
import { canManageBot, autoClaim, isAdmin } from "../../commands/auth";
import { visibleRecords } from "../../../service/BotVisibility";
import { ownerLabel } from "../ownerLabel";
import { safeOnline } from "../../../features/manage/onlineBot";
import { safeOffline } from "../../../features/manage/offlineBot";

function getWorkModeLabel(mode: string): string {
  const map: Record<string, string> = {
    none: "空闲", wander: "闲逛", mine: "挖掘", place: "放置",
    attack: "攻击", raid: "劫掠", fishing: "钓鱼", follow: "跟随",
  };
  return map[mode] ?? mode;
}

function getStatusIcon(death: boolean, online: boolean, workMode?: string): string {
  if (death) return style("[死亡]", color.error);
  if (!online) return style("[离线]", color.warn);
  const label = getWorkModeLabel(workMode ?? "none");
  return style(`[${label}]`, workMode === "none" || !workMode ? color.warn : color.success);
}

function getPosSummary(record: import("../../../rules/Types").BotRecord): string {
  if (record.lastPoint) {
    return `${formatPos(record.lastPoint.location)} ${color.gold}${formatDimensionId(record.lastPoint.dimension)}`;
  }
  if (record.death && record.deathPoint) {
    return `${formatPos(record.deathPoint.location)} ${color.gold}${formatDimensionId(record.deathPoint.dimension)}`;
  }
  return `${formatPos(record.respawnPoint.location)} ${color.gold}${formatDimensionId(record.respawnPoint.dimension)}`;
}

export function showOnlineManagement(player: Player): void {
  // 可见性过滤：管理员看全部；普通玩家看自己的 + 无主的（无主可认领）
  // 排序：在线置顶，其次按假人名
  const records = [...visibleRecords(botRegistry.all(), player.name, isAdmin(player))].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  if (records.length === 0) {
    player.sendMessage(`${color.warn}暂无可见的模拟玩家`);
    return;
  }

  const initialState: boolean[] = records.map((r) => r.online);

  const builder = new ModalFormBuilder().title(`${color.bold}在线管理`);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const icon = getStatusIcon(record.death, record.online, record.workMode);
    const posSummary = getPosSummary(record);
    const tagSummary = record.tags
      .filter((t) => t !== BOT_TAG)
      .map((t) => { const d = getTagDef(t); return d ? d.label : t; })
      .join(" ");
    // 主人/无主标签：管理员在线管理需归属信息；普通玩家看无主假人的 [无主] tag
    const owner = ownerLabel(record, isAdmin(player));
    builder.toggle(
      `s${i}`,
      `${icon} ${color.playerName}${record.name}${owner ? ` ${owner}` : ""} ${color.accent}| ${posSummary}${tagSummary ? ` ${color.accent}[${tagSummary}]` : ""}`,
      {
        defaultValue: record.online,
        tooltip: record.online ? "关闭此开关将下线该假人" : "开启此开关将上线该假人",
      },
    );
  }

  builder.show(player).then((vals) => {
    if (!vals) return;
    const pending: Array<{ record: any; newVal: boolean }> = [];
    let changedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const newVal = vals[`s${i}`] as boolean;
      if (newVal === initialState[i]) continue;
      const record = botRegistry.get(records[i].name);
      if (!record) continue;

      // ── 管理权限：只有主人或管理员可以切换他人的假人上下线 ──
      // 无主假人（旧版升级数据）：首次操作上下线 → 自动认领成为主人（静默标记）
      if (!canManageBot(player, record)) {
        if (autoClaim(player, record)) {
          player.sendMessage(`${color.success}已自动认领假人 ${color.playerName}${record.name}`);
        } else {
          player.sendMessage(`${color.error}${record.name} 只允许主人或管理员操作，已跳过`);
          continue;
        }
      }
      pending.push({ record, newVal });
      changedCount++;
    }

    if (changedCount > 0) {
      player.sendMessage(`${color.success}正在更新 ${changedCount} 个模拟玩家的在线状态（安全上下线已内置排队与等待，无需外部冷却）...`);
      // 安全上下线已内置3秒/2秒等待与排队，批量时顺序 await 即可，无需 tickDelay
      system.run(async () => {
        for (const { record, newVal } of pending) {
          try {
            if (newVal && !record.online) {
              const result = await safeOnline(record);
              if (!result.ok) player.sendMessage(`${color.error}${record.name} 上线失败: ${result.reason ?? "unknown"}`);
              else player.sendMessage(`${color.success}${record.name} 已上线`);
            } else if (!newVal && record.online) {
              const result = await safeOffline(record);
              if (!result.ok) player.sendMessage(`${color.error}${record.name} 下线失败: ${result.reason ?? "unknown"}`);
              else player.sendMessage(`${color.success}${record.name} 已下线`);
            }
          } catch (e: any) {
            player.sendMessage(`${color.error}${record.name} 状态切换失败: ${e.message}`);
          }
        }
      });
    }
  });
}
