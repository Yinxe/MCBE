# BOT 上线/下线/辅助常加载 规格文档（Spec）

> 日期：2026-08-25 | 状态：已落地（feat/optimize-refactor）| 权威实现：`mcaddon/mock-player/docs/bot-lifecycle-tickingarea.md`

## 1. 目标
为 MockPlayer（模拟玩家）提供**可重复、可观测、幂等**的上下线机制，并以**两类辅助常加载**保障区块稳定，规避重名、空背包、容量超限等高危缺陷。

## 2. 范围
- 关联模块：`bootstrap/worldLoad` / `features/manage/{onlineBot,offlineBot,spawnMode,gametestContext,auxiliary,tickingArea/*,autoOnline,pendingRespawn}` / `service/BotRegistry` / `events/{playerJoin,playerLeave,entityDie}` / `interaction/commands + ui`
- 不在范围：工作模式 AI 引擎细节、投掷物认主几何（已独立）

## 3. 验收标准
- [x] 上线 `safeOnline` 唯一入口，永不 reject，覆盖 5 类触发源（命令/UI/重连/自动/恢复）
- [x] 下线 `safeOffline` 唯一入口，永不 throw，覆盖 5 类触发源（命令/UI/死亡/重连/联动），finally 单次卸载
- [x] per-bot 队列防同名并发，重名防护三层（waitNameFree→串行锁→生成后校验重试）
- [x] 恢复标记 `restoredBots` 防空背包覆写，指纹对账只写变化
- [x] 辅助双域隔离：Sim4（命令域 circle r=4, 49 块圆形 4+1+4）上线后常驻 vs SingleChunk（Manager 单chunk 255并发）下线前占位延迟卸载，同名 `mockplayer:aux:<name>`
- [x] GameTest 装置几何 0,0,0 常驻，40t就绪，4区块列tick
- [x] 配额强制与可见性隔离（onlineQuota/可见记录过滤）
- [x] 构建 0 错误、core 79+ 单测通过、文档 533 行与代码注释/日志一一对应
