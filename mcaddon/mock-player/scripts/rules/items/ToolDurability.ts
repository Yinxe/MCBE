// ─── 工具规则（core 层） ────────────────────────────────
// 纯逻辑：工具类别识别、耐久健康判定、替换/空槽搜索（容器无关的数组版）。
// 容器实体读写由 mc 层完成，这里只做基于数据的决策。

// ─── 配置常量 ──────────────────────────────────────────

/** 耐久百分比阈值：低于此值触发补充 */
export const HEALTH_PERCENT_THRESHOLD = 5;

/** 剩余耐久绝对值阈值：低于此值触发补充（兜底低最大耐久工具，如木剑/钓鱼竿） */
export const HEALTH_ABSOLUTE_THRESHOLD = 10;

// ─── 工具识别 ──────────────────────────────────────────

export interface ToolPattern {
  suffix: string;
  label: string;
}

const TOOL_PATTERNS: ToolPattern[] = [
  { suffix: "_pickaxe", label: "镐" },
  { suffix: "_axe", label: "斧" },
  { suffix: "_sword", label: "剑" },
  { suffix: "_hoe", label: "锄" },
  { suffix: "_shovel", label: "锹" },
];

/** 判断是否为需关注的耐久工具，返回工具描述信息 */
export function identifyTool(typeId: string): ToolPattern | undefined {
  if (typeId === "minecraft:fishing_rod") return { suffix: "fishing_rod", label: "钓鱼竿" };
  if (typeId === "minecraft:trident") return { suffix: "trident", label: "三叉戟" };
  if (typeId === "minecraft:shears") return { suffix: "shears", label: "剪刀" };
  for (const p of TOOL_PATTERNS) {
    if (typeId.endsWith(p.suffix)) return p;
  }
  return undefined;
}

// ─── 耐久检查 ──────────────────────────────────────────

/**
 * 检查物品耐久是否健康（基于耐久组件数值）
 * @param damage 当前损伤值（无耐久组件时传 undefined）
 * @param maxDurability 最大耐久（无耐久组件时传 undefined）
 * @param unbreakable 是否不可破坏
 * @returns true = 无需处理（健康或非耐久物品）；false = 耐久不足需要补充
 */
export function isToolHealthy(
  damage: number | undefined,
  maxDurability: number | undefined,
  unbreakable: boolean | undefined
): boolean {
  if (damage === undefined || maxDurability === undefined) return true;
  if (unbreakable) return true;

  const remaining = maxDurability - damage;
  const healthPercent = maxDurability > 0 ? (remaining / maxDurability) * 100 : 100;

  const lowHealth = healthPercent < HEALTH_PERCENT_THRESHOLD;
  const lowAbsolute = remaining < HEALTH_ABSOLUTE_THRESHOLD;
  return !(lowHealth || lowAbsolute);
}

// ─── 背包扫描（数组版搜索，容器无关） ─────────────────────

/**
 * 从物品数组中查找与 typeId 相同且健康的物品
 * 同类定义：typeId 完全相同（同材料同类型）
 * @param items 物品数组（index = slot，null = 空位）
 * @param isHealthy 单个物品的健康判定（由调用方基于实际物品模型实现）
 */
export function findReplacementIndex<T extends { typeId: string }>(
  items: ReadonlyArray<T | null>,
  typeId: string,
  excludeSlot: number,
  isHealthy: (item: T) => boolean
): number | undefined {
  for (let i = 0; i < items.length; i++) {
    if (i === excludeSlot) continue;
    const item = items[i];
    if (!item) continue;
    if (item.typeId !== typeId) continue;
    if (isHealthy(item)) return i;
  }
  return undefined;
}

/** 查找空 slot（不含排除槽位） */
export function findEmptySlotIndex<T>(items: ReadonlyArray<T | null>, excludeSlot: number): number | undefined {
  for (let i = 0; i < items.length; i++) {
    if (i === excludeSlot) continue;
    if (!items[i]) return i;
  }
  return undefined;
}

/** 查找任意非排除槽位（36 格背包总能找到一个） */
export function findAnySlot(excludeSlot: number, containerSize: number): number {
  for (let i = 0; i < containerSize; i++) {
    if (i !== excludeSlot) return i;
  }
  return 0;
}