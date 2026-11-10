# Proposal

## Why

`item-route`（物品路由仓库）是 `~/coding/MCBE/mcaddon/item-route` 里一个成熟但孤立的模组：v0.1.20、118 个 TypeScript 源文件、32 个测试文件、286 条用例全绿，功能上已经覆盖自动分拣、容器整理、统计报表、容量预警、物品搜索与信物交互。但它构建在**本仓库之外**：它依赖同一外部 monorepo 里的 `@yinxe/toolkit`（命令注册、表单构建器、HUD 总线、权限判定）与 `@yinxe/toolkit-build`（打包任务、清单版本同步），包目录用 `BP/` / `RP/` 缩写，产物不进 `release/`，也不受本仓库任何规格约束。

结果是这份代码既不享受本仓库的共享层（`@mc-toolchain/mod-common`、`@mc-toolchain/mod-packaging`）与统一打包流程，也无法用本仓库的规格体系约束后续演进；同时它又是仓库里**第一个带资源包的模组**（两个粒子效果 + 纹理），把它的迁移做对，等于把「双包模组」这条路径一次性打通。

## What Changes

- 在 `mods/item-route/` 新建模组，按 `mods/README.md` 的目录布局承载行为包 `behavior_packs/item-route/` 与资源包 `resource_packs/item-route/`，**BREAKING**（相对上游）：`BP/ItemRoute`、`RP/ItemRoute` 两个缩写目录名废弃。
- 保留上游的版本号 `0.1.20`（迁移不重置版本，符合 `mod-workspace` 的「迁移模组保留原版本」），并把 `manifest.json` 的版本、显示名、描述改为由 `package.json` 派生。
- 保留上游两个包及四个模块的全部 UUID（行为包 `746aab1e-dd00-4f24-bdbb-42bc411a3003`、`data` 模块 `795cb2a2-6886-45bb-b9fa-7f76d9b6eca5`、`script` 模块 `7b4491b1-8154-4542-80c6-729b91b1faff`、资源包 `1bc7314d-ae1c-4b79-8015-de48a030b605`、`resources` 模块 `8b952bc1-c4c7-4b4d-acf8-e3378f85bf34`），使既有世界里已启用的包继续被识别为同一个包。
- 拆掉 `@yinxe/toolkit` 与 `@yinxe/toolkit-build` 两个外部依赖。上游有 **25 个文件**从 `@yinxe/toolkit` 导入，只用到 5 个符号：
  - `ModalFormBuilder`（10 个文件）、`ActionFormBuilder`（7 个文件）、`HudManager`（1 个文件）→ 直接换成本仓库 `@mc-toolchain/mod-common` 的同名实现，**调用面完全兼容，`mod-common` 无需任何改动**（已用真实 `mod-common` 对整份 `scripts/` 做全量编译验证，0 错误）。
  - `defineCommand`（10 个文件、9 处调用）与 `canManage`（9 个文件、10 处调用）→ `mod-common` 刻意不提供这两项，落到模组内实现。
- 源码按 `scripts/core/`（纯逻辑）+ `scripts/mc/`（适配层）+ `scripts/main.ts`（组合根）分层落位，与 `spectator-mode` / `teleporter` 同构；上游 286 条单测随之迁入 `mods/item-route/tests/`，并接入 `node --test`。
- 9 条 `ir:*` 命令全部改为经模组内的 `registerPlayerCommand` 推迟，命令名、参数与权限语义与上游一致。
- 打包配置写入 `package.json`：`packing.mode: "auto"`（行为包 + 资源包 → `.mcaddon`）、`output: "../../release/"`、显式 `minimum_engine_version`，产物不再落在模组目录内。
- 补齐 `mods/item-route/README.md`、`mods/README.md` 与根 `README.md` 的模组表条目。

## Capabilities

### New Capabilities

- `item-route`: 物品路由仓库模组的可观察行为——仓库区域与成员权限、容器角色与扫描、五级自动分拣路由、容器整理、物品族同族收纳、仓库统计与容量预警、物品搜索与定位、信物（木锄）交互、`/ir:*` 命令集、管理员全局配置，以及这些行为在本仓库内的版本、打包形态、依赖边界与最低游戏版本约束。

### Modified Capabilities

无。

迁移不改变任何既有能力的行为契约，因此不产出 `mod-workspace` / `mod-common` / `addon-packaging` 的 delta。逐条核对结果：

