# Design

## Context

`mockplayer3` 是一份**已在生产环境运行**的模组（v3.0.32，146 个 TS 源文件，28 个测试文件），不是待设计的新系统。因此本次设计的全部取舍都服从一条主线：**把代码搬进本仓库，同时把「搬动」引入的风险压到最低**。凡是「迁移后行为可能变」的地方，一律选择保守方案；凡是「迁移后只是形式变化」的地方，才允许按本仓库规范重排。

上游的真实依赖面（`grep` 实测）：

| 外部包 | 引用次数 | 用到的符号 |
|---|---|---|
| `@yinxe/toolkit` | 30 个文件 | `color`(30)、`trySendMessage`(20)、`style`(14)、`ModalFormBuilder`(14)、`ActionFormBuilder`(5)、`MessageFormBuilder`(2)、`defineCommand`(1) |
| `@yinxe/nbt-data-storage` | 2 个文件 | `chunkFromAnchor`、`ItemStorage`、`regionId`、`shortDimension`、`StoredRegion` |
| `@yinxe/toolkit-build` | `just.config.ts` | `bundleOptions`、`copyOptions`、`syncManifestVersion` |
| `@yinxe/tool-strategy` | 0 | 无（`scripts/`、`tests/` 均零引用，直接删除） |

## Goals / Non-Goals

**Goals**

- 迁移后与上游在可观察行为上等价：命令、面板、存档、配额、权限、常加载、物品仓全部照旧。
- 版本号、依赖版本、包 UUID、模块依赖声明**完全不变**。
- 拆掉全部 `@yinxe/*` 依赖，使模组只依赖官方包与本仓库工作区包。
- 让 286 条离线单测继续可跑，且覆盖范围不缩小。

**Non-Goals**

- 不改进任何行为、不修 bug、不优化性能、不重命名命令或面板项。
- 不把 `domain`/`engine`/`application`/`interface` 四层改写成 `core`/`mc` 两层。
- 不迁移上游 `demo/` 演示 addon。
- 不处理「最低游戏版本声明与代码实际要求不符」这一既有缺陷（记录，不修改）。

## Decisions

### D1：保留上游的四层目录，不改写为 `core`/`mc`

上游分层是 `domain`(45) / `application`(21) / `engine`(45) / `interface`(32) + `Composition.ts` + `main.ts`。`item-route` 迁移时用的是 `scripts/core` + `scripts/mc` 两层，但那是因为它原本就接近两层。

**决策**：保持上游目录与文件位置不变。

**理由**：`domain` 与 `engine` 的边界在上游是有语义的——`domain` 是零 `@minecraft` 的纯逻辑（`tests/tsconfig.json` 的 `include` 就靠它），`engine` 是适配层。把 146 个文件搬位置意味着重写全部相对导入（平均每个文件 4~8 条），而收益只是「与本仓库其他模组形状一致」。迁移的第一目标是等价性，不是形状统一。**代价**：`mods/README.md` 需要说明本模组的目录约定与 `item-route` 不同。

### D2：`nbt-data-storage` 落 `packages/`，作为独立工作区包

它不是一个模组的私有实现：上游注释明确写着「多模组共享」「消费模组示例」，`ItemStorage` 是通用存储服务。放进 `mods/mockplayer3/scripts/` 会让它无法被其他模组复用，也违反本仓库 `packages/` = 共享层、`mods/` = 交付物的划分。

**决策**：`packages/nbt-data-storage/`，包名 `@mc-toolchain/nbt-data-storage`，版本 `0.1.21`，`main`/`types` 都指向 `src/index.ts`（与 `mod-common`、`mod-packaging` 同形，工作区内直接以源码引用，不预编译）。

**理由**：与既有两个共享包完全同构，零新增构建机制。`@minecraft/server` 放 `peerDependencies`（`>=2.0.0`，上游原值），避免库包把某个具体版本强加给消费模组。

### D3：`EventSignal` 收进库包自身，不进 `mod-common`

