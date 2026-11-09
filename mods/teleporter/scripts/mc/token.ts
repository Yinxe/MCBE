// ─── 传送信物的物品层实现 ───────────────────────────────────────
//
// 识别常量在 core/token.ts,这里负责创建 ItemStack、发放与背包扫描。

import {
  ItemLockMode,
  ItemStack,
  type Container,
  type Player,
} from "@minecraft/server";
import {
  isTeleportToken,
  TOKEN_LORE,
  TOKEN_NAME,
  TOKEN_TYPE_ID,
} from "../core/token";

/** 创建一个传送信物。死亡不掉落,且被锁定在背包格内(不会被误拖到快捷栏之外)。 */
export function createTeleportToken(): ItemStack {
  const item = new ItemStack(TOKEN_TYPE_ID, 1);
  item.nameTag = TOKEN_NAME;
  item.setLore([TOKEN_LORE]);
  item.keepOnDeath = true;
  item.lockMode = ItemLockMode.inventory;
  return item;
}

/** 背包里是否已有信物。 */
export function hasTeleportToken(container: Container): boolean {
  for (let slot = 0; slot < container.size; slot += 1) {
    const item = container.getItem(slot);
    if (item && isTeleportToken({ typeId: item.typeId, lore: item.getLore() }))
      return true;
  }
  return false;
}

/** 找第一个空槽位,没有则返回 -1。 */
function findEmptySlot(container: Container): number {
  for (let slot = 0; slot < container.size; slot += 1) {
    if (!container.getItem(slot)) return slot;
  }
  return -1;
}

/**
 * 把信物放进背包第一个空位。
 *
 * @returns 放入成功返回 true;没有空位返回 false
 */
export function putTokenInInventory(container: Container): boolean {
  const slot = findEmptySlot(container);
  if (slot === -1) return false;
  container.setItem(slot, createTeleportToken());
  return true;
}

/**
 * 发放信物给玩家:优先放背包,背包满时溢出到脚下。
 *
 * @param announce 是否发送提示消息
 */
export function giveTeleportToken(player: Player, announce = true): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) return;

  if (putTokenInInventory(container)) {
    if (announce) {
      player.sendMessage("§a已获得 §b传送信物§a,右键使用打开传送菜单");
    }
    return;
  }

  player.dimension.spawnItem(createTeleportToken(), player.location);
  if (announce) {
    player.sendMessage("§a背包已满,传送信物已丢在地上");
  }
}

/**
 * 玩家首次进入时补发信物:已有信物或背包没空位时什么都不做。
 *
 * @returns 是否真的发放了
 */
export function ensureTeleportToken(player: Player): boolean {
  const container = player.getComponent("inventory")?.container;
  if (!container) return false;
  if (hasTeleportToken(container)) return false;
  if (!putTokenInInventory(container)) return false;

  player.sendMessage(
    "§a已获得 §b传送信物§a,右键使用打开传送菜单（§6/tpa:token§a 可再次获取）",
  );
  return true;
}
