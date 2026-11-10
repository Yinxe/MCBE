# Tasks

## 1. 库包 `packages/nbt-data-storage`

- [x] 1.1 创建 `packages/nbt-data-storage/package.json`：包名 `@mc-toolchain/nbt-data-storage`、版本 `0.1.21`、`main`/`types` 指向 `src/index.ts`、`@minecraft/server` 放 `peerDependencies` (`>=2.0.0`)、devDependencies 含 `@types/node` 与 `typescript 5.5.4`、`test` 脚本为 `tsc -p tsconfig.test.json && node --test ".test-build/tests/**/*.test.js"`。验证：`node -e "JSON.parse(require('fs').readFileSync('packages/nbt-data-storage/package.json'))"` 无报错且 `name`/`version` 正确。
- [x] 1.2 创建 `packages/nbt-data-storage/tsconfig.json`（`noEmit`、`strict`、`include: ["src/**/*.ts"]`，与 `packages/mod-common/tsconfig.json` 同形）与 `tsconfig.test.json`（`module: commonjs`、`outDir: ../.test-build`、`rootDir: ..`、`include: ["../src/**/*.ts", "**/*.ts"]`）。验证：`npx tsc -p packages/nbt-data-storage/tsconfig.json --noEmit` 在源码拷入后零错误。
- [x] 1.3 把上游 `src/core/` 的 8 个文件（`batch.ts`、`index.ts`、`keys.ts`、`layout.ts`、`meta.ts`、`overwrite.ts`、`put.ts`、`record.ts`、`region.ts`、`repair.ts`、`stats.ts`、`transfer.ts`）原样拷入 `packages/nbt-data-storage/src/core/`，文件头注释保持不动。验证：`ls packages/nbt-data-storage/src/core/*.ts | wc -l` 为 12。
- [x] 1.4 新增 `packages/nbt-data-storage/src/core/EventSignal.ts`，自足实现 `EventSignal<T>`（`Set` 存回调、`subscribe`/`unsubscribe`/`trigger`、快照遍历、订阅者异常转 `console.warn` 不影响其他订阅者、同一回调重复订阅只注册一次），不导入任何 `@minecraft/*` 或外部包。验证：`grep -c "@minecraft\|@yinxe" packages/nbt-data-storage/src/core/EventSignal.ts` 为 0，且 1.10 的事件用例通过。
- [x] 1.5 把上游 `src/mc/` 的 6 个文件（`BarrelRuntime.ts`、`commands.ts`、`events.ts`、`ItemStorage.ts`、`StoredRegion.ts`、`store.ts`）原样拷入 `packages/nbt-data-storage/src/mc/`。验证：`ls packages/nbt-data-storage/src/mc/*.ts | wc -l` 为 6。
- [x] 1.6 修改 `packages/nbt-data-storage/src/mc/events.ts`：把 `import { EventSignal } from "@yinxe/toolkit/src/events"` 改为 `import { EventSignal } from "../core/EventSignal"`，同步更新文件头注释里「复用 @yinxe/toolkit 的 EventSignal」一句。验证：`grep -rn "@yinxe" packages/nbt-data-storage/src/` 无输出。
- [x] 1.7 把上游 `src/index.ts` 原样拷入，并把公共入口注释里的 `@yinxe/nbt-data-storage` 改为 `@mc-toolchain/nbt-data-storage`。验证：`grep -rn "@yinxe" packages/nbt-data-storage/src/index.ts` 无输出，且 `grep -c "^export" packages/nbt-data-storage/src/index.ts` 与上游一致。
- [x] 1.8 把上游 `tests/` 的 12 个测试文件（`batch`/`keys`/`layout`/`meta`/`override`/`overwrite`/`put`/`record`/`region`/`repair`/`repro`/`transfer`）拷入 `packages/nbt-data-storage/tests/`。验证：`ls packages/nbt-data-storage/tests/*.test.ts | wc -l` 为 12。
- [x] 1.9 为 1.4 的 `EventSignal` 新增 `packages/nbt-data-storage/tests/events.test.ts`，覆盖四条行为：订阅后 `trigger` 收到负载、取消订阅后不再收到、同一回调重复订阅只触发一次、某订阅者抛错不影响其余订阅者。验证：`node --test` 中该文件全部用例通过。
- [x] 1.10 在 `packages/nbt-data-storage/` 下运行 `npm test`（即 `tsc -p tsconfig.test.json && node --test`）。验证：编译零错误，`node --test` 报告的 `# fail 0`，且用例总数不少于上游 12 个文件加 1.9 新增文件的总和。
- [x] 1.11 编写 `packages/nbt-data-storage/README.md`：说明用途、公共入口导出的符号、`register`/`put`/`read`/`take` 的最小用法、事件清单、`peerDependencies` 的版本要求，并写明纯逻辑部分可在无游戏环境的 Node 下单测。验证：README 中给出的代码片段与 `src/index.ts` 实际导出符号逐一对应，无未导出符号。

