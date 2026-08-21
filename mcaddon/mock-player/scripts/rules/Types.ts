// ─── 共享类型和常量（core 层） ──────────────────────────
// 所有核心数据类型定义在此文件，不依赖其他模块，零 @minecraft 依赖。
// 类型本地化约定：Vector3/Vector2 用数值接口 Vec3/Vec2 替代（mc 层负责与
// @minecraft/server 的 Vector3/Vector2 互转）；EquipmentSlot 枚举用字符串槽名。

// ─── 本地数值类型 ────────────────────────────────────────

/** 三维向量（替代 @minecraft/server 的 Vector3，core 层统一用此数值接口） */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 二维向量（替代 @minecraft/server 的 Vector2，如旋转角） */
export interface Vec2 {
  x: number;
  y: number;
}

// ─── 常量 ──────────────────────────────────────────────

/** 实体标签前缀 — MC 的 addTag/removeTag 中用此前缀标识属于 MockPlayer 的标签 */
export const TAG_PREFIX = "mockplayer:tag:";
/**
 * DynamicProperty key 前缀
 * 用于持久化 key：
 *   <DP_PREFIX><name>          — BotRecord（位置/标签/状态等）
 *   <DP_PREFIX><name>:inv:<N>  — 背包第 N 格（每格独立 key，避免 32KB 上限）
 *   <DP_PREFIX><name>:equip:<X> — 装备栏 X（head/chest/legs/feet/offhand）
 */
export const DP_PREFIX = "mockplayer:players:";

// ─── 装备槽常量 ──────────────────────────────────────────

/** 装备槽名称列表（字符串形式，用于 DP key 后缀） */
export const EQUIP_SLOT_NAMES = ["head", "chest", "legs", "feet", "offhand"] as const;

/** 装备槽名称（core 内统一用字符串槽名，mc 层映射到 EquipmentSlot 枚举） */
export type EquipSlotName = (typeof EQUIP_SLOT_NAMES)[number];

/** 可互换的装备槽列表（不含主手），用于装备互换/卸甲 */
export const SWAP_SLOT_NAMES: EquipSlotName[] = ["head", "chest", "legs", "feet", "offhand"];

/** 假人背包格数（快捷栏 9 + 主背包 27） */
export const INVENTORY_SIZE = 36;

// ─── 假人名字校验 ──────────────────────────────────────

/** DP 子 key 分隔符（历史遗留：旧版背包/装备槽 key 用），名字含这些子串会与旧格式槽位 key 冲突 */
export const INVALID_NAME_SEGMENTS = [":inv:", ":equip:"] as const;

/** MC 假人名最大长度（玩家名上限，含前缀 sim-） */
export const MAX_BOT_NAME_LENGTH = 32;

/** 假人名字前缀：与真实玩家区分（防止与未上线真人撞名——真人默认名不带 sim-） */
export const BOT_NAME_PREFIX = "sim-";

/**
 * 规范化假人名字：去空白 + 无前缀时自动加前缀（"刷铁机" → "sim-刷铁机"）。
 * 已有前缀不重复加；空输入原样返回。
 * 兼容旧 "$" 前缀：自动迁移为 "sim-"（"$刷铁机" → "sim-刷铁机"）。
 */
export function normalizeBotName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(BOT_NAME_PREFIX)) return trimmed;
  if (trimmed.startsWith("$")) return `${BOT_NAME_PREFIX}${trimmed.slice(1)}`;
  return `${BOT_NAME_PREFIX}${trimmed}`;
}

/**
 * 假人名字是否合法（**规范化后**的完整名，含前缀）。
 * 拒绝：空名、超长（>32，生成 "(2)" 重名防护的边界）、
 *      含 `:inv:` / `:equip:` 子串（历史遗留限制：旧版 DP 槽位 key 冲突；
 *      新 NBT 存储后端已无此冲突，但保留校验以兼容旧数据格式）。
 */
export function isValidBotName(name: string): boolean {
  if (!name) return false;
  if (name.length > MAX_BOT_NAME_LENGTH) return false;
  return !INVALID_NAME_SEGMENTS.some((seg) => name.includes(seg));
}

// ─── 类型定义 ──────────────────────────────────────────

export interface TagDef {
  /** 显示名（中文，给玩家看） */
  label: string;
  /** tag 值（含前缀，如 "mockplayer:tag:bot"） */
  value: string;
}

