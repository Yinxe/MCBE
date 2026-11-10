// ─── 单物绑定推导（core 纯函数，可单测） ──────────────────
// 单物容器（single）的"绑定类型" = 首个非空槽位的物品类型。
// 玩家可能拿走/替换首个非空槽 → 绑定被破坏；策略侧惰性校验（SingleItemStrategy）
// 命中时会用此函数重算并调 ItemIndex.reconcile 修复绑定（惰性自愈，三层兜底之第二层）。
// 之所以拆成独立文件：让"绑定"语义有且仅有一个权威实现，可单独单测。
//
// ⚠️ 实现约束（防无限递归）：本函数必须**自行扫描**（firstNoEmptyItem + getItem），
// 不得回调 `container.getDedicatedItemId()`——mc 适配层的 getDedicatedItemId 正委托
// deriveBinding(this)，若这里再回调回去会无限相互递归（栈溢出，生产 single 必崩）。
import type { Container } from "./Container";
import type { ItemId } from "./types";

/**
 * 单物容器绑定 = 首个非空 slot 的物品类型。
 * 玩家可随时拿走/替换首个非空 slot 来破坏绑定，
 * 索引层通过此函数重算（含空箱重绑场景）。
 */
export function deriveBinding(container: Container): ItemId | undefined {
  const slot = container.firstNoEmptyItem();
  if (slot === undefined) return undefined;
  return container.getItem(slot)?.itemId;
}
