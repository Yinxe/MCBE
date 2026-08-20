// ─── 标签系统（core 层） ────────────────────────────────
// 纯逻辑：标签定义、分组、四级解析。实体同步（syncEntityTags）在 mc 层。

import { TagDef, TAG_PREFIX } from "../Types";

// ─── 标签定义 ──────────────────────────────────────────

// 可共存的标签（可同时拥有多个）
export const TAG_BOT: TagDef = { label: "假人标识", value: `${TAG_PREFIX}bot` };
export const TAG_RESPAWN: TagDef = { label: "自动重生", value: `${TAG_PREFIX}respawn` };
// 已禁用：自动跳跃功能已移除（保留定义仅为旧存档兼容，UI与行为引擎不再使用）
// export const TAG_AUTO_JUMP: TagDef = { label: "自动跳跃", value: `${TAG_PREFIX}autoJump` };
export const TAG_AUTO_JUMP: TagDef = { label: "自动跳跃[已禁用]", value: `${TAG_PREFIX}autoJump` };

// 互斥的标签（同一时间只能有一个生效）
// ⚠️ 旧行为标签（用户拍板：行为标签机制已删除——行为统一走生物 AI 行为
//   record.workMode 字段（工作模式单选，用户拍板）。以下定义**保留仅供
//   legacy 引擎内部使用**（features/state/behavior.ts 的 autoAttack/control/
//   autoJump 等标签行为 + legacy/ai/BotBrain 的宝库/劫掠/钓鱼），
//   不再参与 UI 行为选择、不再进互斥组。
export const TAG_IDLE: TagDef = { label: "空闲", value: `${TAG_PREFIX}idle` };
export const TAG_AUTO_MINE: TagDef = { label: "自动挖掘", value: `${TAG_PREFIX}autoMine` };
export const TAG_AUTO_PLACE: TagDef = { label: "自动放置", value: `${TAG_PREFIX}autoPlace` };
export const TAG_AUTO_ATTACK: TagDef = { label: "自动攻击", value: `${TAG_PREFIX}autoAttack` };
export const TAG_CONTROL: TagDef = { label: "体态控制", value: `${TAG_PREFIX}control` };
export const TAG_AUTO_USE: TagDef = { label: "使用物品", value: `${TAG_PREFIX}autoUse` };
export const TAG_VAULT_MODE: TagDef = { label: "宝库模式", value: `${TAG_PREFIX}vaultMode` };
export const TAG_FISH_MODE: TagDef = { label: "自动钓鱼", value: `${TAG_PREFIX}fishMode` };
export const TAG_WANDER_MODE: TagDef = { label: "随机游走", value: `${TAG_PREFIX}wanderMode` };
// ⚠️ TAG_RAID_MODE 已删除：劫掠模式收编进工作模式单选（workMode="raid"），
//   旧存档中的 raidMode 标签由迁移转换并清理。

/** 可共存的标签组（自动跳跃已移除，仅保留自动重生） */
export const COEXIST_TAGS: TagDef[] = [TAG_BOT, TAG_RESPAWN];

/** 互斥的标签组（行为标签机制已删除——现为空；保留集合供校验兼容） */
export const EXCLUSIVE_TAGS: TagDef[] = [];

/** 独立开关标签组（与互斥/共存标签均可并存，各自独立的持久开关）——
 *  ⚠️ 劫掠模式已收编进工作模式单选（workMode="raid"），现为空；
 *    保留组定义供校验兼容。 */
export const STANDALONE_TAGS: TagDef[] = [];

/** 旧行为标签组（legacy 引擎内部使用——autoAttack/control/宝库/钓鱼等仍按标签
 *  驱动；保留定义与解析能力，但不参与互斥、不进入 UI 行为选择） */
export const LEGACY_TAGS: TagDef[] = [
  TAG_IDLE, TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_AUTO_ATTACK, TAG_CONTROL, TAG_AUTO_USE,
  TAG_VAULT_MODE, TAG_FISH_MODE, TAG_WANDER_MODE, TAG_AUTO_JUMP,
];

/** 所有已定义的标签 */
export const ALL_TAGS: TagDef[] = [...COEXIST_TAGS, ...STANDALONE_TAGS, ...EXCLUSIVE_TAGS, ...LEGACY_TAGS];

/** 新的假人默认拥有的标签（value 列表） */
export const DEFAULT_TAGS: string[] = [TAG_BOT.value, TAG_RESPAWN.value, TAG_IDLE.value];

/** 互斥标签的 value 集合，用于快速判断 */
export const EXCLUSIVE_SET: Set<string> = new Set(EXCLUSIVE_TAGS.map((t) => t.value));

