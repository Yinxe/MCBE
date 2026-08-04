# item-route 实施计划 3：交互层（UI / 命令 / 信物交互 / 视觉反馈）

> 前置：计划 1（core，25 Task）与计划 2（mc 适配层，16 Task）已完成设计。
> 本计划实现设计文档 §12 交互层 + §7 统计展示 + §3.3 权限矩阵的玩家侧落地，以及 scripts/core/data 中文名映射数据层。
> 依赖：core 的 `WarehouseService` / `RouteService` / `MemberService` / `StatsService` / `ItemIndex` / `EventBus`（含 `VisualEffectEvent`）；mc 的 `McModConfig` / `ShardStore` / 4 Phase 装配。

## 目标

- 玩家可通过 9 条命令 + 信物右键交互完成：建仓、选区、容器注册、角色管理、成员管理、搜索、整理、统计查看、配置
- 所有 UI 走 `MemberService.can()` 权限矩阵（owner/member/visitor），替代 v1 的 OP 二元判断
- 视觉反馈订阅 core `EventBus` 事件（route-flash / boundary-glow / particle），无玩家在场不播放
- 中文名映射（`scripts/core/data/name-maps`）供搜索与统计显示，纯数据零 MC 依赖，可单测

## 关键决策

| 决策 | 内容 |
|------|------|
| 命令前缀 | `ir:`（item-route），9 条：`ir:create` `ir:resize` `ir:rescan` `ir:rescan_preview` `ir:delete` `ir:menu` `ir:search` `ir:organize` `ir:help` |
| 权限模型 | 命令/UI 统一经 `MemberService.can(wh, playerId, role)`；`getRole` 返回 `"owner"\|"member"\|"visitor"\|undefined` |
| 角色枚举 | 使用 core 的 `ContainerRole = "input"\|"single"\|"multi"\|"misc"`（**不是** v1 的 normal/bulk） |
| 信物 | `McModConfig.tokenItemId`（默认 `minecraft:wooden_hoe`），`isToken(item)` 判定；TOKEN_OPTIONS 列表供 ConfigUI 选择 |
| 搜索 | 直接查 `ItemIndex.lookup(typeId)`（O(1)），中文名经 `searchItems(query)` 转 typeId 再查索引 |
| 统计 | `StatsService.getWarehouseStats()` 双视图：按类型（byType）+ 按物品（byItem：数量/堆叠数/所在容器） |
| 视觉反馈 | 订阅 `bus.visualEffect`（kind: route-flash/boundary-glow/particle），播放前检查维度内玩家存在 |
| 粒子资源 | 复制 v1 `sort.particle.json` / `deposit.particle.json`，identifier 改为 `itemroute:sort` / `itemroute:deposit`，纹理路径改 `textures/itemroute/particle/*` |
| 成员管理 | 新 `MemberMenu`（替代 v1 FamilyConfigMenu），基于 `MemberService.addMember/setMemberRole/removeMember` |
| 新手引导 | `NewPlayerGuide` 首次进入主菜单展示，`hasSeenGuide/markSeenGuide` 存 DP（`ir2:guide_seen`） |

## 文件结构

