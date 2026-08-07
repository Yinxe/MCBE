// ─── 背包 2 阶段整理决策（纯函数，可单测） ────────────────
// 玩家背包整理分两区：主栏（槽 9-35）与快捷栏（槽 0-8）。
//   阶段一：主栏混乱度 > 0 → 只整理主栏（快捷栏保留待下次）。
//   阶段二：主栏归 0 → 本次改整理快捷栏。
//   两区都归 0 → 完全整齐。
// 玩家可手动触发两次，从而"只整主栏"或"主栏+快捷栏"可控。

/** 本次整理的目标区 + 阶段提示 */
export type InventoryPhase =
  | { region: "main"; /** 快捷栏是否仍待整理（提示玩家再触发一次） */ hotbarPending: boolean }
  | { region: "hotbar" }
  | { region: "clean" };

/**
 * 依据两区混乱度 0-1 决定本次背包整理目标区。
 * @param mainChaos   主栏（槽 9-35）混乱度
 * @param hotbarChaos 快捷栏（槽 0-8）混乱度
 */
export function pickInventoryPhase(mainChaos: number, hotbarChaos: number): InventoryPhase {
  if (mainChaos > 0) return { region: "main", hotbarPending: hotbarChaos > 0 };
  if (hotbarChaos > 0) return { region: "hotbar" };
  return { region: "clean" };
}
