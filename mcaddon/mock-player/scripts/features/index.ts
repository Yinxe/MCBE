// ─── Features barrel — re-exports all public API ────────
// features/core/index.ts — types, tags system, persistence, utils, behavior, spawn
// Individual feature files — use case implementations

export * from "./core/index";

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
export {
  swapMainhandWithBot,
  swapOffhandWithBot,
  swapEquipmentWithBot,
  unequipBotAll,
  equipBotArmor,
  saveBotEquipState,
} from "./equip";
export { saveBotFullState } from "./saveState";
export { setTags } from "./setTags";
