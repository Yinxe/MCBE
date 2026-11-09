# Tasks

## 1. 工作区与仓库配置

- [x] 1.1 在根 `package.json` 的 `workspaces` 中加入 `packages/*`,确认执行 `npm install` 后 `npm ls --workspaces --depth 0` 能列出 `packages/` 下的成员(初始为空则只列出既有 `mods/*` 与 `tools/*`)
- [x] 1.2 在根 `.gitignore` 中补充模组测试编译产物目录 `.test-build/`,确认 `git status` 不把该目录列为未跟踪
- [x] 1.3 在根 `package.json` 的 `dependencies`/`devDependencies` 中新增 `@minecraft/server-ui@2.0.0`(与 `@minecraft/server` 同版本),确认 `npm install` 成功且 `node_modules/@minecraft/server-ui/package.json` 存在

## 2. 抽出共享打包包 `packages/packaging`

- [x] 2.1 新建 `packages/packaging/package.json`(`@mc-toolchain/packaging`、`private: true`、`main`/`types` 指向 `src/index.ts`、`@minecraft/core-build-tasks` 作为 `peerDependencies` 与 `devDependencies`),确认 `npm install` 后 `npm ls -w @mc-toolchain/packaging` 无缺失依赖
- [x] 2.2 把 `mods/keepinventory/tools/packaging.ts` 的打包逻辑平移进 `packages/packaging/src/`,并把纯逻辑函数(版本解析、脚本 API 版本规范化、最低游戏版本查表、包类型判定、包目录探测)与依赖文件系统的入口分离到独立模块,确认 `tsc --noEmit` 通过
- [x] 2.3 为 `packages/packaging` 编写纯逻辑测试(覆盖:三段版本号解析与后缀告警、`^~>=<` 前缀剥离、映射表命中与「高于最高档返回未收录」、显式配置优先于推导、非法配置报错、未知 `packing` 字段报错、清单模块类型判定行为包/资源包/两者皆无),确认 `npm test -w @mc-toolchain/packaging` 全部通过且不加载游戏运行时
- [x] 2.4 在 `packages/packaging` 中加入测试编译配置与 `test` 脚本(`tsc` 编到 `.test-build` 后 `node --test`),确认该命令在干净检出后可直接运行
- [x] 2.5 编写 `packages/packaging/README.md`,说明该包用途、导出函数、`packing` 可用字段与「模组只编排任务」的用法,确认文档中的命令与示例与实现一致

## 3. 让 keepinventory 改用共享打包包

- [x] 3.1 在 `mods/keepinventory/package.json` 的 `devDependencies` 中加入 `@mc-toolchain/packaging`(版本写 `*`),确认 `npm install` 后 `node_modules/@mc-toolchain/packaging` 链接到 `packages/packaging`
- [x] 3.2 修改 `mods/keepinventory/just.config.ts` 改为从 `@mc-toolchain/packaging` 导入 `createPackagesByMode` 与 `synchronizePackVersions`,确认 `npm run pack -w @mc-toolchain/keepinventory` 成功
- [x] 3.3 删除 `mods/keepinventory/tools/packaging.ts`,并同步 `tsconfig.json` 的 `include` 与 `eslint.config.mjs` 中不再需要的 `tools/**/*` 条目,确认 `npx tsc --noEmit` 与 `npm run lint -w @mc-toolchain/keepinventory` 均通过
- [x] 3.4 对比改造前后的产物:确认 `dist/packages/keepinventory-v0.0.1_bp.mcpack` 的文件名、包内文件清单、`manifest.json` 的 `header.version`/`modules[].version` 与 `header.min_engine_version` 均与改造前一致(逐项比对清单字段)
- [x] 3.5 更新 `mods/keepinventory/README.md` 中与打包脚本路径相关的说明(不再指向模组内 `tools/packaging.ts`),确认文档中不再出现该路径

## 4. 抽出共享运行时包 `packages/shared`

