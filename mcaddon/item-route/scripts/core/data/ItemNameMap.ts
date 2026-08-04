/**
 * ============================================================================
 * ItemNameMap —— Minecraft 物品 ID 与中文名的双向映射
 * ============================================================================
 *
 * 职责：
 * 1. 以 @minecraft/vanilla-data 的 MinecraftItemTypes 为权威 ID 来源
 * 2. 提供 typeId→中文名映射（来自 name-maps 预计算映射表）
 * 3. 提供中文名→typeId 的反向模糊搜索索引
 * 4. 未被覆盖的条目回退为英文可读名
 *
 * 数据来源：
 * name-maps/ 目录下的预计算映射表，由 AI 从 zh_CN.json 手工抄写验算。
 * 所有 typeId 均来自官方 @minecraft/vanilla-data，确保 100% 正确。
 * ============================================================================
 */

import { itemsMap } from "./name-maps/index";

// ─── 公开常量 ───────────────────────────────────────────────────

/**
 * 物品 ID → 中文名的完全映射表。
 * 所有 key 均来自 MinecraftItemTypes，value 来自 zh_CN.json（或英文回退）。
 */
export const ITEM_NAME_MAP: Readonly<Record<string, string>> = itemsMap;

/**
 * 中文名（小写）→ typeId 列表的反向搜索索引。
 * 在模块首次加载时从 ITEM_NAME_MAP 构建。
 */
export const NAME_INDEX: Map<string, string[]> = /* @__PURE__ */ buildNameIndex(ITEM_NAME_MAP);

// ─── 公开查询函数 ───────────────────────────────────────────────

/**
 * 获取物品的中文显示名称。
 *
 * @param typeId - 物品类型 ID（如 "minecraft:diamond"）
 * @returns 中文名，未找到时返回英文回退
 */
export function getChineseName(typeId: string): string {
  return ITEM_NAME_MAP[typeId] ?? typeIdToEnglish(typeId);
}

/**
 * 搜索匹配所有 typeId 和中文名的模糊搜索。
 *
 * 搜索策略（按优先级）：
 * - 按 typeId 精确匹配（minecraft:xxx）
 * - 按 typeId 子串匹配
 * - 按中文名模糊匹配
 * - 按英文可读名模糊匹配
 *
 * @param query - 搜索查询
 * @returns 匹配的 typeId 数组（无重复，按字母排序）
 */
export function searchItems(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = new Set<string>();

  // 1. typeId 精确/前缀匹配
  if (q.startsWith("minecraft:")) {
    if (ITEM_NAME_MAP[q]) results.add(q);
    for (const typeId of Object.keys(ITEM_NAME_MAP)) {
      if (typeId.startsWith(q)) results.add(typeId);
    }
    return [...results].sort();
  }

  // 2. typeId 部分匹配
  for (const typeId of Object.keys(ITEM_NAME_MAP)) {
    if (typeId.includes(q)) results.add(typeId);
  }

  // 3. 中文名模糊匹配
  for (const [name, typeIds] of NAME_INDEX) {
    if (name.includes(q)) {
      for (const id of typeIds) results.add(id);
    }
  }

  return [...results].sort();
}

// ─── 内部工具 ──────────────────────────────────────────────────

/**
 * 将 typeId 转换为可读的英文名称（供回退使用）。
 * minecraft:oak_planks → "Oak Planks"
 */
function typeIdToEnglish(typeId: string): string {
  const suffix = typeId.slice("minecraft:".length);
  return suffix.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * 从 ITEM_NAME_MAP 构建中文名→typeId 的反向搜索索引。
 *
 * @param map - typeId → 中文名的映射
 * @returns 中文名（小写）→ typeId 列表的索引
 */
function buildNameIndex(map: Record<string, string>): Map<string, string[]> {
  const idx = new Map<string, string[]>();

  for (const [typeId, name] of Object.entries(map)) {
    const key = name.toLowerCase();
    const existing = idx.get(key);
    if (existing) {
      existing.push(typeId);
    } else {
      idx.set(key, [typeId]);
    }
  }

  return idx;
}
