# Deepwork: 仓库容器自动整理 (Auto-Sort Container Organization)

## Goal — 完成 ✅

在仓库设置中实现自动整理箱子功能：按物品 ID 排序整理容器内物品，智能混乱度检测，与分拣互斥容器级锁，零数据丢失。

## Oracle Reviews

### Plan Review (ses_0e1d0c208ffeecnWi2l6Z6rbMT)
Status: **条件批准 → 全部修复**
| # | Issue | Fix |
|---|-------|-----|
| K1 | clear→writeBack 数据丢失 | 原地覆写（不清空容器） |
| K2 | organizeInProgress 减半吞吐 | 仅依赖容器级锁 |
| K3 | tick 锁早过期 | try/finally 显式释放 + 100 tick 安全网 |

### Implementation Review (ses_0e1b22335ffeJnEmvPKeLu0ukm)
Status: **条件批准 → 全部修复**
| # | Issue | Fix |
|---|-------|-----|
| C1 | 读取失败槽位 → setItem(i,undefined) 数据丢失 | 追踪 readItemSlots，只写回确认槽位 |
| I2 | LOCK_SAFETY_TICKS=600 过长 | 降为 100（~5 秒） |
| I4 | 2-4 槽容器 messiness 误报 | <5 个物品返回 0（跳过） |
| - | CHECK_DELAY_TICKS 为 20 不符合 30 秒要求 | 改为 600 |

## Implementation Summary

### Files Changed
| Type | File | Change |
|------|------|--------|
| MOD | `scripts/types.ts` | `autoSort` in WarehouseSettings, `OrganizeRuntimeState` interface, `organizeState?` in WarehouseRuntimeModel |
| MOD | `scripts/storage/WarehouseRepository.ts` | `autoSort: false` in defaults |
| MOD | `scripts/runtime/WarehouseRuntimeModel.ts` | `createOrganizeState()` builder |
| NEW | `scripts/sorting/ContainerOrganizer.ts` | 混乱度计算、安全整理、锁管理、deposit 注册 |
| NEW | `scripts/sorting/OrganizerScheduler.ts` | 全局整理调度（20 tick interval） |
| MOD | `scripts/sorting/SorterEngine.ts` | 容器锁检查 + `registerDeposit` 集成 |
| MOD | `scripts/sorting/SortEffects.ts` | `playOrganizeEffect`（琥珀色光效） |
| MOD | `scripts/ui/WarehouseSettingsMenu.ts` | autoSort 开关 |
| MOD | `scripts/main.ts` | 创建并注入 ContainerOrganizer, OrganizerScheduler |

### Key Design Decisions

**容器锁**: 双向 —— 整理器和分拣器都检查同一把锁。tryLock → try/finally → unlock。

**混乱度算法**: `transitions / (occupiedSlots - 1)`，忽略空格，跳过 <5 物品的容器。

**数据安全**: 只写回 `readItemSlots` 中确认的原始槽位，绝不覆盖未知数据。

**调度限流**: 全局 20 tick 间隔，每次处理一个容器的一个物品。不绑定 per-warehouse processingSpeed。

### Requirements Checklist
- ✅ 开关控制自动整理
- ✅ 按物品 ID 排序整理
- ✅ 混乱度智能阈值 0.3
- ✅ 整理与分拣互斥（容器级锁）
- ✅ deposit 后延迟 30 秒检查混乱度
- ✅ 整理后 30 秒冷却
- ✅ 冷却后重新检查，直到混乱度 < 阈值
- ✅ 全仓限流（1 容器/20 tick）
- ✅ 零数据丢失（原地覆写 + 只写确认槽位）
