import { ItemStack, Player, world } from "@minecraft/server";
import { showMainMenu } from "../ui/menu";

// ─── Token 常量 ────────────────────────────────────────────────────

export const TOKEN_LORE = "§b右键打开传送菜单";
export const TOKEN_NAME = "§b传送信物";
export const TOKEN_TYPE_ID = "minecraft:paper";

/**
 * 判断物品是否为传送信物。
 */
export function isTeleportToken(item: ItemStack): boolean {
  if (item.typeId !== TOKEN_TYPE_ID) return false;
  const lore = item.getLore();
  return lore.some((line) => line === TOKEN_LORE);
}

/**
 * 创建传送信物 ItemStack（死亡不掉落）。
 */
export function createTeleportToken(): ItemStack {
  const item = new ItemStack(TOKEN_TYPE_ID, 1);
  item.nameTag = TOKEN_NAME;
  item.setLore([TOKEN_LORE]);
  item.keepOnDeath = true;
  return item;
}

// ─── 事件订阅 ──────────────────────────────────────────────────────

/**
 * 订阅物品使用前事件。
 * 使用传送信物时取消事件并打开菜单，避免触发任何方块交互。
 */
export function subscribeItemUseEvent(): void {
  // 空中使用 → 取消
  world.beforeEvents.itemUse.subscribe((event) => {
    if (!isTeleportToken(event.itemStack)) return;
    event.cancel = true;
    showMainMenu(event.source);
  });

  // 对着方块使用 → 取消交互
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!event.itemStack || !isTeleportToken(event.itemStack)) return;
    event.cancel = true;
    showMainMenu(event.player);
  });
}

// ─── 给予信物 ──────────────────────────────────────────────────────

/**
 * 给玩家一个传送信物。
 * 背包满时溢出到地面。
 */
export function giveTeleportToken(player: Player): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) return;

  const token = createTeleportToken();

  for (let i = 0; i < container.size; i++) {
    const slot = container.getSlot(i);
    if (slot && !slot.hasItem()) {
      slot.setItem(token);
      player.sendMessage("§a已获得 §b传送信物§a，右键使用打开传送菜单");
      return;
    }
  }

  player.dimension.spawnItem(token, player.location);
  player.sendMessage("§a背包已满，传送信物已丢在地上");
}
