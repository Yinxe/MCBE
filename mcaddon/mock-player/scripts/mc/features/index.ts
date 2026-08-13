// ─── Features barrel — re-exports all public API ────────
// Individual feature files — use case implementations（决策调 core，副作用留本地）

export { createBot, type CreateBotOptions } from "./createBot";
export { onlineBot } from "./onlineBot";
export { offlineBot } from "./offlineBot";
export { deleteBot } from "./deleteBot";
export { killBot } from "./killBot";
export { tpPlayerToBot, tpBotToPlayer } from "./teleport";
export { moveBot } from "./move";
export { toggleControl } from "./control";
export { setSneaking } from "./sneak";
export { reclaimBot, type ReclaimResult } from "./reclaim";
export type { ReclaimOptions } from "../../core/service/ReclaimPlanner";
export {
  swapMainhandWithBot,
  swapOffhandWithBot,
  swapEquipmentWithBot,
  unequipBotAll,
  equipBotArmor,
} from "./equip";
export { InventoryStorage } from "./inventoryStorage";
export { setTags } from "./setTags";
export { checkMainHandDurability } from "./toolHealth";
export { startFollow, stopFollow, isFollowing } from "./follow";
export { scanTridents, isMainhandTrident, throwTridents } from "./trident";
export { getMainhandOptions, setMainhandSlot } from "./mainhand";
export { startUseItem, stopUseItem } from "./useItem";
export { startRaidMode } from "../workflows/raidFlow";
export { runVaultCycle } from "../workflows/vaultFlow";
