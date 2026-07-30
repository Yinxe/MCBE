// ─── 主菜单 ───────────────────────────────────────────
// 顶层菜单入口，bot 操作面板已移至 bot.ts

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder } from "@yinxe/toolkit";

import { BotRecord } from "../features/core/types";
import { BOT_TAG } from "../features/core/tags";
import { formatPos, formatDimensionId } from "../features/core/utils";
import { botRegistry } from "../features/core/persistence";
import { showBotPanel, showBotList } from "./bot";
import { showCreateForm } from "./create";
import { showOnlineManagement } from "./online";
import { showHelpGuide } from "./HelpGuide";

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  new ActionFormBuilder()
    .title(`${color.bold}模拟玩家管理`)
    .button(style("创建模拟玩家", color.darkGreen), () => showCreateForm(player))
    .button(style("模拟玩家列表", color.darkBlue), () => showBotList(player, () => showMainMenu(player)))
    .button(style("在线管理", color.darkBlue), () => showOnlineManagement(player))
    .button(style("帮助", color.darkBlue), () => showHelpGuide(player))
    .show(player);
}
