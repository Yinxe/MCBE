// ─── 工具与主手策略纯逻辑（domain） ───
// 决策全在此（可单测），容器读写在 engine/Wielder。typeId 字符串进出。

/** 重点关注的精确工具 id */
export const EXACT_TOOL_IDS: readonly string[] = ["minecraft:fishing_rod", "minecraft:trident", "minecraft:shears"];
/** 工具后缀（覆盖全部材料：钻石/铁/金/木/石/下界合金） */
export const TOOL_SUFFIXES: readonly string[] = ["_pickaxe", "_axe", "_sword", "_hoe", "_shovel"];

/** 耐久警戒线：百分比（<5% 触发守护） */
export const HEALTH_PERCENT_THRESHOLD = 5;
/** 耐久警戒线：绝对点数（兜底低最大耐久工具，如木剑/钓鱼竿） */
export const HEALTH_ABSOLUTE_THRESHOLD = 10;
/** 主手固定位（工具守护替换后固定 slot 0） */
export const GUARD_MAINHAND_SLOT = 0;

/** 是否受耐久守护关注的工具 */
export function isWatchedTool(typeId: string): boolean {
  if (EXACT_TOOL_IDS.includes(typeId)) return true;
  return TOOL_SUFFIXES.some((s) => typeId.endsWith(s));
}

/** 耐久快照（无耐久组件传 undefined → 视为健康） */
export interface DurabilitySnapshot {
  damage?: number;
  maxDurability?: number;
  unbreakable?: boolean;
}

/**
 * 耐久是否告急：百分比 <5% 或剩余 <10 点（双重保障）。
 * 字段缺失/无组件/不可破坏视为健康（返回 false）。
 */
export function isDurabilityCritical(d: DurabilitySnapshot): boolean {
  if (d.unbreakable) return false;
  if (d.damage === undefined || d.maxDurability === undefined) return false;
  const remaining = d.maxDurability > 0 ? d.maxDurability - d.damage : 100;
  const percent = d.maxDurability > 0 ? (remaining / d.maxDurability) * 100 : 100;
  return percent < HEALTH_PERCENT_THRESHOLD || remaining < HEALTH_ABSOLUTE_THRESHOLD;
}

/**
 * 同类替代品检索：typeId 完全相同且排除 excludeSlot，并过 isHealthy 健康闸
 * （只比 typeId 会换上残次品，导致守护反复触发）；无则 -1。
 */
export function findReplacementIndex(
  items: (string | null)[],
  targetTypeId: string,
  excludeSlot: number,
  isHealthy: (slot: number) => boolean
): number {
  for (let i = 0; i < items.length; i++) {
    if (i === excludeSlot) continue;
    if (items[i] === targetTypeId && isHealthy(i)) return i;
  }
  return -1;
}

/** 空槽检索（排除主手位）；无则 -1 */
export function findEmptySlotIndex(items: (string | null)[], handSlot: number): number {
  for (let i = 0; i < items.length; i++) {
    if (i === handSlot) continue;
    if (items[i] === null) return i;
  }
  return -1;
}

/** 兜底任意槽（36 格背包总能找到；排除 handSlot）；理论不可达返回 handSlot */
export function findAnySlotIndex(items: (string | null)[], handSlot: number): number {
  for (let i = 0; i < items.length; i++) {
    if (i !== handSlot) return i;
  }
  return handSlot;
}

/**
 * 保护性收起的目标槽：目标落主手固定位且主手位非 handSlot 时向后扫首个
 * 非 handSlot 槽（防受损工具经 swap 回到主手，保护失效）。
 */
export function pickStowSlot(items: (string | null)[], handSlot: number): number {
  const empty = findEmptySlotIndex(items, handSlot);
  const target = empty >= 0 ? empty : findAnySlotIndex(items, handSlot);
  if (target === GUARD_MAINHAND_SLOT && handSlot !== GUARD_MAINHAND_SLOT) {
    for (let i = target + 1; i < items.length; i++) {
      if (i !== handSlot) return i;
    }
  }
  return target;
}

/**
 * 守护替换的交换计划：candidate 已在主手位时只切选中、不做交换（swap(0,0)
 * 自交换会把受损工具留主手）。
 * @returns 需执行的交换对序列（[a,b] 表示互换），及是否仅需切换选中槽
 */
export function planGuardSwap(
  handSlot: number,
  candidateSlot: number,
  mainhandSlot: number = GUARD_MAINHAND_SLOT
): { swaps: [number, number][]; selectMainhand: boolean } {
  if (candidateSlot === mainhandSlot) return { swaps: [], selectMainhand: true };
  if (handSlot !== mainhandSlot)
    return {
      swaps: [
        [mainhandSlot, handSlot],
        [mainhandSlot, candidateSlot],
      ],
      selectMainhand: true,
    };
  return { swaps: [[mainhandSlot, candidateSlot]], selectMainhand: true };
}

/** 主手清空可行性 = 存在非主手空槽 */
export function canClearMainhand(items: (string | null)[], handSlot: number): boolean {
  for (let i = 0; i < items.length; i++) {
    if (i !== handSlot && items[i] === null) return true;
  }
  return false;
}

/** 槽位展示名（1-based：热栏1-9 / 背包10+） */
export function slotLabel(index: number): string {
  return index < 9 ? `热栏${index + 1}` : `背包${index + 1}`;
}
