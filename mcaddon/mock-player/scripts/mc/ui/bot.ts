// ─── 统一假人操作面板（v3） ──────────────────────────
//
// ⚠️ UI 事件驱动：按钮点击只发布 panelAction 领域事件（负载 操作者/假人/动作），
//    各功能模块独立订阅执行——本文件不 import 任何业务动作函数。
//    「返回列表」是 UI 内部导航，保持内联回调（不事件化）。

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder } from "@yinxe/toolkit";

import { BotRecord } from "../../model/Types";
import { BOT_TAG, getTagDef } from "../../tags/BotTags";
import { BotUiEvent, type BotPanelAction } from "../../events/UiEvents";
import { formatPos } from "../format";
import { formatDimensionId } from "../../format/Format";
import { botRegistry } from "../bootstrap/context";
import { canManageBot, autoClaim, isAdmin } from "../commands/auth";
import { resolveUiBotRecord } from "./helpers";
import { visibleRecords } from "../../service/BotVisibility";
import { ownerLabel } from "./ownerLabel";

// ─── 工具 ──────────────────────────────────────────────

function getStatusIcon(record: BotRecord): string {
  if (record.death) return style("[死亡]", color.error);
  if (record.online) return style("[在线]", color.success);
  return style("[离线]", color.warn);
}

function getPosSummary(record: BotRecord): string {
  if (record.lastPoint) {
    return `${formatPos(record.lastPoint.location)} ${color.gold}${formatDimensionId(record.lastPoint.dimension)}`;
  }
  if (record.death && record.deathPoint) {
    return `${formatPos(record.deathPoint.location)} ${color.gold}${formatDimensionId(record.deathPoint.dimension)} ${style("(死亡点)", color.gold)}`;
  }
  return `${formatPos(record.respawnPoint.location)} ${color.gold}${formatDimensionId(record.respawnPoint.dimension)} ${style("(重生点)", color.gold)}`;
}

// ─── 统一假人操作面板（v3，showBotPanel 主菜单） ──────

export function showBotPanel(player: Player, botName: string, onBack?: () => void): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;

  // ── 管理权限：只有主人或管理员可以操作假人 ──
  if (!canManageBot(player, record)) {
    // 无主假人（旧版升级数据）→ 自动认领：首次打开菜单即成为主人（静默添加主人）
    if (autoClaim(player, record)) {
      player.sendMessage(`${color.success}已自动认领假人 ${color.playerName}${botName}${color.success}（旧版数据，首次操作生效）`);
    } else {
      player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 只允许主人或管理员操作`);
      return;
    }
  }

  const ownerStr = record.ownerName ? `\n${color.accent}主人: ${color.playerName}${record.ownerName}` : `\n${color.muted}无主（仅管理员可管理）`;
  const tagLabels = record.tags.filter(t => t !== BOT_TAG).map(t => { const d = getTagDef(t); return d ? d.label : t; });
  const tagStr = tagLabels.length > 0 ? `\n${color.accent}标签: ${color.playerName}${tagLabels.join(`${color.accent} | ${color.playerName}`)}` : "";
  const expStr = record.experience ? `\n${color.accent}经验: ${color.playerName}Lv.${record.experience.level} ${color.accent}(${record.experience.totalXp} XP)` : "";

  // 发布 panelAction 领域事件（订阅方：各功能模块按 action 过滤执行）
  const trigger = (action: BotPanelAction): void => {
    BotUiEvent.panelAction.trigger({ playerId: player.id, botName, action });
  };

  new ActionFormBuilder()
    .title(`${color.bold}${botName} ${getStatusIcon(record)}`)
    .body(`${getPosSummary(record)}${ownerStr}${tagStr}${expStr}`)
    // ── 上线/下线（置顶） ──
    .button(record.online ? style("设为离线", color.darkGreen) : style("设为在线", color.darkGreen), () => trigger("toggleOnline"))
    // ── 传送 ──
    .button(style("传送过去", color.darkBlue), () => trigger("tpToBot"))
    // ── 同步/操作 ──
    .button(style("同步姿态", color.darkBlue), () => trigger("syncPose"))
    .button(style("选择主手", color.darkBlue), () => trigger("selectMainhand"))
    // ── 互换/回收 ──
    .button(style("物品互换", color.darkBlue), () => trigger("swap"))
    .button(style("回收资源", color.darkBlue), () => trigger("reclaim"))
    // ── 标签/设置 ──
    .button(style("行为标签", color.darkGreen), () => trigger("openBehavior"))
    .button(style("设置重生", color.darkBlue), () => trigger("updateSpawn"))
    .button(style("修改名字", color.darkBlue), () => trigger("rename"))
    // ── 战斗/工具 ──
    .button(style("投三叉戟", color.darkBlue), () => trigger("throwTrident"))
    .button(style("投掷物认主", color.darkBlue), () => trigger("claimTrident"))
    .button(style("查看数据", color.darkBlue), () => trigger("viewData"))
    // ── 危险 ──
    .button(style("击杀假人", color.darkRed), () => trigger("kill"))
    .buttonWithIcon(style("删除假人", color.darkRed), "textures/ui/icon_trash", () => trigger("delete"))
    // ── UI 内部导航（不事件化） ──
    .button(style("返回列表", color.darkBlue), () => { if (onBack) onBack(); })
    .show(player);
}

// ─── 假人列表 ──────────────────────────────────────────

/**
 * 展示模拟玩家列表（可见性过滤：管理员看全部；普通玩家看自己的 + 无主的）
 * @param onMainMenu 点击「返回」时调用的回调（来自 menu.ts 的 showMainMenu）
 */
export function showBotList(player: Player, onMainMenu?: () => void): void {
  const records = visibleRecords(botRegistry.all(), player.name, isAdmin(player));
  if (records.length === 0) {
    player.sendMessage(`${color.warn}暂无可见的模拟玩家，请先创建`);
    return;
  }

  const sorted = [...records].sort((a, b) => {
    const orderA = a.death ? 1 : a.online ? 2 : 0;
    const orderB = b.death ? 1 : b.online ? 2 : 0;
    return orderA - orderB;
  });

  const builder = new ActionFormBuilder()
    .title(`${color.bold}模拟玩家列表`)
    .body(`${color.accent}共 ${color.playerName}${records.length} ${color.accent}个`);

  for (const record of sorted) {
    const dim = record.lastPoint
      ? formatDimensionId(record.lastPoint.dimension)
      : record.deathPoint
        ? formatDimensionId(record.deathPoint.dimension)
        : formatDimensionId(record.respawnPoint.dimension);
    // 主人/无主标签：管理员看全览需归属信息；普通玩家看无主假人的 [无主] tag
    const owner = ownerLabel(record, isAdmin(player));
    builder.button(
      `${getStatusIcon(record)} ${color.black}${record.name} ${color.black}${dim}${owner ? ` ${owner}` : ""}`,
      () => showBotPanel(player, record.name, () => showBotList(player, onMainMenu)),
    );
  }

  builder.button(style("← 返回", color.darkBlue), () => { if (onMainMenu) onMainMenu(); }).show(player);
}
