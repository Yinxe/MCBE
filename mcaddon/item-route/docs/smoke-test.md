# 物品路由 · 游戏内冒烟清单（手动验收）

> 一键验收：把 `dist/packages/item-route-v0.1.0.mcaddon` 装进世界，逐条执行下表。
> node 测试（`pnpm test:core`，138 tests）覆盖纯逻辑；**此清单覆盖真实 MC 运行时**（容器/DP/事件/信物交互），是交付前必须人工过一遍的闭环。

## 前置

- [ ] `pnpm run build && pnpm run pack` 通过，产物 `dist/packages/item-route-v0.1.0.mcaddon`
- [ ] 一个允许作弊的命仓库世界（`min_engine_version 1.21.90`），已导入该 mcaddon
- [ ] 开服日志可读（`content-log` 打开），观察 `[item-route]` 前缀消息

---

## A 阶段：启动与建仓（P2 冒烟 · mc 计划 Task 16）

| # | 操作 | 预期 | 对应用例 |
|---|------|------|---------|
| A1 | 加载世界 | 日志 `[ItemRoute] 启动完成：0 仓库`，无异常栈 | `scripts/mc/main.ts` Phase 4 |
| A2 | `/ir:create 测试仓 <x1> <y1> <z1> <x2> <y2> <z2>`（如 `0 64 0 10 70 10`） | 中文成功提示「创建成功」+ **边界光幕**（粒子棱线框） | `commands/create.ts` + `BoundaryDisplay` |
| A3 | 在区域内放一个箱子 | 拾取箱自动注册为 single（`ContainerRoleMenu` 可见坐标） | `McEventBridge` playerPlaceBlock |
| A4 | 在箱子旁再放一个箱子（双箱） | **两个方块合并为一个逻辑容器**（occuoccupiedLocations 含两半） | `SafeProbe` 探针 |
| A5 | 放一个漏斗 | 自动注册为 **input**，且角色菜单中不可改（漏斗约束） | `McContainerFactory` finalRole |

## B 阶段：分拣与数据完整性（P2 + 数据安全）

| # | 操作 | 预期 | 对应用例 |
|---|------|------|---------|
| B1 | 往 input 容器放石头，旁边有已含石头的 multi 容器 | 石头被自动路由到 multi（`processingSpeed` tick 后），出现路由粒子 | `Scheduler` + `Router` + `SortEffects` |
| B2 | 用一把**附魔剑**走分拣 | 剑目标里**保留附魔/耐久**（对比 `A3` 的普通剑）| `McItemAdapter` `toMc` clone 保留组件 |
| B3 | 两把不同附魔的同型剑 → 触发整理 | **不错误合并**；`/ir:organize` 不因不可堆叠对报失败 | `McContainerAdapter.addItem`+`mc.addItem`、`Organizer.apply` 跳过 |
| B4 | 潜行 + 信物右键容器 | 快速整理当前仓库 | `ToolInteractionController` playerInteractWithBlock |
| B5 | 关闭分区拣开关（ConfigUI）→ 再放物品 | 不分拣；重新开启后恢复 | `RouteService.setGlobalEnabled` |

## C 阶段：搜索 / 菜单 / 权限（P3 冒烟 · 交互层计划 Task 17）

| # | 操作 | 预期 | 对应用例 |
|---|------|------|---------|
| C1 | `/ir:search 钻石` | 列出结果 + 紫色粒子标记命中容器 | `SearchUI` + `ItemNameMap.searchItems` |
| C2 | `/ir:menu` → 统计页双视图 | 按类型/按物品统计表格正常 | `StatsUI` + `StatsService` |
| C3 | 非 owner 玩家敲 `/ir:delete 测试仓` | 中文「需要 owner 权限」 | `commands/auth.ts` `COMMAND_MIN_ROLE` |
| C4 | owner 加成员 / 改角色 / 移除 | 权限随即变化生效 | `MemberMenu` + `MemberService` |
| C5 | ConfigUI 换信物 → 新信物可交互、旧信物失效 | 右键行为随信物切换 | `McModConfig.tokenItemId` + `isToken` |

## D 阶段：容量预警与持久化恢复（v1 沉淀回归）

| # | 操作 | 预期 | 对应用例 |
|---|------|------|---------|
| D1 | 把容器填到 ≥90% 容量 | 附近 8 格内玩家收到黄色预警消息 | `WarningRelay` + `StatsService.evaluateWarnings` |
| D2 | 重进世界（重启） | 仓库/容器/索引从 DP 恢复（日志「索引恢复/重建」），无需重扫 | `main.ts` Phase 4 + `McIndexStore` |
| D3 | 玩家离开世界 | 无阻塞、索引批量落盘 flush 无报错 | `McEventBridge` playerLeave |

---

## 失败 → 代码对照

| 现象 | 定位 | 检查 |
|------|------|------|
| 启动无「启动完成」 | `main.ts` 装配异常 | 全局 try-catch 已吞错，看 content-log 最前 `[item-route]` 行 |
| 建仓即崩/重叠误判 | `WarehouseService.createWarehouse` / `areaOverlaps` | 单测已锁，重点看坐标取整 |
| 双箱不合并 | `SafeProbe.probeDoubleChestSafely` | 探针写/恢复是否成功；`structure_void` 是否可入箱 |
| 分拣不动 | `Scheduler` 邻近检测 / `McProximityChecker` | 玩家是否在区域 16 格内；`settings.enabled` |
| 附魔丢失 | `McItemAdapter.toMc` | 确认 SOURCE 携带并走 `clone()` 分支（若丢，回退：setItem 复用槽位原堆）|
| 预警不发 | `WarningRelay` | 玩家是否同维度且 ≤8 格；`bus.warning` 是否触发 |
| DP 写异常 | `ShardStore` 预算/世代 | 单键信封≤26K；总量命中 `maxTotalBytes` 会打印「拒绝写入」并延迟重试 |

## 记录模板（逐条打勾 + 备注偏差）

```
A1 [ ] A2 [ ] A3 [ ] A4 [ ] A5 [ ]
B1 [ ] B2 [ ] B3 [ ] B4 [ ] B5 [ ]
C1 [ ] C2 [ ] C3 [ ] C4 [ ] C5 [ ]
D1 [ ] D2 [ ] D3 [ ]
备注：__________________________________
```