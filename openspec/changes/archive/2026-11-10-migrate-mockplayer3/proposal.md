# Proposal

## Why

`mockplayer3`（模拟玩家III）是 `~/coding/MCBE/mcaddon/mockplayer3` 里一个已在大量玩家手中正常运行的成熟模组：v3.0.32、146 个 TypeScript 源文件、28 个测试文件，功能覆盖假人生成与回收、行为脚本、库存与寻路、UI 面板与 `mp:*` 命令集。它同时是仓库外唯一一个**深度依赖外部 monorepo 四个包**的模组（`@yinxe/toolkit`、`@yinxe/toolkit-build`、`@yinxe/tool-strategy`、`@yinxe/nbt-data-storage`），并因此卡在仓库之外：不受本仓库任何规格约束，无法用统一打包流程产出，也不享受共享层。

它依赖的 `@yinxe/nbt-data-storage`（v0.1.21，2567 行，12 个测试文件）本身是一个通用「区块锚定木桶阵列」存储库，不是模组私有实现，本仓库内也没有等价能力。**它的迁移与 `mockplayer3` 的迁移必须同批完成**——否则模组无法构建。

这是一次**纯迁移**：不改行为、不改版本、不改 API 契约。验收标准是「迁移后与上游逐字节等价地可运行」，而不是「顺便改进」。

## What Changes

- 在 `mods/mockplayer3/` 新建模组，按 `mods/README.md` 的目录布局承载行为包 `behavior_packs/mockplayer3/` 与资源包 `resource_packs/mockplayer3/`，**BREAKING**（相对上游）：`BP/MockPlayer3`、`RP/MockPlayer3` 两个缩写目录名废弃。
- 在 `packages/nbt-data-storage/` 新建独立库包 `@mc-toolchain/nbt-data-storage`，把上游 v0.1.21 的 `src/core`、`src/mc`、`tests/` 整体迁入。
- **版本与依赖完全不变**（本次迁移的硬约束，用户明确要求）：
  - 模组版本 `3.0.32`、库版本 `0.1.21` 原样保留。
  - `packing.minimum_engine_version` 显式写 `[1, 21, 130]`，与上游 `manifest.json` 的 `min_engine_version` 一致，**不**由 `@minecraft/server` 依赖版本推导（推导会得到 `[1, 26, 30]`，见 `design.md` 风险 R1）。
  - `@minecraft/server` 固定 `2.8.0`、`@minecraft/server-gametest` 固定 `1.0.0-beta.1.26.0-stable`、`@minecraft/server-ui` 保持 `^2.0.0`、`@minecraft/math` 固定 `2.2.7`、`@minecraft/vanilla-data` 固定 `1.26.20`。
  - 行为包 `manifest.json` 的三个 `module_name` 依赖保持上游原值：`@minecraft/server` = `"beta"`、`@minecraft/server-gametest` = `"beta"`、`@minecraft/server-ui` = `"2.0.0"`。打包器只同步 `header.version`、`modules[].version`、`header.min_engine_version` 与 `uuid` 型依赖的版本（`packages/mod-packaging/src/packs.ts:60-72`），不会改动 `module_name` 型依赖，因此这三个值可原样保留。
- 保留上游全部 UUID（行为包 `49df180b-e16a-4740-9edd-c655127fcd22`、数据模块 `256118ca-af02-43d2-a0f1-da5b460474d6`、脚本模块 `cda1f72a-5834-4494-af4c-871df2e22e0a`、资源包 `4497ec44-a22f-4f7f-a723-1f18d14c4e04`、资源模块 `79f9a3e5-d73b-4741-a6f9-b499f5bcde65`），使既有世界里已启用的包继续被识别为同一个包。
- 拆掉四个外部依赖：
  - `@yinxe/toolkit` → 拆成两半：`color` / `style` / `trySendMessage` / `ModalFormBuilder` / `ActionFormBuilder` / `MessageFormBuilder` 六个符号由 `@mc-toolchain/mod-common` 提供（调用面已核实兼容）；`defineCommand`（仅 `scripts/interface/CmdKit.ts` 一处使用）`mod-common` 刻意不提供，落为模组内实现。
  - `@yinxe/nbt-data-storage` → `@mc-toolchain/nbt-data-storage`（workspace 依赖）。
  - `@yinxe/toolkit-build` → `@mc-toolchain/mod-packaging`。
  - `@yinxe/tool-strategy` → **直接删除**（`grep` 确认 `scripts/`、`tests/` 零引用）。
- 源码目录名保持上游分层（`scripts/domain`、`scripts/application`、`scripts/engine`、`scripts/interface`、`Composition.ts`、`main.ts`），**不**改写为 `core` / `mc` 分层——146 个文件的相对导入重排属于纯风险，迁移不承担该收益。
- 打包配置写入 `package.json`：`packing.mode: "auto"`（行为包 + 资源包 → `.mcaddon`）、`output: "../../release/"`，产物不再落在模组目录内。
- `nbt-data-storage` 的 `EventSignal` 依赖就地自足：上游从 `@yinxe/toolkit/src/events` 深路径导入，迁移后改为包内自带实现，**不**把事件原语加进 `mod-common`（理由见 `design.md` 决策 D3）。
- 上游 `nbt-data-storage/demo/` 演示 addon 不迁入（它是一个独立可打包 addon，本仓库的演示形态由各模组的游戏内实测承担）。

