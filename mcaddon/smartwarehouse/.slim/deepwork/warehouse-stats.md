# Deepwork: 仓库统计 (Warehouse Stats)

## Goal (v1: Command Only)
实现 `sw:stats <warehouse_name>` 指令，查询仓库的统计数据：
容器数量、物品数量、物品类型、容量利用率、角色分布、预警信息。

## Oracle Review (ses_0e19bf261ffefoF0iE4qcNSIIe)
Status: **条件批准 — 简化范围后采纳**

### 关键建议（全部采纳）
1. **先只做指令版**，告示牌展示延后
2. **跳过未加载区块的容器**，避免强制加载区块造成卡顿
3. **缓存失效通知** — 接入 onWarehouseChange
4. **`sw:stats` 使用 mandatory name 参数** — 复用 `namedCommand` 模式
5. **不需要 DynamicProperty 持久化** — 内存缓存即可

## Implementation Phases

### Phase 1: Types
File: types.ts
- Add `RoleStats` interface
- Add `WarehouseStats` interface

### Phase 2: WarehouseStatsCollector
NEW: `scripts/stats/WarehouseStatsCollector.ts`
- `collectStats(warehouse, dimension, model): WarehouseStats`
- In-memory cache `Map<WarehouseId, { stats: WarehouseStats, tick: number }>`
- TTL: 1200 ticks (60 seconds)
- Skip unloaded containers (try-catch on getBlock)
- `invalidate(id)` — called on warehouse change

### Phase 3: Command
File: CommandRouter.ts
- Register `sw:stats <name>` via `namedCommand`
- Handler: collect stats → format colored output → send to player
- Show: total containers/items/types, per-role breakdown, capacity %, warnings

### Phase 4: Wiring
File: main.ts
- Create WarehouseStatsCollector
- Pass to CommandRouter (via constructor)
- Wire invalidate into onWarehouseChange
