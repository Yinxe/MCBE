// ─── 主菜单 ───────────────────────────────────────────
// 顶层菜单入口，bot 操作面板已移至 bot.ts

import { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit/ui";

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
    .title("§l模拟玩家管理")
    .buttonWithIcon("§a创建模拟玩家", "textures/ui/icon_plus", () => showCreateForm(player))
    .buttonWithIcon("§7模拟玩家列表", "textures/ui/icon_menu", () => showBotList(player, () => showMainMenu(player)))
    .buttonWithIcon("§7在线管理", "textures/ui/icon_refresh", () => showOnlineManagement(player))
    .buttonWithIcon("§7帮助", "textures/ui/icon_info", () => showHelpGuide(player))
    .show(player);
}