/** 点位状态：完整的位置、维度、朝向、视角 */
export interface PositionState {
  location: Vec3;
  dimension: string;
  rotation: Vec2;
  lookTarget: Vec3;
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
 * 序列化效果（buff 持久化用，随 BotRecord 保存/恢复）。
 * 排除流程性效果（村庄英雄/不祥之兆/袭击之兆——由劫掠等业务自行管理）。
 * 离线时效果暂停（实体销毁），恢复时用最后保存的剩余时长重新施加。
 */
export interface SerializedEffect {
  /** 效果 ID（含命名空间，如 "minecraft:speed"） */
  id: string;
  /** 剩余时长（tick） */
  duration: number;
  /** 效果等级（0 = 1 级） */
  amplifier: number;
}

/**
 * 序列化后的物品（ItemStack → JSON 可存）
 * Script API 的 ItemStack 不可直接 JSON.stringify，需要手动抽取可读字段
 * 详见 serializeItemStack / deserializeItemStack 的实现（mc 层）
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
   *
   * ⚠️ 已知限制：运行时 item.hasComponent("minecraft:inventory") 对原版
   * 潜影盒/收纳袋返回 false，getComponent 返回 undefined。
   * 该字段永远无法被 populate，定义仅保留类型结构参考。
   * ItemInventoryComponent 实际只对自定义 BP 物品
   *（含 minecraft:storage_item 组件）生效。
   * 如要完整保存潜影盒内容，需用 structureManager 做结构快照存储
   *（见 scripts/lib/ItemStorage.ts 预留模块）。
   * Mojang 相关 Bug/Feature Request 未解决前此字段无实际效果。
   */
  container?: (SerializedItemStack | null)[];
}

/** 假人持久化记录，通过 world.setDynamicProperty 存储为 JSON */
export interface BotRecord {
  /** 假人唯一名（同时也是 SimulatedPlayer 的 name） */
  name: string;
  /**
   * 主人玩家名（创建者）。玩家重连后实体 ID 会变但 name 稳定，故只存 name。
   * 为空 = 无主假人（存量数据迁移），仅管理员可管理。
   */
  ownerName?: string;
  /** 是否在线（false = 离线/死亡离线，重启后加载时默认 false） */
  online: boolean;
  /** 是否死亡 */
  death: boolean;
  /** SimulatedPlayer 的实体 ID（在线时有效，死亡/离线后清空） */
  entityId?: string;
  /** 持久化的标签列表（上线时通过 syncEntityTags 恢复） */
  tags: string[];
  /**
   * 工作模式（用户拍板命名：互斥单选——一个假人一个工作模式）：
   * "none" = 无 / "wander" = 闲逛模式 / "mine" = 定点挖掘模式 /
   * "place" = 定点放置模式 / "attack" = 定点攻击模式 / "raid" = 劫掠模式 /
   * "fishing" = 自动钓鱼模式 / "woodcut" = 自动砍树模式。
   * 替代旧互斥行为标签 + 劫掠独立开关（互斥由单字段天然保证）。
   * 旧记录缺失 = "none"（升级兼容；aiBehavior 字段由迁移转换）。
   */
  workMode: string;
  /**
   * 砍树子模式（仅 workMode === "woodcut" 时有效）：
   * "logs" = 原木模式 / "collect" = 收集模式；缺省 "logs"。
   * 由 /mp:woodcutmode 设置；引擎注入大脑记忆驱动能力（core WoodcutRules 枚举）。
   */
  woodcutMode?: string;
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
  /**
   * 效果状态（buff 持久化；排除流程性效果；离线时效果暂停，
   * 上线恢复时用最后保存的剩余时长重新施加）。旧记录缺失 = 无效果（升级兼容）。
   */
  effects?: SerializedEffect[];
  /** 生成模式：normal=普通可转向 / chunkload=强加载不可转向 */
  spawnMode?: "normal" | "chunkload";
}

/**
 * NBT 存储绑定表：假人背包格/装备槽 → nbt-data-storage 槽位（slotId）。
 * **独立持久化**（不与 BotRecord 混存——事件驱动的绑定写穿与记录解耦，
 * 记录被覆盖不影响绑定）：key `mockplayer:players:<name>:bind`。
 * 槽位由库的 `put` 惰性分配（绝不与他人冲突），凭据 { regionId, slotId }
 * 完整 NBT 保留（潜影盒/收纳袋内容随真实 ItemStack 存取）。
 * key-value 对象结构：无 key = 未绑定（稀疏，不受数组长度约束）。
 */