## 2. 模组骨架 `mods/mockplayer3`

- [x] 2.1 创建 `mods/mockplayer3/package.json`：`name` 为 `@mc-toolchain/mockplayer3`、`version` 为 `3.0.32`、`productName` 为 `模拟玩家III`；`dependencies` 固定为 `@minecraft/server 2.8.0`、`@minecraft/server-gametest 1.0.0-beta.1.26.0-stable`、`@minecraft/server-ui ^2.0.0`、`@minecraft/math 2.2.7`、`@minecraft/vanilla-data 1.26.20`；`devDependencies` 含 `@mc-toolchain/mod-common`、`@mc-toolchain/mod-packaging`、`@mc-toolchain/nbt-data-storage`（均为 `*`）与 `@minecraft/core-build-tasks 5.5.0` 等构建依赖；`packing` 段为 `mode: "auto"`、`output: "../../release/"`、`minimum_engine_version: [1, 21, 130]`、`qq_group: "632178498"`。验证：`node -e "const p=require('./mods/mockplayer3/package.json');console.log(p.version,p.packing.minimum_engine_version)"` 输出 `3.0.32 [ 1, 21, 130 ]`。
- [x] 2.2 创建 `mods/mockplayer3/.env`（`PROJECT_NAME="mockplayer3"`、`MINECRAFT_PRODUCT="BedrockGDK"`、`CUSTOM_DEPLOYMENT_PATH=""`）、`eslint.config.mjs`（与 `mods/item-route/eslint.config.mjs` 同形）、`tsconfig.json`（保留上游的 `moduleResolution: "bundler"`、`types: []`、`include: ["scripts/**/*"]` 等全部选项）。验证：`npx tsc -p mods/mockplayer3/tsconfig.json --noEmit` 在源码拷入后零错误。
- [x] 2.3 创建 `mods/mockplayer3/just.config.ts`，与 `mods/item-route/just.config.ts` 同构，差异只有三处：`external` 加入 `@minecraft/server-gametest`；`copyToResourcePacks` 指向 `./resource_packs/${projectName}`；`pack` 任务链为 `series("clean-build", "build", "synchronizePackVersions", createPackagesByMode(__dirname))`。验证：`grep -c "copyToResourcePacks" mods/mockplayer3/just.config.ts` 为 1，且 `grep -c "@yinxe" mods/mockplayer3/just.config.ts` 为 0。
- [x] 2.4 创建 `mods/mockplayer3/behavior_packs/mockplayer3/manifest.json`：`format_version: 2`；`header.uuid` = `49df180b-e16a-4740-9edd-c655127fcd22`、`header.version` = `[3,0,32]`、`header.min_engine_version` = `[1,21,130]`；`modules` 两项 UUID 分别为 `256118ca-af02-43d2-a0f1-da5b460474d6`（`type: data`）与 `cda1f72a-5834-4494-af4c-871df2e22e0a`（`type: script`、`module_name: "MockPlayer"`、`entry: "scripts/main.js"`）；`dependencies` 三项为资源包 UUID `4497ec44-a22f-4f7f-a723-1f18d14c4e04`（version `[3,0,32]`）、`module_name: "@minecraft/server"` 配 `version: "beta"`、`module_name: "@minecraft/server-gametest"` 配 `version: "beta"`、`module_name: "@minecraft/server-ui"` 配 `version: "2.0.0"`。验证：`python3 -c` 读该文件断言五个 UUID 与三个 `module_name` 依赖版本逐字等于上述值。
- [x] 2.5 创建 `mods/mockplayer3/resource_packs/mockplayer3/manifest.json`：`header.uuid` = `4497ec44-a22f-4f7f-a723-1f18d14c4e04`、`header.version` = `[3,0,32]`、`header.min_engine_version` = `[1,21,130]`、`modules` 一项 UUID = `79f9a3e5-d73b-4741-a6f9-b499f5bcde65`（`type: resources`）。验证：同上断言脚本对资源包清单通过。
- [x] 2.6 把上游 `RP/MockPlayer3/` 下的 UI 图标纹理等资源文件拷入 `mods/mockplayer3/resource_packs/mockplayer3/`，保持相对路径。验证：`diff -r` 对比上游 RP 目录（除 `manifest.json`）与迁移后目录无差异。