```
scripts/core/data/name-maps/            # 新增：中文名映射（纯数据，零 MC 依赖）
│   ├── types.ts                # ItemNameMap/EffectNameMap/EnchantmentNameMap/EntityNameMap/BiomeNameMap = Record<string,string>
│   ├── items-direct.ts         # 852 行物品 ID→中文名（从 v1 平移）
│   ├── items-gaps.ts           # 补漏层
│   ├── items-colors.ts         # 颜色物品层
│   ├── items-woods.ts          # 木材层
│   ├── items-compounds.ts      # 化合物层
│   ├── items-special.ts        # 特殊层
│   ├── items-fallback.ts       # 兜底层
│   ├── effects.ts              # 药水效果
│   ├── enchantments.ts         # 附魔
│   ├── entities.ts             # 实体
│   ├── biomes.ts               # 群系
│   └── index.ts                # itemsMap 合并（direct>gaps>colors>woods>compounds>special>fallback）
scripts/core/data/ItemNameMap.ts        # getChineseName(typeId) / searchItems(query) / NAME_INDEX
scripts/mc/ui/                          # 12 模块
│   ├── Table.ts                # 纯文本表格渲染（§ 颜色码不计宽度）
│   ├── MainMenu.ts             # 主菜单（容器搜索/管理仓库/仓库列表/创建仓库/配置[仅管理员]）
│   ├── WarehouseCreateFlow.ts  # 建仓表单 → 选区会话
│   ├── WarehouseManageMenu.ts  # 仓库列表（OP 全部/非 OP 自己）
│   ├── WarehouseSettingsMenu.ts# 仓库设置 + 底部操作
│   ├── ContainerRoleMenu.ts    # 容器角色/状态（isHopper→input）
│   ├── MemberMenu.ts           # 成员管理（新增）
│   ├── SearchUI.ts             # 搜索 + 粒子标记
│   ├── StatsUI.ts              # 统计页（类型/物品双视图，新增）
│   ├── ConfigUI.ts             # 模组配置（信物/全局开关/速度上限）
│   ├── HelpGuide.ts            # 帮助手册
│   └── NewPlayerGuide.ts       # 新手引导
scripts/mc/commands/                    # 9 命令 + 注册中心
│   ├── index.ts                # registerAllCommands(registry)
│   ├── create.ts / resize.ts / rescan.ts / rescanPreview.ts / delete.ts
│   ├── organize.ts / menu.ts / search.ts / help.ts
scripts/mc/interaction/
│   ├── SelectionSessionStore.ts    # 选区会话（纯 TS 可单测）
│   └── ToolInteractionController.ts# 信物右键交互
scripts/mc/effects/
│   ├── SortEffects.ts          # 路由闪光/存入效果（角色颜色）
│   └── BoundaryDisplay.ts      # 12 棱线框光幕（endrod）
RP/ItemRoute/particles/itemroute/ # 粒子资源（sort/deposit）
RP/ItemRoute/textures/particle/   # 渐变纹理
```

## 测试约定

- `pnpm test:core`：`tsc -p tsconfig.test.json && node --test .test-build/tests/`（scripts/core/data 单测走此通道）
- scripts/mc/ui、scripts/mc/commands、scripts/mc/interaction、scripts/mc/effects：纯逻辑部分（Table、SelectionSessionStore、权限封装、粒子参数计算）单测；MC API 交互部分仅编译检查 + 游戏内冒烟
- 冒烟清单（游戏内，与 mc 计划 Task 16 合并验证）见 Task 17

---

## Task 1：scripts/core/data/name-maps 数据层平移

**失败测试先行**（`tests/name-maps.test.ts`）：
- `itemsMap` 条目数 ≥ 1300，且 `itemsMap["minecraft:diamond"] === "钻石"`
- 合并优先级：同 key 时 direct 层覆盖 fallback 层
- `getChineseName("minecraft:diamond") === "钻石"`；未知 ID 回退英文 `"minecraft:unknown_item"`
- `searchItems("钻")` 返回含 `minecraft:diamond`；`searchItems("diamond")` 命中 typeId 子串；`searchItems("钻石剑")` 命中中文名
- `NAME_INDEX` 反向索引：中文名 → typeId 数组

