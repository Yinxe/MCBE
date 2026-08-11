// ── @yinxe/nbt-data-storage 公共入口 ──────────────────────────────
// 运行时入口（含 mc 适配层，需在游戏内 Script API 环境使用）。
// core 纯领域函数（layout/meta/record/stats）同时导出，供调试与工具使用。
//
// 消费模组示例（main.ts，Phase 3）：
//   import { ItemStorage, installNdsCommands } from "@yinxe/nbt-data-storage";
//   const region = ItemStorage.register({
//     dimension: "minecraft:the_end",
//     anchor: { x: 0, y: 120, z: -1024 },
//   });
//   const slotId = region.put(item);    // -> 唯一格子 ID 或 null（满）
//   const stored = region.get(slotId);  // -> ItemStack | undefined（O(1)）
//   const took = region.take(slotId);   // -> 取走并回收槽位
export { ItemStorage } from "./mc/ItemStorage";
export type { RegisterOptions, RegionWorldInfo } from "./mc/ItemStorage";
export { installNdsCommands } from "./mc/commands";
export type { StoredRegion } from "./mc/StoredRegion";
export * from "./core";
