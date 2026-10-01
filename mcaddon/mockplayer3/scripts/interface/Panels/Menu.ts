// ─── 主菜单 + 信物/实体交互入口 ───
// 本文件是信物与长按假人两条触发路的唯一消费者；判定在桥后同步做、开表单必须 system.run。
// 图标纹理路径为既定口径。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, style, trySendMessage } from "@yinxe/toolkit";
import { isAdmin } from "../../domain/Permissions";
import { uiViewer } from "../Kit";
import { services } from "../../Composition";
import { entityGateway } from "../../engine/EntityGateway";
import { showBotList } from "./BotList";
import { showCreateForm } from "./Create";
import { showOnlineManagement } from "./Online";
import { showHelpGuide } from "./HelpGuide";
import { showAdminMenu } from "./Admin";
import { showBotPanel } from "./BotPanel";
import { showBehaviorPanel } from "./Behavior";

/** 主菜单面板：创建/列表/在线管理/帮助/管理员入口 */
export function showMainMenu(player: Player): void {
  const viewer = uiViewer(player);
  void ActionFormBuilder.showQuick(player, `${color.bold}模拟玩家管理`, (f) => {
    f.buttonWithIcon(style("创建模拟玩家", color.darkGreen), "textures/ui/mockplayer/create_bot", () =>
      showCreateForm(player)
    );
    f.buttonWithIcon(style("模拟玩家列表", color.darkBlue), "textures/ui/mockplayer/bot_list", () =>
      showBotList(player, () => showMainMenu(player))
    );
    f.buttonWithIcon(style("在线管理", color.darkBlue), "textures/ui/mockplayer/online_management", () =>
      showOnlineManagement(player)
    );
    f.buttonWithIcon(style("帮助", color.darkBlue), "textures/ui/mockplayer/help", () => showHelpGuide(player));
    if (isAdmin(viewer, services.runtime.config)) {
      f.buttonWithIcon(style("⚙ 管理员菜单", color.gold), "textures/ui/mockplayer/admin_settings", () =>
        showAdminMenu(player)
      );
    }
  });
}

/** 信物右键入口：真人限定在桥内，此处只判配置匹配 */
export function onTokenItemUse(playerName: string, itemTypeId: string): void {
  const token = services.runtime.config.tokenItem;
  if (!token.enabled || itemTypeId !== token.typeId) return;
  system.run(() => {
    const player = entityGateway.findRealPlayer(playerName);
    if (player) showMainMenu(player);
  });
}

/** 长按假人入口：站立开操作面板、潜行开行为菜单（system.run 内重读潜行态） */
export function onBotInteract(viewerName: string, botName: string): void {
  system.run(() => {
    const player = entityGateway.findRealPlayer(viewerName);
    if (!player) return;
    // 存在性预判仅提前报错；面板入口自带解析与管理守卫
    const botId = services.runtime.findBotIdByName(botName);
    if (botId === undefined || !services.runtime.record(botId)) {
      trySendMessage(player, `${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已不存在`);
      return;
    }
    if (player.isSneaking) showBehaviorPanel(player, botName);
    else showBotPanel(player, botName);
  });
}
