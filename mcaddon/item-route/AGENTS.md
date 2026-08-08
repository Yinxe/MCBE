# item-route — 物品路由仓库

MCBE 智能仓库管理 Add-On：自动分拣（路由）、容器整理、仓库统计、容量预警、信物交互。
本仓库是 monorepo 里的**参考架构**（六边形/分层）：业务逻辑（core）与 MC 运行时（mc）解耦。

> 通用代码规范（命名/导入顺序/JSDoc/错误处理/依赖注入/Minecraft 特有模式/版本流程）见根 `AGENTS.md`。
> 本文件只记 **item-route 独有**的命令、架构、约定。

---

## 目录结构

```
scripts/
├── main.ts          # 唯一 bundle 入口 + 4 Phase DI 组合根（只装配，不含业务）
├── core/            # 纯领域逻辑（**零 @minecraft 依赖**，可 node 单测）
│   ├── model/       # Container/Warehouse/ItemStack/ContainerId/Area/ContainerScan
│   ├── routing/     # Router + RouteStrategy + CandidateSorter + Move（原子移动）
│   ├── index/       # ItemIndex（O(1) 物品索引 + 三层兜底惰性校验）
│   ├── scheduling/  # Scheduler（生命周期状态机 + 每仓索引隔离）
│   ├── stats/       # StatsService（统计 + 两级容量预警）
│   ├── organizing/  # Organizer（混乱度模型）
│   ├── services/    # WarehouseService/RouteService/MemberService/OrganizeService
│   ├── events/      # EventBus + 领域事件（core 触发，mc 订阅副作用）
│   └── storage/     # 仓储接口 + InMemory 测试替身
└── mc/              # MC 适配层（只做副作用/IO：持久化/视觉/通知/交互）
    ├── adapters/    # 容器/物品/邻近/间隔调度/事件桥接/SafeProbe/背包容器
    ├── bootstrap/   # 持久边界/背包整理/效果注册（业务抽离）
    ├── commands/    # ir:* 命令（权限经 MemberService 矩阵）
    ├── effects/     # 视觉/播报/HUD/边界/通知
    ├── events/      # 中央订阅注册（Subscriptions.ts 单点收编领域事件）
    ├── interaction/ # 信物交互 + 选区会话
    ├── persistence/ # 索引生命周期 + 容器逐容器持久化
    ├── storage/     # DP 直存实现（每容器一条键）
    └── ui/          # ActionForm/ModalForm 菜单（中文）
```

## 命令（`ir:` 前缀）

| 命令 | 权限 | 说明 |
|------|------|------|
| `/ir:menu` | any | 主菜单（搜索/管理/建仓/帮助；管理员额外：模组配置） |
| `/ir:create <名称> <pos1> <pos2>` | any | 按两对角坐标创建仓库区域（校验体积/间距/同名/每玩家上限） |
| `/ir:resize <名称> <pos1> <pos2>` | owner | 调整仓库区域（区域变化 → ID 迁移 + 容器失效重扫） |
| `/ir:rescan <名称>` | member+ | 重扫区域补注册容器 |
| `/ir:rescan_preview <名称>` | member+ | 只读预览区域内容器清单 |
| `/ir:delete <名称>` | owner | 删除仓库（副作用经领域事件联动清内存/持久化键） |
| `/ir:organize` | any | 整理**玩家所在仓库**全部容器（就地类型排序 + 合并堆叠） |
| `/ir:search <关键词>` | member+ | 就近仓库搜物品 + 紫色粒子标记 |
| `/ir:help` | any | 帮助手册 |

权限矩阵：`owner > member > visitor`，由 `auth.ts COMMAND_MIN_ROLE` 声明 + `MemberService.can` 判定。
⚠️ 审查保留项：`ir:organize`/`ir:create` 当前为 any（非成员可整理他人仓容器/建仓，不丢物但有骚扰面）——如需收紧（member+）可改 COMMAND_MIN_ROLE。

## 核心设计约定（新代码遵循）