/** 独立开关标签的 value 集合，用于快速判断 */
export const STANDALONE_SET: Set<string> = new Set(STANDALONE_TAGS.map((t) => t.value));

/** 假人基础标识标签值（字符串快捷引用，等价于 TAG_BOT.value） */
export const BOT_TAG = TAG_BOT.value;

// ─── 标签查询 ──────────────────────────────────────────

export function getTagDef(value: string): TagDef | undefined {
  return ALL_TAGS.find((t) => t.value === value);
}

/** 根据用户输入的文本解析出对应的 TagDef（支持 value / label / 短名） */
export function resolveTag(input: string): TagDef | undefined {
  // 1. 精确匹配 value
  let tag = ALL_TAGS.find((t) => t.value === input);
  if (tag) return tag;

  // 2. 精确匹配 label
  tag = ALL_TAGS.find((t) => t.label === input);
  if (tag) return tag;

  // 3. 作为短名匹配（自动补前缀）
  const prefixed = input.startsWith(TAG_PREFIX) ? input : `${TAG_PREFIX}${input}`;
  tag = ALL_TAGS.find((t) => t.value === prefixed);
  if (tag) return tag;

  // 4. 忽略大小写匹配
  const lower = input.toLowerCase();
  tag = ALL_TAGS.find((t) => t.value.toLowerCase() === `${TAG_PREFIX}${lower}`);
  if (tag) return tag;

  return undefined;
}

/** 标签分组结构（mc 层据此做带色渲染） */
export interface TagGroups {
  coexist: TagDef[];
  standalone: TagDef[];
  exclusive: TagDef[];
}

/** 获取全部标签的分组结构 */
export function getTagGroups(): TagGroups {
  return { coexist: COEXIST_TAGS, standalone: STANDALONE_TAGS, exclusive: EXCLUSIVE_TAGS };
}

// ─── 行为表单标签计算（core 纯函数，可单测） ────────────

/** 行为菜单表单输入（勾选的共存标签）——
 *  工作模式已统一走 record.workMode 字段（单选互斥），不再用标签 */
export interface BehaviorFormInput {
  /** 勾选的共存标签（不含 bot 标识标签） */
  coexist: string[];
}

/**
 * 由行为菜单表单输入计算完整新标签集（含 bot 标识标签）。
 * 工作模式机制下标签只剩：bot 标识 + 共存勾选（劫掠/行为标签均已收编）。
 * 兜底保留空闲标签（新假人默认带 idle；表单提交是全量替换标签集，
 * 不兜底会静默剥离 idle——与 control.ts 的"互斥/独立标签兜底补 idle"
 * 语义对齐，审核 M2）。
 */
export function computeTagsFromBehaviorForm(input: BehaviorFormInput): string[] {
  return [TAG_BOT.value, ...input.coexist, TAG_IDLE.value];
}

// ─── 标签集校验（core 纯函数，可单测） ─────────────────

/** 所有已定义标签的 value 集合（未知标签校验用） */
const ALL_TAG_VALUES: Set<string> = new Set(ALL_TAGS.map((t) => t.value));

/**
 * 过滤未知标签（数据迁移用）：只保留已定义标签。
 * 场景：已删除定义的历史标签持久化在假人数据里，
 * 会导致 setTags 校验拒绝（"包含未知标签"）——启动迁移时清理。
 * @param tags 待清理的标签集
 * @returns 仅含已定义标签的集合（保持原顺序）
 */
export function filterKnownTags(tags: string[]): string[] {
  return tags.filter((t) => ALL_TAG_VALUES.has(t));
}

/**
 * 校验完整标签集是否合法（setTags 的唯一入口校验，先全通过再落库）：
 * 1. 所有标签必须是已定义的（未知标签拒绝，防手滑拼错 / 防脏数据写入）；
 * 2. 假人标识标签（BOT_TAG）不可缺失——移除后实体不再被识别为假人；
 * 3. 互斥标签（EXCLUSIVE_TAGS）同一时间最多一个。
 * @param tags 待校验的完整标签集
 * @returns 拒绝原因（不合法时）；undefined = 合法
 */
export function validateTagSet(tags: string[]): string | undefined {
  const unknown = tags.filter((t) => !ALL_TAG_VALUES.has(t));
  if (unknown.length > 0) {
    return `包含未知标签: ${unknown.join(", ")}`;
  }
  if (!tags.includes(BOT_TAG)) {
    return "假人标识标签不可移除";
  }
  const exclusives = tags.filter((t) => EXCLUSIVE_SET.has(t));
  if (exclusives.length > 1) {
    return `互斥标签不能同时存在: ${exclusives.join(", ")}`;
  }
  return undefined;
}
