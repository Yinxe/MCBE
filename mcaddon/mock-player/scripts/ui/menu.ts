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
import { showTagLookup } from "./tags";

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  new ActionFormBuilder()
    .title("§l模拟玩家管理")
    .button("§a创建模拟玩家", () => showCreateForm(player))
    .button("§b模拟玩家列表", () => showBotList(player, () => showMainMenu(player)))
    .button("§6在线管理", () => showOnlineManagement(player))
    .button("§d标签速查", () => showTagLookup(player))
    .show(player);
}
