# Design

## Context

迁移源：`/home/yinxin/coding/MCBE/mcaddon/item-route`（版本 `0.1.20`，118 个 TS 源文件，32 个测试文件 / 286 条用例全绿）。迁移目标：本仓库 `mods/item-route/`。

需要解释清楚现状的五个事实（动机见 `proposal.md`）：

1. **上游是 pnpm monorepo 的一个 addon 包**，包名 `item-route`（无 scope），`mcbe.bp` / `mcbe.rp` 指向 `BP/ItemRoute` / `RP/ItemRoute`；打包走 `@minecraft/core-build-tasks` 的 `mcaddonTask` + 自研 `@yinxe/toolkit-build` 的 `syncManifestVersion`，产物落在模组内的 `dist/packages/`。
2. **上游 25 个文件从 `@yinxe/toolkit` 导入**，只用到 5 个符号：`defineCommand`（10 个文件 / 9 处调用）、`canManage`（9 个文件 / 10 处调用）、`ModalFormBuilder`（10 个文件）、`ActionFormBuilder`（7 个文件）、`HudManager`（1 个文件）。其中 `defineCommand` 与 `canManage` 在本仓库的 `packages/mod-common` 里**刻意不存在**（`packages/mod-common/src/index.ts` 头注释：「命令注册封装（defineCommand 等价物，各模组自己写）」「玩家权限判定（canManage 这类模组级策略」），其余三个符号在 `mod-common` 中已有对应实现。
3. **`@minecraft/vanilla-data` 是真实运行时依赖**：`scripts/core/data/ItemNameMap.ts:23` 有 `import { MinecraftItemTypes } from "@minecraft/vanilla-data";`，用于 `buildFullUniverse()` 构造 `FULL_ITEM_IDS`（「全量物品宇宙」，保证 `raw_iron`、`wolf_armor`、`trial_key` 这类预计算表未覆盖的条目可搜）。上游版本 `1.26.20`，注释标明对应「1.21.94 世代」。该包是纯数据包，esbuild 打包时内联进 `main.js`。
4. **上游的类型基线是 `@minecraft/server` 2.8.0**（pnpm `overrides` 全仓收敛），但本仓库各模组各自固定版本（`teleporter` 2.3.0、`spectator-mode` 2.1.0、`keepinventory` 2.0.0），且 `packages/mod-common` 的 devDependency 为 2.0.0、peerDependency 为 `>=2.0.0`。
5. **上游的测试 tsconfig 是白名单式的**：`tsconfig.test.json` 的 `include` 除了 `scripts/core/**/*.ts` 与 `tests/**/*.ts`，还显式列了 8 个 `scripts/mc/` 下的文件，并 `exclude` 了 `scripts/mc/storage/DynamicPropertyStore.ts`（该文件是唯一 import `@minecraft/server` 的存储文件，注释说明「因此本文件不进 node 测试构建」）。这 8 个文件里 6 个是纯逻辑（`storage/ShardStore.ts`、`storage/McModConfig.ts`、`ui/Table.ts`、`interaction/SelectionSessionStore.ts`、`interaction/interactionLogic.ts`、`commands/auth.ts`），另外 2 个（`effects/SortEffects.ts`、`util/playerName.ts`）**确实 import `@minecraft/server`**——它们能编过是因为类型可用，能跑过是因为测试只引用其中的纯常量/纯函数、从不触发模块级副作用。

## Goals / Non-Goals

**Goals:**

- 让 `item-route` 在 `mods/item-route/` 下用本仓库的 `just.config.ts` + `@mc-toolchain/mod-packaging` 走通「构建 → 同步版本 → 打出双包 `.mcaddon` → 落到 `release/`」全链路，并保持 286 条单测可跑。
- 把上游的适配层从 `@yinxe/toolkit` 完全剥离，且**不新增共享包 API**：能复用 `mod-common` 的直接复用，`mod-common` 刻意不提供的（命令注册、OP 判定）在模组内实现。
- 保持可观察行为不变：9 条 `ir:*` 命令的名称/参数/权限矩阵、信物交互流程、五级路由优先级、持久化键空间、两个包的 UUID 全部照搬。

**Non-Goals:**

- 不重构上游的业务逻辑（不合并/拆分 `core/` 的模块边界，不优化路由算法）。
- 不修改 `packages/mod-common` 与 `packages/mod-packaging` 的任何源文件与规格。
- 不为 `item-route` 补新功能（如新的命令、新的界面）。
- 不做「顺便统一全仓 Script API 版本」这类跨模组改动。

## Decisions

### 决策 1：包目录用官方全名，包名加 scope

