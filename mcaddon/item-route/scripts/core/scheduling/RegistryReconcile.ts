// ─── 待补容器重载决策（纯函数，零 MC/@minecraft 依赖，可 node 单测） ──
// 容器补注册简单方案：加载/激活时某容器因区块未加载被跳过 → 记入仓库 pendingReloads，
// 主循环 pump 时对每个待补容器重新读方块，按结果三分支处置：
//   · skip      —— 方块仍读不到（区块未加载）→ 保留待补，下轮再试（**绝不误删**）
//   · remove    —— 方块已加载且空气，**或加载为非受支持容器类型**（容器真被拆/被换成杂物）
//                  → 移除注册表 + cids + 统计
//   · register  —— 方块已加载、非空气、且是**受支持容器类型** → 重建适配器注册进仓库 + 索引
// 用户定案要点：只认 `isSupportedContainerType` 白名单（箱子/陷阱箱/桶/漏斗/潜影盒）。
//   非容器方块不进入 register（工厂侧同样白名单，见 McContainerFactory）——否则非容器会掉进
//   register 分支、由 createEntry undefined 兜底删除，那条分支**漏清 cids 索引**（不对称）。
//   把"是否受支持容器"提前到决策层，非容器走统一 remove 分支（含 cids 修剪）。

import { isSupportedContainerType } from "../model/ContainerTypes";

/** 方块读取结果（仅看 isAir + typeId；undefined = 区块未加载/读取失败） */
export interface BlockView {
  readonly isAir: boolean;
  /** 方块类型 id（如 minecraft:chest / minecraft:anvil）——非受支持容器类型按 remove 处置 */
  readonly typeId: string;
}

/** 待补容器本轮处置 */
export type PendingDecision = "skip" | "remove" | "register";

/**
 * 决策：给定方块读取结果，判定本轮处置。
 * @param block undefined（区块未加载）→ skip；isAir → remove；非受支持容器类型 → remove；
 *               否则（受支持容器）→ register。
 */
export function decidePendingAction(block: BlockView | undefined): PendingDecision {
  if (block === undefined) return "skip";
  if (block.isAir) return "remove";
  return isSupportedContainerType(block.typeId) ? "register" : "remove";
}