## 3. 源码迁入与依赖替换

- [x] 3.1 把上游 `scripts/` 的 146 个文件整体拷入 `mods/mockplayer3/scripts/`，保持 `domain/`(45)、`application/`(21)、`engine/`(45)、`interface/`(32)、`Composition.ts`、`main.ts`、`Runtime.d.ts` 的目录与文件位置完全不变。验证：`find mods/mockplayer3/scripts -name '*.ts' -o -name '*.d.ts' | wc -l` 为 146，且 `diff -r --brief` 对比上游 `scripts/`（除下述待改文件外）无差异。
- [x] 3.2 把 30 个文件里的 `from "@yinxe/toolkit"` 改为 `from "@mc-toolchain/mod-common"`，涉及符号 `color`、`style`、`trySendMessage`、`ModalFormBuilder`、`ActionFormBuilder`、`MessageFormBuilder`（这些符号 `mod-common` 已全部导出）。验证：`grep -rn "from \"@yinxe/toolkit\"" mods/mockplayer3/scripts/` 只剩 `CmdKit.ts` 一处（3.3 处理），其余 29 个文件的导入全部改向。
- [x] 3.3 改 `mods/mockplayer3/scripts/interface/CmdKit.ts`：从导入列表移除 `defineCommand`，改为从 `@mc-toolchain/mod-common` 导入 `runSafeDetached`；在文件内新增本地 `defineCommand(registry, config, handler)` 实现，语义逐条对齐上游——取 `origin.sourceEntity ?? origin.initiator`、非 `Player` 返回 `{ status: 1, message: "该命令只能由玩家执行" }`、按 `[...mandatoryParameters, ...optionalParameters]` 位置映射 `args[i]` 到 `params[param.name]`、用 `runSafeDetached` 把 handler 推迟到安全上下文、立即返回 `{ status: 0, message: undefined }`。验证：`grep -c "@yinxe" mods/mockplayer3/scripts/interface/CmdKit.ts` 为 0，`npx tsc --noEmit` 零错误，且 `grep -n "runSafeDetached" mods/mockplayer3/scripts/interface/CmdKit.ts` 命中。
- [x] 3.4 把 `scripts/engine/ItemVault.ts` 与 `scripts/interface/Commands.Admin.ts` 里的 `@yinxe/nbt-data-storage` 改为 `@mc-toolchain/nbt-data-storage`，导入符号（`chunkFromAnchor`、`ItemStorage`、`regionId`、`shortDimension`、`StoredRegion`）保持不变。验证：`grep -rn "@yinxe" mods/mockplayer3/scripts/` 全仓零命中。
- [x] 3.5 在 `mods/mockplayer3/` 下运行 `npx tsc -p tsconfig.json --noEmit`。验证：零错误输出。若出现 `TS2339: Property 'tickingAreaManager' does not exist on type 'World'`，说明安装的 `@minecraft/server` 低于 `2.6.0`，须核对 2.1 的版本钉定是否生效，**不得**通过改代码或调低声明来绕过。
- [x] 3.6 为两个 `pack_icon.png` 生成 128×128 RGBA 图标：`mods/mockplayer3/tools/generate-pack-icon.js`（从 `mods/item-route/tools/generate-pack-icon.js` 复制并改文案/配色），分别写入行为包与资源包目录。验证：`python3 -c "from PIL import Image; ..."` 或 `file` 命令确认两个文件均为 `PNG image data, 128 x 128, 8-bit/color RGBA`。

