# AutoRefill

Minecraft Bedrock「自动替换」Add-On，行为包（TypeScript + Script API）。基于 `@minecraft/server`，主手物品被消耗或工具损坏时自动从背包补充同类型物品。

> **核心卖点：保留成就，无需开启作弊。** 不使用 `/replaceitem` 等作弊指令，替换完全在背包层面完成（`container` + `Equippable` 组件操作），不触发作弊判定。

## 功能

- **自动补充消耗品** — 生存/冒险模式下，主手物品被消耗（食物、药水、弓/弩/三叉戟射击等）后，自动从背包查找同 `typeId` 物品替换到主手
- **自动更换损坏工具** — 工具耐久耗尽破碎时，自动换上背包中的同类型工具
- **自动切换挖掘工具** — 开始挖掘方块时，识别方块所需工具类别（镐/斧/锹/锄/剪刀，识别为「标签优先、精简 ID 关键词兜底」的启发式，见 `BlockClassifier.ts`，含最低品质约束）。**主手已在用对工具则一律不动**（不择优升级，尊重玩家用铁镐省钻石镐耐久的自主选择），只在主手类别错误（空手/用错工具/品质不达标）时才换入背包同类达标工具；持续挖掘石→沙→木等不同方块时自动跟随切换
- **自动切换武器** — 攻击实体（击打其他生物/玩家）时，若主手不是武器，自动换上背包最优近战武器（**剑 → 斧 → 镐** 依次优先）；已持武器 / 背包无武器 / 锁定·自定义主手则不动，尊重玩家选择
- **自动换精准采集工具** — 挖掘玻璃/玻璃片/冰/萤石/海晶灯等无工具类别、不用精准采集就无法产出方块本体的方块时，自动换上背包里任意一把带精准采集（Silk Touch）的工具，避免方块被打碎
- **替换音效** — 每次成功替换播放 `random.pop` 音效，给出即时反馈
- **模式守卫** — 仅生存/冒险模式生效，创造/旁观/假人不触发
- **管理员配置菜单** — 命令 `/ar:menu`（仅**操作员**）打开的配置表单，可单独开关「全局启用 / 物品补充 / 武器替换 / 工具替换」，状态持久化到世界（重启不变）

## 管理员配置

命令 `/ar:menu`（`CommandPermissionLevel.GameDirectors`，仅操作员）打开 ActionForm 配置菜单，四项开关点击即切换并自动保存：

| 开关 | 控制 |
|---|---|
| 全局启用 | 总开关，关闭则所有功能不执行 |
| 物品补充 | 消耗品补货（使用后主手 `undefined` / 副作用残留 → 换同类 + 堆叠回收） |
| 武器替换 | 攻击实体时非武器主手换武器（剑 → 斧 → 镐） |
| 工具替换 | 挖掘工具核对换入 + 工具破碎换同类 |

开关存世界动态属性（键 `autorefill:global/refill/weapon/tool`），重启世界保持。

## 架构

按「**两个核心功能域 + 主手状态判定**」构建：
- **工具切换**（`ToolManager` + `ToolStrategies`）：`entityHitBlock` 触发，策略链识别并换入正确挖掘工具
- **自动填充**（`RefillManager`）：使用/交互事件触发，按**使用后主手状态**决定是否补货

```
scripts/
├── main.ts             组装根：只订阅事件 → PlayerPolicy 守卫 → 按事件路由到领域服务（无业务逻辑）
├── types.ts            领域类型：ToolCategory / ToolRequirement / ToolCandidate
├── ItemDomain.ts       物品域判定：resolve(typeId) → 'tool' | 'consumable'（补货的消耗分支兜底守卫）
├── PlayerPolicy.ts     玩家守卫：真实玩家 + 生存/冒险模式
├── Inventory.ts        背包端口（Port & Adapter）：唯一封装 Container I/O + 物品元数据 + 槽位策略
├── BlockClassifier.ts  方块识别（Strategy 表驱动）：tag 优先 + 关键词兜底 + 精准采集标记
├── ToolStrategies.ts   工具选择策略（Strategy + Chain of Responsibility）：
│                       挖掘链 SilkTouchStrategy → CategoryStrategy → 默认不动；
│                       武器链 WeaponPriorityStrategy（剑→斧→镐）
├── ToolManager.ts      工具领域服务（Facade）：挖掘核对 / 武器切换 / 工具破碎换同类
└── RefillManager.ts    消耗品领域服务（Facade）：按主手状态补货 + 副作用堆叠
```

