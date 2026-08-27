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
import { showAdminMenu } from "./panels/adminMenu";
import { isAdmin } from "../commands/auth";

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  const form = new ActionFormBuilder()
    .title(`${color.bold}模拟玩家管理`)
    .buttonWithIcon(style("创建模拟玩家", color.darkGreen), "textures/ui/mockplayer/create_bot", () => showCreateForm(player))
    .buttonWithIcon(style("模拟玩家列表", color.darkBlue), "textures/ui/mockplayer/bot_list", () => showBotList(player, () => showMainMenu(player)))
    .buttonWithIcon(style("在线管理", color.darkBlue), "textures/ui/mockplayer/online_management", () => showOnlineManagement(player))
    .buttonWithIcon(style("帮助", color.darkBlue), "textures/ui/mockplayer/help", () => showHelpGuide(player));

  // 管理员菜单（仅管理员可见）
  if (isAdmin(player)) {
    form.buttonWithIcon(style("⚙ 管理员菜单", color.gold), "textures/ui/mockplayer/admin_settings", () => showAdminMenu(player));
  }

  form.show(player);
}
