// ─── 列表主人/无主标签（mc/ui） ─────────────────────────
// 列表项共享渲染辅助：按视角区分——
//   管理员：每行显示「主人:XXX」或「[无主]」（全览需要归属信息）
//   普通玩家：只对无主假人标「[无主]」（自己的不需要标，本来就知道）

import { color } from "@yinxe/toolkit";

import type { BotRecord } from "../../core/model/Types";

/** 列表 owner 标签（带色）：管理员 → "主人:XXX" / "[无主]"；普通玩家 → 无主才标 "[无主]" */
export function ownerLabel(record: BotRecord, isAdminPlayer: boolean): string {
  if (record.ownerName) {
    return isAdminPlayer ? `${color.accent}主人:${color.playerName}${record.ownerName}` : "";
  }
  // 无主假人：所有视角都标（普通玩家可看到无主假人，提示"可认领"）
  return `${color.muted}[${color.warn}无主${color.muted}]`;
}