`mods/item-route/behavior_packs/item-route/` 与 `mods/item-route/resource_packs/item-route/`，`package.json#name` 为 `@mc-toolchain/item-route`。

- 依据：`mod-workspace` 的「包目录的命名约定」明确要求 `behavior_packs/<name>/`、`resource_packs/<name>/` 且 **MUST NOT** 用 `BP` / `RP` 缩写；`.env` 的 `PROJECT_NAME` MUST 与包目录名一致（`just.config.ts` 用 `./behavior_packs/${projectName}` 定位）。
- 替代方案：保留 `BP/ItemRoute` 并在 `just.config.ts` 里特判。否决——`mod-packaging` 的包探测只认 `behavior_packs` / `resource_packs` 两个顶层目录名，缩写目录会直接探测不到包。
- 资源包目录名与行为包同名是安全的：`mod-packaging` 按 `manifest.json` 的 `modules[].type` 判定类型（含 `data`/`script` → 行为包，含 `resources` → 资源包），不靠目录名。

### 决策 2：不新增 `mod-common` API，命令注册与 OP 判定落在模组内

对照表（上游符号 → 迁移后落点）：

| 上游 | 迁移后 | 说明 |
|---|---|---|
| `defineCommand(registry, config, handler)` | `mods/item-route/scripts/mc/commands/register.ts` 的 `registerPlayerCommand` | 见下文 |
| `canManage(player)` | `mods/item-route/scripts/mc/auth/admin.ts` 的 `canManage(player)` | 见下文 |
| `ModalFormBuilder` / `ActionFormBuilder` | `@mc-toolchain/mod-common` | 调用面完全兼容，零改动 |
| `HudManager` | `@mc-toolchain/mod-common` | 调用面完全兼容，零改动 |

**命令注册**：`mods/teleporter/scripts/mc/commands.ts` 里已有本仓库既定的等价写法（`registerPlayerCommand`：解包位置参数 → 校验来源是玩家 → `runSafeDetached` 推迟 → 返回 `CustomCommandResult`）。`item-route` 照此实现。上游的 `scripts/mc/commands/defs.ts` 四个工厂（`regionCommand` / `nameCommand` / `queryCommand` / `noParamCommand`）返回原生 `CustomCommand`，与 `defineCommand` 的 `config` 参数完全同构，可直接作为 `registerPlayerCommand` 的第二个参数，**无需改动**。**注意**：上游 `defineCommand` 用 `runSafeAsync`，本仓库的等价物是 `runSafeDetached`（`mod-common` 提供），两者都在 `system.run` 内执行，差异仅在错误处理——`runSafeDetached` 把异常写 `console.warn` 而不是变成 unhandled rejection，这正是 `mod-common` 规格「执行助手不吞掉回调异常」要求的行为。另需注意上游 `commands/*.ts` 里 `registry` 的类型写成 `Parameters<typeof defineCommand>[0]`，迁移时改为 `CustomCommandRegistry`。

**OP 判定**：上游 `canManage` 就是 `player.playerPermissionLevel >= PlayerPermissionLevel.Operator`（`~/coding/MCBE/packages/toolkit/src/player.ts:12-14`）。`teleporter/scripts/mc/detection.ts` 的 `isAdmin` 在此之上加了 `hasTag("op")` 兜底。迁移时用**最小实现**（只判 `playerPermissionLevel`），与上游语义完全一致，不加标签兜底——加兜底会扩大 OP 面，属于行为变更。

- 替代方案 A：把 `defineCommand` 提升进 `mod-common`，让三个模组共用。否决——`mod-common` 的头注释是刻意决定（命令注册是模组级策略），改动它需要连带改 `mod-common` 规格与另两个模组的消费方式，超出迁移范围。
- 替代方案 B：直接复制 `~/coding/MCBE/packages/toolkit/src/command/index.ts` 到模组内。否决——那份实现 `import { runSafeAsync } from "../ui/runSafe"`，而 `mod-common` 的对应物是 `runSafeDetached`；照抄会引入一个模组内自建的执行助手，与 `mod-common` 规格「执行助手已内含 `system.run`，模组不得再包一层」冲突。

### 决策 3：Script API 版本固定为 `2.1.0`，`minimum_engine_version` 显式写 `[1, 21, 100]`

**这一条已用真实编译验证，不是推测。** 做法：把上游 `scripts/` 复制到临时目录（`/tmp/ir-check`），装上 `@minecraft/server` 2.1.0、`@minecraft/server-ui` 2.0.0 与 `@minecraft/vanilla-data` 1.26.20，把 25 个文件的 `@yinxe/toolkit` import 换成本仓库真实的 `packages/mod-common`，补上 `mc/auth/admin.ts` 与 `mc/commands/register.ts`，然后 `tsc` 全量编译整个 `scripts/` 目录——**结果 0 错误**。同一套代码用上游白名单式 `tsconfig.test.json` 编译 + `node --test`，输出 `# tests 286 / # pass 286 / # fail 0`。

