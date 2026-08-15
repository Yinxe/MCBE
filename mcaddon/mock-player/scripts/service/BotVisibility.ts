// ─── 假人可见性规则（core 层纯逻辑） ────────────────
// 每个玩家只能看到属于自己的假人 + 无主假人（全员可见，首操认领）；
// 管理员看到全部。列表/在线管理等 UI 统一走此过滤。
// 零 @minecraft 依赖，可 node 单测。

import type { BotRecord } from "../model/Types";

/**
 * 玩家可见的假人记录：
 *   - 管理员：全部
 *   - 普通玩家：自己的（ownerName === playerName）+ 无主的（ownerName 为空，
 *     全员可见——第一个打开菜单/管理的人 autoClaim 成为主人）
 */
export function visibleRecords(records: BotRecord[], playerName: string, isAdminPlayer: boolean): BotRecord[] {
  if (isAdminPlayer) return records;
  return records.filter((r) => !r.ownerName || r.ownerName === playerName);
}