## 4. 测试迁入

- [x] 4.1 把上游 `tests/` 的 28 个测试文件与 `tests/stubs/MinecraftRuntime.ts` 拷入 `mods/mockplayer3/tests/`。验证：`ls mods/mockplayer3/tests/*.test.ts | wc -l` 为 28，`ls mods/mockplayer3/tests/stubs/` 含 `MinecraftRuntime.ts`。
- [x] 4.2 创建 `mods/mockplayer3/tests/tsconfig.json`：沿用上游的 `target: ES2022`、`module: commonjs`、`outDir: .test-build`、`rootDir: .`、`types: ["node"]`，`include` 扩为 `["scripts/domain/**/*.ts", "scripts/engine/**/*.ts", "tests/**/*.ts"]`（上游只有 `domain`，会让 `engine.FishingSim.test.ts` 失去编译入口）。验证：`grep -c "scripts/engine" mods/mockplayer3/tests/tsconfig.json` 为 1。
- [x] 4.3 改 `mods/mockplayer3/tests/stubs/MinecraftRuntime.ts` 的 `STUBBED` 列表：把 `"@yinxe/toolkit"` 替换为 `"@mc-toolchain/nbt-data-storage"`，保留 `@minecraft/server`、`@minecraft/server-gametest`、`@minecraft/server-ui`、`@minecraft/math`。验证：`grep -c "@yinxe" mods/mockplayer3/tests/stubs/MinecraftRuntime.ts` 为 0，且 `grep -c "nbt-data-storage"` 为 1。
- [x] 4.4 在 `mods/mockplayer3/` 下运行 `npm test`。验证：`tsc -p tests/tsconfig.json` 零错误，`node --test` 报告的 `# fail 0`，`# pass` 数量与上游 28 个文件的实际用例总数一致（不少于上游基线），且输出中不出现 `MODULE_NOT_FOUND`。

## 5. 打包验证

- [x] 5.1 在仓库根执行安装，确认各 workspace 解析到各自声明的 `@minecraft/server` 版本。验证：`npm ls @minecraft/server --workspaces` 显示 `mockplayer3` 为 `2.8.0`、`item-route` 为 `2.1.0`、`teleporter` 为 `2.3.0`、`mod-common` 为 `2.0.0`，无 `invalid` 或 `UNMET`。
- [x] 5.2 在 `mods/mockplayer3/` 下执行 `npm run pack`。验证：命令退出码为 0，`release/` 下出现 `模拟玩家III-v3.0.32.mcaddon`（或 `packing` 配置决定的名字）。
- [x] 5.3 解压 5.2 的产物，核对两个包都在、清单正确。验证：解压后含 `mockplayer3/` 行为包与资源包两套；行为包 `manifest.json` 的 `header.version` 与 `modules[].version` 均为 `[3,0,32]`、`min_engine_version` 为 `[1,21,130]`、`@minecraft/server` 与 `@minecraft/server-gametest` 的 `version` 仍为字符串 `"beta"`、`@minecraft/server-ui` 仍为 `"2.0.0"`；五个 UUID 与上游逐字一致。
- [x] 5.4 确认产物未落在模组目录内。验证：`find mods/mockplayer3 -name "*.mcaddon" -o -name "*.mcpack"` 无输出。
- [x] 5.5 确认 `scripts/main.js` 已打进行为包且不含未内联的外部包。验证：产物行为包内存在 `scripts/main.js`，且 `grep -c "@yinxe" ` 该文件为 0。

## 6. 文档

