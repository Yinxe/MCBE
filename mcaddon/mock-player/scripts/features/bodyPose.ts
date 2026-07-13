// ─── 体态管理（业务层 barrel） ────────────────────────
//
// 集中 re-export core/pose 中的所有体态功能，方便 features/ 层引用。
// 所有实现都在 features/core/pose.ts 中。

export {
  setPose,
  lookAt,
  getPlayerLookTarget,
  savePoseToRecord,
} from "./core/pose";
