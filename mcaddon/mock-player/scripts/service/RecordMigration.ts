// ─── 记录结构归一化（core 层纯逻辑，迁移用） ────────────
// 旧版本（≤1.1.48 认主前 / 更早架构）的 BotRecord 可能缺失部分字段：
//   - ownerName：1.1.48 才引入（缺失 = 无主，管理员可管理——默认语义）
//   - 极端情况：更老版本/手动损坏的记录缺 experience/respawnPoint 等
// 归一化幂等：缺失字段补默认值，已有字段不动；每次启动对全部记录执行安全。
// 零 @minecraft 依赖，可 node 单测。

import type { BotRecord, PositionState } from "../rules/Types";

/** 记录缺失 respawnPoint 时的默认值（调用方可用世界出生点覆盖） */
export const DEFAULT_RESPAWN: PositionState = {
  location: { x: 0, y: 64, z: 0 },
  dimension: "minecraft:overworld",
  rotation: { x: 0, y: 0 },
  lookTarget: { x: 0, y: 64, z: 0 },
};

/**
 * 补齐记录缺失字段（幂等；返回是否发生了任何补全）。
 * @param defaultRespawn 缺失重生点时的默认值（通常传世界出生点；不传用 DEFAULT_RESPAWN）
 */
export function normalizeRecord(record: BotRecord, defaultRespawn: PositionState = DEFAULT_RESPAWN): boolean {
  let changed = false;
  if (record.online === undefined) { record.online = false; changed = true; }
  if (record.death === undefined) { record.death = false; changed = true; }
  if (!Array.isArray(record.tags)) { record.tags = []; changed = true; }
  if (record.isSneaking === undefined) { record.isSneaking = false; changed = true; }
  if (record.lastPoint === undefined) { record.lastPoint = null; changed = true; }
  if (!record.respawnPoint || typeof record.respawnPoint !== "object") {
    record.respawnPoint = { ...defaultRespawn };
    changed = true;
  }
  if (record.deathPoint === undefined) { record.deathPoint = null; changed = true; }
  if (!record.experience || typeof record.experience !== "object") {
    record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
    changed = true;
  }
  if (record.spawnMode === undefined) { record.spawnMode = "normal"; changed = true; }
  return changed;
}