**冲突设计（按主手状态化解）**：早前版本存在冲突——工具切换（`entityHitBlock` / 武器 `entityHitEntity`）把正确物品换上后，连带触发的"使用"事件又触发补货把旧物品换回。现在 `RefillManager` 不再按 typeId 拦，而是**检查使用后的主手**三段分派：
1. 主手 `undefined` → 被完全消耗 → 安全补同类（仅消耗品域）
2. 主手是**已枚举的副作用残留**（空瓶/空桶/碗，`SIDE_EFFECT_ITEMS`）→ 交换补同类 + 残留堆叠回收
3. 主手是其他物品（工具/武器切换已换入的主手 / 主手仍同类仅数量减少）→ **与消耗无关，忽略**

场景 3 即旧冲突的根：主手已被 `ToolManager` 换成正确物品，既非 undefined 也非副作用残留 → 补货忽略，不撤销切换。工具破碎替换走 `playerBreakBlock` → `ToolManager`。

**策略设计**：同一套 `ToolDecisionPlanner` 链机制、两组策略链——
- **挖掘链**（`entityHitBlock`）：`SilkTouchStrategy`（精准采集）→ `CategoryStrategy`（类别 + 最低品质，达标不择优 / 不达标找达标 / 无达标不降级）→ 默认不动
- **武器链**（`entityHitEntity`）：`WeaponPriorityStrategy`（非武器主手换剑→斧→镐；已持武器 / 无武器 / 锁定·自定义 → 不动）

## 领域职责与事件路由

### 事件路由（main.ts）

| 事件 | 分派 | 所属领域 |
|---|---|---|
| `entityHitBlock` | `ToolManager.onPlayerHitBlock`（挖掘开始、破坏前核对换入） | tool |
| `entityHitEntity` | `ToolManager.onAttackEntity`（攻击实体，非武器主手换武器） | tool |
| `playerBreakBlock`（`itemStackAfterBreak` 为空） | `ToolManager.onToolBroke`（碎工具换同类） | tool |
| `itemCompleteUse` / `itemReleaseUse` / `itemUse` / `playerInteractWithBlock` | `RefillManager.onConsumed`（按使用后主手状态判断：完全消耗补货 / 副作用残留补货+堆叠 / 其余忽略） | 消耗 / 工具切换由主手状态判别 |

### 守卫 `PlayerPolicy`（`scripts/PlayerPolicy.ts`）

仅当：**真实玩家**（非 mock-player 假人）**且**游戏模式为**生存/冒险**时才处理，创造/旁观/假人一律跳过。

### 工具核对与切换（`scripts/ToolManager.ts` + `ToolStrategies.ts`）

由 `afterEvents.entityHitBlock` 触发：玩家开始挖掘方块的"第一下"命中时（方块**尚未破坏**），拿 `hitBlock` 方块对象走识别与策略链，用错则立刻换——正在挖的这块就用对工具。无需给工具挂自定义组件，不碰原版工具定义。

1. **精准采集优先**（`SilkTouchStrategy`）：`wantsSilkTouch(block)` 命中玻璃/玻璃片/冰/萤石/海晶灯等 → 主手已带精准采集则不动，否则换入背包任意一把带精准采集的原版工具（跨类别择优，跳过锁定槽）
2. **识别工具需求**（`BlockClassifier.classify`，4 层可扩展）——瞬破方块排除 → **自定义策略**（`CUSTOM_RULES`，表达偏好/优先级，见下）→ **现代挖掘标签**（`minecraft:is_*_item_destructible`，一条标签覆盖整个家族，含 `*_tier_destructible` 镐最低品质；已实证 `hasTag` 可读）→ 遗留标签（`*_pick_diggable`/`stone`/`dirt`/`log`…）→ typeId 关键词兜底（`ore`/`log`/`path`…）。识别**宁缺毋滥**，无偏好的方块（玻璃/花/火把）不干预
3. **最低品质约束**：现代镐品质标签（`is_diamond_tier_destructible`→钻石⁺、`is_iron_tier_destructible`→铁⁺…）附到镐目标——**换入工具必须达标，绝不降级**；读不到时退回遗留 `*_pick_diggable` 映射
4. **决策（目标优先级链）**：需求为"按优先级的工具目标列表"（如树叶 `精准锄 > 剪刀`）——主手命中**任一**目标即视为正确不动（不择优）；未命中则按顺序换入第一个有货且达标的目标工具；主手锁定/自定义、背包无达标 → 尊重不动