上游 `src/mc/events.ts` 从 `@yinxe/toolkit/src/events` **深路径**导入 `EventSignal`（注释解释了为什么不走 index 入口：避免顶层副作用）。

**决策**：在 `packages/nbt-data-storage/src/core/EventSignal.ts` 放一份自足实现（约 50 行：`Set` 存回调、快照遍历、`subscribe`/`unsubscribe`/`trigger`、订阅者异常隔离），`src/mc/events.ts` 改为相对导入。

**理由**：`EventSignal` 是纯 TS 无 `@minecraft` 依赖，放 `core/` 后可被 node 单测直接覆盖（上游正是因为它在外部包而无法测）。**不放进 `mod-common`** 的理由是：`mod-common` 的对外入口注释明确列出它刻意不包含的内容，且把事件原语加进去等于为一次迁移扩张共享包的 API 面；库包自带一份 50 行实现，耦合最低。代价是仓库里存在两份 `EventSignal`（`@yinxe/toolkit` 那份不进本仓库，所以实际只有一份）。

### D4：`defineCommand` 落模组内实现，不进 `mod-common`

`mod-common/src/index.ts` 头注释写明「刻意不包含：命令注册封装(defineCommand 等价物,各模组自己写)」。

**决策**：在 `mods/mockplayer3/scripts/interface/CmdKit.ts` 内实现本地版本，语义与上游逐条对齐：

- `registry.registerCommand(config, handler)`；
- `origin.sourceEntity ?? origin.initiator` 取执行者，非 `Player` 时返回 `{ status: 1, message: "该命令只能由玩家执行" }`；
- 按 `[...mandatoryParameters, ...optionalParameters]` 的位置顺序把 `args[i]` 映射到 `params[param.name]`；
- **把 handler 推迟到安全上下文执行**——上游用 `runSafeAsync`，本地用 `@mc-toolchain/mod-common` 的 `runSafeDetached`；
- 立即返回 `{ status: 0, message: undefined }`。

**理由**：`runSafeDetached` 与上游 `runSafeAsync` 语义一致（`system.run` + 吞掉异常转 `console.warn`），直接复用共享包即可，不必自己写 `system.run`。这正是 `CmdKit.ts` 现有 `defineCommand` 调用点唯一需要改的地方——**调用点不动，只换实现来源**。

### D5：`minimum_engine_version` 显式钉 `[1,21,130]`，不推导

`mod-packaging` 的 `resolveMinimumEngineVersion` 在 `packing.minimum_engine_version` 缺失时会按 `@minecraft/server` 依赖版本查表推导。上游依赖 `2.8.0`，查表得 `[1,26,30]`（`packages/mod-packaging/src/versions.ts:28`）。这会把模组的最低游戏版本从 `1.21.130` 抬到 `1.26.30`，等于把大量现有玩家挡在门外。

**决策**：`package.json` 的 `packing.minimum_engine_version` 显式写 `[1,21,130]`。

**理由**：显式值优先于推导，这是 `mod-packaging` 的既定行为（`versions.ts` 中显式配置短路返回）。用户明确要求版本完全不变。

### D6：行为包 `module_name` 依赖原样保留 `"beta"`

上游行为包 `dependencies` 里 `@minecraft/server` 与 `@minecraft/server-gametest` 都是 `"beta"`（字符串，非三段数组），`@minecraft/server-ui` 是 `"2.0.0"`。

**决策**：原样保留这三个值。

**理由**：已核实 `packages/mod-packaging/src/packs.ts:60-72` 的 `synchronizePackVersions` 只同步四类内容——`header.version`、`modules[].version`、`header.min_engine_version`、以及**带 `uuid` 字段的依赖项**的 `version`。`module_name` 型依赖不含 `uuid`，不会被触碰。因此这三个值可原样保留，无需任何额外配置。

`"beta"` 的必要性：`@minecraft/server-gametest` 全生态只有 beta/internal 版本（`1.0.0-beta.1.26.0-stable`），没有 stable，而模组 15 个文件依赖 `spawnSimulatedPlayer`、`SimulatedPlayer`、`LookDuration`、`register`/`Test`。所以模组运行时**必须**要求世界开启 Beta APIs 实验开关——这是上游既有事实，不是迁移引入的。

