# Tasks

## 1. 共享切片与分发器 `tools/icon-forge/`

- [x] 1.1 新建 `tools/icon-forge/package.json`（`@mc-toolchain/icon-forge`，`private: true`），并在 workspace 中解析该包
- [x] 1.2 编写 `tools/icon-forge/src/png.js` 纯 Node 无外部依赖的 PNG 编解码器（zlib + CRC32）
- [x] 1.3 备份原图至 `tools/icon-forge/assets/minecraft-icon-sprites.png`，确保离线与持续可重现
- [x] 1.4 实现 `tools/icon-forge/bin/slice-all.js` 自动网格计算、外部黑色泛洪消除与精确居中缩放为 256×256 透明底
- [x] 1.5 验证全部切片满足 256×256 分辨率、无外溢黑边与合规 alpha 透明通道

## 2. 模组包图标（Pack Icons）全仓分发

- [x] 2.1 分发 `mods/auto-refill` 256×256 包图标（药水瓶+循环箭头）
- [x] 2.2 分发 `mods/craftablerarities` 256×256 包图标（工作台+发光金苹果）
- [x] 2.3 分发 `mods/item-route` BP/RP 256×256 包图标（木箱子+齿轮）
- [x] 2.4 分发 `mods/keepinventory` 256×256 包图标（不死图腾+金色护盾）
- [x] 2.5 分发 `mods/mockplayer3` BP/RP 256×256 包图标（史蒂夫+机械齿轮）
- [x] 2.6 分发 `mods/spectator-mode` 256×256 包图标（基座末影之眼）
- [x] 2.7 分发 `mods/teleporter` BP/RP 256×256 包图标（圆石水池水流传送门）

## 3. 菜单图标资源分发与 ActionForm 代码接入

- [x] 3.1 为 `mods/item-route` 资源包分发 13 张高精 256×256 界面图标至 `textures/ui/item-route/`
- [x] 3.2 在 `mods/item-route` 的 `MainMenu.ts`、`OPConfigUI.ts`、`WarehouseSettingsMenu.ts`、`HelpGuide.ts` 中接入 `buttonWithIcon`
- [x] 3.3 为 `mods/teleporter` 新建资源包 `mods/teleporter/resource_packs/teleporter/`，配置合规 `manifest.json` 与独立 UUID
- [x] 3.4 为 `mods/teleporter` 资源包分发 11 张高精 256×256 界面图标至 `textures/ui/teleporter/`
- [x] 3.5 在 `mods/teleporter` 的 `menu.ts`、`playerTeleport.ts`、`deathPoints.ts`、`publicWarps.ts`、`warps.ts` 中接入 `buttonWithIcon`

## 4. 清理旧生成器与脚本对齐

- [x] 4.1 删除 7 份旧的 `mods/*/tools/generate-pack-icon.js`
- [x] 4.2 更新各模组 `package.json` 的 `generate:icon` 脚本为 `node ../../tools/icon-forge/bin/slice-all.js`

## 5. 全仓构建、单测与打包验证

- [x] 5.1 验证 `mods/teleporter` 单测 55/55 通过，构建通过
- [x] 5.2 验证 `mods/item-route` 单测 305/305 通过，构建通过
- [x] 5.3 验证所有 7 个模组全量打包成功（`teleporter`、`item-route`、`mockplayer3` 打出 `.mcaddon`，其余打出 `_bp.mcpack`）
- [x] 5.4 验证 `release/` 目录下全部包体产出完整且图标均被打包器正确纳入
