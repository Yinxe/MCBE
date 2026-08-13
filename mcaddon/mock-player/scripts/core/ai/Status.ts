// ─── 行为树节点状态 ──────────────────────────────────────
// 三态：success（成功）/ failure（失败）/ running（进行中，下次 tick 继续）。

export type Status = "success" | "failure" | "running";
