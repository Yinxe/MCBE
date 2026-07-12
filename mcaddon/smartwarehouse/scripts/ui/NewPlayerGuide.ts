/**
 * ============================================================================
 * NewPlayerGuide —— 新手引导
 * ============================================================================
 *
 * 玩家首次打开菜单时自动推送欢迎引导消息，
 * 使用 DynamicProperty 记录每个玩家是否已看过引导。
 * ============================================================================
 */

import { world, type Player } from "@minecraft/server";

/** DynamicProperty 键名前缀 */
const ONBOARDED_PREFIX = "smartwarehouse:onboarded:";

/**
 * 检查玩家是否已看过新手引导。
 */
function hasSeenGuide(player: Player): boolean {
  const raw = world.getDynamicProperty(ONBOARDED_PREFIX + player.id);
  return raw === true;
}

/**
 * 标记玩家已看过新手引导。
 */
function markSeenGuide(player: Player): void {
  world.setDynamicProperty(ONBOARDED_PREFIX + player.id, true);
}

/**
 * 检查是否为玩家首次使用，若是则发送欢迎引导消息。
 * 引导仅在新玩家首次打开菜单时自动触发一次。
 *
 * @param player - 目标玩家
 * @returns true 表示已发送引导消息，false 表示玩家已不是新手
 */
export function tryShowNewPlayerGuide(player: Player): boolean {
  if (hasSeenGuide(player)) return false;

  markSeenGuide(player);
  sendWelcomeMessage(player);
  return true;
}

/**
 * 发送欢迎引导消息。
 */
function sendWelcomeMessage(player: Player): void {
  const lines = [
    "",
    "§l§b≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡",
    "§l§b       欢迎使用 SmartWarehouse §r§b✨",
    "§l§b≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡",
    "",
    "§7SmartWarehouse 是一个智能仓库管理模组，",
    "§7可以自动将你的物品分拣到指定的容器中。",
    "",
    "§a▶ 快速开始",
    `§7  1. 点击 §a创建仓库 §7开始搭建你的第一个仓库`,
    `§7  2. 使用 §f/sw:menu §7随时打开主菜单`,
    `§7  3. 手持 §e木锄 §7（默认信物）右键方块选择区域`,
    `§7  4. 需要帮助可点击菜单中的 §e❓ 帮助 §7按钮`,
    "",
    "§a▶ 新手提示",
    `§7  - 将待分拣物品放入 §6输入容器 §7（比如漏斗）`,
    `§7  - 分拣引擎会自动将物品分配到对应的容器中`,
    `§7  - 接近仓库 §f16 格 §7会自动激活分拣`,
    `§7  - 使用 §f容器搜索 §7可以快速找到物品位置`,
    "",
    "§7§o提示：此引导仅显示一次，",
    "§7§o需要帮助时可随时点击菜单中的 §e❓ 帮助§7§o。",
    "§l§b≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡",
    "",
  ];

  for (const line of lines) {
    player.sendMessage(line);
  }
}
