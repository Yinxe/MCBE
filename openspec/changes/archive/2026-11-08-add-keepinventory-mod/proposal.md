# Proposal

## Why

需要一个 Minecraft Bedrock 的「死亡不掉落」行为包:在不开启作弊、不破坏成就的前提下让玩家死亡后保留物品(平台在 1.26.50 起会因侧载外部行为包而禁用成就,属已上报的 bug MCPE-242529)。

当前 `mc-toolchain` 仓库只有 OpenSpec 规划目录,还没有可复用的模组工作区、构建与打包工具链。官方 `mct create` 生成的模板默认栈只会产出 `.mcaddon`,无法按需单独产出 BP / RP,也不会把包内 `manifest.json` 版本号与 npm 版本号对齐。本变更同时把这个工具链补齐,并交付第一个模组作为样板。

## What Changes

- **建立 npm workspaces 工作区**:仓库根新增私有 `package.json`(`workspaces: ["mods/*"]`),所有模组统一放在 `mods/` 下。
- **新增第一个模组** `mods/keepinventory`,包名 `@mc-toolchain/keepinventory`,初始版本 `0.0.1`;目录结构以官方 `mct create` 模板(tsStarter 形态:`scripts/main.ts` + `just.config.ts`)为基础,包目录采用 `BP/<name>` / `RP/<name>` 约定(兼容全名 `behavior_packs/` / `resource_packs/`)并做精简。
- **实现「死亡不掉落」**:通过脚本稳定 API 设置 `world.gameRules.keepInventory = true`,不开启作弊、不启用实验性功能、不改动其它游戏规则。
- **版本号单一来源**:以 `package.json#version` 为准,包内 `manifest.json` 的 `header.version` 与 `modules[].version` 与其保持一致;`pack` 在压缩前自动同步。
- **自定义打包逻辑**:在模板 `just.config.ts` 上扩展**唯一的** `pack` 入口,配置取自 `package.json#packing`(`mode` / `behavior_packs` / `resource_packs` / `output`,全部可选且有默认值,包类型以 `manifest.json` 为准);`mode` 默认 `auto`,按探测到的包数量自动决定产出单个 `.mcpack` 还是 `.mcaddon`,产物文件名带模组名与版本号。
- **兼容下限**:以 `min_engine_version [1, 21, 0]` + `@minecraft/server [1, 11, 0]` 为下限,覆盖 1.21.0 → 1.26.40 全部仍允许成就的版本(详见 `design.md` 的版本调研)。
- **评估移除不必要的脚本依赖**:模板默认带 `@minecraft/server-ui` / `@minecraft/math` / `@minecraft/vanilla-data`,本模组按需保留(见 `design.md` 决策)。

## Capabilities

### New Capabilities
- `mod-workspace`: 在 `mc-toolchain` 仓库中用 npm workspaces 承载 `mods/` 下的多个模组,统一包名、初始版本与「npm 版本即模组版本」的约定。
- `addon-packaging`: 自定义构建与打包工具链,产出可分发、版本号一致的 BP / RP / mcaddon 产物。
- `keepinventory`: 「死亡不掉落」模组的可观察行为(开启 keepInventory、不破坏成就、兼容低版本)。

### Modified Capabilities
- 无。仓库当前没有任何已归档 spec(`openspec list --specs` 为空),本次全部为新增能力。

## Impact

- 新增文件:仓库根 `package.json`、`package-lock.json`、`.gitignore`,以及 `mods/keepinventory/**`。
- 依赖:`@minecraft/core-build-tasks`(复用其已导出的 `zipTask`,不引入新的打包库)、`just-scripts`、`@minecraft/server`(类型)、`typescript`、`eslint-plugin-minecraft-linting`。
- 不触碰 `openspec/` 之外的既有代码(仓库当前无业务代码);`openspec/` 仅新增本变更目录。
- 已知平台限制(非本模组可修复):游戏版本 ≥ 1.26.50 时,侧载(非市场)行为包会禁用成就(MCPE-242529);本变更将其记录为兼容性说明,不作为模组缺陷。