- `mod-workspace` 的「包类型可选」「包目录的命名约定」「npm 版本号是模组版本的唯一来源（含「迁移模组保留原版本」）」「模组清单须出现在两处 README」——`item-route` 只是**遵守**这些既有要求，不改变它们。仓库内此前没有双包模组，但双包布局与 `.mcaddon` 形态早已被 `mod-workspace` 与 `addon-packaging` 覆盖。
- `addon-packaging` 的 `packing.mode: "auto"` 已明确「2 个包时产出 `.mcaddon`」，`packing.output`、版本同步、最低版本显式优先、包目录只认官方全名，全部照用。
- `mod-common` 无需改动：`ModalFormBuilder`（`title/header/divider/label/textField/dropdown/toggle/slider/submitButton/show/showQuick`）、`ActionFormBuilder`（`title/body/header/divider/label/button/buttonWithIcon/show/showQuick`）、`HudManager`（`constructor/register/start/stop/setEnabled`）已覆盖上游全部调用点，包括 `label` 的重复字段名、`slider` 自定义范围与步长、`dropdown` 的 `defaultValueIndex`、`toggle` 的 `tooltip`。

## Impact

**新增代码**

- `mods/item-route/`（`package.json`、`just.config.ts`、`tsconfig.json`、`tests/tsconfig.json`、`eslint.config.mjs`、`.env`、`README.md`）
- `mods/item-route/behavior_packs/item-route/`（`manifest.json`、`pack_icon.png`）
- `mods/item-route/resource_packs/item-route/`（`manifest.json`、2 个粒子 JSON、2 张粒子纹理 PNG）
- `mods/item-route/scripts/core/`（55 个文件，原样搬迁：模型、路由策略、整理、索引、统计、搜索、调度、服务、名称映射表、存储抽象）
- `mods/item-route/scripts/mc/`（64 个文件：上游 62 个，其中 `commands/auth.ts` 移位为 `auth/commands.ts`，另新增 `auth/admin.ts` 与 `commands/register.ts`）
- `mods/item-route/scripts/main.ts`（组合根，原样搬迁）
- 合计 120 个 TS 源文件（上游 118 个 + 新增 2 个）
- `mods/item-route/tests/`（32 个用例文件，286 条用例）

**修改**

- `mods/README.md`、根 `README.md`：模组表补 `item-route` 一行。
- 根 `package.json` 无需改动（`workspaces` 已覆盖 `mods/*`）。

**移除 / 不再引入**

- 外部依赖 `@yinxe/toolkit`、`@yinxe/toolkit-build`（迁移后仓库内不存在任何 `@yinxe/*` 引用）。
- 上游的 `@minecraft/core-build-tasks` 打包任务编排（改为 `mod-packaging` + 仓库内既有 `just.config.ts` 形态）。

**依赖与运行时**

- 运行时依赖：`@minecraft/server`（固定 `2.1.0`，与 `spectator-mode` 一致）、`@minecraft/server-ui`（固定 `2.0.0`）。
- **`@minecraft/vanilla-data` 是真实运行时依赖，必须迁入**：`scripts/core/data/ItemNameMap.ts:23` 有 `import { MinecraftItemTypes } from "@minecraft/vanilla-data";`，用来构建「全量物品宇宙」`FULL_ITEM_IDS`（搜索必须能命中 `raw_iron` 这类预计算表未覆盖的条目）。版本保留上游的 `1.26.20`（上游注释明确该表对应「1.21.94 世代」，换版本会改变可搜物品集合）。该包在 esbuild 打包时被内联进 `main.js`，不需要额外的 manifest 模块声明——`just.config.ts` 的 `external` 只列 `@minecraft/server` 与 `@minecraft/server-ui`。
- 最低游戏版本：上游清单写 `[1, 21, 90]`，但上游 `dependencies` 声明 `@minecraft/server [2, 0, 0]` 且全仓 `overrides` 收敛到 2.8.0。迁移后按 `@minecraft/server` 2.1.0 显式写 `[1, 21, 100]`（依据 `mod-packaging` 的映射表），并在 `design.md` 记录验证过程。

**风险**

- 上游 9 条命令与 19 个界面文件全部经由外部封装进入安全上下文；拆掉 `defineCommand` 后若推迟职责落空，表现为「命令返回成功但什么都没发生」。本变更把这一点列为必须实测的验收项，而不是只比对返回值。
- 上游的测试白名单里有两个文件（`scripts/mc/effects/SortEffects.ts`、`scripts/mc/util/playerName.ts`）**确实 import `@minecraft/server`**，靠类型可用 + 测试不实际执行该模块才编得过。迁移时若有人「顺手」把它们的运行时依赖引入测试路径，会在 `node --test` 下崩；`design.md` 记录这一脆弱点。