export interface StorageBinding {
  /** 存储区域 ID（"维度token:区块X:区块Z"），本假人绑定槽所在区域 */
  regionId: string;
  /** 背包格号（字符串 key）→ slotId；无 key = 未绑定 */
  inv: Record<string, number>;
  /** 装备槽名 → slotId；无 key = 未绑定 */
  equip: Record<string, number>;
}

/** 回收预览——单个物品的展示信息 */
export interface ItemPreview {
  typeId: string;
  amount: number;
  nameTag?: string;
  damage?: number;
  maxDurability?: number;
  enchantments: SerializedEnchantment[];
}

/** 回收预览——表单展示用 */
export interface ReclaimPreview {
  xp: { level: number; totalXp: number } | null;
  mainhand: ItemPreview | null;
  offhand: ItemPreview | null;
  head: ItemPreview | null;
  chest: ItemPreview | null;
  legs: ItemPreview | null;
  feet: ItemPreview | null;
  /** 背包略写文字 */
  inventorySummary: string;
}

// ─── 全局配置 ──────────────────────────────────────────

/** 全局配置默认值：每玩家默认配额（管理员不受配额限制） */
export const DEFAULT_QUOTA = 5;

/** 模组菜单触发信物默认值（木棍） */
export const DEFAULT_MENU_TRIGGER_ITEM = "minecraft:stick";

/** 模组菜单触发信物选项（参考 item-route TOKEN_OPTIONS，默认木棍，null=无仅命令） */
export const MENU_TRIGGER_OPTIONS: readonly { label: string; itemId: string | null }[] = [
  { label: "§7无 (仅命令 /mp:menu)", itemId: null },
  { label: "§e木棍 (默认)", itemId: "minecraft:stick" },
  { label: "§e木锄", itemId: "minecraft:wooden_hoe" },
  { label: "§b鹦鹉螺壳", itemId: "minecraft:nautilus_shell" },
  { label: "§6唱片残片5", itemId: "minecraft:disc_fragment_5" },
  { label: "§b下界之星", itemId: "minecraft:nether_star" },
  { label: "§6烈焰粉", itemId: "minecraft:blaze_powder" },
  { label: "§f羽毛", itemId: "minecraft:feather" },
  { label: "§7燧石", itemId: "minecraft:flint" },
  { label: "§6烈焰棒", itemId: "minecraft:blaze_rod" },
  { label: "§b旋风棒", itemId: "minecraft:breeze_rod" },
  { label: "§f箭", itemId: "minecraft:arrow" },
];

/**
 * 全局配置（管理员菜单可改），单键 DP `mockplayer:config` 存储。
 * 纯可序列化数据，core 层定义，mc 层 McConfigStore 负责读写。
 */
export interface ModConfig {
  /** 每玩家默认可创建的假人数（0 = 禁止创建；管理员豁免） */
  defaultQuota: number;
  /** 逐玩家覆盖配额（key = 玩家名） */
  quotas: Record<string, number>;
  /** 额外管理员名单（非 OP 玩家，如服务器服主/协作管理） */
  admins: string[];
  /** 世界重启后是否自动上线之前在线的假人（管理员功能，默认开启） */
  autoOnlineOnRestart: boolean;
  /** 主人下线时是否联动下线其所属假人（默认不下线） */
  ownerOfflineAutoOffline: boolean;
  /** 各工作模式是否启用（key = workMode，true=启用；缺省全禁用） */
  enabledWorkModes?: Record<string, boolean>;
  /** 模组菜单触发信物物品 ID，null 表示关闭（仅命令触发） */
  menuTriggerItemId?: string | null;
}

/** 默认配置（早执行创建用；worldLoad 后从持久化 refresh 合并） */
export function createDefaultConfig(): ModConfig {
  return {
    defaultQuota: DEFAULT_QUOTA,
    quotas: {},
    admins: [],
    autoOnlineOnRestart: true,
    ownerOfflineAutoOffline: false,
    enabledWorkModes: {},
    menuTriggerItemId: DEFAULT_MENU_TRIGGER_ITEM,
  } as ModConfig;
}
