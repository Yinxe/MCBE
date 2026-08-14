// ─── core/tasks 任务型模块统一出口 ──────────────────────
// 分层约定：core/ai = 生物 AI 框架（行为树，不含具体任务）；
//   core/tasks = 任务型模块（构建于 core/ai 之上，端口 + 树装配，零 @minecraft 可单测）。
// 新任务（砍树/钓鱼等）按 VaultTask 模式在此目录新增。
// 劫掠的领域事件与规则也内聚在此（RaidTask RaidEvents / RaidRules）。

export * from "./VaultTask";
export * from "./RaidTask";
export * from "./RaidRules";
export * from "./FishingRules";