**实现**：
1. 从 v1 `smartwarehouse/scripts/data/name-maps/` 平移 9 个数据文件到 `scripts/core/data/name-maps/`（内容不变，仅路径）
2. `index.ts`：`itemsMap = { ...fallback, ...special, ...compounds, ...woods, ...colors, ...gaps, ...direct }`（后层覆盖前层，direct 最高优先）
3. `scripts/core/data/ItemNameMap.ts`：`getChineseName(typeId)`（查表→回退 `typeIdToEnglish` 去命名空间→原样）；`searchItems(query)` 四层模糊（typeId 精确/typeId 子串/中文名子串/英文回退子串）；`NAME_INDEX` 构建

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: core 中文名映射数据层`

---

## Task 2：scripts/mc/ui/Table.ts 纯文本表格渲染

**失败测试先行**（`tests/table.test.ts`）：
- 多列对齐：`Cell.left/center/right` 分别左/中/右对齐
- `§` 颜色码不计入宽度（`"§a钻石"` 按 2 字符宽计算）
- 空表返回空字符串；单列表正常

**实现**：从 v1 `ui/Table.ts` 平移（Cell/Table 结构不变），确认宽度计算剥离 `§[0-9a-fk-or]`。

**验证**：`pnpm test:core` 通过。
**提交**：`item-route@0.1.0: 表格渲染器`

---

## Task 3：McModConfig 扩展（tokenItemId + 引导标记）

**失败测试先行**（追加 `tests/mc-mod-config.test.ts`）：
- 默认 `tokenItemId === "minecraft:wooden_hoe"`；`isToken(wooden_hoe) === true`，`isToken(diamond) === false`
- `setTokenItemId("minecraft:stick")` 后持久化并 `isToken(stick) === true`
- `hasSeenGuide` 默认 false；`markSeenGuide()` 后 true 且持久化

**实现**：
1. `McModConfig` 增加字段 `tokenItemId: string`（默认 `minecraft:wooden_hoe`）+ `setTokenItemId()` + `isToken(itemTypeId)`
2. 新增 `guideSeen: boolean`（DP `ir2:guide_seen`）+ `hasSeenGuide()/markSeenGuide()`
3. `TOKEN_OPTIONS` 常量：`["minecraft:wooden_hoe","minecraft:stick","minecraft:parrot_spawn_egg","minecraft:nautilus_shell","minecraft:music_disc_11","minecraft:nether_star","minecraft:blaze_powder"]`（v1 同款）

**验证**：`pnpm test:core` 通过。
**提交**：`item-route@0.1.0: 模组配置扩展信物与引导标记`

---

## Task 4：scripts/mc/interaction/SelectionSessionStore.ts

**失败测试先行**（`tests/selection-session.test.ts`）：
- `set(playerId, session)` / `get(playerId)` / `clear(playerId)` / `clearAll()`
- 会话类型：`{ kind: "createWarehouse", name, defaultRole, defaultEnabled }` 与 `{ kind: "resizeWarehouse", warehouseId }`
- 覆盖旧会话：同 playerId 二次 set 替换

**实现**：从 v1 `interaction/SelectionSessionStore.ts` 平移（Map<playerId, SelectionSession>），类型改用 core 的 `ContainerRole`。

**验证**：`pnpm test:core` 通过。
**提交**：`item-route@0.1.0: 选区会话存储`

---

## Task 5：命令注册中心 + 权限封装

**失败测试先行**（`tests/command-auth.test.ts`）：
- `resolveWarehouseByName(store, name)`：精确匹配显示名；无匹配返回 undefined
- `requireRole(wh, playerId, role)`：owner 满足 owner/member/visitor；member 满足 member/visitor；visitor 仅 visitor；非成员返回 undefined
- 权限矩阵（§3.3）：create=任意玩家；delete/resize=owner；rescan/rescan_preview=member+；menu/search=visitor+；organize/help=任意

**实现**：
1. `scripts/mc/commands/index.ts`：`registerAllCommands(registry)` 用 `defineCommand(registry, regionCommand("ir:xxx", "描述"), cb)` 注册 9 条（v1 同款模式，`event.customCommandRegistry`）
2. `scripts/mc/commands/auth.ts`：`resolveWarehouseByName` + `requireRole`（内部调 `MemberService.getRole`）
3. 每条命令回调：`system.runTimeout` 包裹 + 中文错误消息返回

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 命令注册中心与权限封装`

---

## Task 6：ir:create / ir:resize（区域点选命令）

**失败测试先行**（`tests/commands-area.test.ts`）：
- `parseAreaArgs(args)`：`<name> <x1> <y1> <z1> <x2> <y2> <z2>` 解析为 `{name, corner1, corner2}`；参数不足返回错误消息
- 创建流程：`WarehouseService.createWarehouse(name, playerId, area)` → `CreateResult`；空名/同名/区域重叠返回对应中文错误
- resize：`WarehouseService.updateArea(warehouseId, area)` 后区域更新；非 owner 被拒

