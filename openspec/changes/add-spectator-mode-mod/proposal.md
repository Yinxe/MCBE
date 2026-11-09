# Proposal

## Why

仓库外已有一个成熟的「灵魂出窍 / 旁观模式」行为包（`MCBE/mcaddon/spectator-mode`，v1.0.10）：玩家可把自己变成本地原生旁观者飞离真身侦查，行动范围受最大距离限制，超限进入 5 秒容忍倒计时后自动回归本体。

它当前的形态与本仓约定不一致：目录用 `BP/SpectatorMode`、包名无 scope、运行时依赖外部 workspace 包 `@yinxe/toolkit`（`HudManager` / `defineCommand` / `canManage` / `ModalFormBuilder`）、打包走自带的 `just-scripts mcaddon` 而非 `@mc-toolchain/packaging`、图标为 256×256。把它整体重写进本仓后，它才能与 `auto-refill` / `keepinventory` 同构，复用共享的打包与 HUD 仲裁能力，并纳入 OpenSpec 的行为规格管理。

## What Changes

- **新增模组** `mods/spectator-mode`，包名 `@mc-toolchain/spectator-mode`，版本保留上游 `1.0.10`（迁移不重置版本）；行为包目录 `behavior_packs/spectator-mode`，纯行为包、无资源包。
- **功能语义完整保留**：`/sp:soul` 切换旁观/回归、`/sp:soul menu` 管理员表单、距离监控与 5 秒容忍倒计时、跨维度视为超限、极限模式禁用、灵魂锚点持久化与重连恢复、旁观者自愈、假人过滤、真身标记/灵魂光环/双向扫掠连线粒子（连线默认关）。
- **新增：灵魂阶段夜视增益**（本仓在迁移之外的唯一行为增量）：灵魂出窍期间持续为灵魂施加夜视效果，使低亮度环境下的侦查不受限；进入前已带夜视的玩家，回归时按快照还原其原有强度与剩余时长（而非直接移除），原本无夜视者回归后移除。该增益由管理员表单独立开关控制，默认开启。
- **命令面保留上游原样**：只注册一条 `/sp:soul`，`menu` 作为可选字符串子命令，不做命令拆分。
- **持久化键名保留上游原样**（`sp:enabled` / `sp:maxDist` / `sp:showLink`，玩家锚点 `sp:soul`），使旧世界的配置与「以灵魂状态离线」的存档无缝延续；这是本仓「避免缩写」规范中「与上游生态约定一致时保留既有缩写」的例外，需在模组文档中记录理由。新增的夜视开关（`sp:nightVision`）与夜视快照（`sp:nvSave`）沿用同一前缀，理由是该前缀已成为本模组的持久化命名空间。
- **替换外部依赖**：`@yinxe/toolkit` 的 `HudManager` / `color` / `style` 改由 `@mc-toolchain/shared` 提供；`defineCommand` / `canManage` / `ModalFormBuilder` 不引入共享包，改为直接调用原生 `customCommandRegistry.registerCommand` 与 `ModalFormData`（与 `auto-refill` 的做法一致）。**BREAKING**（对外部使用方而言）：不再依赖 `@yinxe/toolkit`。
- **打包与版本接入本仓**：`package.json` 增加 `"pack": "just-scripts pack"` 与 `packing` 块，`just.config.ts` 复用 `@mc-toolchain/packaging` 的 `createPackagesByMode` / `synchronizePackVersions`，产物为 `dist/packages/spectator-mode-v1.0.10_bp.mcpack`；`manifest.json` 的版本与 `min_engine_version` 由打包写入。
- **兼容下限**：`@minecraft/server` 取 `2.1.0`（原生自定义命令 `StartupEvent.customCommandRegistry` 的首个可用版本），由映射表推导 `min_engine_version [1,21,100]`，即兼容下限从上游的 1.21.0 提高到 1.21.100。
- **图标重绘**：128×128 RGBA 像素画，替换上游 256×256 图标，符合 `pack-icon` 规范。
- **代码结构按本仓分层**：`scripts/core/` 放零 `@minecraft` 依赖的纯逻辑（类型、配置钳制、距离/容忍状态机、颜色阶梯、HUD 文案），`scripts/mc/` 放适配层（持久化、粒子、控制器、命令、表单、玩家过滤），纯逻辑用 `node --test` 覆盖。

## Capabilities

### New Capabilities

- `spectator-mode`: 「灵魂出窍 / 旁观模式」模组的可观察行为——进入与回归、距离监控与容忍倒计时、HUD 呈现、管理员配置、夜视增益与状态还原、持久化与重连恢复、极限模式与假人守卫、粒子表现、以及兼容下限与纯逻辑可测性。

### Modified Capabilities

- 无。本变更不改变 `mod-workspace`、`addon-packaging`、`shared-runtime`、`pack-icon` 的既有要求，只是新增一个符合它们的模组实例。

## Impact

- 新增文件：`mods/spectator-mode/**`（`package.json`、`just.config.ts`、`tsconfig.json`、`tests/tsconfig.json`、`.env`、`eslint.config.mjs`、`.prettierrc.json`、`README.md`、`scripts/**`、`tests/**`、`behavior_packs/spectator-mode/{manifest.json,pack_icon.png}`、`tools/generate-pack-icon.js`）。
- 依赖：模组新增 `@mc-toolchain/packaging`、`@mc-toolchain/shared`、`@minecraft/server` 2.1.0、`@minecraft/server-ui` 2.0.0、`@minecraft/core-build-tasks` 5.5.0；**不再**依赖 `@yinxe/toolkit` / `@yinxe/toolkit-build`。夜视用 2.1.0 已有的 `Entity.addEffect` / `getEffect` / `removeEffect`，不引入新依赖，不影响兼容下限。
- 配置模型：`SpConfig` 由三项扩为四项（新增 `nightVision`），管理表单由 3 项控件扩为 4 项；玩家级新增夜视快照键（`sp:nvSave`）。
- 仓库根 `package.json` 的 `workspaces` 已覆盖 `mods/*`，无需改动；`npm install` 后自动纳入 workspace。
- 不影响既有 `mods/auto-refill` 与 `mods/keepinventory` 的产物与行为；不改动 `packages/packaging`、`packages/shared` 的源码。
- HUD 走 `@mc-toolchain/shared` 的 `HudManager`（`modId: "spectator-mode"`、`priority: 200`），与其它行为包按既有 `/scriptevent yinxe:hud` 协定仲裁，不修改该协议。
- 与上游并存风险：同一世界中若同时启用上游包与本模组，两者都会注册 `/sp:soul` 并争抢 actionbar；本变更不提供兼容层，在 README 中说明应只装其一。