### D7：`tests/tsconfig.json` 保留 `domain` + `engine` 双目录

上游 `include` 是 `["scripts/domain/**/*.ts", "tests/**/*.ts"]`，但 `tests/engine.FishingSim.test.ts` 导入 `../scripts/engine`。它能跑通是因为 `tests/stubs/MinecraftRuntime.ts` 装了 CommonJS 解析钩子，把 `@minecraft/*` 与 `@yinxe/toolkit` 这些裸模块名解析成自动桩（任意属性/调用/构造都返回自身的 Proxy）。

**决策**：迁移后 `include` 扩为 `["scripts/domain/**/*.ts", "scripts/engine/**/*.ts", "tests/**/*.ts"]`，`STUBBED` 列表把 `@yinxe/toolkit` 换成 `@mc-toolchain/nbt-data-storage`（因为 `engine/ItemVault.ts` 会导入它）。

**理由**：只保留 `domain` 会让 `engine.FishingSim.test.ts` 失去编译入口而静默不跑。桩机制必须跟着依赖面一起改，否则 `ItemVault` 在测试里会 `MODULE_NOT_FOUND`。

### D8：`@minecraft/math` 与 `@minecraft/vanilla-data` 保留声明

`grep` 实测：`@minecraft/math` 在 `scripts/` 零引用（仅出现在 `tests/stubs` 的 `STUBBED` 列表里）；`@minecraft/vanilla-data` 在 `scripts/engine/Placer.ts:15`、`scripts/engine/Scanner.ts:28`（`MinecraftBlockTypes`）与 `tests/domain.Harvest.test.ts:5` 真实引用。

**决策**：两者都保留在 `dependencies` 里，版本钉上游原值（`2.2.7` / `1.26.20`）。

**理由**：`vanilla-data` 是真实依赖，必须留。`math` 虽无 `scripts/` 引用，但它在 `STUBBED` 列表里，且删掉它属于「顺手清理」，与迁移目标无关；保留的代价是一次无害的安装。

### D9：`demo/` 不迁移

上游 `nbt-data-storage/demo/` 是一个独立可打包的演示 addon（自带 `manifest.json`、`just.config.ts`、5 个脚本）。

**决策**：不迁入。

**理由**：它是示例而非库的一部分；本仓库对演示的既有形态是「各模组在游戏内实测」，不存在 `demo/` 约定。迁入会多出一个需要维护的 addon，且它的 `just.config.ts` 又依赖 `@yinxe/toolkit-build`。

## Risks / Trade-offs

**R1 — 最低游戏版本声明与代码实际要求不符（记录，不修改）**

上游 `manifest.json` 写 `min_engine_version [1,21,130]`，对应 `@minecraft/server` 2.4.0（`versions.ts:32`）。但 `scripts/engine/TickingAreas.ts:89/91/133/134/182/216`、`scripts/engine/Rig.ts:262/267/292`、`scripts/interface/Commands.Admin.ts:152` 直接调用 `world.tickingAreaManager`，且无任何存在性判空。

实测验证（`/tmp/mp3check`，把上游 `scripts/` 全量拷出后分别用不同 `@minecraft/server` 版本编译）：

| `@minecraft/server` | 对应游戏版本 | 编译结果 |
|---|---|---|
| 2.4.0 | 1.21.130 | 8 处 `TS2339: Property 'tickingAreaManager' does not exist on type 'World'` |
| 2.5.0 | 1.26.0 | 同样报错（`grep -c tickingAreaManager` = 0） |
| 2.6.0 | 1.26.10 | 错误消失（`grep -c tickingAreaManager` = 1） |
| 2.8.0 | 1.26.30 | 无此错误 |

即：**上游声明的引擎地板 `1.21.130` 与代码事实不符，真实地板是 `1.26.10`。**

