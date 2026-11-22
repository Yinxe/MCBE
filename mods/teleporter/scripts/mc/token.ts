// ─── 传送信物的物品层实现 ───────────────────────────────────────
//
// 识别常量在 core/token.ts,这里负责创建 ItemStack、发放与背包扫描。
//
// 信物是磁石指针 `minecraft:lodestone_compass`。这是官方物品目录里
// 登记的独立 ID,不需要运行时拼 `lodestone_tracker` 组件。

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

/** 改版前信物的物品类型,仅用于迁移清理。 */
const LEGACY_TOKEN_TYPE_ID = "minecraft:paper";

/**
 * 创建一个传送信物(磁石指针)。
 *
 * 死亡不掉落,且被锁定在背包格内,避免被误拖出去或误丢。
 * 磁石指针不可堆叠,与「一件信物」的语义一致。
 */
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

/**
 * 移除改版前发出去的纸信物。
 *
 * 旧信物的类型是 `minecraft:paper`,新版判定只认 `minecraft:lodestone_compass`,
 * 所以它们已经失效——留着只是占背包的垃圾。补发新信物时顺手清掉。
 *
 * @returns 清掉的件数
 */
export function removeLegacyTokens(container: Container): number {
  let removed = 0;
  for (let slot = 0; slot < container.size; slot += 1) {
    const item = container.getItem(slot);
    if (!item) continue;
    if (item.typeId !== LEGACY_TOKEN_TYPE_ID) continue;
    if (item.getLore().indexOf(TOKEN_LORE) === -1) continue;
    container.setItem(slot, undefined);
    removed += 1;
  }
  return removed;
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
  // ⚠️ 半初始化实体上 `getComponent` 可能直接抛错（游戏实测 `getComponent of undefined`）。
  // 发放失败只是少一件信物，绝不能让异常穿到 playerSpawn 回调外层。
  let container;
  try {
    container = player.getComponent("inventory")?.container;
  } catch {
    return;
  }
  if (!container) return;

  if (putTokenInInventory(container)) {
    if (announce) {
      player.sendMessage("§a已获得 §b传送磁石§a,右键使用打开传送菜单");
    }
    return;
  }

  try {
    player.dimension.spawnItem(createTeleportToken(), player.location);
  } catch {
    return; // 维度/位置不可读 → 不溢出，静默放弃
  }
  if (announce) {
    player.sendMessage("§a背包已满,§b传送磁石§a 已丢在地上");
  }
}

/**
 * 玩家首次进入时补发信物:已有信物或背包没空位时什么都不做。
 *
 * @returns 是否真的发放了
 */
export function ensureTeleportToken(player: Player): boolean {
  let container;
  try {
    container = player.getComponent("inventory")?.container;
  } catch {
    return false;
  }
  if (!container) return false;

  // 先把失效的旧纸信物清掉,再判断是否需要补发。
  // 顺序很重要:否则背包里「有信物」(旧纸)会让补发被跳过,玩家永远拿不到新信物。
  const cleaned = removeLegacyTokens(container);

  if (hasTeleportToken(container)) {
    if (cleaned > 0) {
      player.sendMessage(
        `§7已清理 ${cleaned} 个失效的旧信物,§b传送磁石§7 已在背包中`,
      );
    }
    return false;
  }

  if (!putTokenInInventory(container)) return false;

  player.sendMessage(
    "§a已获得 §b传送磁石§a,右键使用打开传送菜单（§6/tpa:token§a 可再次获取）",
  );
  return true;
}
