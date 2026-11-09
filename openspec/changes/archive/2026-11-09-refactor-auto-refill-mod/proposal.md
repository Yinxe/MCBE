# Proposal

## Why

仓库外已有一个功能完整的「自动替换」Bedrock 行为包(`~/coding/MCBE/mcaddon/auto-refill`,约 3100 行 TypeScript + 60 项纯逻辑单测),但它长在另一套工程体系里:pnpm workspace、`BP/AutoRefill` 缩写包目录、`@yinxe/toolkit` / `@yinxe/toolkit-build` 两个外部共享包、每模组自带的打包脚本。

本仓库(`mc-toolchain`)已有一套与之冲突的约定:`mods/README.md` 只认 `behavior_packs/` 全名目录、打包入口唯一为 `pack`、版本号以 `package.json` 为唯一来源、纯逻辑层需可 `node --test`。直接复制进来会同时破坏本仓库约定,并在 `pack` 时报错。因此需要一次**按本仓库规范的重构式迁移**,并把重复的东西沉淀成仓库内的共享包。

同时,`mods/keepinventory/tools/packaging.ts`(580 行)目前是逐模组复制的:第二个模组进来时必然要再复制一份,两份会各自漂移。共享包抽取正是此刻做才有意义。

## What Changes

- 新增 `packages/` 工作区(与 `mods/`、`tools/` 并列),承载**仓库内部共享包**;`tools/` 保持「可独立发布到 npm」的定位不变。
- 新增 `packages/shared`(`@mc-toolchain/shared`):把模组运行时真正需要的可复用能力**按本仓库约定重写**,替代外部 `@yinxe/toolkit` 的对应部分(样式 `color`/`style` 与 HUD/actionbar 仲裁 `HudManager`),零第三方运行时依赖。
- 新增 `packages/packaging`(`@mc-toolchain/packaging`):把 `mods/keepinventory/tools/packaging.ts` 的通用打包逻辑抽成共享包,行为不变;**`keepinventory` 改为使用共享包并删除自带的 `tools/packaging.ts`**。
- 迁移模组到 `mods/auto-refill/`:包名 `@mc-toolchain/auto-refill`,版本**继承上游 `2.2.0`**(不重置为 `0.0.1`),包目录 `behavior_packs/auto-refill/`(由上游 `BP/AutoRefill` 改名)。
- `packing.minimum_engine_version` **显式**设为 `[1, 21, 100]`,不再沿用上游的 `[1, 21, 20]`,也不依赖映射表推导;脚本模块依赖同步提升为 `@minecraft/server [2, 1, 0]`。
- 迁移上游 60 项纯逻辑单测,接入 `npm test -w @mc-toolchain/auto-refill`;补齐 `tsconfig.test.json` 与根 `.gitignore` 的 `.test-build/`。
- 图标从 256×256 重制为 128×128 RGBA PNG,满足 `pack-icon` 规范。
- 模组文档(`mods/auto-refill/README.md`)按本仓库风格重写,并在根 `README.md` 的模组表中登记。

## Capabilities

### New Capabilities

- `shared-runtime`: 约束仓库内部共享运行时包 `@mc-toolchain/shared` 的定位、可复用能力边界(样式与 HUD 仲裁)、依赖约束(只依赖官方 Script API 包)与零外部运行时依赖,使多个模组能共用同一套 actionbar 仲裁而不必各自复制。
- `shared-packaging`: 约束仓库内部共享打包包 `@mc-toolchain/packaging` 的定位与对外 API,使「版本同步 / 最低游戏版本推导 / 包目录探测 / 按 mode 产出产物」这套逻辑在所有模组间只有一份实现。
- `auto-refill`: 定义「自动替换」模组对玩家的可观察行为:消耗品补充、挖掘工具切换、武器切换、耐久保护、不死图腾补充、挖掘防误触、管理员配置与帮助命令,以及模式守卫与成就保留前提。