按用户决定，本次迁移**保持 `[1,21,130]` 原值不变**，仅在此记录并在 `mods/mockplayer3/README.md` 中写明，供后续独立评估。**影响**：在 1.21.130~1.26.0 的游戏版本上启用本模组，常加载相关代码会在运行时失败（`world.tickingAreaManager` 为 `undefined`，调用即抛错）。

**R2 — `@minecraft/server` 版本在仓库内不统一**

本模组用 `2.8.0`，`item-route` 用 `2.1.0`，`teleporter` 用 `2.3.0`，`mod-common` 的 devDependency 用 `2.0.0`。npm workspaces 会为不同版本各自安装副本到各 workspace 的 `node_modules`，类型不会互相污染。**验证方式**：`pnpm ls -r @minecraft/server` 或 `npm ls @minecraft/server` 确认每个 workspace 解析到自己声明的版本。

**R3 — `defineCommand` 的推迟语义是「命令能跑」的关键**

上游 `defineCommand` 内部把 handler 放进 `runSafeAsync`（`system.run`）。自定义命令回调与 `beforeEvents` 回调运行在**只读上下文**，在其中调用被标注 `can't be called in read-only mode` 的成员会抛错。若本地实现漏掉这层推迟，表现为「命令返回成功但什么都没发生」——玩家看不到任何反馈，日志里也没有错误。

**缓解**：本地实现复用 `mod-common` 的 `runSafeDetached`（其 `runSafeCore.ts` 注释明确记录了该引擎约束）。**验收必须实测**：至少覆盖生命周期（`mp:create`/`mp:online`/`mp:offline`）、导航（`mp:tphere`）、行为（`mp:work`）、物品（`mp:reclaim`）、面板（`mp:menu`）五类各一条，在游戏内确认世界状态真的变了。

**R4 — 表单调用面是本仓库最大的**

14 个文件用 `ModalFormBuilder`、5 个用 `ActionFormBuilder`、2 个用 `MessageFormBuilder`，是 `mod-common` 迄今最大的消费方。符号名与 `mod-common` 完全对齐，但调用细节（`label` 重复字段名、`slider` 自定义范围与步长、`textField` 占位符、下拉默认选中）需逐个面板实测。**缓解**：`tsc` 全量编译通过是必要条件，但不充分——`packages/mod-common` 的既有单测已覆盖这些调用面（`tests/modal-values.test.ts` 等 4 个文件），迁移后先跑一遍 `mod-common` 的测试再改模组。

**R5 — Beta APIs 实验开关是硬性运行时前提**

见 D6。模组清单声明 `@minecraft/server` = `"beta"`，世界未开启 Beta APIs 时脚本不加载。这不是迁移缺陷，但迁移后的 README 与发布说明必须写明，否则用户会以为是「迁移搞坏了」。

## Migration Plan

1. **先建库包，再建模组**——模组依赖库包，顺序不能反。
   - `packages/nbt-data-storage/`：迁 `src/core`(8) + `src/mc`(6) + `tests`(12)，新增 `src/core/EventSignal.ts`，改 `src/mc/events.ts` 的导入来源，写 `package.json`/`tsconfig.json`/`tsconfig.test.json`/`README.md`。
   - 跑 `node --test`，确认 12 个测试文件全绿。

2. **建模组骨架**：`mods/mockplayer3/` 的 `package.json`（含 `packing` 段）、`just.config.ts`、`tsconfig.json`、`tsconfig.test.json`、`eslint.config.mjs`、`.env`。

3. **迁清单与资源**：`behavior_packs/mockplayer3/manifest.json`（UUID、`module_name` 依赖、`min_engine_version` 全部按上游原值）、`resource_packs/mockplayer3/manifest.json`、UI 图标纹理、两个 `pack_icon.png`（128×128 RGBA）。

4. **迁源码**：`scripts/` 146 个文件整体拷入，保持目录结构。

5. **改导入**（只有两类）：
   - `@yinxe/toolkit` → `@mc-toolchain/mod-common`（`color`/`style`/`trySendMessage`/三个表单构建器），`defineCommand` 改从本地 `CmdKit.ts` 内的实现来。
   - `@yinxe/nbt-data-storage` → `@mc-toolchain/nbt-data-storage`（2 个文件）。

