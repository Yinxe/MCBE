# AutoRefill

Minecraft Bedrock「自动替换」Add-On，行为包（TypeScript + Script API）。基于 `@minecraft/server`，主手物品被消耗或工具损坏时自动从背包补充同类型物品。

> **核心卖点：保留成就，无需开启作弊。** 不使用 `/replaceitem` 等作弊指令，替换完全在背包层面完成（`container` + `Equippable` 组件操作），不触发作弊判定。

## 功能

- **自动补充消耗品** — 生存/冒险模式下，主手物品被消耗（食物、药水、弓/弩/三叉戟射击等）后，自动从背包查找同 `typeId` 物品替换到主手
- **自动更换损坏工具** — 工具耐久耗尽破碎时，自动换上背包中的同类型工具
- **替换音效** — 每次成功替换播放 `random.pop` 音效，给出即时反馈
- **模式守卫** — 仅生存/冒险模式生效，创造/旁观模式不触发

## 机制

### 核心函数 `refillMainhand(player, typeId)`

1. 获取玩家的 `Inventory` 组件（container）与 `Equippable` 组件
2. 若主手已持有物品则跳过（`Mainhand` 槽位非空）
3. 遍历背包所有槽位，查找首个 `typeId` 相同的物品
4. 找到后：`setEquipment(Mainhand, item)` 装备到主手 → 原槽位置空 → 播放 `random.pop` 音效

### 守卫 `isSurvivalOrAdventure(player)`

仅当玩家游戏模式为 **生存（Survival）** 或 **冒险（Adventure）** 时执行替换逻辑，创造/旁观模式直接跳过。

### 监听事件

| 事件 | 触发场景 |
|---|---|
| `itemCompleteUse` | 食物/药水食用完毕、弓/弩/三叉戟蓄力满释放后 |
| `itemReleaseUse` | 提前松开蓄力物品（`itemStack` 存在时） |
| `itemUse` | 使用物品（放置方块、盾牌、钓鱼竿、打火石等） |
| `playerBreakBlock` | 工具耐久耗尽破碎（`itemStackBeforeBreak` 存在且 `itemStackAfterBreak` 为空） |

## 安装

1. 从 `dist/packages/` 下载 `auto-refill-v{version}.mcpack`
2. 双击/导入 Minecraft
3. 在世界设置中启用「自动替换」行为包
4. 进入世界，生存/冒险模式下主手消耗物品即可自动补充

### 需求

- Minecraft Bedrock（`min_engine_version` 1.21.20+）
- 无需开启作弊（不依赖 `/replaceitem`）

## 开发

### 命令

```bash
pnpm run lint          # ESLint 检查
pnpm run build         # 构建（同步版本 → tsc → esbuild）
pnpm run pack          # 打包 .mcpack 发行包
pnpm run local-deploy  # watch 模式自动构建并部署到游戏
pnpm run clean         # 清理构建产物
```

### 打包产物

`dist/packages/auto-refill-v{version}.mcpack`

### 依赖版本

| 包 | 版本 |
|---|---|
| `@minecraft/server` | 2.6.0 |
| `@minecraft/core-build-tasks`（构建） | 5.5.0 |
| `just-scripts`（构建） | ^2.6.2 |
| `@yinxe/toolkit-build`（构建，workspace） | — |

## 许可证

MIT
