// ─── 主菜单 + 信物/实体交互入口 ───
// 本文件是信物与长按假人两条触发路的唯一消费者；判定在桥后同步做、开表单必须 system.run。
// 三条入口（长按/点击是两次不同手势，互斥触发，故不需要"同拍抑制"）：
//   长按 / 使用信物（不蹲也行）→ 主菜单
//   蹲下 + 点击普通木头箱子    → 工作箱绑定面板（取消这次开箱）
//   点击假人                   → 站立开操作面板、蹲下开行为菜单
// 图标纹理路径为既定口径。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, style, trySendMessage } from "@yinxe/toolkit";
import { isAdmin } from "../../domain/Permissions";
import { isChestBindGesture, isTokenMenuGesture } from "../../domain/InteractionRules";
import { uiViewer } from "../Kit";
import { services } from "../../Composition";
import { entityGateway } from "../../engine/EntityGateway";
import { showBotList } from "./BotList";
import { showCreateForm } from "./Create";
import { showOnlineManagement } from "./Online";
import { showHelpGuide } from "./HelpGuide";
import { showNotifySettingsForm } from "./NotifySettings";
import { showAdminMenu } from "./Admin";
import { showBotPanel } from "./BotPanel";
import { showBehaviorPanel } from "./Behavior";
import { showWorkChestForm } from "./WorkChest";

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
    f.button(style("通知设置", color.darkBlue), () => showNotifySettingsForm(player));
    if (isAdmin(viewer, services.runtime.config)) {
      f.buttonWithIcon(style("⚙ 管理员菜单", color.gold), "textures/ui/mockplayer/admin_settings", () =>
        showAdminMenu(player)
      );
    }
  });
}

/**
 * 信物长按（使用物品）入口：手持信物即可开主菜单——长按本身是主动手势，不要求蹲下。
 * @param playerName - 使用物品的玩家名
 * @param itemTypeId - 本次使用的物品 id
 */
export function onTokenItemUse(playerName: string, itemTypeId: string): void {
  const token = services.runtime.config.tokenItem;
  const hit = isTokenMenuGesture({ tokenEnabled: token.enabled, tokenTypeId: token.typeId, heldTypeId: itemTypeId });
  if (!hit) return;
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

/**
 * 蹲下 + 手持信物 + 点击普通木头箱子 → 工作箱绑定面板（桥后同步判定，返回 true=取消这次方块交互防开箱 GUI）。
 * 长按重复事件一并取消但面板只首发开一次；开表单经 system.run（F-11）。
 * @param info - 桥上报的点击事实（整数格 + 本次交互实际手持物品 + 潜行态）
 * @returns true=已消费这次点击（调用方取消方块交互）
 */
export function onRealPlayerBlockClick(info: {
  playerName: string;
  dimId: string;
  x: number;
  y: number;
  z: number;
  blockTypeId: string;
  heldTypeId: string;
  sneaking: boolean;
  firstPress: boolean;
}): boolean {
  const token = services.runtime.config.tokenItem;
  const hit = isChestBindGesture({
    tokenEnabled: token.enabled,
    tokenTypeId: token.typeId,
    heldTypeId: info.heldTypeId,
    sneaking: info.sneaking,
    blockTypeId: info.blockTypeId,
  });
  if (!hit) return false;
  if (info.firstPress) {
    system.run(() => {
      const player = entityGateway.findRealPlayer(info.playerName);
      if (player) showWorkChestForm(player, { dimId: info.dimId, x: info.x, y: info.y, z: info.z });
    });
  }
  return true;
}