- [x] 6.1 编写 `mods/mockplayer3/README.md`：功能概览（按上线/下线、工作模式、物品与资源、交互面板四组）、37 条 `mp:` 命令的分组表、构建与测试命令、依赖说明。必须包含两条醒目说明：(a) 运行时要求世界开启 **Beta APIs** 实验开关（因 `@minecraft/server` 与 `@minecraft/server-gametest` 依赖为 `"beta"`）；(b) 清单声明 `min_engine_version [1,21,130]`，但代码直接调用 `world.tickingAreaManager`（该 API 自 `@minecraft/server` 2.6.0 起存在，对应游戏 1.26.10），因此实际可用地板为 1.26.10，此不一致为上游既有问题、本次迁移保持原值未改。验证：README 中出现「Beta APIs」与「1.26.10」两处关键说明，且命令分组表条数与 `grep -rho "\"mp:[a-z]*\"" scripts/interface/` 去重后的条数一致。
- [x] 6.2 更新 `mods/README.md` 的模组清单表，新增 `mockplayer3` 一行（说明：模拟玩家（假人）——创建/上下线/工作模式/物品与经验回收/面板交互；注明它是本目录内**唯一保持四层目录（`domain`/`application`/`engine`/`interface`）** 的模组，与其余模组的 `core`/`mc` 分层不同）。验证：`grep -c "mockplayer3" mods/README.md` 至少为 1，且表格 Markdown 结构完整（列数与其他行一致）。
- [x] 6.3 更新根 `README.md`：模组表补 `mockplayer3` 一行，共享包说明补 `@mc-toolchain/nbt-data-storage`。验证：`grep -c "mockplayer3" README.md` 与 `grep -c "nbt-data-storage" README.md` 均至少为 1。

## 7. 集成验证

- [x] 7.1 全仓回归：在仓库根执行 `npx tsc -p packages/mod-common/tsconfig.json --noEmit`、`cd packages/mod-common && npm test`、`cd packages/nbt-data-storage && npm test`、`cd packages/mod-packaging && npm test`、`cd mods/mockplayer3 && npm test`。验证：五条命令全部退出码 0，各自 `# fail 0`。
- [x] 7.2 确认既有模组未被破坏：在 `mods/item-route/`、`mods/teleporter/` 下各跑一次 `npx tsc -p tsconfig.json --noEmit` 与 `npm run pack`。验证：两条 `tsc` 零错误，两次 `pack` 均在 `release/` 下产出各自的 `.mcaddon`。
- [ ] 7.3 游戏内实测命令生效（验证 `defineCommand` 的推迟语义没有落空，见 design R3）：新建测试世界并开启 Beta APIs，逐条执行并确认**世界状态真的改变**——`mp:create 测试1`（世界中出现假人）、`mp:online 测试1`（假人上线）、`mp:work 测试1 跟随`（模式切换生效）、`mp:tphere 测试1`（假人移动到玩家身边）、`mp:menu`（主菜单打开）、`mp:reclaim 测试1`（物品转移）。验证：六条命令每条都有可见的世界变化与玩家反馈，不出现「命令返回成功但什么都没发生」。**（阻塞：本环境无 Minecraft 客户端，须由你在游戏中执行）** 逐步操作见 `mods/mockplayer3/docs/迁移自测清单.md` §7.3。
- [ ] 7.4 游戏内实测面板与存档兼容：打开 `mp:admin` 全局配置面板、任一假人的操作面板与长流程脚本面板，各修改一项并确认改动持久化（重进世界后仍在）；用上游版本创建的世界存档替换为迁移后的包，确认假人记录、工作模式、物品仓内容与全局配置全部正确读取且假人可正常上下线。验证：面板改动重进后保留；旧存档中的假人在迁移后能上线并按原工作模式运行。**（阻塞：本环境无 Minecraft 客户端，须由你在游戏中执行）** 逐步操作见 `mods/mockplayer3/docs/迁移自测清单.md` §7.4。
- [ ] 7.5 游戏内实测常加载与物品仓：确认假人上线后 `tickingarea list` 出现 `mpa:` 前缀区域、下线后该区域被释放；执行一次物品存入与取出，确认 NBT 保真（用带附魔与自定义名称的物品往返）。验证：区域申请与释放可观察；物品往返后附魔、名称、耐久完全一致。**（阻塞：本环境无 Minecraft 客户端，须由你在游戏中执行）** 逐步操作见 `mods/mockplayer3/docs/迁移自测清单.md` §7.5。

## Workflow follow-up

- 项目评审要求满足后归档本变更。
- 归档后确认 `openspec/specs/mockplayer3/spec.md` 与 `openspec/specs/nbt-data-storage/spec.md` 已生成且 `## Purpose` 被正确带入。
- design.md 的 R1（引擎地板不一致）与 Open Questions 中的 `@minecraft/server` 版本统一问题，作为独立 change 另行评估，不在本变更范围内处理。
