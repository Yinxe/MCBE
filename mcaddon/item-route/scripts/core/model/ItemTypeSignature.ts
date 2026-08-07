// ─── 容器"物品类型集合"签名（开/关箱变更检测用，core 纯函数） ──
// 玩家在容器 GUI 会话里手动改动物品类型时，没有逐格内容事件；我们靠"开箱记签名、
// 关箱对比签名是否变了"来判定要不要重建该容器索引。签名 = 容器内所有槽位 itemId 的
// 去重排序串联：
//   · 仅关心"类型存在性"（索引只记录某容器含哪些 typeId），数量/落槽变化不计。
//   · 排序保证签名对槽位顺序不敏感（两箱内容相同但摆放顺序不同 → 签名相等 → 不重建）。
// 此函数不感知 MC，可 node 单测（tests/item-typesignature.test.ts）。
import type { Container } from "./Container";

/**
 * 计算容器当前"物品类型集合"签名：所有非空槽位 itemId 去重后按字典序 join。
 * 开箱记录、关箱对比；相等 = 类型集合没变（不需要重建索引），不等 = 变化了。
 */
export function itemTypeSignature(container: Container): string {
  const ids = new Set<string>();
  for (let i = 0; i < container.capacity; i++) {
    const id = container.getItem(i)?.itemId;
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort().join("|");
}