- 选 `2.1.0`：它是本仓库已有模组在用的最高版本（`spectator-mode`），也在 `mod-common` peerDependency（`>=2.0.0`）的下界之上；`mod-packaging` 的映射表里有 `2.1.0 → [1, 21, 100]`。
- 上游的 `@minecraft/server: ^2.0.0` 在本仓会解析成 workspace 内最新的可满足版本，不可复现；`^` 也不符合本仓库各模组「精确固定」的既有写法。
- `minimum_engine_version` **显式写**而不是靠推导：上游清单写的是 `[1, 21, 90]`（对应脚本 API 2.0.0），与实际需要的 2.1.0 不符；`mod-packaging` 的推导只读 `@minecraft/server` 依赖版本，虽然这次推导结果恰好也是 `[1, 21, 100]`，但显式声明让「最低版本」成为可审查的意图而不是依赖版本号的副产品。
- 编译能过的一个关键原因：`scripts/mc/adapters/McEventBridge.ts:44-60` 用**结构类型 + 运行时特性检测**订阅 `blockContainerOpened` / `blockContainerClosed`（这两个事件在 2.1.0 的类型里不存在）。注释写明「编译期不依赖 2.8 类型 → 与共享 `@yinxe/toolkit`（2.6.0）类型一致，不产生跨包冲突」。降到 2.1.0 反而更契合它原本的设计意图。

- 替代方案：跟上游一致用 2.8.0。否决——`mod-common` 的 devDependency 是 2.0.0，模组用 2.8.0 会让共享包类型与模组侧类型出现两份 `@minecraft/server` 实例（本仓 `npm workspaces` 的提升规则下可复现，`spectator-mode` 的 2.1.0 就是这样装的），跨包类型冲突是已知痛点。若后续确需 2.8.0，改动是把 `package.json` 的版本提到 `"2.8.0"` 并把 `minimum_engine_version` 改成 `[1, 26, 30]`，不牵动规格。

### 决策 4：`@minecraft/vanilla-data` 必须迁入，版本锁 `1.26.20`

`proposal.md` 的依赖清单里它是三项之一。理由：

- 它不是「注释里提到的包」——`scripts/core/data/ItemNameMap.ts:23` 是真实的 `import`，`FULL_ITEM_IDS` 由 `MinecraftItemTypes` 的枚举值构造，物品搜索的「全量宇宙」完全依赖它。去掉它，搜索退化成只能搜预计算表覆盖的条目，`raw_iron` 这类会直接搜不到。
- 它不需要额外的 manifest 模块声明：`just.config.ts` 的 `external` 只列 `@minecraft/server` 与 `@minecraft/server-ui`，`vanilla-data` 是纯数据包，会被 esbuild 内联进 `dist/scripts/main.js`。上游注释也明确这一点（「esbuild 打包时内联进 main.js，无需额外 manifest 模块」）。
- 版本锁 `1.26.20`（不带 `^`）：上游注释标注该映射表对应「1.21.94 世代」，而本仓根 `node_modules` 里的 `vanilla-data` 是 `1.26.60`。换版本会改变 `MinecraftItemTypes` 的枚举集合，进而改变可搜物品范围与 `FULL_ITEM_IDS` 的内容——这是可观察行为变更，迁移不该顺手做。

### 决策 5：`tests/tsconfig.json` 保留白名单式 `include`，不缩到 `core/` 单目录

迁移后 `mods/item-route/tests/tsconfig.json` 的 `include` 与上游 `tsconfig.test.json` 等价（路径改为 `../scripts/...`），保留那 8 个 `scripts/mc/` 文件的显式条目与 `DynamicPropertyStore.ts` 的 `exclude`。

