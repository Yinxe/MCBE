// ─── 共享类型和常量 ────────────────────────────────────

import { Vector3, Vector2 } from "@minecraft/server";

// ─── 常量 ──────────────────────────────────────────────

export const TAG_PREFIX = "mockplayer:tag:";
export const BOT_TAG = `${TAG_PREFIX}bot`;
export const DP_PREFIX = "mockplayer:players:";

// ─── 类型定义 ──────────────────────────────────────────

export interface TagDef {
  /** 显示名 */
  label: string;
  /** tag 值（含前缀） */
  value: string;
}

/** 点位状态：完整的位置、维度、朝向、视角 */
export interface PositionState {
  location: Vector3;
  dimension: string;
  rotation: Vector2;
  lookTarget: Vector3;
}

/** 经验值记录 */
export interface ExperienceRecord {
  /** 等级 */
  level: number;
  /** 当前等级内的经验进度 */
  xpProgress: number;
  /** 总经验值 = 所有等级累计 + xpProgress，方便转移给玩家 */
  totalXp: number;
}

// ─── 序列化类型 ──────────────────────────────────────────

/** 序列化后的单个附魔 */
export interface SerializedEnchantment {
  id: string;
  level: number;
}

/** 序列化后的物品（ItemStack → JSON 可存） */
export interface SerializedItemStack {
  typeId: string;
  amount: number;
  nameTag?: string;
  keepOnDeath?: boolean;
  lockMode?: string;
  lore?: string[];
  canDestroy?: string[];
  canPlaceOn?: string[];
  /** 耐久损伤值（从 durability component） */
  damage?: number;
  /** 是否不可破坏 */
  unbreakable?: boolean;
  /** 附魔列表（id + level） */
  enchantments?: SerializedEnchantment[];
  /** 药水效果 ID（如 "healing"、"strength"） */
  potionEffectType?: string;
  /** 药水投掷类型 ID（如 "potion"、"lingering_potion"） */
  potionDeliveryType?: string;
  /** 染色颜色（皮革甲） */
  color?: { red: number; green: number; blue: number };
  /** 成书作者 */
  bookAuthor?: string;
  /** 成书页内容 */
  bookContents?: (string | undefined)[];
  /** 是否已签名 */
  bookIsSigned?: boolean;
  /** 嵌套容器（潜影盒/收纳袋内部物品），递归序列化，null = 空位 */
  container?: (SerializedItemStack | null)[];
}

/** 假人持久化记录 */
export interface BotRecord {
  name: string;
  online: boolean;
  death: boolean;
  /** SimulatedPlayer 的实体 ID（在线时有效） */
  entityId?: string;
  /** 持久化的标签列表 */
  tags: string[];
  /** 体态控制器玩家 ID（仅 TAG_CONTROL 时有效） */
  controllerId?: string;
  /** 潜行状态 */
  isSneaking: boolean;
  /** 最后已知位置（死亡时清空，由 respawnPoint 或在线刷新填充） */
  lastPoint: PositionState | null;
  /** 重生点 */
  respawnPoint: PositionState;
  /** 死亡点（死亡时记录，重生后清空） */
  deathPoint: PositionState | null;
  /** 经验值（等级 + 进度） */
  experience: ExperienceRecord;
}
