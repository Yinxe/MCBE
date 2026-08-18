// ─── 流程模块 barrel（features/flow） ────────────────────
// flow = 工作流：将一组原子功能（features/basic）组合而成的业务流程。
// 原子能力放 basic（单动作）；流程组合放这里（多动作编排）——如飞行 fly
// 原子能力在 basic，飞行 flow（巡航/降落编排）才属 flow。
//   - fishingFlow        钓鱼流程（fishOnce：发杆→稳定→监听→收竿→战利品）+ 战利品感知
//   - fishingHookTracker 鱼钩生成追踪（钓鱼流程的感知基础设施）
//   - treeScan           树资源坐标集扫描（woodcut 流程的 mc 扫描壳；纯算法在 rules/tree）
//   - raidMode           劫掠模式（纯事件驱动循环：喝瓶→兆头→袭击/胜利→回药）
//   - RaidEvents         劫掠领域事件（raidStarted/raidVictory/raidPhase：通知/联动用）
//
// ⚠️ 旧 Ports（VaultPorts/FishingPorts）已随旧树架构迁入 legacy/ai，不在此 barrel。

export { initLootTracker, failureLabel, fishOnce } from "./fishingFlow";
export type { FishingOutcome, FishingFailureReason, BackpackInfo, LootItem } from "./fishingFlow";
export { initFishingHookTracker } from "./fishingHookTracker";
export {
  collectCoordinateSet,
  scanTreesFromSets,
  buildTreeSetReport,
  VALID_LOG_TYPE_IDS,
  VALID_LEAF_TYPE_IDS,
  type CoordinateSetResult,
  type TreeSetScanResult,
} from "./treeScan";
export {
  chopOneTree,
  describeChopPlan,
  type WoodcutOutcome,
  type WoodcutFailureReason,
} from "./woodcutFlow";
export {
  runPickupFlow,
  type PickupOutcome,
  type PickupOptions,
} from "./pickupFlow";
export { initRaidMode, cleanupRaidMode, type RaidDrinkResult } from "./raidMode";
export {
  raidStarted,
  raidVictory,
  raidPhase,
  initialRaidPhaseState,
  type RaidPhase,
  type RaidStartedEvent,
  type RaidVictoryEvent,
  type RaidPhaseEvent,
  type RaidPhaseState,
} from "./RaidEvents";