- [x] 4.1 新建 `packages/shared/package.json`(`@mc-toolchain/shared`、`private: true`、`main`/`types` 指向 `src/index.ts`、`@minecraft/server` 作为 `peerDependencies`),确认 `npm install` 后 `npm ls -w @mc-toolchain/shared` 无缺失依赖
- [x] 4.2 从上游 `@yinxe/toolkit` 搬入文本样式部分(格式码常量与样式函数)到 `packages/shared/src/`,确认 `tsc --noEmit` 通过
- [x] 4.3 搬入 HUD 管理器与其仲裁纯函数到 `packages/shared/src/`,保留 `/scriptevent` 总线事件标识、`modId` 参与同优先级决胜的规则与心跳过期阈值语义,确认 `tsc --noEmit` 通过
- [x] 4.4 在 `packages/shared` 的 `tsconfig.json` 中以 `target: es6`、`module: ES2020` 自检(与消费方模组一致),确认共享包源码在该保守配置下编译通过
- [x] 4.5 为共享包中可脱离游戏环境的部分(仲裁决胜、过期判定)编写 `node --test` 单元测试,确认 `npm test -w @mc-toolchain/shared` 通过
- [x] 4.6 编写 `packages/shared/README.md`,说明该包承载范围、零第三方运行时依赖的约束、`HudManager` 的跨包协议不可改、以及 `modId`/优先级用法,确认文档与实现一致

## 5. 建立 auto-refill 模组骨架

- [x] 5.1 新建 `mods/auto-refill/`,按 `keepinventory` 同构创建 `package.json`(`@mc-toolchain/auto-refill`、`version: "2.2.0"`、`private: true`、`dependencies` 含 `@minecraft/server@2.1.0` 与 `@minecraft/server-ui@2.0.0`、`devDependencies` 含 `@mc-toolchain/packaging` 与 `@mc-toolchain/shared`、`packing` 含 `mode: "auto"`、`output: "dist/packages"`、`minimum_engine_version: [1, 21, 100]`),确认 `npm install` 后 `npm ls -w @mc-toolchain/auto-refill` 无缺失依赖
- [x] 5.2 创建 `just.config.ts`(导入共享打包包、`external` 含 `@minecraft/server` 与 `@minecraft/server-ui`、单一 `pack` 入口),确认 `npm run pack -w @mc-toolchain/auto-refill` 在脚本迁入后可成功执行
- [x] 5.3 创建 `tsconfig.json`(沿用模组模板配置并保留上游的 `lib: ["es2017"]`、`include` 覆盖 `scripts/**/*`)、`eslint.config.mjs`、`.env`(`PROJECT_NAME="auto-refill"`、`MINECRAFT_PRODUCT`、`CUSTOM_DEPLOYMENT_PATH`),确认 `npx tsc --noEmit` 与 `npm run lint -w @mc-toolchain/auto-refill` 通过
- [x] 5.4 创建包目录 `mods/auto-refill/behavior_packs/auto-refill/` 与 `manifest.json`(保留上游 `header.uuid` 与 `modules[].uuid`、`header.version` 与 `modules[].version` 写 `[2, 2, 0]`、`min_engine_version` 写 `[1, 21, 100]`、`dependencies` 含 `@minecraft/server [2, 1, 0]` 与 `@minecraft/server-ui [2, 0, 0]`、脚本入口 `scripts/main.js`),确认 `mct validate -i .` 在该模组目录下 0 ERROR
- [x] 5.5 确认三处版本声明自洽:`package.json` 的 `@minecraft/server` 为 `2.1.0`、`manifest.json` 的 `dependencies[].version` 为 `[2, 1, 0]`、`packing.minimum_engine_version` 为 `[1, 21, 100]`,确认三者同时满足且 `npm run pack` 输出的 `min_engine_version` 为 `[1,21,100]`(该值不会被 `packages/packaging` 从依赖推导覆盖)

## 6. 迁移脚本与行为适配

- [x] 6.1 把上游 21 个脚本模块平移到 `mods/auto-refill/scripts/`,仅调整模块引用路径,确认 `npx tsc --noEmit` 通过
- [x] 6.2 把 `AntiTouchHud.ts` 的 `@yinxe/toolkit` 导入改为 `@mc-toolchain/shared`,确认打包产物中不再出现 `@yinxe/toolkit` 引用
- [x] 6.3 确认 `AdminMenu.ts` 的 `@minecraft/server-ui` 导入在新增依赖后解析成功,且 `manifest.json` 的 `dependencies` 已声明该模块
- [x] 6.4 确认 `main.ts` 的事件路由(方块命中、实体命中、物品使用/完成/释放、方块破坏、图腾治愈)与上游一致,逐条核对事件订阅列表无遗漏
- [x] 6.5 确认两个命令(`/ar:menu` 仅操作员、`/ar:help` 全体)与上游权限一致,并确认 `Settings` 的世界动态属性键仍为 `autorefill:*`(世界配置在升级后不丢失)
- [x] 6.6 确认 `main.ts` 对 `world.afterEvents.entityHeal` 的运行时特性侦测保留完好(属性不存在时静默跳过订阅),在仅装 `@minecraft/server 2.1.0` 的编译环境下 `tsc --noEmit` 通过且图腾降级不阻断其余功能
- [x] 6.7 生成图标:创建 `mods/auto-refill/tools/generate-pack-icon.js`,按 32×32 逻辑像素 4 倍最近邻放大输出 128×128 RGBA 的 `behavior_packs/auto-refill/pack_icon.png`,确认图像尺寸为 128×128 且色彩类型含 alpha 通道

