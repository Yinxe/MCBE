/**
 * ============================================================================
 * ItemNameMap —— Minecraft 物品 ID 与中文名的双向映射
 * ============================================================================
 *
 * 职责：
 * 1. 以 @minecraft/vanilla-data 的 MinecraftItemTypes 为**权威全量 ID 来源**（1.21.94 世代）
 * 2. 提供 typeId→中文名映射（来自 name-maps 预计算映射表；未覆盖条目回退英文可读名）
 * 3. 提供中文名→typeId 的反向模糊搜索索引
 * 4. `searchItems` 搜索**全量物品宇宙**（MinecraftItemTypes 全部 typeId ∪ 预计算表补集）：
 *    · 按 typeId 精确/子串（如 "raw_iron" / "raw"）
 *    · 按中文名模糊（如 "粗铁"）
 *    · 未覆盖条目的英文可读名模糊（如 "Raw Iron"）
 *    解决"物品多选器搜不到粗铁等物品"——预计算表只覆盖部分条目，全量宇宙必须从游戏枚举取。
 *
 * 数据来源：
 * name-maps/ 目录下的预计算映射表，由 AI 从 zh_CN.json 手工抄写验算。
 * typeId 权威集 = @minecraft/vanilla-data（纯数据包，零 @minecraft/server 运行时依赖，
 * core 层可 node 测试；esbuild 打包时内联进 main.js，无需额外 manifest 模块）。
 * ============================================================================
 */

import { MinecraftItemTypes } from "@minecraft/vanilla-data";
import { itemsMap } from "./name-maps/index";

// ─── 公开常量 ───────────────────────────────────────────────────

/**
 * 物品 ID → 中文名的完全映射表。
 * 所有 key 均来自 MinecraftItemTypes，value 来自 zh_CN.json（或英文回退）。
 */
export const ITEM_NAME_MAP: Readonly<Record<string, string>> = itemsMap;

/**
 * 全量物品宇宙 typeId[]（去重排序）：MinecraftItemTypes 全部值 ∪ 预计算表补集。
 * 搜索/枚举以它为准——保证 1.21.94 世代所有物品可搜（含 raw_iron / wolf_armor / trial_key 等）。
 */
export const FULL_ITEM_IDS: readonly string[] = /* @__PURE__ */ buildFullUniverse();

/**
 * 中文名（小写）→ typeId 列表的反向搜索索引。
 * 在模块首次加载时从 ITEM_NAME_MAP 构建。
 */
export const NAME_INDEX: Map<string, string[]> = /* @__PURE__ */ buildNameIndex(ITEM_NAME_MAP);

/**
 * 未覆盖条目的英文可读名（小写）→ typeId 列表（搜索兜底；如 "raw iron" → raw_iron）。
 */
export const ENGLISH_NAME_INDEX: Map<string, string[]> = /* @__PURE__ */ buildEnglishIndex();

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
 * 搜索匹配**全量物品宇宙**（typeId 子串 / 中文名 / 英文回退名 的模糊搜索）。
 *
 * 搜索策略（按优先级）：
 * - 按 typeId 精确匹配（minecraft:xxx）
 * - 按 typeId 子串匹配
 * - 按中文名模糊匹配（预计算表）
 * - 按英文可读名模糊匹配（未覆盖条目回退）
 *
 * @param query - 搜索查询
 * @returns 匹配的 typeId 数组（无重复，按字母排序）
 */
export function searchItems(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = new Set<string>();

  // 1. typeId 精确/前缀匹配（全量宇宙）
  if (q.startsWith("minecraft:")) {
    if (FULL_ITEM_IDS.includes(q)) results.add(q);
    for (const typeId of FULL_ITEM_IDS) {
      if (typeId.startsWith(q)) results.add(typeId);
    }
    return [...results].sort();
  }

  // 2. typeId 部分匹配（全量宇宙，含英文子串如 "raw"）
  for (const typeId of FULL_ITEM_IDS) {
    if (typeId.includes(q)) results.add(typeId);
  }

  // 3. 中文名模糊匹配（预计算表）
  for (const [name, typeIds] of NAME_INDEX) {
    if (name.includes(q)) {
      for (const id of typeIds) results.add(id);
    }
  }

  // 4. 未覆盖条目英文可读名模糊匹配（如 "raw iron" → raw_iron）
  for (const [english, typeIds] of ENGLISH_NAME_INDEX) {
    if (english.includes(q)) {
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

/** 全量物品宇宙：MinecraftItemTypes 值 ∪ 预计算表 key，去重排序 */
function buildFullUniverse(): string[] {
  const set = new Set<string>(Object.values(MinecraftItemTypes));
  for (const id of Object.keys(ITEM_NAME_MAP)) set.add(id);
  return [...set].sort();
}

/** 全部宇宙条目的英文可读名（小写）→ typeId 索引（含已中文条目，供英文关键词搜索） */
function buildEnglishIndex(): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const typeId of FULL_ITEM_IDS) {
    const key = typeIdToEnglish(typeId).toLowerCase();
    const existing = idx.get(key);
    if (existing) existing.push(typeId);
    else idx.set(key, [typeId]);
  }
  return idx;
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