// ─── core barrel ────────────────────────────────────────
// core 层统一出口：零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。

// model
export * from "./model/Types";

// events
export { EventSignal, type EventCallback } from "./events/EventSignal";
// 领域事件聚合导出（生命周期/认主/劫掠/行为共 13 个信号 + 全部类型）：
//   import { BotEvents } from "../../core";
//   BotEvents.botOnline.subscribe(...)
export * from "./events/DomainEvents";
// UI 领域事件（BOT 主菜单动作 / 行为菜单提交）：
//   import { BotUiEvent } from "../../core";
//   BotUiEvent.behaviorSubmitted.subscribe(...)
export * from "./events/UiEvents";

// tags
export * from "./tags/BotTags";

// coords
export * from "./coords/Coordinate";
export * from "./coords/Direction";
export * from "./coords/Cluster";

// xp
export * from "./xp/XpMath";

// format
export * from "./format/Format";
export * from "./format/EnchantZh";

// items
export * from "./items/ItemRules";
export * from "./items/ToolRules";
export * from "./items/MainhandPolicy";
export * from "./items/TridentRules";
export * from "./items/TridentClaimRules";

// storage 端口
export * from "./storage/BotStore";
export * from "./storage/IntervalScheduler";

// service
export * from "./service/BotRegistry";
export * from "./service/ReclaimPlanner";
export * from "./service/RaidRules";
export * from "./service/QuotaRules";
export * from "./service/ModConfigRules";

// ai 行为树框架
export * from "./ai";
