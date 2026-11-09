// ─── 传送信物的判定常量 ─────────────────────────────────────────
//
// 只放常量与纯判定逻辑;真正创建 ItemStack 由 scripts/mc/token.ts 承担。
// 识别依据是「类型 + 描述行」而不是名称,因为名称可被铁砧改掉。

/** 信物的物品类型。 */
export const TOKEN_TYPE_ID = "minecraft:paper";

/** 信物显示名。 */
export const TOKEN_NAME = "§b传送信物";

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
 * 类型必须是纸,且描述里含有信物标记行。普通纸返回 false。
 */
export function isTeleportToken(candidate: TokenCandidate): boolean {
  if (candidate.typeId !== TOKEN_TYPE_ID) return false;
  return candidate.lore.indexOf(TOKEN_LORE) !== -1;
}
