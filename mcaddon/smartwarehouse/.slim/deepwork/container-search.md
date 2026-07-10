# Deepwork: 容器搜索 (Container Search)

## Goal
指令 `sw:find <item>` 搜索离玩家最近的仓库中指定物品，用光效标记容器，让玩家转向容器，靠近后光效消失。

## Plan

### 1. ContainerMarker (NEW: `scripts/ui/ContainerMarker.ts`)
- 单个容器的粒子标记系统
- `start(player, dimension, stored, durationTicks)` — 启动粒子循环
- `stopAll()` / `stop(playerId)` — 停止
- 粒子颜色: 亮红/金（区别于分拣和整理效果）
- 当玩家距离容器 < 3 格自动停止

### 2. Command `sw:find <item>` (modify CommandRouter.ts)
- 使用 `namedCommand("sw:find", "搜索仓库中的物品")`
- 找到最近仓库（计算玩家到各仓库中心距离）
- 在仓库所有容器中搜索匹配物品（支持后缀匹配: "diamond" → "minecraft:diamond"）
- 搜索结果:
  - 未找到 → 消息提示
  - 找到 → ContainerMarker.start + player.setRotation 转向容器

### 3. Wiring (main.ts)
- 创建 ContainerMarker
- 传给 CommandRouter

## Files
- NEW: `scripts/ui/ContainerMarker.ts`
- MOD: `scripts/commands/CommandRouter.ts` — add sw:find
- MOD: `scripts/main.ts` — wire ContainerMarker
