// ─── 投射物认主规则（domain 纯逻辑） ────
// 双任认主模型：mp:owner:<name>（第一任=实际投掷者，不可变）、
// mp:owner2:<name>（第二任，仅假人可被覆盖复写）。
// mp:item:<name> 为投掷瞬间的附魔/耐久快照：投射物实体无可读物品组件，只能投掷时记。
// 玩家用 name、假人用仲裁名作 tag 标识；tag 跨重启存于实体，按名字而非 botId 归属。

/** 追踪投射物类型（arrow 含药水箭，API 无法细分） */
export const TRACKED_PROJECTILE_IDS: readonly string[] = ["minecraft:thrown_trident", "minecraft:arrow"];

const OWNER_PREFIX = "mp:owner:";
const OWNER2_PREFIX = "mp:owner2:";
const ITEM_PREFIX = "mp:item:";
const FISHER_PREFIX = "mp:fisher:";

/** 第一任认主 tag（投掷即打，不可变） */
export function makeOwnerTag(name: string): string {
  return `${OWNER_PREFIX}${name}`;
}

/** 第二任 tag（可被后续假人覆盖复写） */
export function makeOwner2Tag(name: string): string {
  return `${OWNER2_PREFIX}${name}`;
}

/** 鱼钩认主 tag（钓鱼浮漂归属） */
export function makeFisherTag(name: string): string {
  return `${FISHER_PREFIX}${name}`;
}

/** 物品信息快照 tag：mp:item:<enchPart>[|<cur/max>] */
export function encodeItemTag(
  enchantments: { id: string; level: number }[],
  durability?: { current: number; max: number }
): string {
  const enchPart = enchantments.map((e) => `${e.id}:${e.level}`).join(",");
  const durPart = durability ? `|${Math.max(0, durability.current)}/${durability.max}` : "";
  return `${ITEM_PREFIX}${enchPart}${durPart}`;
}

/** 解码物品信息 tag（附魔展示降级用；解析失败给空结构不抛） */
export function decodeItemTag(tag: string): {
  enchantments: { id: string; level: number }[];
  durability?: { current: number; max: number };
} {
  if (!tag.startsWith(ITEM_PREFIX)) return { enchantments: [] };
  const [enchPart, durPart] = tag.slice(ITEM_PREFIX.length).split("|");
  const enchantments = (enchPart ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => {
      const idx = s.lastIndexOf(":");
      if (idx <= 0) return undefined;
      const level = Number(s.slice(idx + 1));
      return Number.isFinite(level) ? { id: s.slice(0, idx), level } : undefined;
    })
    .filter((e): e is { id: string; level: number } => e !== undefined);
  let durability: { current: number; max: number } | undefined;
  if (durPart) {
    const [cur, max] = durPart.split("/").map(Number);
    if (Number.isFinite(cur) && Number.isFinite(max)) durability = { current: cur!, max: max! };
  }
  return { enchantments, durability };
}

/** 从实体 tag 集合解析双任归属 */
export function parseOwnerTags(tags: string[]): { firstOwner?: string; secondOwner?: string; itemTag?: string } {
  let firstOwner: string | undefined;
  let secondOwner: string | undefined;
  let itemTag: string | undefined;
  for (const t of tags) {
    if (t.startsWith(OWNER2_PREFIX)) secondOwner = t.slice(OWNER2_PREFIX.length);
    else if (t.startsWith(OWNER_PREFIX)) firstOwner = t.slice(OWNER_PREFIX.length);
    else if (t.startsWith(ITEM_PREFIX)) itemTag = t;
  }
  return { firstOwner, secondOwner, itemTag };
}

/**
 * 认主优先级：第二任（仅假人）在线 > 第一任在线 > 都不动（等上线夺回）。
 * @param onlineOf - 名字→是否在线探针（engine 注入）
 */
export function resolveClaimOwner(
  firstOwner: string | undefined,
  secondOwner: string | undefined,
  onlineOf: (name: string) => boolean
): string | undefined {
  if (secondOwner && onlineOf(secondOwner)) return secondOwner;
  if (firstOwner && onlineOf(firstOwner)) return firstOwner;
  return undefined;
}

/** 家族归属判定：第一/第二任任一命中 {主人名 ∪ 主人名下假人名} 即自家 */
export function isFamilyOwned(
  firstOwner: string | undefined,
  secondOwner: string | undefined,
  familyNames: Set<string>
): boolean {
  return (
    (firstOwner !== undefined && familyNames.has(firstOwner)) ||
    (secondOwner !== undefined && familyNames.has(secondOwner))
  );
}

// ─── 聚簇分组（UI 扫描纯几何） ──

/** 空间点（带实体 id） */
export interface ClusterPoint {
  id: string;
  x: number;
  y: number;
  z: number;
}

/**
 * 链式连通聚簇：距离 ≤ radius 即同组（单链接传递）。
 * @returns 组间按规模降序、组内按邻居密度降序的点集
 */
export function clusterPoints(points: ClusterPoint[], radius: number): ClusterPoint[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!,
        b = points[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= radius) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, ClusterPoint[]>();
  points.forEach((p, i) => {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(p);
    groups.set(root, g);
  });
  return [...groups.values()]
    .map((g) => {
      const density = neighborDensity(g, radius);
      return [...g].sort((a, b) => (density.get(b.id) ?? 0) - (density.get(a.id) ?? 0));
    })
    .sort((a, b) => b.length - a.length);
}

/** 邻居密度归一化（0-1，聚集概率展示用） */
export function neighborDensity(points: ClusterPoint[], radius: number): Map<string, number> {
  const out = new Map<string, number>();
  const max = Math.max(1, points.length - 1);
  for (const a of points) {
    let n = 0;
    for (const b of points) {
      if (a === b) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= radius) n++;
    }
    out.set(a.id, n / max);
  }
  return out;
}