- 理由：这 8 个文件共被 9 个测试文件覆盖（`mc-mod-config`、`mc-warehouse-store`、`mc-stats-store`、`shard-store`、`table`、`selection-session`、`interaction`、`player-name`、`command-auth`；`SortEffects` 被 `effects` 用例引用其常量模块 `ParticleIds`）。缩到 `core/` 会让这些用例因缺少编译入口而静默不跑——`node --test ".test-build/tests/**/*.test.js"` 只跑编译产物，缺文件不会报错，只会少跑。
- 与 `spectator-mode` 的 `tests/tsconfig.json`（`include: ["../scripts/core/**/*.ts", "**/*.ts"]`）的差异是**故意的**：那个模组的 `mc/` 层文件都 import `@minecraft` 且测试不引用它们；`item-route` 这批文件被测试直接引用，所以必须编进来。
- **已验证**：按此 `include` 列表编译后跑 `node --test`，输出 `# tests 286 / # pass 286 / # fail 0`。
- 已知脆弱点：`effects/SortEffects.ts` 与 `util/playerName.ts` 确实 import `@minecraft/server`，它们能进测试构建是因为**类型可解析**、且测试只触及其中的纯常量（`SORT_PARTICLE`、`DEPOSIT_PARTICLE` 在 `effects/ParticleIds.ts`）与纯函数（`playerNameOf`）。`SortEffects.ts` 的模块级代码不执行 `@minecraft` 调用，所以 `node --test` 不崩。迁移时不要「顺手」让测试 import 这两个模块的运行时值。

### 决策 6：`mc/` 层的目录结构原样保留

上游 `scripts/` 下是 `core/` + `mc/` + `main.ts` 三层，与本仓库 `spectator-mode` / `teleporter` 的约定一致（`core/` 纯逻辑、`mc/` 适配、`main.ts` 组合根），**不需要重排**。`mc/` 下的子目录（`adapters` `bootstrap` `commands` `container` `effects` `events` `interaction` `persistence` `storage` `ui` `util`）原样保留。

- 唯一的调整是新增 `mc/auth/`：上游的 `commands/auth.ts`（权限矩阵，纯逻辑，不 import `@minecraft`）**移位**为 `mc/auth/commands.ts`（不是复制——两处并存会让 `commands/auth.ts` 变成没人用的死文件），新增的 `mc/auth/admin.ts`（`canManage`，import `@minecraft`）放在旁边。这样 `commands.ts` 保持纯净、继续留在测试白名单里。**注意**：`tests/tsconfig.json` 的 `include` 条目要跟着从 `scripts/mc/commands/auth.ts` 改成 `../scripts/mc/auth/commands.ts`，`tests/command-auth.test.ts` 的 import 路径要同步，另有三处 UI 文件的 `from "../commands/auth"` 要改成 `from "../auth/commands"`（`ui/FamilyConfigMenu.ts:9`、`ui/WarehouseSettingsMenu.ts:11`、`ui/ContainerRoleMenu.ts:12`）。

### 决策 7：持久化键空间与 UUID 不变

- 持久化用 `world.setDynamicProperty` 分片（`ShardStore`，前缀 `ir2:`）+ 每容器/每仓库的独立键。迁移时**不改**这些字符串，否则玩家既有世界的仓库数据会全部读不出来（表现为「仓库消失、容器变成未分配」）。
- 两个包及四个模块的 UUID 全部照抄上游清单（见 `proposal.md`「What Changes」）。改 UUID 会让游戏把新包当另一个包，既有世界需要重新启用、旧数据成为孤儿。

### 决策 8：两个包都生成 `pack_icon.png`

上游两个包目录里**没有** `pack_icon.png`（`BP/ItemRoute` 只有 `manifest.json`，`RP/ItemRoute` 只有清单 + 粒子 + 纹理）。`pack-icon` 规格要求行为包在包目录根部提供 128×128 RGBA 图标；资源包虽未被该规格点名，但 `addon-packaging` 的 `mcaddon` 会原样打包资源包目录，缺图标会让资源包在游戏内显示为空白。

- 做法：参照 `mods/spectator-mode/tools/generate-pack-icon.js` 写一个生成脚本（像素画风格、有限色板、语义对应「分拣/仓库」），产物写入两个包目录。仓库内现有 5 个模组的图标都在行为包，本次是第一次需要资源包图标，因此在 `mods/item-route/README.md` 记录该脚本的用法。

## Risks / Trade-offs

