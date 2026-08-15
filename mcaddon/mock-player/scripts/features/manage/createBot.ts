// ─── 创建假人 ──────────────────────────────────────────

import { Vector3, Dimension, world } from "@minecraft/server";

import { BotRecord, isValidBotName, normalizeBotName, MAX_BOT_NAME_LENGTH } from "../../rules/Types";
import { botRegistry, configStore } from "../../bootstrap/context";
import { isNameOccupiedInWorld } from "../../bot/PlayerGateway";
import { canCreateBot, remainingQuota } from "../../service/QuotaRules";
import { isAdmin } from "../../interaction/commands/auth";
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
  const { name: rawName, ownerName, location, dimension, initialTags, rotation, lookTarget, isSneaking, spawnMode } = options;

  // 名字规范化：自动加假人前缀（"刷铁机" → "$刷铁机"，防与真人撞名）
  const name = normalizeBotName(rawName);

  // 名字校验：空名/超长/含 DP 子 key 分隔符（:inv: :equip: → 持久化 key 冲突，重启丢数据/误删）
  if (!isValidBotName(name)) {
    throw new Error(`假人名字不合法：不能为空、超过 ${MAX_BOT_NAME_LENGTH} 字符或包含 ":inv:" / ":equip:"`);
  }
  // 注册表已有同名记录 → 覆盖会丢旧数据，直接拒绝
  if (botRegistry.has(name)) {
    throw new Error(`假人 ${name} 已存在，请更换名字`);
  }
  // 真实玩家冲突检查（双重）：
  // 1. 输入原始名与在线真人同名 → 直接拒绝（用户要求）
  // 2. 规范化后完整名与世界中玩家实体（真人/在线假人）同名 → 拒绝（spawn 必生成 "(2)"）
  if (rawName.trim() !== name && isNameOccupiedInWorld(rawName.trim())) {
    throw new Error(`名字 ${rawName.trim()} 与真实玩家相同，请更换名字`);
  }
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
