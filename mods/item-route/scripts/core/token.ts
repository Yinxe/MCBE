// ─── 信物判定（纯函数，零 MC 依赖，可单测） ────────────────
// 信物是模组专属的数据驱动物品，typeId 固定为 `itemroute:warehouse_token`。
// 这里是「什么是信物」的唯一事实来源：判定、发放、UI 提示、测试全部引用本常量，
// 避免字符串散落多处。
//
// ⚠️ 语义变更（相对旧版）：
//   旧版信物是**可配置的原版物品**（默认木锄），管理员可切换 12 种原版物品。
//   现在信物是固定 typeId，任何原版物品都不再是信物。
import type { ItemId } from "./model/types";

/**
 * 信物物品 typeId。
 *
 * 与行为包 `behavior_packs/item-route/items/warehouse_token.json` 的
 * `minecraft:item.description.identifier` 必须完全一致；改一处必须同时改另一处。
 * `tests/token.test.ts` 有一致性用例守着这条约束。
 */
export const TOKEN_TYPE_ID = "itemroute:warehouse_token";

/**
 * 判断某个物品 typeId 是否为仓库信物。
 *
 * 判定是**严格相等**：不做大小写归一、不做命名空间补全。
 * 理由：Bedrock 的 typeId 恒为小写且恒带命名空间，归一化只会掩盖物品定义写错的问题。
 *
 * @param itemTypeId - 物品 typeId（可能为空串，表示手上没东西）
 * @returns 是信物返回 true
 */
export function isWarehouseToken(itemTypeId: ItemId | undefined): boolean {
  return itemTypeId === TOKEN_TYPE_ID;
}

// ─── 发放决策（纯函数，零 MC 依赖） ──────────────────────────
// 放在 core 而不是 mc/token.ts 的原因：mc 层顶层 import @minecraft/server，
// node --test 加载不了；而「已持有怎么办 / 背包满怎么办」恰恰是最该被测的分支。

/** 发放结果：已持有 / 放入背包 / 溢出到地面 / 无法读取背包 */
export type GiveOutcome = "already-has" | "into-inventory" | "dropped" | "unavailable";

/** 发放决策的纯输入（不依赖真实 Player/Container） */
export interface GiveDecisionInput {
  /** 背包里是否已有信物 */
  alreadyHas: boolean;
  /** 是否存在空槽位 */
  hasEmptySlot: boolean;
  /** 能否读到玩家背包（半初始化/离线实体读不到） */
  containerReadable: boolean;
}

/**
 * 决定发放行为。
 *
 * 顺序关键：先判「已持有」——信物是工具不是资源，重复发放无收益且会占背包；
 * 再判「能否读背包」，读不到就什么都做不了；最后才按空位选择入包还是落地。
 */
export function decideGiveOutcome(input: GiveDecisionInput): GiveOutcome {
  if (input.alreadyHas) return "already-has";
  if (!input.containerReadable) return "unavailable";
  return input.hasEmptySlot ? "into-inventory" : "dropped";
}
