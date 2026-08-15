// ─── 主菜单 ───────────────────────────────────────────
// 顶层菜单入口，bot 操作面板已移至 bot.ts

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder } from "@yinxe/toolkit";

import { BotRecord } from "../../model/Types";
import { BOT_TAG } from "../../tags/BotTags";
import { formatPos } from "../format";
import { formatDimensionId } from "../../format/Format";
import { botRegistry } from "../bootstrap/context";
import { showBotPanel, showBotList } from "./bot";
import { showCreateForm } from "./create";
import { showOnlineManagement } from "./online";
import { showHelpGuide } from "./HelpGuide";
import { showAdminMenu } from "./adminMenu";
import { isAdmin } from "../commands/auth";

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  const form = new ActionFormBuilder()
    .title(`${color.bold}模拟玩家管理`)
    .button(style("创建模拟玩家", color.darkGreen), () => showCreateForm(player))
    .button(style("模拟玩家列表", color.darkBlue), () => showBotList(player, () => showMainMenu(player)))
    .button(style("在线管理", color.darkBlue), () => showOnlineManagement(player))
    .button(style("帮助", color.darkBlue), () => showHelpGuide(player));

  // 管理员菜单（仅管理员可见：OP 或配置名单内玩家）
  if (isAdmin(player)) {
    form.button(style("⚙ 管理员菜单", color.gold), () => showAdminMenu(player));
  }

  form.show(player);
}
