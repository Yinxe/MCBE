// ─── 信物的物品层实现 ────────────────────────────────────────
// 判定常量在 core/token.ts（纯 TS，可单测）；本文件负责创建 ItemStack、
// 扫描背包、发放与溢出。放这里是让「发放策略」成为可被单测覆盖的纯决策，
// 而不是埋在命令回调里。
import { ItemLockMode, ItemStack, type Container, type Player } from "@minecraft/server";
import { TOKEN_TYPE_ID, decideGiveOutcome, type GiveOutcome } from "../core/token";

/**
 * 创建一个仓库信物。
 *
 * 与传送磁石信物同款保护：死亡不掉落、锁定在背包格内。锁背包的理由是
 * 「信物被塞进仓库箱子后玩家找不到」——这与本模组自己的语义冲突得最厉害。
 */
export function createWarehouseToken(): ItemStack {
  const item = new ItemStack(TOKEN_TYPE_ID, 1);
  item.keepOnDeath = true;
  item.lockMode = ItemLockMode.inventory;
  return item;
}

/** 背包里是否已有信物 */
export function hasWarehouseToken(container: Container): boolean {
  for (let slot = 0; slot < container.size; slot += 1) {
    const item = container.getItem(slot);
    if (item !== undefined && item.typeId === TOKEN_TYPE_ID) return true;
  }
  return false;
}

/** 找第一个空槽位，没有则返回 -1 */
function findEmptySlot(container: Container): number {
  for (let slot = 0; slot < container.size; slot += 1) {
    if (container.getItem(slot) === undefined) return slot;
  }
  return -1;
}

/**
 * 发放信物给玩家：优先放背包，背包满时溢出到脚下。
 *
 * ⚠️ 半初始化实体上 `getComponent` 可能直接抛错（游戏实测 `getComponent of undefined`）。
 * 发放失败只是少一件信物，绝不能让异常穿到事件回调外层。
 *
 * @param player - 目标玩家
 * @returns 发放结果（调用方据此决定提示文案）
 */
export function giveWarehouseToken(player: Player): GiveOutcome {
  let container: Container | undefined;
  try {
    container = player.getComponent("inventory")?.container;
  } catch {
    return "unavailable";
  }

  const outcome = decideGiveOutcome({
    alreadyHas: container !== undefined && hasWarehouseToken(container),
    hasEmptySlot: container !== undefined && findEmptySlot(container) !== -1,
    containerReadable: container !== undefined,
  });

  if (outcome === "into-inventory" && container !== undefined) {
    container.setItem(findEmptySlot(container), createWarehouseToken());
    return "into-inventory";
  }

  if (outcome === "dropped") {
    try {
      player.dimension.spawnItem(createWarehouseToken(), player.location);
      return "dropped";
    } catch {
      return "unavailable"; // 维度/位置不可读 → 不溢出，静默放弃
    }
  }

  return outcome;
}
