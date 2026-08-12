// ─── 死亡时物品持久化策略（core 层） ───────────────────
// 纯逻辑：假人死亡时背包/装备的持久化决策。
//
// 刷物防护语义：
//   - 死亡掉落开启（keepInventory=false）：引擎生成掉落物 = 物品离开假人的唯一副本。
//     持久化必须清空，否则"掉落 + 重连恢复"产生双份（刷物）。
//     无论 entityDie 回调时 deadEntity 背包是否已被引擎清空（时序差异），清空都安全。
//   - 死亡不掉落（keepInventory=true）：物品继续属于假人（重生/重连应保留）。
//     持久化保存当前背包，避免"清空"导致物品凭空消失（丢物）。

export type DeathInventoryPolicy = "persist" | "clear";

/**
 * 按世界游戏规则决定死亡时的物品持久化策略。
 * @param keepInventory 世界是否开启死亡不掉落（world.gameRules.keepInventory）
 */
export function decideDeathInventoryPolicy(keepInventory: boolean): DeathInventoryPolicy {
  return keepInventory ? "persist" : "clear";
}