// ─── 传送信物的判定常量 ─────────────────────────────────────────
//
// 只放常量与纯判定逻辑;真正创建 ItemStack 由 scripts/mc/token.ts 承担。
// 识别依据是「类型 + 描述行」而不是名称,因为名称可被铁砧改掉。
//
// 物品用 `minecraft:lodestone_compass`(磁石指针),不是 `minecraft:compass`
// 加组件——它是官方物品目录里登记的独立 ID,比运行时拼组件更稳。

/** 信物的物品类型。磁石指针。 */
export const TOKEN_TYPE_ID = "minecraft:lodestone_compass";

/** 信物显示名。 */
export const TOKEN_NAME = "§b传送磁石";

/** 信物的描述行。识别以此为准。 */
export const TOKEN_LORE = "§b右键打开传送菜单";

/** 判定用的最小物品信息。 */
export interface TokenCandidate {
  typeId: string;
  lore: readonly string[];
}

/**
 * 判断一个物品是否为传送信物。
 *
 * 类型必须是磁石指针,且描述里含有信物标记行。
 * 普通指南针、普通磁石指针(没有该描述行)返回 false。
 */
export function isTeleportToken(candidate: TokenCandidate): boolean {
  if (candidate.typeId !== TOKEN_TYPE_ID) return false;
  return candidate.lore.indexOf(TOKEN_LORE) !== -1;
}
