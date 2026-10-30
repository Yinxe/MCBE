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
import { showScriptPanel, showScriptPicker } from "./Script";
import { showBotPanel } from "./BotPanel";
import { showBehaviorPanel } from "./Behavior";
import { showWorkChestForm } from "./WorkChest";

/**
 * 手势去重窗口（tick）：同一次点击在引擎里可能**同时**上报「实体交互」与「使用物品」两个事件，
 * 两个都处理就会开两个表单（典型症状：羽毛点假人时长流程面板被"选人列表"盖住、
 * 木棍点假人时假人面板被主菜单盖住）。规则：
 *   · 实体手势（点假人）**立即认领**，优先级最高；
 *   · 物品手势（长按使用）**延后 2 tick** 再执行，执行前复核，若已被实体手势认领就让路。
 */
const GESTURE_DEDUPE_TICKS = 3;
/** 玩家名 → 上次认领手势的 tick */
const gestureClaimedAt = new Map<string, number>();
/**
 * 认领一次手势（立即登记）。
 * @param playerName - 操作者名
 * @param now - 当前 tick
 * @returns false = 窗口内已被认领（调用方应放弃本次处理）
 */
function claimGesture(playerName: string, now: number): boolean {
  const last = gestureClaimedAt.get(playerName);
  if (last !== undefined && now - last <= GESTURE_DEDUPE_TICKS) return false;
  gestureClaimedAt.set(playerName, now);
  return true;
}
/**
 * 是否已被别人认领（只查不登记）：供延后执行的手势复核。
 * @param playerName - 操作者名
 * @param since - 本次手势起始 tick（之后被认领才算被抢）
 */
function gestureTakenSince(playerName: string, since: number): boolean {
  const last = gestureClaimedAt.get(playerName);
  return last !== undefined && last > since;
}

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
    f.buttonWithIcon(style("长流程模式", color.darkGreen), "textures/ui/mockplayer/inventory", () =>
      showScriptPicker(player)
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
 * 使用物品（长按 / 右键）入口，两件物品各管一摊：
 *   · 长流程专用物品（默认羽毛）→ 开「长流程 · 选假人」列表；
 *   · 菜单信物（默认木棍）→ 开主菜单。
 * 长按本身是主动手势，不要求蹲下。
 * @param playerName - 使用物品的玩家名
 * @param itemTypeId - 本次使用的物品 id
 */
export function onTokenItemUse(playerName: string, itemTypeId: string): void {
  const cfg = services.runtime.config;
  const isFlow = cfg.flowItem.enabled && itemTypeId !== "" && itemTypeId === cfg.flowItem.typeId;
  const hit = isTokenMenuGesture({
    tokenEnabled: cfg.tokenItem.enabled,
    tokenTypeId: cfg.tokenItem.typeId,
    heldTypeId: itemTypeId,
  });
  if (!isFlow && !hit) return;
  // ⚠️ 延后 2 tick 再执行：同一次点击若落在假人或箱子上，引擎还会上报「实体交互」/
  // 「方块交互」，那两条路优先级更高、会先认领手势；这里复核到已被抢就直接让路。
  // 否则就会出现"先弹总菜单、关掉才看到箱子面板"这种叠两个页面的现象。
  const startedAt = system.currentTick;
  system.runTimeout(() => {
    if (gestureTakenSince(playerName, startedAt)) return;
    if (!claimGesture(playerName, system.currentTick)) return;
    const player = entityGateway.findRealPlayer(playerName);
    if (!player) return;
    if (isFlow) showScriptPicker(player);
    else showMainMenu(player);
  }, 2);
}

/** 长按假人入口：手持长流程物品（默认羽毛）→ 直接开长流程面板；否则站立开操作面板、潜行开行为菜单 */
export function onBotInteract(viewerName: string, botName: string, heldTypeId = ""): void {
  // ⚠️ 手持物必须在 system.run 里重读：桥上是在 beforeEvents 回调（受限执行模式）里
  // 尝试读背包组件的，那次读取会抛错并被降级成空串，症状就是"拿羽毛点假人却开了假人面板"。
  // 这里也不再同步认领手势——等下面的 run 里读到手持物、分清是哪种手势后再认领。
  system.run(() => {
    const player = entityGateway.findRealPlayer(viewerName);
    if (!player) return;
    const cfg = services.runtime.config;
    const held = readHeldItemId(player) || heldTypeId;
    const isFlowItem = cfg.flowItem.enabled && held !== "" && held === cfg.flowItem.typeId;
    const isTokenItem = cfg.tokenItem.enabled && held !== "" && held === cfg.tokenItem.typeId;
    // 潜行 + 信物（木棍）= 绑箱手势：这一下完整交给方块路径，这里既不认领手势也不开面板
    // （认领了方块那边就认领失败，绑定面板会弹不出来）
    if (isTokenItem && !isFlowItem && player.isSneaking) return;
    // 其余情况实体手势优先：立即认领，让同一次点击里的「使用物品」上报自动让路
    // （物品手势延后 2 tick 执行，本回调只需 1 tick，所以一定先到）
    if (!claimGesture(viewerName, system.currentTick)) return;
    // 存在性预判仅提前报错；面板入口自带解析与管理守卫
    const botId = services.runtime.findBotIdByName(botName);
    if (botId === undefined || !services.runtime.record(botId)) {
      trySendMessage(player, `${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已不存在`);
      return;
    }
    // 长流程专用物品优先：手持它点假人 = 直接进该假人的长流程面板（压过操作面板 / 行为菜单）
    if (isFlowItem) {
      showScriptPanel(player, botName);
      return;
    }
    if (player.isSneaking) showBehaviorPanel(player, botName);
    else showBotPanel(player, botName);
  });
}
/**
 * 读玩家主手物品 id（空手 / 读不到回空串）。只在 system.run 等非受限上下文调用。
 * @param player - 目标玩家
 */
function readHeldItemId(player: Player): string {
  try {
    const inv = player.getComponent("minecraft:inventory") as
      | { container?: { getItem(slot: number): { typeId: string } | undefined } }
      | undefined;
    return inv?.container?.getItem(player.selectedSlotIndex)?.typeId ?? "";
  } catch {
    return "";
  }
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
  const cfg = services.runtime.config;
  // ⚠️ 长流程物品（默认羽毛）不参与方块手势：直接放行不消费，免得跟实体路径抢同一个面板
  if (cfg.flowItem.enabled && info.heldTypeId !== "" && info.heldTypeId === cfg.flowItem.typeId) return false;
  const hit = isChestBindGesture({
    tokenEnabled: cfg.tokenItem.enabled,
    tokenTypeId: cfg.tokenItem.typeId,
    heldTypeId: info.heldTypeId,
    sneaking: info.sneaking,
    blockTypeId: info.blockTypeId,
  });
  if (!hit) return false;
  // 方块手势（绑箱）优先级高于物品手势：命中即认领，同一次点击里"使用木棍"的上报随即让路
  // （返回 true 照旧取消原版开箱，哪怕手势被抢也不让箱子 GUI 弹出来叠在上层）
  if (!claimGesture(info.playerName, system.currentTick)) return true;
  if (info.firstPress) {
    system.run(() => {
      const player = entityGateway.findRealPlayer(info.playerName);
      if (player) showWorkChestForm(player, { dimId: info.dimId, x: info.x, y: info.y, z: info.z });
    });
  }
  return true;
}
