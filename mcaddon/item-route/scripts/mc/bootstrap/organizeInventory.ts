// ─── 背包整理装配：玩家主栏 → core Container 就地整理（潜行点非容器） ──
// 从组合根抽出的"背包整理"业务：把玩家主栏（槽 9~35）包装成 PlayerInventoryContainer，
// 走 OrganizeService.organizeStandalone（无仓库/无事件）。结果与容器整理同格式，
// 由 ToolInteractionController 用 formatOrganizeResult("背包") 展示。
import type { Player } from "@minecraft/server";
import type { OrganizeResult, OrganizeService } from "../../core/services/OrganizeService";
import { MoveJournal } from "../../core/routing/Move";
import type { McItemAdapter } from "../adapters/McItemAdapter";
import { PlayerInventoryContainer } from "../adapters/PlayerInventoryContainer";

/** 背包不可用（无 inventory 组件）时的占位结果——整理失败 */
const NO_INVENTORY_RESULT: OrganizeResult = {
  ok: false,
  moves: 0,
  beforeStacks: 0,
  afterStacks: 0,
  beforeTypes: 0,
  afterTypes: 0,
  totalSlots: 0,
  usedSlots: 0,
  messiness: {
    total: 0,
    order: 0,
    stack: 0,
    effectiveSlots: 0,
    disorderSlots: 0,
    nonEmptySlots: 0,
    suboptimalStacks: 0,
  },
  chaosAfter: 0,
  perType: {},
};

/**
 * 构造背包整理器（main.ts 装配进 deps.organizeInventory）。
 * @param organize - 整理服务（organizeStandalone 无事件变体）
 * @param item     - 物品适配器（PlayerInventoryContainer 的 NBT 堆叠判定/保留组件）
 * @returns 输入玩家 → 背包整理结果（与容器整理同格式）
 */
export function createInventoryOrganizer(
  organize: OrganizeService,
  item: McItemAdapter
): (player: Player) => OrganizeResult {
  return (player): OrganizeResult => {
    const inv = player.getComponent("inventory")?.container;
    if (inv === undefined) return NO_INVENTORY_RESULT;
    const adapter = new PlayerInventoryContainer(`player:${player.name}`, inv, item);
    return organize.organizeStandalone(adapter, new MoveJournal());
  };
}
