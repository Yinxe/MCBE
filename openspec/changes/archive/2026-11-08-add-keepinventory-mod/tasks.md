# Tasks

> 实施约定:模组命令在仓库根执行并用 `-w @mc-toolchain/keepinventory` 指定;`mct` 命令用 `mct <cmd> -i mods/keepinventory`。包目录缩写记作 `BP`/`RP`,全名记作 `behavior_packs`/`resource_packs`,两者等价。

## 1. 工作区与模组脚手架

- [x] 1.1 在仓库根新增私有 `package.json`(name `mc-toolchain`、`private: true`、`workspaces: ["mods/*"]`)与 `.gitignore`;验证方式:根目录 `npm install` 成功,且 `npm ls -w @mc-toolchain/keepinventory` 能解析到该模组。
- [x] 1.2 用 `mct create`(tsStarter 形态)在 `mods/keepinventory` 生成模组,并调整为包名 `@mc-toolchain/keepinventory`、`version` `0.0.1`、`.env` 的 `PROJECT_NAME=keepinventory`;验证方式:`mods/keepinventory/package.json` 的 `name`/`version` 与 `.env` 值符合预期,且模板核心文件(`just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`scripts/main.ts`)齐全。
- [x] 1.3 把模组精简为纯行为包:将 `behavior_packs/keepinventory` 重命名为 `BP/keepinventory`,删除模板生成的 `resource_packs/` 与 tick `sendMessage` 示例,保留 `BP/keepinventory/manifest.json` 与 `pack_icon.png`;验证方式:`npm run build -w @mc-toolchain/keepinventory` 成功,且 `find mods/keepinventory -maxdepth 1 -type d` 出现 `BP` 而不出现 `behavior_packs`/`resource_packs`。

## 2. keepinventory 模组行为

- [x] 2.1 修改 `BP/keepinventory/manifest.json`:`min_engine_version` = `[1, 21, 0]`、依赖 `@minecraft/server` = `[1, 11, 0]`、`metadata.product_type` = `"addon"`、`header.name` = 「死亡不掉落」;验证方式:`mct validate -i mods/keepinventory` 通过,且用脚本断言该三处字段取值正确。
- [x] 2.2 实现 `scripts/main.ts`:订阅 `world.afterEvents.worldLoad`,在其回调中设置 `world.gameRules.keepInventory = true`(可再包一层 `system.run` 推迟到下一 tick),且不订阅玩家事件重复设置;除 `keepInventory` 外不得写任何游戏规则;验证方式:`npm run build -w @mc-toolchain/keepinventory` 产出 `dist/scripts/main.js`,且源码与产物中除 `keepInventory` 外无其它 gameRule 赋值。
- [x] 2.3 在 `mods/keepinventory/README.md` 记录:兼容区间(`1.21.90 → 1.26.40` 成就可用)、`1.26.50+` 的 MCPE-242529 平台限制、无需作弊、安装与使用方式;验证方式:文档包含上述四项要点,且描述与 `BP/keepinventory/manifest.json` 的实际取值一致。

## 3. 打包配置与自定义打包逻辑

- [x] 3.1 固定依赖:模组 `package.json` 的 `@minecraft/server` 固定为 `2.0.0`,移除本模组未使用的脚本模块依赖;验证方式:`npm install` 成功且无 peer 依赖冲突,实际安装版本为 `2.0.0`。
- [x] 3.2 在模组 `package.json` 追加可选 `packing` 配置块(`mode`/`behavior_packs`/`resource_packs`/`output`,每个字段都有默认值,可整块省略)与**唯一的**打包脚本 `"pack": "just-scripts pack"`;验证方式:`node -e` 读取并打印解析后的默认配置,确认缺省时为 `mode=auto`、`output=dist/packages`、包类型改由 `manifest.json` 探测。
- [x] 3.3 新增 `mods/keepinventory/tools/packaging.ts`,实现三个函数:`resolvePackDirectories()`(显式配置优先,否则扫描模组目录下含 `manifest.json` 的包目录并**按 `modules[].type` 判定类型**:含 `data`/`script` 为行为包、含 `resources` 为资源包;同类型多个报歧义、清单无法判定类型报错、显式路径不存在或类型不符报错)、`synchronizePackVersions()`(把 `package.json#version` 写成 `[major,minor,patch]`,写入各 `manifest.json` 的 `header.version`、`modules[].version` 与资源包对行为包的依赖 `version`;不可解析为三段数字时报错中止)、`createPackagesByMode()`(按 `mode` 用 `zipTask` 产出产物);验证方式:对「目录名与类型不一致」「同类型多个包」「清单无法判定类型」「显式路径不存在或类型不符」「非法版本号」五种输入分别调用并观察行为符合 spec。
- [x] 3.4 在 `mods/keepinventory/just.config.ts` 引入并注册 `pack` 任务,流水线为 `series("clean-build", "build", synchronizePackVersions, createPackagesByMode)`(`clean-build` 只清构建中间产物与 `dist/scripts`,保留 `dist/packages` 以便多版本并存);官方任务与脚本保持不动;验证方式:`npm run pack -w @mc-toolchain/keepinventory` 能完整执行且既有官方脚本(`build`、`mcaddon`)仍可用。
- [x] 3.5 验证 `mode: "auto"` 的自动检测:先在纯行为包状态下打包,再临时新增 `RP/keepinventory/`(含合法 `manifest.json`)后打包;验证方式:前者只产出 `dist/packages/keepinventory-v<version>_bp.mcpack`、不产出 `.mcaddon`;后者只产出 `dist/packages/keepinventory-v<version>.mcaddon`(内含两个 `.mcpack`)。验证后移除临时资源包。
- [x] 3.6 验证 `mode` 显式覆盖与类型判定:(a) `mode` 设为 `mcpack` 且 BP/RP 都在 → 产出 `_bp.mcpack` 与 `_rp.mcpack` 两个文件且无 `.mcaddon`;(b) `mode` 设为 `mcaddon` 但只留 BP → 报错提示单包应使用 `mcpack` 且不产出任何产物;(c) 临时把一个只含 `resources` 模块的包放进 `BP/` 目录 → 被打包识别为资源包(产出 `_rp.mcpack`),证明类型来自 `manifest.json` 而非目录名,验证后恢复目录。
- [x] 3.7 验证版本同步与命名联动:把 `package.json#version` 改为 `0.0.2` 后执行 `pack`;验证方式:产物名为 `keepinventory-v0.0.2*` 且包内 `manifest.json` 版本为 `[0, 0, 2]`,并与 `0.0.1` 产物并存于输出目录。
- [x] 3.8 验证压缩包结构:解压产物并列出文件树;验证方式:`.mcpack` 根目录存在 `manifest.json`、行为包内存在 `scripts/main.js`,且列表中不含 `.ts` 源文件与 `.map` 调试文件。
- [x] 3.9 在 `mods/keepinventory/README.md` 补充打包文档:`pack` 用法、`packing` 各字段与默认值、`BP`/`RP` 与全名目录的等价关系、`auto` 的自动检测规则,以及「`mct` 重新导入项目会重置 `just.config.ts` 与 `package.json#packing`」的风险与恢复方式;验证方式:文档中的命令逐条可复制执行成功。

## 4. 集成验证

- [x] 4.0 修复 lint 与 prettier:官方 `mct create` 模板的 `eslint.config.mjs` 导入了 `@typescript-eslint/eslint-plugin`,但模板 `devDependencies` 未声明它,导致 `npm run lint` 必然失败(全新模板项目可复现);补装 `@typescript-eslint/eslint-plugin`、`@typescript-eslint/parser` 与 `prettier` 到 `devDependencies`,并把 lint/prettier 的检查范围从 `scripts/**/*.ts` 扩到同时覆盖 `tools/**/*.ts`;验证方式:`npm run lint` 中 eslint 与 `prettier --check` 均通过。

- [x] 4.1 全量校验工具链与行为包:在仓库根执行 `mct validate -i mods/keepinventory` 与 `npm run build -w @mc-toolchain/keepinventory`;验证方式:两者均成功且无错误输出。
- [x] 4.2 实机验证(需 Minecraft 客户端):分别在 Minecraft 1.21.90 与最新版加载行为包,确认死亡后物品与经验保留、世界作弊开关保持关闭;并在 `< 1.26.50` 版本确认完成成就条件时可正常解锁成就;验证方式:记录两款版本的实测结果(含 `1.26.50+` 因平台 bug 无法解锁成就的观察)。已由用户在真实客户端验证通过:模组可正常使用。

## Workflow follow-up

- 实施完成并通过评审后,运行 `/opsx-archive` 归档本变更,把 `specs/` 下的三个能力 delta 同步为 `openspec/specs/` 主 spec。
- 归档后确认 `openspec list --specs` 出现 `mod-workspace`、`addon-packaging`、`keepinventory` 三个能力。