**实现**：
1. `create.ts`：`ir:create <名称> <x1> <y1> <z1> <x2> <y2> <z2>` → 调 core `createWarehouse` → 成功提示 + 自动 `rescan` 提示
2. `resize.ts`：`ir:resize <名称> <x1> <y1> <z1> <x2> <y2> <z2>` → owner 校验 → `updateArea` → 触发 `bus.visualEffect`（boundary-glow）

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 建仓与调整区域命令`

---

## Task 7：ir:rescan / ir:rescan_preview / ir:delete

**失败测试先行**（`tests/commands-warehouse.test.ts`）：
- rescan：member+ 校验；调 `WarehouseService.rescan(warehouseId)` 返回扫描统计（容器数/物品数）
- rescan_preview：只读预览（不写索引），返回将注册的容器清单
- delete：owner 校验；`deleteWarehouse(warehouseId)` 后 `store.get(warehouseId) === undefined`；二次删除返回"仓库不存在"

**实现**：
1. `rescan.ts`：`ir:rescan <名称>` → `rescan` → 中文统计消息
2. `rescanPreview.ts`：`ir:rescan_preview <名称>` → 预览清单（Table 渲染）
3. `delete.ts`：`ir:delete <名称>` → owner 校验 → 删除 → 确认消息

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 扫描与删除命令`

---

## Task 8：ir:organize / ir:menu / ir:search / ir:help

**失败测试先行**（`tests/commands-misc.test.ts`）：
- organize：`OrganizeService.organizePlayerInventory(player)` 调用参数正确（经 mock）
- menu：打开主菜单（ActionFormBuilder 构造断言）
- search：`searchItems(query)` → `ItemIndex.lookup` 聚合 → 结果列表
- help：分节发送（`showHelpSection`）

**实现**：
1. `organize.ts`：`ir:organize` → 整理玩家背包（调 core `OrganizeService`）
2. `menu.ts`：`ir:menu` → `MainMenu.show()`
3. `search.ts`：`ir:search <关键词>` → `SearchUI` 搜索 + 粒子标记
4. `help.ts`：`ir:help [章节]` → `HelpGuide`

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 整理/菜单/搜索/帮助命令`

---

## Task 9：MainMenu + NewPlayerGuide + HelpGuide

**失败测试先行**（`tests/ui-main.test.ts`）：
- 主菜单按钮：容器搜索/管理仓库/仓库列表/创建仓库/配置（配置仅 `canManage(player)` 显示）
- 首次打开触发 `NewPlayerGuide`（`hasSeenGuide` false 时）；之后不再触发
- `HelpGuide` 分节索引正确（§12 章节列表）

**实现**：
1. `MainMenu.ts`：ActionFormBuilder 主菜单（v1 同款结构，配置按钮按管理员显示）
2. `NewPlayerGuide.ts`：`tryShowNewPlayerGuide(player)` → 引导页 → `markSeenGuide()`
3. `HelpGuide.ts`：`showHelpGuide(player)` 全部分节 + `showHelpSection(player, index)`

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 主菜单与引导帮助`

---

## Task 10：WarehouseCreateFlow

**失败测试先行**（`tests/ui-create.test.ts`）：
- 表单字段：名称/默认角色（input/single/multi/misc）/默认启用
- 提交后 `SelectionSessionStore.set(playerId, {kind:"createWarehouse", ...})` 且提示"手持信物右键两个对角方块"
- 角色选项标签来自 core `ROLE_LABELS`（新枚举）

