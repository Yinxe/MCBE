// ─── 投掷物认主规则（core 层） ─────────────────────────
// 纯逻辑：双任主人 tag 设计、解析与优先级判定。
//
// 实体 tag 约定（投掷物 thrown_trident / arrow 上的持久标记）：
//   mp:owner:<name>   — 第一任主人（实际投掷者，玩家或假人）
//   mp:owner2:<name>  — 第二任主人（仅假人，可被后续假人覆盖复写）
//
// 认主优先级：第二任 > 第一任（fallback：第二任未上线时认第一任）。
// 旧格式 mp:trid:<name> 不做兼容。

/** 第一任主人 tag 前缀 */
export const OWNER_TAG_PREFIX = "mp:owner:";
/** 第二任主人 tag 前缀 */
export const OWNER2_TAG_PREFIX = "mp:owner2:";
/** 投掷物物品信息 tag 前缀（附魔/耐久编码，投掷时打上，认主 UI 解码展示） */
export const ITEM_TAG_PREFIX = "mp:item:";

/** 受认主机制覆盖的投掷物实体 typeId（arrow 含药水箭，API 无法细分） */
export const TRACKED_PROJECTILE_IDS = ["minecraft:thrown_trident", "minecraft:arrow"] as const;

/** 是否受认主机制跟踪的投掷物 */
export function isTrackedProjectile(typeId: string): boolean {
  return (TRACKED_PROJECTILE_IDS as readonly string[]).includes(typeId);
}

/** 投掷物 typeId → 中文展示名（认主 UI 无自定义名时兜底） */
export function projectileTypeLabel(typeId: string): string {
  if (typeId === "minecraft:thrown_trident") return "三叉戟";
  if (typeId === "minecraft:arrow") return "箭";
  return "投掷物";
}

/** 构建第一任主人 tag */
export function makeOwnerTag(name: string): string {
  return `${OWNER_TAG_PREFIX}${name}`;
}

/** 构建第二任主人 tag */
export function makeSecondOwnerTag(name: string): string {
  return `${OWNER2_TAG_PREFIX}${name}`;
}

/**
 * 构建投掷物物品信息 tag：`mp:item:<附魔id:等级,附魔id:等级|耐久cur/max>`
 * 投掷时从投掷者主手 ItemStack 提取编码（投射物实体无可读物品组件）。
 * 段说明：附魔段（可空）与耐久段（可空）以 | 分隔。
 */
export function makeItemTag(
  enchantments: readonly { id: string; level: number }[],
  durability?: { current: number; max: number }
): string {
  const enchPart = enchantments.map((e) => `${e.id}:${e.level}`).join(",");
  const durPart = durability ? `${durability.current}/${durability.max}` : "";
  return `${ITEM_TAG_PREFIX}${enchPart}|${durPart}`;
}

/** 解码投掷物物品信息 tag；非 mp:item: 前缀返回 undefined */
export function parseItemTag(tag: string): { enchantments: { id: string; level: number }[]; durability?: { current: number; max: number } } | undefined {
  if (!tag.startsWith(ITEM_TAG_PREFIX)) return undefined;
  const body = tag.slice(ITEM_TAG_PREFIX.length);
  const [enchPart = "", durPart = ""] = body.split("|");

  const enchantments: { id: string; level: number }[] = [];
  if (enchPart) {
    for (const seg of enchPart.split(",")) {
      const [id = "", levelStr = ""] = seg.split(":");
      const level = parseInt(levelStr, 10);
      if (id && !isNaN(level) && level > 0) enchantments.push({ id, level });
    }
  }

  let durability: { current: number; max: number } | undefined;
  if (durPart) {
    const [curStr = "", maxStr = ""] = durPart.split("/");
    const current = parseInt(curStr, 10);
    const max = parseInt(maxStr, 10);
    if (!isNaN(current) && !isNaN(max) && max > 0) durability = { current, max };
  }

  return { enchantments, durability };
}

/** 解析实体 tags 中的双任主人（不含旧格式；空名 tag 忽略） */
export function parseClaimTags(tags: readonly string[]): { firstOwner?: string; secondOwner?: string } {
  let firstOwner: string | undefined;
  let secondOwner: string | undefined;
  for (const tag of tags) {
    if (tag.startsWith(OWNER_TAG_PREFIX)) {
      const name = tag.slice(OWNER_TAG_PREFIX.length);
      if (name) firstOwner = name;
    } else if (tag.startsWith(OWNER2_TAG_PREFIX)) {
      const name = tag.slice(OWNER2_TAG_PREFIX.length);
      if (name) secondOwner = name;
    }
  }
  return { firstOwner, secondOwner };
}

/**
 * 判定投掷物是否属于某家族（自家三叉戟）。
 * 家族 = 主人名 ∪ 主人名下全部假人名；第一/第二任任一命中即算自家。
 */
export function isOwnedByFamily(
  firstOwner: string | undefined,
  secondOwner: string | undefined,
  family: ReadonlySet<string>
): boolean {
  return (firstOwner !== undefined && family.has(firstOwner))
    || (secondOwner !== undefined && family.has(secondOwner));
}

/**
 * 按优先级解析认主目标：第二任在线则认第二任，否则第一任在线认第一任。
 * @param isOnline 名字 → 是否在线（假人=registry 有 entityId；玩家=世界中存在）
 * @returns 应认主的名字；无人在线返回 undefined（等上线夺回）
 */
export function resolveClaimOwner(
  firstOwner: string | undefined,
  secondOwner: string | undefined,
  isOnline: (name: string) => boolean
): string | undefined {
  if (secondOwner && isOnline(secondOwner)) return secondOwner;
  if (firstOwner && isOnline(firstOwner)) return firstOwner;
  return undefined;
}