### 识别可扩展性

识别分**通用策略**与**自定义策略**，均按需扩充：

- **通用策略**（`BlockClassifier`）：**现代挖掘标签**为主（`is_*_item_destructible`，无维护成本，自动覆盖新方块）；`ID_KEYWORDS` 关键词兜底（模组/无标签方块在此补词条）
- **自定义策略**：`CUSTOM_RULES` 注册表——只放标签表达不了的**策略偏好**（优先级/精准采集）：

| 规则 | 命中 | 工具偏好（优先级） |
|---|---|---|
| `leaves` | `*_leaves`（树叶） | 精准采集锄头 → 剪刀 |
| `grass_block_family` | 草方块 / 灰化土 / 菌丝 | 精准采集锹 → 锹 |

（纯识别缺口如草径由现代标签覆盖，无需登记；新增偏好 → 追加一条即可。）

> **工具正确性判定**（`InventoryService.matchesTarget` / `isVanillaToolOf`）：主判物品原生标签（`minecraft:is_pickaxe` 等），typeId 后缀兜底——无需维护物品列表，且能识别挂了对应标签的自定义工具。

### 武器切换（`scripts/ToolManager.onAttackEntity` + `WeaponPriorityStrategy`）

由 `afterEvents.entityHitEntity` 触发：玩家攻击实体时，若主手**不是武器**则自动换上背包最优近战武器，按 **剑 → 斧 → 镐** 依次优先（首个有货的类别里选品质/耐久最优）。规则：

1. 已持武器（剑/斧/镐/三叉戟/弓弩）→ 尊重玩家，不动（哪怕背包有更好的）
2. 主手是锁定槽/自定义物品 → 尊重玩家，不动
3. 背包无任何武器（剑/斧/镐都没有）→ 不动
4. 其余（空手/非武器如方块/食物/锹/锄）→ 换入最优武器 + pop 音效

与工具核对共用 `ToolDecisionPlanner` 链机制与 `Inventory` 端口，只是换一组策略（武器链）。

### 消耗品补货（`scripts/RefillManager.ts`）

`onConsumed(player, typeId)` 按**使用后的主手状态**三段分派：

1. 主手 `undefined` → 被完全消耗 → 从背包找同类 `swap` 换入（仅消耗品域，`ItemDomain` 兜底）
2. 主手是副作用残留（`SIDE_EFFECT_ITEMS`：`glass_bottle` 空瓶 / `bucket` 空桶 / `bowl` 碗，可扩展）→ `swap` 补同类 + 残留堆叠回收（交换 + 堆叠原子流程）
3. 主手是其他物品（工具切换已换入的工具 / 主手仍同类仅数量减少）→ 忽略

找不到同类时（最后一件也用完）→ 主手残留堆叠回背包 → pop 音效。

### 工具破碎替换（`scripts/ToolManager.onToolBroke`）

`playerBreakBlock` 且 `itemStackAfterBreak` 为空（工具碎掉）→ 从背包换入同类新工具。

> 详细日志：识别路径（`tag:xxx` / `keyword`）、类别、最低品质、各级决策（工具已正确 / 品质不足 / 无达标工具 / 已换入 / 破碎补齐 / 替换）均通过 `console.warn` 输出（游戏内容日志可见）。
>
> 时序说明：稳定 Script API 中**没有**"挖掘开始"的全局事件；`playerBreakBlock` 在破坏/破坏后才触发（已晚）。`entityHitBlock`（玩家命中方块）是唯一能在破坏前拦截、且不依赖物品自定义组件的入口——代价是同事件也会在其他实体命中方块时触发（用 `entityTypes` 过滤只收玩家）。

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