**实现**：`WarehouseCreateFlow.ts`：ModalFormBuilder 建仓表单 → 写选区会话 → 提示信物操作（v1 同款流程，角色枚举换新）。

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 建仓流程表单`

---

## Task 11：WarehouseManageMenu + WarehouseSettingsMenu

**失败测试先行**（`tests/ui-manage.test.ts`）：
- 仓库列表：管理员（`canManage`）显示全部仓库；普通玩家仅显示 `getRole !== undefined` 的仓库；按名称排序
- 设置表单：名称/默认角色/启用/速度（`ProcessingSpeed` 选项 4/8/16/20/30/40）
- 底部操作：刷新容器/修复/删除（owner）/刷新统计/成员管理/调整区域
- 删除需确认框（ActionForm 二次确认）

**实现**：
1. `WarehouseManageMenu.ts`：列表 → 选中 → `WarehouseSettingsMenu`
2. `WarehouseSettingsMenu.ts`：ModalForm 设置 + 底部操作按钮（v1 同款，权限按 `requireRole` 分级显示）

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 仓库管理与设置菜单`

---

## Task 12：ContainerRoleMenu + MemberMenu

**失败测试先行**（`tests/ui-role.test.ts`）：
- 容器角色菜单：显示当前角色/状态（容量、物品数）；`isHopper` → 强制 input 且不可改
- 角色变更：member+ 可改；`RouteService.setContainerEnabled` 联动
- 成员菜单：owner 可见；`addMember(playerName, role)` / `setMemberRole` / `removeMember` 调 core 正确
- 角色选项：owner/member/visitor 三档

**实现**：
1. `ContainerRoleMenu.ts`：容器状态 + 角色 ModalForm（v1 同款，角色枚举换新 + `ROLE_LABELS`）
2. `MemberMenu.ts`：成员列表 + 添加/改角色/移除（基于 `MemberService`）

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 容器角色与成员管理菜单`

---

## Task 13：SearchUI + StatsUI

**失败测试先行**（`tests/ui-search-stats.test.ts`）：
- 搜索：`searchItems(query)` → typeId 列表 → `ItemIndex.lookup` 聚合 → 结果（物品名/数量/所在容器）；无结果返回"未找到"
- 粒子标记：`startMarkerParticles` 状态机（持信物续时/10s 倒计时/3s 宽限期，v1 同款）；`stopMarkerParticles` 清理
- 统计双视图：按类型（byType：物品→数量）+ 按物品（byItem：数量/堆叠数/所在容器）；`CAPACITY_WARNING_THRESHOLD` 满仓警告标记
- 统计页数据来自 `StatsService.getWarehouseStats()`（mock 断言）

**实现**：
1. `SearchUI.ts`：ModalForm 搜索 + 紫色粒子标记（v1 同款，`PARTICLE_INTERVAL=20`/`DEFAULT_DURATION=15*20`/`GRACE_DURATION=3*20`/`activeMarkerHandles`）
2. `StatsUI.ts`：双视图统计页（Table 渲染，新增模块）

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 搜索与统计页`

---

## Task 14：ConfigUI

**失败测试先行**（`tests/ui-config.test.ts`）：
- 仅管理员（`canManage`）可打开
- 信物选择：TOKEN_OPTIONS 列表 → `setTokenItemId`
- 全局开关：`RouteService.setGlobalEnabled`；速度上限：`setGlobalSpeedLimit`（clamp 1-40）
- 全服统计：仓库数/容器数/物品数（`StatsService` 聚合）