## Capabilities

### New Capabilities

- `mockplayer3`: 模拟玩家（假人）模组的可观察行为——假人创建/回收与会话生命周期、行为脚本与动作规则、库存与寻路、`mp:*` 命令集、管理员界面与玩家面板、常加载区块辅助、NBT 物品仓集成，以及本仓库内的版本、依赖声明、打包形态与最低游戏版本约束。
- `nbt-data-storage`: 区块锚定木桶阵列存储库的能力——O(1) 槽位寻址、完整 NBT 存取、动态扩容、原子传输、原位覆写、阵列巡检与修复、桶级丢失上报、自定义事件总线、跨模组共享与常加载额度，以及它作为 `packages/` 下独立库包在仓库内的定位与依赖边界。

### Modified Capabilities

（无。本次为纯迁移：`mod-workspace` 的包名、版本保留、目录布局、显示名派生等既有要求，`mockplayer3` 与 `nbt-data-storage` 均直接满足，不需要修改规范。）

## Impact

**新增代码**

- `mods/mockplayer3/`（`package.json`、`just.config.ts`、`tsconfig.json`、`tsconfig.test.json`、`eslint.config.mjs`、`.env`、`README.md`）
- `mods/mockplayer3/behavior_packs/mockplayer3/`（`manifest.json`、`pack_icon.png`）
- `mods/mockplayer3/resource_packs/mockplayer3/`（`manifest.json`、UI 图标纹理）
- `mods/mockplayer3/scripts/`（146 个文件：`domain/` 45、`application/` 21、`engine/` 45、`interface/` 32，加 `Composition.ts`、`main.ts`、`Runtime.d.ts`）
- `mods/mockplayer3/tests/`（28 个用例文件）
- `packages/nbt-data-storage/`（`package.json`、`tsconfig.json`、`tsconfig.test.json`、`README.md`、`AGENTS.md`、`src/core/` 8 个文件、`src/mc/` 6 个文件、`tests/` 12 个文件）

**修改**

- `packages/nbt-data-storage/src/mc/events.ts`：`EventSignal` 导入来源改为包内实现。
- `mods/mockplayer3/scripts/interface/CmdKit.ts`：`defineCommand` 改由模组内实现提供。
- `mods/README.md`、根 `README.md`：模组表补 `mockplayer3`，共享包说明补 `nbt-data-storage`。
- 根 `package.json` 无需改动（`workspaces` 已覆盖 `mods/*` 与 `packages/*`）。

**移除 / 不再引入**

- 外部依赖 `@yinxe/toolkit`、`@yinxe/toolkit-build`、`@yinxe/tool-strategy`、`@yinxe/nbt-data-storage`（迁移后仓库内不存在任何 `@yinxe/*` 引用）。
- 上游 `@minecraft/core-build-tasks` 的 `mcaddonTask` / `copyOptions` / `bundleOptions` 编排（改为 `mod-packaging` + 仓库内既有 `just.config.ts` 形态）。
- 上游 `nbt-data-storage/demo/` 演示 addon。

**依赖与运行时**

- 运行时依赖只保留官方包，版本全部固定为上游值（见「What Changes」）。
- `mods/mockplayer3` 以 workspace 依赖使用 `@mc-toolchain/mod-common`、`@mc-toolchain/mod-packaging`、`@mc-toolchain/nbt-data-storage`。
- `@minecraft/server-gametest` 全生态只有 beta/internal 版本（无 stable），因此行为包清单的 `"beta"` 依赖无法改为正式版本号，模组运行时**要求世界开启「Beta APIs」实验开关**。这是上游既有事实，迁移不改变它。

**风险**

- **R1（须记录，不修改）**：上游 `manifest.json` 声明 `min_engine_version [1,21,130]`（对应 `@minecraft/server` 2.4.0），但 `scripts/engine/TickingAreas.ts:89`、`scripts/engine/Rig.ts:262/267/292` 直接调用 `world.tickingAreaManager` 且无存在性判空，而该属性实测自 `@minecraft/server` 2.6.0（= 游戏 1.26.10）才存在。用 2.4.0 / 2.5.0 编译全量 `scripts/` 分别报 8 处 `TS2339`。即上游文档所述「引擎地板 1.21.130」与代码事实不符，真实地板为 1.26.10。**按用户决定，本次迁移保持 `[1,21,130]` 原值不变**，仅在 `design.md` 与模组 README 中记录该不一致，供后续独立评估。
- **R2**：`nbt-data-storage` 与 `mockplayer3` 都使用 `@minecraft/server` 2.8.0，而仓库其余模组在 2.0.0 / 2.1.0 / 2.3.0。npm workspaces 会为不同版本各自安装副本，类型不会串味；但根 `node_modules` 目前只有 2.0.0，需确认安装后各 workspace 拿到自己的版本。
- **R3**：上游 `defineCommand` 内含 `system.run` 推迟语义。改为模组内实现后，若推迟职责落空，表现为「命令返回成功但什么都没发生」。本变更把「9 类 `mp:*` 命令在游戏内实际生效」列为必须实测的验收项。
- **R4**：`mod-common` 的 `ModalFormBuilder` 等调用面已核对兼容，但 `mockplayer3` 是迄今最大的表单消费方（14 个文件用 `ModalFormBuilder`），需在迁移后跑通全部界面。
