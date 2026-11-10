// ─── RP 粒子 identifier 常量（纯常量模块，零 @minecraft/server 依赖） ──
// 独立成文件以让 node 单测（effects.test）能直接引用常量而不拖入 mc 运行时。
// 视觉效果在 effects/SortEffects.ts（角色颜色/方块尺寸/音效对齐 v1）。
export const SORT_PARTICLE = "itemroute:sort";
export const DEPOSIT_PARTICLE = "itemroute:deposit";
