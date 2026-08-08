// ─── 仓库内物品搜索（基于通用容器索引，O(1) 命中） ──
// 需求（重构搜索模块）：
//   · **搜索基于通用容器索引构建**：仓库的 ItemIndex.byItem 即含 single/multi/misc 全角色桶，
//     搜索直接 O(1) 读 `lookupSearch(typeId)`；未激活（无索引）时退化为一次性倒排（结果一致）。
//   · **中文 / typeId / 英文模糊**：复用 ItemNameMap.searchItems（全量宇宙 + 中文名 + 英文回退）。
//   · **全命中不截断**：修复旧实现"前 N 个 typeId 截断导致下界合金系被金系挤掉"。
//   · **命中验证 + 自愈**：逐容器真实读取该 typeId 数量（索引 miss → 跳过并可由调用方 reconcile）。
//   · 结果不省略；容器展示最多 1 个、多余略写由 UI 层处理（见 SearchUI）。
// 纯逻辑（core 可单测，零 @minecraft/server 依赖）。
import type { Container } from "../model/Container";
import type { ItemId } from "../model/types";
import { searchItems, getChineseName } from "../data/ItemNameMap";

/** 搜索结果行：类型 / 中文名 / 数量汇总 / 命中的容器 id（按数量降序） */
export interface SearchHit {
  typeId: ItemId;
  name: string;
  count: number;
  containerIds: string[];
}

/** 搜索索引提供者：typeId → 该仓含此物/箱容器 ID（ItemIndex.lookupSearch；缺席时本地倒排 fallback） */
export type SearchLookup = (typeId: ItemId) => ContainerIdLike[];

type ContainerIdLike = string;

/** 一次性倒排（无索引兜底）：typeId → 容器 ID（跳过 input 在途源；misc 也纳入） */
export function buildSearchLookup(containers: Iterable<Container>): SearchLookup {
  const idx = new Map<ItemId, Set<string>>();
  for (const container of containers) {
    if (container.role === "input") continue;
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item === undefined) continue;
      const bucket = idx.get(item.itemId);
      if (bucket) bucket.add(container.id);
      else idx.set(item.itemId, new Set([container.id]));
    }
  }
  return (typeId: ItemId) => [...(idx.get(typeId) ?? [])];
}

/**
 * 搜索仓库内物品（核心入口）：
 * 1. `searchItems(query)` 全量宇宙（中文/typeId/英文）模糊匹配 → typeId 列表（**不截断**）
 * 2. 每 typeId 用 `lookup`（注入 ItemIndex.lookupSearch 或本地倒排）O(1) 找容器；
 *    逐容器真实读取该类型数量（比索引更可信；索引 miss 也验证到空 → 跳过）
 * 3. 返回 count>0 的行，按 count 降序（全列举、不省略）。
 *
 * @param containers - 仓库全部容器（可迭代，供真实数量读取）
 * @param lookup     - 搜索索引提供者（缺省用本地一次性倒排）
 * @param query      - 搜索关键词
 */
export function searchContainers(
  containers: Iterable<Container>,
  query: string,
  lookup?: SearchLookup
): SearchHit[] {
  const byId = new Map<string, Container>();
  for (const c of containers) byId.set(c.id, c);
  const resolve = lookup ?? buildSearchLookup(byId.values());
  const typeIds = searchItems(query);
  const hits: SearchHit[] = [];
  for (const typeId of typeIds) {
    let total = 0;
    const lines: { id: string; amount: number }[] = [];
    for (const cid of resolve(typeId)) {
      const container = byId.get(cid);
      if (container === undefined) continue;
      const amount = sumOfType(container, typeId);
      if (amount <= 0) continue; // 索引 miss 但真实无此类型 → 跳过
      lines.push({ id: cid, amount });
      total += amount;
    }
    if (total > 0) {
      // 命中容器按数量降序（展示取前 1 + 其余略写）
      hits.push({ typeId, name: getChineseName(typeId), count: total, containerIds: lines.map((l) => l.id) });
    }
  }
  return hits.sort((a, b) => b.count - a.count);
}

/** 单容器某 typeId 的数量汇总（逐槽累加） */
function sumOfType(container: Container, typeId: string): number {
  let sum = 0;
  for (let i = 0; i < container.capacity; i++) {
    const item = container.getItem(i);
    if (item !== undefined && item.itemId === typeId) sum += item.amount;
  }
  return sum;
}