### Modified Capabilities

- `mod-workspace`: 新增 `packages/` 工作区与内部共享包的命名/版本/私有性约定;明确「从外部仓库迁移的既有模组保留原版本号」,并允许模组以 workspace 依赖引用内部共享包。
- `addon-packaging`: 打包逻辑的宿主从「每个模组自带 `tools/packaging.ts`」改为「共享包 `@mc-toolchain/packaging`」,打包行为与配置字段保持不变。

## Impact

**新增**

- `packages/shared/`:`package.json`、`tsconfig.json`、`src/`(样式、HUD 仲裁与驱动)、`tests/`。
- `packages/packaging/`:`package.json`、`tsconfig.json`、`src/`(由 `mods/keepinventory/tools/packaging.ts` 拆分而来)、`tests/`。

**新增模组**

- `mods/auto-refill/`:`package.json`(version `2.2.0`)、`just.config.ts`、`tsconfig.json`、`tsconfig.test.json`、`eslint.config.mjs`、`.env`、`scripts/`(约 20 个模块)、`tests/`(6 个测试文件)、`behavior_packs/auto-refill/`(`manifest.json` + `pack_icon.png`)、`README.md`。

**修改**

- `package.json`(根):`workspaces` 增加 `packages/*`。
- `.gitignore`(根):增加 `.test-build/`。
- `README.md`(根):模组表增加 `auto-refill`,目录结构增加 `packages/`。
- `mods/README.md`:补充「模组可依赖内部共享包」的说明。
- `mods/keepinventory/just.config.ts`:改为从 `@mc-toolchain/packaging` 导入;删除 `mods/keepinventory/tools/packaging.ts`。
- `mods/keepinventory/package.json`:增加 `@mc-toolchain/packaging` 开发依赖。
- `mods/keepinventory/README.md`:目录结构中去掉 `tools/packaging.ts`,说明打包逻辑来自共享包。

**依赖变化**

- 根 `node_modules` 需新增 `@minecraft/server-ui@2.0.0`(上游模组的 `AdminMenu` 使用 `ModalFormData`)。
- 移除对外部仓库 `@yinxe/toolkit` / `@yinxe/toolkit-build` 的依赖;本仓库不引入任何 pnpm 专有依赖(`workspace:*` 改为 `*`)。

**兼容性**

- 上游 `manifest.json` 的 `min_engine_version` 由 `[1, 21, 20]` 提升为 `[1, 21, 100]`:1.21.20–1.21.99 的客户端将无法加载本模组。这是显式取舍(见 design.md D7):原生自定义命令需要 `@minecraft/server 2.1.0`,对应游戏 1.21.100。
- 上游代码用到的 `world.afterEvents.entityHeal` 自 `@minecraft/server 2.6.0` 起可用,因此在 1.21.100–1.26.0 上**图腾补充静默失效**,其余功能不受影响;上游已有的 `if (world.afterEvents.entityHeal)` 守卫使这种降级不报错、不崩溃。
- 包目录与包名改变,但**保留上游的包与模块 UUID**,使已装载旧包的世界在重新导入后仍被视为同一个包。
- `keepinventory` 的打包行为不变,产物名与内容不变;但其 `pack` 实现来源改变,`just.config.ts` 需同步。

**风险**

- 共享打包包被两个模组共用后,一处改动同时影响两者;需要 `packages/packaging` 自带单测兜住纯逻辑部分。
- HUD 仲裁依赖 `/scriptevent` 跨包总线,重写后需与上游 `@yinxe/toolkit` 的协议保持一致,否则与同世界其它包(如 item-route)共存时优先级仲裁会失效;本次以「同一 modId/优先级/事件名语义」为对齐目标,并在设计文档中记录协议字段。
- 上游 `pack_icon.png` 为 256×256,与本仓库 `pack-icon` 规范的 128×128 冲突,需重制而非简单缩放(缩放会破坏像素风硬边)。
