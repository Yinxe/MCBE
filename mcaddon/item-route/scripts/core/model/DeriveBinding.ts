// ─── 单物绑定推导（core 纯函数，可单测） ──────────────────
import type { Container } from "./Container";
import type { ItemId } from "./types";

/**
 * 单物容器绑定 = 首个非空 slot 的物品类型。
 * 玩家可随时拿走/替换首个非空 slot 来破坏绑定，
 * 索引层通过此函数重算（含空箱重绑场景）。
 */
export function deriveBinding(container: Container): ItemId | undefined {
  return container.getDedicatedItemId();
}