**实现**：`ConfigUI.ts`：管理员面板（v1 同款，字段映射到新 McModConfig + RouteService）。

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 模组配置面板`

---

## Task 15：ToolInteractionController（信物交互总控）

**失败测试先行**（`tests/interaction.test.ts`）：
- 手持信物右键容器：无会话 → 容器角色菜单；有 createWarehouse 会话 → 记录角点1；有 resizeWarehouse 会话 → 记录角点1
- 手持信物对空右键：无会话 → 主菜单；有会话 → 记录角点2 → 完成创建/调整
- 潜行右键容器 → 快速整理（`OrganizeService`）
- 非信物手持 → 不拦截（返回 false）
- `DEBOUNCE_MS=250` 防抖（同 tick 双击只处理一次）

**实现**：`ToolInteractionController.ts`：`registerToolInteraction(bus, store, ...)` 注册 `world.afterEvents.itemUseOn` + `itemUse`（v1 同款结构，权限/角色换新）。

**验证**：`pnpm test:core` 通过；`tsc` 无错。
**提交**：`item-route@0.1.0: 信物交互控制器`

---

## Task 16：SortEffects + BoundaryDisplay + RP 粒子资源

**失败测试先行**（`tests/effects.test.ts`）：
- 角色→颜色映射：input 金色 / single 浅绿 / multi 天蓝 / misc 粉红（v1 同款色值）
- `playSortEffect` 参数：`CHEST_SIZE=0.96` / `FULL_BLOCK_SIZE=1.08`；粒子 identifier `itemroute:sort` / `itemroute:deposit`
- `BoundaryDisplay`：`start(warehouseId, area, dimensionId)` 12 棱线框（`STEP=0.6`/`REFRESH_INTERVAL=40`/`TEMP_DURATION_TICKS=200`/`PROXIMITY_MARGIN=8`）；显示条件：`showBoundary` + 附近玩家 + 手持信物；临时边界不需信物
- 订阅 `bus.visualEffect`：kind=route-flash → 播放闪光；kind=boundary-glow → 临时边界；kind=particle → 粒子；维度内无玩家 → 跳过

**实现**：
1. 复制 v1 粒子 JSON 到 `RP/ItemRoute/particles/itemroute/sort.particle.json` + `deposit.particle.json`，identifier 改 `itemroute:*`，纹理路径改 `textures/itemroute/particle/*`；复制渐变纹理到 `RP/ItemRoute/textures/particle/`
2. `SortEffects.ts`：`playSortEffect`/`playSearchEffect`（v1 同款，identifier 换新）
3. `BoundaryDisplay.ts`：v1 同款类，订阅 `bus.visualEffect` 驱动

**验证**：`pnpm test:core` 通过；`tsc` 无错；RP 粒子 JSON 语法校验（`jq`）。
**提交**：`item-route@0.1.0: 视觉反馈与粒子资源`

---

## Task 17：main.ts 装配扩展 + 全量验证收尾

**失败测试先行**（`tests/main-assembly.test.ts`）：
- 4 Phase 装配：Phase 3 注册 9 命令 + 信物交互 + 视觉订阅；Phase 4 延迟启动
- 视觉订阅在 `system.run` 内注册（世界状态操作约束）

**实现**：
1. `scripts/mc/main.ts` 扩展：Phase 3 调 `registerAllCommands` + `registerToolInteraction` + `SortEffects/BoundaryDisplay` 订阅；Phase 4 启动
2. 全量验证：`pnpm test:core` 全绿 + `tsc` 无错 + `pnpm run build:item-route` 通过

**游戏内冒烟清单**（与 mc 计划 Task 16 合并执行）：
1. `ir:create 测试仓 0 64 0 10 70 10` → 成功提示
2. 手持信物右键容器 → 角色菜单；设 input → 存入物品 → 路由闪光粒子
3. `ir:search 钻石` → 结果 + 紫色粒子标记
4. `ir:menu` → 主菜单 → 统计页双视图
5. 非 owner 玩家 `ir:delete` → 权限拒绝中文提示
6. 成员添加/移除 → 权限变化生效
7. 信物切换（ConfigUI）→ 新信物可交互、旧信物失效

**提交**：`item-route@0.1.0: 交互层装配与冒烟验证`

---

## 自审清单

- [ ] 9 命令全部经 `MemberService` 权限校验，无 OP 二元残留
- [ ] 角色枚举统一用 core `ContainerRole`（input/single/multi/misc），无 normal/bulk
- [ ] 视觉反馈全部经 `bus.visualEffect` 事件驱动，无直接耦合 core 内部
- [ ] 所有 MC API 调用在 `system.run`/事件处理器内；纯逻辑（Table/SelectionSessionStore/权限/粒子参数）可单测
- [ ] 面向玩家消息中文；调试日志英文 `[item-route]` 前缀
- [ ] 粒子 identifier 与纹理路径与 RP 资源一致
- [ ] 无玩家在场不播放视觉反馈
- [ ] 冒烟清单 7 项全部通过