// ─── 方块原子能力 barrel（features/basic/blocks） ────────
// 内聚：所有"假人操作世界中方块"的原子能力（与 items 背包/手持分隔）。
//   - blockBreak  方块破坏（breakBlockOnce 原子单块 / breakBlockAt 持续破坏 /
//                 viewBlock 视线感知 / waitTicks 节奏控制；异步可取消）
//   - blockPlace  方块放置（placeBlockOnce 异步原子：system.run 包装
//                 stopBreakingBlock→startBuild→stopBuild，返回 Promise<boolean>）
// 决策留在 rules/（坐标/树/结果），方块/实体读写在这里。

export {
  BreakResult, breakBlockOnce, breakBlockAt, viewBlock, waitTicks,
  type BreakResultValue, type BreakOnceOptions, type BreakBlockOptions,
  type EnsureToolContext,
} from "./blockBreak";
export { placeBlockOnce } from "./blockPlace";
