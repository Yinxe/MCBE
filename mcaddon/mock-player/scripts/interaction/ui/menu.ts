// ─── 主菜单 ───────────────────────────────────────────
// 顶层菜单入口，bot 操作面板已移至 bot.ts

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { formatPos } from "./format";
import { formatDimensionId } from "../../rules/format/Format";
import { showBotPanel, showBotList } from "./bot";
import { showCreateForm } from "./panels/create";
import { showOnlineManagement } from "./panels/online";
import { showHelpGuide } from "./HelpGuide";
import { showAdminMenu, showGlobalConfig, showPlayerQuotaList, showAdminList } from "./panels/adminMenu";
import { isAdmin } from "../commands/auth";

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  const form = new ActionFormBuilder()
    .title(`${color.bold}模拟玩家管理`)
    .button(style("创建模拟玩家", color.darkGreen), () => showCreateForm(player))
    .button(style("模拟玩家列表", color.darkBlue), () => showBotList(player, () => showMainMenu(player)))
    .button(style("在线管理", color.darkBlue), () => showOnlineManagement(player))
    .button(style("帮助", color.darkBlue), () => showHelpGuide(player));

  // 管理员功能（仅管理员可见，直接放入主菜单）
  if (isAdmin(player)) {
    form.button(style("全部假人列表", color.gold), () => showBotList(player, () => showMainMenu(player)));
    form.button(style("全部在线管理", color.gold), () => showOnlineManagement(player));
    form.button(style("全局配置", color.gold), () => showGlobalConfig(player));
    form.button(style("玩家配额", color.gold), () => showPlayerQuotaList(player));
    form.button(style("管理员名单", color.gold), () => showAdminList(player));
  }

  form.show(player);
}
