// ─── 背包整理装配：玩家背包 2 阶段就地整理（潜行点非容器） ──
// 从组合根抽出的"背包整理"业务。走 OrganizeService.organizeStandalone（无仓库/无事件）。
//
// 2 阶段语义（用户可控）：
//   · 阶段一：优先整理**主栏（槽 9-35）**——主栏混乱度 > 0 时只整理主栏，快捷栏不动。
//   · 阶段二：主栏归 0 后，本次触发改整理**快捷栏（槽 0-8）**。
//   · 两区都归 0 → 完全整齐。
// 玩家可手动触发两次：第一次清主栏，第二次清快捷栏（或主栏已 0 时直接清快捷栏），
// 从而"只整背包"或"整背包+快捷栏"可控。结果与容器整理同格式，由交互层格式化并附阶段提示。
import type { Player } from "@minecraft/server";
import type { PlayerInventoryResult } from "../commands/deps";
import type { OrganizeService } from "../../core/services/OrganizeService";
import { Organizer } from "../../core/organizing/Organizer";
import { pickInventoryPhase } from "../../core/organizing/InventoryPhase";
import { MoveJournal } from "../../core/routing/Move";
import type { McItemAdapter } from "../adapters/McItemAdapter";
import { PlayerInventoryContainer } from "../adapters/PlayerInventoryContainer";

/** 背包不可用（无 inventory 组件）时的占位结果——整理失败 */
const NO_INVENTORY_RESULT: PlayerInventoryResult = {
  region: "背包",
  result: {
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
  },
};

/** 主栏槽区（槽 9-35，27 格） */
const MAIN_START = 9;
const MAIN_CAPACITY = 27;
/** 快捷栏槽区（槽 0-8，9 格） */
const HOTBAR_START = 0;
const HOTBAR_CAPACITY = 9;

/**
 * 构造背包整理器（main.ts 装配进 deps.organizeInventory）。
 * @param organize - 整理服务（organizeStandalone 无事件变体）
 * @param item     - 物品适配器（PlayerInventoryContainer 的 NBT 堆叠判定/保留组件）
 * @returns 输入玩家 → 背包整理结果（2 阶段：主栏优先，归零转快捷栏）
 */
export function createInventoryOrganizer(
  organize: OrganizeService,
  item: McItemAdapter
): (player: Player) => PlayerInventoryResult {
  return (player): PlayerInventoryResult => {
    const inv = player.getComponent("inventory")?.container;
    if (inv === undefined) return NO_INVENTORY_RESULT;
    const main = new PlayerInventoryContainer(`player:${player.name}:main`, inv, item, MAIN_START, MAIN_CAPACITY);
    const hotbar = new PlayerInventoryContainer(
      `player:${player.name}:hotbar`,
      inv,
      item,
      HOTBAR_START,
      HOTBAR_CAPACITY
    );
    const organizer = new Organizer();
    const phase = pickInventoryPhase(organizer.messiness(main).total, organizer.messiness(hotbar).total);

    // 阶段一：主栏未归 0 → 只整理主栏（快捷栏保留待下次）
    if (phase.region === "main") {
      return {
        region: "背包主栏",
        result: organize.organizeStandalone(main, new MoveJournal()),
        note: phase.hotbarPending ? "快捷栏仍待整理——再触发一次可清快捷栏" : undefined,
      };
    }
    // 阶段二：主栏已归 0 → 本次整理快捷栏
    if (phase.region === "hotbar") {
      return { region: "背包快捷栏", result: organize.organizeStandalone(hotbar, new MoveJournal()) };
    }
    // 两区都归 0 → 完全整齐
    return {
      region: "背包",
      result: organize.organizeStandalone(main, new MoveJournal()),
      note: "背包与快捷栏均已整齐",
    };
  };
}
