// ─── 共享类型和常量 ────────────────────────────────────
// 所有核心数据类型定义在此文件，不依赖其他模块

import { Vector3, Vector2 } from "@minecraft/server";

// ─── 常量 ──────────────────────────────────────────────

/** 实体标签前缀 — MC 的 addTag/removeTag 中用此前缀标识属于 MockPlayer 的标签 */
export const TAG_PREFIX = "mockplayer:tag:";
/** 假人基础标识标签（用于 entity.hasTag 快速判断） */
export const BOT_TAG = `${TAG_PREFIX}bot`;
/**
 * DynamicProperty key 前缀
 * 用于持久化 key：
 *   <DP_PREFIX><name>          — BotRecord（位置/标签/状态等）
 *   <DP_PREFIX><name>:inv:<N>  — 背包第 N 格（每格独立 key，避免 32KB 上限）
 *   <DP_PREFIX><name>:equip:<X> — 装备栏 X（head/chest/legs/feet/offhand）
 */
export const DP_PREFIX = "mockplayer:players:";

// ─── 类型定义 ──────────────────────────────────────────

export interface TagDef {
  /** 显示名（中文，给玩家看） */
  label: string;
  /** tag 值（含前缀，如 "mockplayer:tag:bot"） */
  value: string;
}

/** 点位状态：完整的位置、维度、朝向、视角 */
export interface PositionState {
  location: Vector3;
  dimension: string;
  rotation: Vector2;
  lookTarget: Vector3;
}

/**
 * 经验值记录
 * MC 升级公式（Java & Bedrock 一致）：
 *   0–15 级：升一级需 2n + 7 XP
 *   16–30 级：升一级需 5n − 38 XP
 *   31+ 级：  升一级需 9n − 158 XP
 * totalXp 方便直接调 player.addExperience(totalXp) 转移给玩家
 */
export interface ExperienceRecord {
  /** 等级（给玩家看） */
  level: number;
  /** 当前等级内的经验进度（给玩家看进度条） */
  xpProgress: number;
  /** 总经验值 = 所有等级累计 + xpProgress */
  totalXp: number;
}

// ─── 序列化类型 ──────────────────────────────────────────
// ItemStack → JSON 可存的结构，用于背包持久化

/** 序列化后的单个附魔 */
export interface SerializedEnchantment {
  /** 附魔 ID，如 "sharpness"、"protection" */
  id: string;
  /** 附魔等级 */
  level: number;
}

/**
 * 序列化后的物品（ItemStack → JSON 可存）
 * Script API 的 ItemStack 不可直接 JSON.stringify，需要手动抽取可读字段
 * 详见 serializeItemStack / deserializeItemStack 的实现
 */
export interface SerializedItemStack {
  /** 物品类型 ID，如 "minecraft:diamond" */
  typeId: string;
  /** 堆叠数量 */
  amount: number;
  /** 自定义名称 */
  nameTag?: string;
  /** 死亡不掉落 */
  keepOnDeath?: boolean;
  /** 锁定模式（inventory / slot / none） */
  lockMode?: string;
  /** 物品说明文本 */
  lore?: string[];
  /** 冒险模式可破坏方块列表 */
  canDestroy?: string[];
  /** 冒险模式可放置方块列表 */
  canPlaceOn?: string[];
  /** 耐久损伤值（从 durability component） */
  damage?: number;
  /** 是否不可破坏 */
  unbreakable?: boolean;
  /** 附魔列表（id + level） */
  enchantments?: SerializedEnchantment[];
  /** 药水效果 ID（如 "healing"、"strength"） */
  potionEffectType?: string;
  /** 药水投掷类型 ID（如 "potion"、"lingering_potion"、"splash_potion"） */
  potionDeliveryType?: string;
  /** 染色颜色（皮革甲等可染色物品） */
  color?: { red: number; green: number; blue: number };
  /** 成书作者 */
  bookAuthor?: string;
  /** 成书页内容（每页字符串，未写内容的页为 undefined） */
  bookContents?: (string | undefined)[];
  /** 是否已签名（已签名的书才能设置 author/contents） */
  bookIsSigned?: boolean;
  /**
   * 嵌套容器（潜影盒/收纳袋内部物品），递归序列化
   * null = 空位，数组长度 = 容器大小
   * 反序列化时先建外层物品，再递归填充内部容器
   */
  container?: (SerializedItemStack | null)[];
}

/** 假人持久化记录，通过 world.setDynamicProperty 存储为 JSON */
export interface BotRecord {
  /** 假人唯一名（同时也是 SimulatedPlayer 的 name） */
  name: string;
  /** 是否在线（false = 离线/死亡离线，重启后加载时默认 false） */
  online: boolean;
  /** 是否死亡 */
  death: boolean;
  /** SimulatedPlayer 的实体 ID（在线时有效，死亡/离线后清空） */
  entityId?: string;
  /** 持久化的标签列表（上线时通过 syncEntityTags 恢复） */
  tags: string[];
  /** 体态控制器玩家 ID（仅当有 TAG_CONTROL 标签时有效） */
  controllerId?: string;
  /** 潜行状态 */
  isSneaking: boolean;
  /** 最后已知位置（死亡时清空，由 respawnPoint 或在线刷新填充） */
  lastPoint: PositionState | null;
  /** 重生点（创建时由当前位置设定，可用 /mp:setRespawn 修改） */
  respawnPoint: PositionState;
  /** 死亡点（死亡时记录，重生后清空） */
  deathPoint: PositionState | null;
  /** 经验值（等级 + 进度 + 总值） */
  experience: ExperienceRecord;
}
