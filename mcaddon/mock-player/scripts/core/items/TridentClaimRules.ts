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

/** 受认主机制覆盖的投掷物实体 typeId（arrow 含药水箭，API 无法细分） */
export const TRACKED_PROJECTILE_IDS = ["minecraft:thrown_trident", "minecraft:arrow"] as const;

/** 是否受认主机制跟踪的投掷物 */
export function isTrackedProjectile(typeId: string): boolean {
  return (TRACKED_PROJECTILE_IDS as readonly string[]).includes(typeId);
}

/** 构建第一任主人 tag */
export function makeOwnerTag(name: string): string {
  return `${OWNER_TAG_PREFIX}${name}`;
}

/** 构建第二任主人 tag */
export function makeSecondOwnerTag(name: string): string {
  return `${OWNER2_TAG_PREFIX}${name}`;
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