- **[拆掉 `defineCommand` 后推迟职责落空]** → 表现是「命令返回成功但什么都没发生」，因为回调里的容器操作在受限上下文里会静默失败或被引擎拒绝。缓解：`registerPlayerCommand` 直接照 `teleporter/scripts/mc/commands.ts` 的既有实现写（该实现已在产线跑了 16 条命令），并在验收清单里要求**逐条实测 9 条命令的副作用**（建仓、改区、删仓、重扫、预览、整理、搜索、开菜单、帮助），而不是只看命令返回值。
- **[测试白名单漏项导致用例静默减少]** → `node --test` 只跑编译产物，缺文件不报错。缓解：迁移后立即跑 `npm test -w @mc-toolchain/item-route`，把输出里的 `# pass` 与上游的 286 对齐；不等则逐个补 `include` 条目而不是删用例。已在设计阶段验证该配置能跑满 286 条。
- **[`SortEffects.ts` / `playerName.ts` 把 `@minecraft` 带进测试运行时]** → 这两个文件在测试构建里，若有人让测试 import 其运行时值（而非 `ParticleIds` 的常量或 `playerNameOf` 纯函数），`node --test` 会在 `import "@minecraft/server"` 处崩。缓解：tasks 里有一条「测试只引用这两个模块的纯常量/纯函数」的检查。
- **[双包布局在 `just.config.ts` 的 copy 阶段落错包]** → `copyTask` 的 `copyToBehaviorPacks` 默认只拷行为包，资源包需要 `copyToResourcePacks`（`CopyTaskParameters` 里该字段是可选，仓库内现有 5 个模组都没用过）。缓解：`just.config.ts` 显式写 `copyToResourcePacks: ["./resource_packs/${projectName}"]`，并在 tasks 里要求 `just pack` 后检查 `.mcaddon` 解包内容同时含两个包。
- **[产物落在模组目录内]** → 上游的 `mcaddonTask` 输出到 `./dist/packages/`。缓解：`packing.output: "../../release/"` 显式声明，`pack` 任务走 `createPackagesByMode`（`mod-packaging`），并在验收里检查模组目录无压缩包。
- **[vanilla-data 版本漂移]** → 根 `node_modules` 里是 `1.26.60`，上游锁 `1.26.20`。若迁移时写成 `^1.26.20` 或直接装根版本，可搜物品集合会变。缓解：`package.json` 写精确 `"1.26.20"`，tasks 里有一条版本断言。

## Migration Plan

1. **骨架**：建 `mods/item-route/`，写 `package.json`（版本 `0.1.20`、`packing` 三项、依赖为 `@minecraft/server: "2.1.0"` / `@minecraft/server-ui: "2.0.0"` / `@minecraft/vanilla-data: "1.26.20"`）、`just.config.ts`（照 `spectator-mode` 改两个 copy 数组）、`tsconfig.json`、`tests/tsconfig.json`、`eslint.config.mjs`、`.env`（`PROJECT_NAME="item-route"`）。
2. **静态包**：把 `BP/ItemRoute/manifest.json` → `behavior_packs/item-route/manifest.json`、`RP/ItemRoute/*` → `resource_packs/item-route/*`，UUID 保留、`min_engine_version` 按决策 3 处理；生成两份 `pack_icon.png`。
3. **源码搬迁**：`scripts/core/**`（55 个文件）与 `scripts/mc/**`（62 个文件）原样复制（保留目录层级），`main.ts` 保留；随后 `mc/commands/auth.ts` 移位为 `mc/auth/commands.ts`，并新增 `mc/auth/admin.ts` 与 `mc/commands/register.ts`（`mc/` 最终 64 个文件，全仓 120 个 TS 源文件）。
4. **剥离外部依赖**：改 25 个文件的 import（`ModalFormBuilder` / `ActionFormBuilder` / `HudManager` → `@mc-toolchain/mod-common`）；新增 `mc/commands/register.ts`、`mc/auth/admin.ts`，把 9 处 `defineCommand` 与 10 处 `canManage` 换成本地实现；`mc/commands/auth.ts` 移到 `mc/auth/commands.ts`；`scripts/mc/effects/WarehouseHUD.ts` 的 `HudManager` 参数（`modId: "item-route"`、`intervalTicks: 10`）与两个源（`session` 优先级 100、`warehouse` 优先级 80）保持不变。
5. **编译闭环**：`npm install` → `npm run build -w @mc-toolchain/item-route`。
6. **测试闭环**：`npm test -w @mc-toolchain/item-route`，把用例数对齐 286。
7. **打包验证**：`npm run pack -w @mc-toolchain/item-route`，检查 `release/item-route-v0.1.20.mcaddon` 存在、解包含两个包、模组目录无产物、两个 manifest 的版本/显示名/描述/`min_engine_version` 都由 `package.json` 派生。
8. **文档**：`mods/item-route/README.md`（模组说明 + 最低版本与 vanilla-data 版本取值依据 + 图标生成脚本用法）、`mods/README.md` 与根 `README.md` 的模组表补条目。
9. **回滚**：整个迁移只新增 `mods/item-route/` 与两处 README 条目，不改任何既有文件，`git revert` 或直接删除目录即可；上游仓库保持不动，随时可重新迁移。

## Open Questions

无。Script API 版本（决策 3）与测试配置（决策 5）这两条原本有不确定性，已在设计阶段用真实编译 + 真实跑测验证为 0 错误 / 286 通过，不再是开放问题。
