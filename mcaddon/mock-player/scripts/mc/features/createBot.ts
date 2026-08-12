// ─── 创建假人 ──────────────────────────────────────────

import { Vector3, Dimension, world } from "@minecraft/server";

import { BotRecord } from "../../core/model/Types";
import { botRegistry, configStore } from "../bootstrap/context";
import { isNameOccupiedInWorld } from "../adapters/PlayerGateway";
import { canCreateBot, remainingQuota } from "../../core/service/QuotaRules";
import { isAdmin } from "../commands/auth";
import { spawnBot } from "./spawnMode";

export interface CreateBotOptions {
  name: string;
  /** 主人玩家名（创建者，用于配额统计与权限） */
  ownerName: string;
  location: Vector3;
  dimension: Dimension;
  initialTags: string[];
  rotation: Vector3;
  lookTarget: Vector3;
  isSneaking: boolean;
  spawnMode?: "normal" | "chunkload";
}

/**
 * 创建新假人（异步：生成前会等待名称唯一，见 spawnMode）
 * - 已存在的同名假人直接抛错，避免两个 record 争用同一 key 导致数据丢失
 * - 超过该主人配额直接抛错（管理员豁免配额）
 * - 根据 spawnMode 选择普通/强加载模式
 * - 构建 BotRecord（初始标签、位置、重生点、主人）
 * - 背包/装备/经验由 playerJoin 事件从持久化恢复
 */
export async function createBot(options: CreateBotOptions): Promise<BotRecord> {
  const { name, ownerName, location, dimension, initialTags, rotation, lookTarget, isSneaking, spawnMode } = options;

  // 注册表已有同名记录 → 覆盖会丢旧数据，直接拒绝
  if (botRegistry.has(name)) {
    throw new Error(`假人 ${name} 已存在，请更换名字`);
  }
  // 世界中已有同名玩家实体（真人/在线假人）→ spawn 必然生成 "(2)"，提前拒绝
  if (isNameOccupiedInWorld(name)) {
    throw new Error(`世界中已存在同名玩家实体 ${name}，请更换名字`);
  }

  // ── 配额检查（主人是管理员则豁免；0 = 禁止创建） ──
  // 主人即创建者（必然在线），按名字找实体判定管理员身份
  const ownedCount = botRegistry.all().filter((r) => r.ownerName === ownerName).length;
  const quota = configStore.quotaFor(ownerName);
  const ownerPlayer = world.getAllPlayers().find((p) => p.name === ownerName);
  const ownerIsAdmin = ownerPlayer ? isAdmin(ownerPlayer) : false;
  if (!canCreateBot(ownedCount, quota, ownerIsAdmin)) {
    const left = remainingQuota(ownedCount, quota, ownerIsAdmin);
    throw new Error(`创建失败：${ownerName} 的假人配额已达上限（${quota} 个）${left >= 0 ? `，剩余 ${left} 个` : ""}`);
  }

  const rot2 = { x: rotation.x, y: rotation.y };

  const record: BotRecord = {
    name,
    ownerName,
    online: true,
    death: false,
    tags: [...initialTags],
    isSneaking,
    spawnMode,
    lastPoint: { location, dimension: dimension.id, rotation: rot2, lookTarget },
    respawnPoint: { location, dimension: dimension.id, rotation: rot2, lookTarget },
    deathPoint: null,
    experience: { level: 0, xpProgress: 0, totalXp: 0 },
  };

  await spawnBot(record, location, dimension, rot2, lookTarget);

  console.info(
    `[MockPlayer] 创建假人 ${name} 模式=${record.spawnMode ?? "normal"} 主人=${ownerName}` +
    `（${dimension.id} ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)}）`,
  );
  return record;
}