- **core 无副作用**：core 只发领域事件（EventBus），mc 层订阅做**持久化/视觉/通知**副作用。事件负载只用可序列化 string/number，不携带 MC 对象。
- **按需加载 + 统一生命周期**：启动只载仓库 meta（空容器表）；容器在**激活 / 菜单 / 命令访问**时 `ensureContainersLoaded` 按需加载，闲置（30 分钟）卸载。容器级数据（配置注册表 `ir2:c` / 统计 `ir2:cst`）生命周期一致，随仓库激活加载/卸载；**索引纯运行时**（激活全量重建、卸载即弃，不落盘）。
- **持久化最小单位**：容器级数据每容器一条 DP 键（`ir2:c:{cid}` / `ir2:cst:{cid}`），**事件驱动写穿、无定时 flush**；仓库 meta 单键（`ir2:wh:{id}:meta`）+ cids 索引（`ir2:wh:{id}:cids`）。容器 ID 全局唯一（不随仓库 resize 变），统计键无需迁移。
- **维度短名**：ID 内维度用短名（`minecraft:overworld` → `overworld`）；容器短名 `(x,y,z)@overworld`。
- **不吞/不覆盖/不刷物**：概念 `ItemStack` 是缩减视图（id/数量/堆叠上限），写回用 `McItemAdapter` 携带源 `mc.ItemStack`（`clone()` 保留全部 NBT/组件）；堆叠判定委托 `mc.addItem` 权威（NBT 级，防错误合并/刷物）。整理合并权也委托 `addItem`。
- **区块安全**：所有方块/容器访问 try-catch；`beforeEvents.playerInteractWithBlock` 回调**受限执行上下文**内不触世界/容器/UI 操作（延迟到 `system.run`），只做分支判断/读状态。
- **输入容器只在途不做统计**：`role="input"` 是"在途源"（物品短暂驻留即被路由走），仓库统计（`getWarehouseStats`/分角色/按类型/按物品）与容量预警一律 **排除 input**。
- **索引三层兜底**（漂移自愈）：① 代理信号（玩家交互/放置/破坏 → reconcile）② 策略侧惰性校验（候选命中时各策略自查绑定/contains，漂移重建）③ 空箱重绑。索引 miss 时 Router 触发 `selfHeal` 全仓扫描非 input/misc 重建。
- **路由热路径容器级**（itemRouted → 扫描目标 → containerScanned）：统计单容器增量、混乱度→自动整理、容量预警各自订阅，O(1)/单容器不每路由全仓扫描。满仓预警在输入阻塞时也评估（仓库满 → 路由失败 → input-blocked → 预警）。

## 测试

```bash
pnpm run test:core   # tsc -p tsconfig.test.json && node --test ".test-build/tests/**/*.test.js"
```

- core **零 @minecraft 依赖**，可被 `tsconfig.test.json` 单独编译进 node 测试；mc 层不进 node 测试构建。
- 测试文件 `tests/*.test.ts`，用 `node:test` + `node:assert/strict` + `InMemory*` 替身：
  `InMemoryContainer` / `InMemoryKeyValueStore` / `InMemoryWarehouseStore` / `MemoryIntervalScheduler` / `StubProximity`。
- 核心纯逻辑（routing/index/scheduler/stats/organize/services/ContainerId/几何/容器注册表）必须有单测覆盖；
  纯工具（圆心短名/BoundaryGeometry/formatCount/messiness）也有覆盖；**mc 适配/UI/交互层**改动靠游戏内冒烟（信物交互、粒子/音效、菜单、HUD）。

## 交互约定（信物）

- 默认信物 `minecraft:wooden_hoe`（管理员可在 模组配置 换信物，下拉显示中文名）。
- 手持信物右键（`beforeEvents.playerInteractWithBlock`）：
  - 点击容器 → 直通该容器配置模态；潜行点容器 → 单容器就地整理。
  - 点击非容器 → 选区模式（建仓/调区会话）/ 仓库菜单模式；潜行点非容器 → 背包整理（2 阶段：优先整理主栏 9-35，归零后再触发转清快捷栏 0-8，两区齐才完全干净）。
  - 不改变物品内容的交互（只点开盒）→ 依次走系统 run 延迟与系统 run（区块未加载则跳过）等。
- 长按（isFirstEvent=false）→ 潜行长按打开仓库菜单（取玩家位置）。

## 构建与提交

- 构建：`pnpm run build`（类型 + esbuild）；打包：`pnpm run pack`（BP/RP → .mcpack/.mcaddon）。
- 版本：`package.json#version`（构建自动同步到 BP/manifest + `version.ts`）；源码提交**排除** `version.ts`/`manifest.json`/`package.json`（release-only），只提交 `scripts/` 与 `tests/`。
- commit message：`item-route: <中文描述>`（不强制带版本，日常源码提交即可）。