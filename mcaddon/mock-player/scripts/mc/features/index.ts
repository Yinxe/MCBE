// ─── Features barrel — re-exports all public API ────────
// 归类：manage（生命周期管理）/ basic（基础原子操作）/ task（行为任务）/
//       state（状态标签）/ trident（三叉戟）。决策调 rules/items 等纯规则，副作用留本地。

export { createBot, type CreateBotOptions } from "./manage/createBot";
export { onlineBot } from "./manage/onlineBot";
export { offlineBot } from "./manage/offlineBot";
export { deleteBot } from "./manage/deleteBot";
export { killBot } from "./manage/killBot";
export { tpPlayerToBot, tpBotToPlayer } from "./basic/teleport";
export { moveBot } from "./basic/move";
export { toggleControl } from "./basic/control";
export { setSneaking } from "./basic/sneak";
export { reclaimBot, type ReclaimResult } from "./manage/reclaim";
export type { ReclaimOptions } from "../../service/ReclaimPlanner";
export {
  swapMainhandWithBot,
  swapOffhandWithBot,
  swapEquipmentWithBot,
  unequipBotAll,
  equipBotArmor,
} from "./basic/equip";
export { InventoryStorage } from "./inventoryStorage";
export { setTags } from "./state/setTags";
export { checkMainHandDurability } from "./basic/toolHealth";
export { startFollow, stopFollow, isFollowing } from "./state/follow";
export { scanTridents, isMainhandTrident, throwTridents } from "./trident/trident";
export { getMainhandOptions, setMainhandSlot } from "./basic/mainhand";
export { startUseItem, stopUseItem } from "./basic/useItem";