6. **改 `CmdKit.ts`**：删掉对 `defineCommand` 的导入，就地实现（见 D4）。

7. **迁测试**：`tests/` 28 个文件 + `stubs/MinecraftRuntime.ts`，`STUBBED` 列表更新（见 D7）。

8. **验证**：`tsc --noEmit` 零错误 → `node --test` 全绿 → `just-scripts pack` 产出 `release/` 下的 `.mcaddon` → 解压核对清单。

9. **补文档**：`mods/mockplayer3/README.md`（含 R1 与 R5 的说明）、`mods/README.md` 模组表、根 `README.md`。

**回滚**：全部改动都是新增目录 + 三处文档改动，`git revert` 单个提交即可，不影响既有模组。

## Open Questions

- R1 的引擎地板不一致是否需要后续单独开一个 change 处理（把 `min_engine_version` 改为 `[1,26,10]`，或给 `tickingAreaManager` 加存在性判空并降级）？本次按用户决定只记录。
- `@minecraft/math` 在 `scripts/` 零引用，是否属于上游遗留？本次保留，留待清理类 change 处理。

## 迁移中发现的既有问题（仅记录，本次一律未改）

按用户决定「版本问题先完全保持不变，将调研后的问题记录即可」，以下问题均为**上游既有**，迁移时原样保留，只在此登记，供后续独立 change 处理。

1. **`min_engine_version` 与实际 API 地板不符**（即 R1）。清单写 `[1,21,130]`，但 `scripts/` 直接调用 `world.tickingAreaManager`（`@minecraft/server` 2.6.0 起才有，对应游戏 1.26.10）。在 1.21.130~1.26.0 上启用会运行时抛错。已在 `mods/mockplayer3/README.md` 中写明。

2. **`noUncheckedIndexedAccess` 下的两处索引访问**。上游测试配置未开该标志，而本仓库三个模组的 `tests/tsconfig.json` 都开着，迁入后 `tsc` 报两处 `TS2345`：
   - `scripts/engine/PanelOps.ts:269` — `dropper.dropSlot(botId, pending[k])`
   - `scripts/engine/ToolGuard.ts:79` — `const d = durabilities[slot]`

   两处越界均可由上下文证明安全（`k < pending.length`；`durabilities` 恰好填满 `INVENTORY_SIZE` 且 `findReplacementIndex` 只在 `[0, INVENTORY_SIZE)` 内回调）。处理方式：补 `!` 非空断言（**纯类型层，零运行时变化**），并各加一行注释说明越界依据，与本仓库既有写法一致（`scripts/engine/Scanner.ts:248`、`scripts/engine/ItemVault.ts:327` 等 12 处同形）。

3. **`@minecraft/math` 零引用**。`scripts/` 内无任何 import，属上游遗留声明。本次保留在 `dependencies`（R8/D8），留待清理类 change。

4. **`@minecraft/server` 版本在仓库内不统一**（即 R2）：mockplayer3 `2.8.0`、item-route `2.1.0`、teleporter `2.3.0`、mod-common devDep `2.0.0`。npm workspaces 各自装副本，类型不串味，但**升级时需逐模组改**，无法一键统一。

5. **`defineCommand` 是本仓库第三份独立实现**。item-route（`scripts/mc/commands/register.ts`）、teleporter（`scripts/mc/commands.ts:65`）、mockplayer3（`scripts/interface/CmdKit.ts`）各有一份语义对齐但代码独立的版本。D4 已论证「不进 `mod-common`」的理由，但三份实现的**漂移风险**是真实存在的：任一处修了边界 bug，另两处不会自动跟上。建议后续单独评估是否抽出共享实现。

6. **`@minecraft/server` 的 `"beta"` 依赖使脚本加载依赖实验开关**（即 R5）。世界未开 Beta APIs 时整个模组不加载，且**没有任何错误提示**——表现为「装了但什么都没发生」。已在 README 置顶说明。