## 7. 迁移纯逻辑测试

- [x] 7.1 把上游 6 个测试文件迁入 `mods/auto-refill/tests/`,测试用 tsconfig 放在 `tests/tsconfig.json`(不放模组根目录,否则 `mct validate` 会报 `UNKJSON101`),校正 `include` 中的文件路径,确认 `tsc -p tests/tsconfig.json` 通过
- [x] 7.2 在 `mods/auto-refill/package.json` 中加入 `test` 脚本(用 `tests/tsconfig.json` 编译到 `.test-build` 后 `node --test`),确认 `npm test -w @mc-toolchain/auto-refill` 全部 60 项用例通过且不加载游戏运行时
- [x] 7.3 确认 `tests/tsconfig.json` 的 `include` 只覆盖无 `@minecraft` 依赖的模块(纯逻辑层),确认背包、方块分类器、界面等适配层未被纳入测试编译范围
- [x] 7.4 编写 `mods/auto-refill/README.md`,覆盖功能列表、两个命令、配置项与默认值、最低游戏版本 1.21.100、图腾补充需 1.26.10+ 的降级说明、不使用作弊指令、以及测试命令,确认文档中的命令可照抄运行

## 8. 文档同步

- [x] 8.1 更新根 `README.md`:补充 `packages/` 目录职责说明与模组清单表格(含 `auto-refill` 及其版本 2.2.0),确认文档中的目录树与仓库实际结构一致
- [x] 8.2 更新 `mods/README.md`:说明打包逻辑来自 `@mc-toolchain/packaging`(模组内不再有打包实现)、运行时共享代码来自 `@mc-toolchain/shared`,确认新模组照此说明可零复制接入
- [x] 8.3 确认 `openspec/specs/mod-workspace/spec.md` 与 `openspec/specs/addon-packaging/spec.md` 未被本次改动直接编辑(改动只经 delta 规格),确认 `git status` 中这两个文件无改动

## 9. 集成验证

- [x] 9.1 在仓库根执行 `npm install`,确认所有 workspace 成员安装成功且 `npm ls --workspaces --depth 0` 无错误
- [x] 9.2 对 `keepinventory` 执行 `npx tsc --noEmit`、`npm run lint`、`npm run pack`,对 `auto-refill` 额外执行 `npm test`(keepinventory 本身没有测试脚本,不要求 `npm test`),确认各命令退出码均为 0
- [x] 9.3 确认两个模组的产物分别落在各自 `dist/packages/`:keepinventory 为 `keepinventory-v0.0.1_bp.mcpack`,auto-refill 为 `auto-refill-v2.2.0_bp.mcpack`,且后者包内 `manifest.json` 的 `min_engine_version` 为 `[1,21,100]`、`dependencies[].version` 为 `[2,1,0]`、版本字段为 `[2,2,0]`
- [x] 9.4 在两个模组目录分别执行 `mct validate -i .`,确认 0 ERROR,且 `CPACKICON001`、`MINENGINEVER001` 通过
- [x] 9.5 确认仓库中不再存在重复的打包实现文件(全仓库检索 `zipTask` 的调用点只落在 `packages/packaging`),确认检索结果只有一处
- [x] 9.6 执行 `openspec validate refactor-auto-refill-mod --strict`,确认校验通过

## Workflow follow-up

- 归档本次 change(`openspec archive refactor-auto-refill-mod`),确认 delta 规格合并进主规格后 `openspec validate --specs` 通过。
- 归档后确认 `openspec/specs/` 下新增 `shared-runtime`、`shared-packaging`、`auto-refill` 三个能力,且 `mod-workspace`、`addon-packaging` 已更新。
