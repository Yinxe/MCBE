# Design

## Context

See `proposal.md` — Why for motivation. 本节只记录约束与已实测的事实。

### 仓库现状

- 根 `package.json` 的 `workspaces` 目前只有 `mods/*` 与 `tools/*`,没有 `packages/*`。
- `mods/keepinventory` 是唯一已完成模组,打包逻辑在 `mods/keepinventory/tools/packaging.ts`(580 行),由 `just.config.ts` 直接 `import`。
- `tools/mcwiki-search` 是唯一 `tools/` 成员,可发布、`type: "module"`、用 vitest。
- `@minecraft/server` 在根 `node_modules` 中为 2.0.0;`@minecraft/server-ui` **未安装**,需新增。
- 模组 `tsconfig.json` 的 `module` 为 `ES2020`、`moduleResolution` 为 `Node`、`target` 为 `es6`、`baseUrl` 指向 `behavior_packs/`。

### 上游 auto-refill 现状

- `scripts/` 21 个模块共约 2140 行,`tests/` 6 个文件 60 项纯逻辑测试;`tsconfig.test.json` 用 `module: commonjs` + `outDir: .test-build` 编译纯逻辑子集后 `node --test`。
- 唯一第三方运行时依赖是 `@yinxe/toolkit`(`AntiTouchHud.ts` 用到 `HudManager`、`color`、`style`),唯一 UI 依赖是 `@minecraft/server-ui`(`AdminMenu.ts` 的 `ModalFormData`)。
- `HudManager` 是跨行为包 actionbar/title/sidebar 仲裁器,依赖 `/scriptevent` 总线、`system.runInterval` 与计分板对象;`arbiter.ts` 是纯函数(`BusClaim`/`isStale`/`pickWinner`)。
- 包目录 `BP/AutoRefill`,包名 `auto-refill`(无 scope),`min_engine_version [1,21,20]`。

### 已实测的关键约束

1. `just-scripts` 加载 `just.config.ts` 时经 ts-node 转译,可直接 `import` 一个 `main` 指向 `src/index.ts` 的 workspace 包(实测通过)。因此共享包无需预编译即可被 `just.config.ts` 使用。
2. esbuild(bundle 任务)能解析并内联这类 TS 源码 workspace 包(实测 `--bundle` 输出含该包代码,`@minecraft/server` 作为 external 保留)。
3. 模组的 `tsc` 会跟随 workspace 包的 `types` 字段进入其源码并做类型检查;因此共享包的 `package.json` 必须显式提供 `types`,且其源码必须能在模组的 `target`/`module` 设置下通过检查。
4. 上游 `pack_icon.png` 为 256×256,仓库规范要求 128×128,必须重绘而非缩放。

## Goals / Non-Goals

**Goals:**

- 让打包逻辑与 HUD/样式工具在仓库内各只有一份源码,后续模组零复制即可复用。
- 让 `mods/auto-refill` 在目录、包名、版本来源、打包入口、测试入口上与 `keepinventory` 完全同构。
- 保持上游全部功能语义与 60 项纯逻辑测试不变,只改「从哪里 import」。
- 让 `packages/*` 的引入不破坏既有 `keepinventory` 的产物与命令。

**Non-Goals:**

- 不把 `@mc-toolchain/shared` 做成可发布库,也不承诺对外 API 稳定性。
- 不为 `tools/mcwiki-search` 更换测试框架,也不统一两套测试框架(它用 vitest、模组用 `node --test`)。
- 不重写上游决策算法(评分、偏好表、防误触窗口),只做搬运与接口适配。
- 不在本次改动中新增模组功能或调整任何默认阈值。

## Decisions

### D1: 新增 `packages/` 顶层工作区,与 `mods/`、`tools/` 三分

`workspaces` 扩为 `["mods/*", "packages/*", "tools/*"]`。三个目录的职责在 `mod-workspace` 规格中已定为:模组 / 内部共享包 / 可发布工具。

**备选**:把共享代码塞进 `tools/`。否决理由:`tools/` 现有成员是可发布 npm 包(`publishConfig.access: public`),混入私有共享包会让「`tools/` 下都能发布」这一隐含预期失效,也让 `files`/`exports` 等发布字段变成噪音。

**备选**:在 `mods/` 下建 `mods/shared`。否决理由:`mods/*` 的语义是「每个目录一个模组」,而共享包没有 `manifest.json`、不打 `.mcpack`,会被 `mct validate -i mods` 与模组模板约定误伤。

### D2: 共享包以 TS 源码直出,不设预编译步骤

`packages/shared` 与 `packages/packaging` 的 `package.json` 使用 `"main"`/`"types"` 同时指向 `src/index.ts`,不产出 `lib/`,不设 `build` 脚本。

**理由**:实测(见 Context 第 1–3 条)表明 `just-scripts` 与 esbuild 都能直接消费 TS 源码 workspace 包;省掉构建步骤就省掉了「改了源码忘记 rebuild 导致产物用旧代码」这一类故障,也让 `npm run pack -w <mod>` 保持单命令。

**备选**:每个共享包加 `tsc` 预构建 + `prepare` 钩子。否决理由:`npm install` 时触发构建会让 CI 与本地首次安装变慢,且需要维护 `lib/` 的 gitignore 与清理逻辑;收益仅是让 `main` 指向 JS,而消费方(esbuild、ts-node)本来就能处理 TS。

**代价**:共享包源码必须落在消费方 `tsconfig` 的编译能力内(模组 `target: es6`)。因此共享包禁用 `??=`、`?.` 之外的较新语法糖,并以消费方最严格配置为基准自检。

### D3: `@mc-toolchain/shared` 只承载 `color`/`style` 与 `HudManager` 子集

从 `@yinxe/toolkit` 只搬运 auto-refill 实际用到的部分:`color` 常量、`style()`、`HudManager`、`arbiter`(`pickWinner`/`isStale`/`BusClaim`)。不搬运 `actionFormFg`、`ModalFormBuilder`/`ActionFormBuilder`/`MessageFormBuilder`、`defineCommand`、`player.canManage`。

**理由**:搬运未使用的代码会让共享包承担无谓的维护面与审查面。`AdminMenu` 已直接使用原生 `ModalFormData`,不需要 UI 构造器;命令注册在 auto-refill 里是两处 `registry.registerCommand` 直调,不需要 `defineCommand` 包装。

**备选**:整体搬运 toolkit。否决理由:UI 构造器与命令包装都没有消费方,搬进来等于把外部仓库的全部设计债转移到本仓库。

**跨包总线兼容性**:`HudManager` 的 `/scriptevent yinxe:hud` 协议与 `modId` 参与决胜的规则**原样保留**。这不是本仓库内部实现细节,而是与用户世界中其它行为包(spectator-mode、item-route)共用的运行时协定;改协议会让本模组的 HUD 与其它包互相覆盖。因此 `modId` 仍为 `"auto-refill"`。

### D4: `@mc-toolchain/packaging` 由 keepinventory 的 `tools/packaging.ts` 平移,行为零变更

搬移时只做两件事:把 `zipTask` 的依赖改为从 `@minecraft/core-build-tasks` 以 peer 形式获取;把纯逻辑函数(`parseVersion`、`normalizeScriptApiVersion`、`findMinimumEngineVersion`、`resolveMinimumEngineVersion`、`detectPackType`、`resolvePackDirectories` 等)从需要文件系统的入口中分离,使它们可被单测直接调用。

**理由**:`addon-packaging` 规格要求「替换实现后产物不变」。零行为变更是最容易验证的迁移方式:两个模组打出的产物与迁移前逐字节可比。

**备选**:顺手重构打包逻辑(例如把 `minimum_engine_version` 映射表抽成数据文件)。否决理由:本次改动的目的是消除重复,不是改进打包器;混入重构会让「产物不变」这条验证失去意义。

**peerDependency 而非 dependency**:`@minecraft/core-build-tasks` 由各模组自己声明版本(keepinventory 现为 `5.5.0`),共享包若硬依赖会锁死版本或造成重复安装。用 `peerDependencies` + `devDependencies` 自测。

### D5: 共享包的测试用 `node --test`,与模组一致

`packages/packaging` 自带纯逻辑测试,用 `tsc` 编到 `.test-build` 后 `node --test` 运行,与 `mods/auto-refill` 的测试口径一致。

**理由**:仓库里已有两套测试框架(vitest 在 `tools/`, `node --test` 在上游 auto-refill)。共享包与模组是同一类东西(构建期 Node 脚本 + 纯逻辑),跟随模组口径能让「`npm test -w <pkg>` 行为一致」成立。`packages/shared` 的 `HudManager` 依赖 `@minecraft/server`,不做单元测试,只做编译期类型检查。

**备选**:统一到 vitest。否决理由:这会把「迁移上游 60 项 `node:test` 用例」变成「重写 60 项用例」,扩大本次改动范围,且 `tools/mcwiki-search` 的 vitest 与模组侧没有共享需求。

### D6: 模组侧 `tools/packaging.ts` 删除,`just.config.ts` 改为 import 共享包

`mods/keepinventory` 与 `mods/auto-refill` 都只保留任务编排。

**理由**:`addon-packaging` 规格新增的「打包逻辑在仓库内只有一份」要求如此;同时这也消除了两个模组打包实现漂移的根源。

**风险控制**:keepinventory 的改造与 auto-refill 的引入放在同一改动内,先在 keepinventory 上验证「产物与改造前一致」,再让 auto-refill 复用同一实现。

### D7: 版本 `2.2.0`、依赖 `@minecraft/server 2.1.0`、`minimum_engine_version [1,21,100]` 显式声明

`package.json` 保持 `version: "2.2.0"` 与 `dependencies["@minecraft/server"] = "2.1.0"`;`packing.minimum_engine_version` 显式写 `[1, 21, 100]`;`manifest.json` 的 `dependencies[].version` 写 `[2, 1, 0]`。

**理由**:上游代码用到两组超出 `@minecraft/server 2.0.0` 的 API:

| API | 首次可用 | 用途 |
| --- | --- | --- |
| `StartupEvent.customCommandRegistry` / `CommandPermissionLevel` / `CustomCommandOrigin` | 2.1.0 | `/ar:menu`、`/ar:help` 原生自定义命令 |
| `world.afterEvents.entityHeal` / `EntityHealAfterEvent` | 2.6.0 | 图腾触发的合成事件 |

取 2.1.0 而非 2.6.0,是因为前者能把兼容下限压在 1.21.100,同时保留原生命令;`entityHeal` 在 2.1.0 的类型面里不存在,因此必须改为**运行时特性侦测的优雅降级**——图腾补充在 1.21.100–1.26.0 上自动失效,1.26.10+ 恢复完整功能。上游 `main.ts` 已有 `if (world.afterEvents.entityHeal)` 守卫,迁移时保留即可。

显式写 `packing.minimum_engine_version` 而非依赖推导,是因为推导值会随依赖版本静默漂移;显式声明把门槛钉在配置里。

**备选**:
- 用 `2.0.0` + `[1,21,90]`(原规划)。否决理由:2.0.0 既无 `customCommandRegistry` 也无 `entityHeal`,两个功能都得降级,其中命令要退回 `/scriptevent` 并失去原生自动补全。
- 用 `2.6.0` + `[1,26,10]`。否决理由:功能 100% 等价上游,但放弃 1.21.100–1.26.0 全部玩家,代价过大。
- 省略 `packing.minimum_engine_version` 靠推导。否决理由:静默漂移风险。

**背景研究**:见 `docs/research/version-semantics-and-backward-compatibility.md`。

**验收要点**:`package.json` 的 `@minecraft/server` 版本、`manifest.json` 的 `dependencies[].version`、`packing.minimum_engine_version` 三者必须同时改动并保持自洽——`packages/packaging` 不会同步 `dependencies[].version`,那一行是手写常量。

### D8: 保留上游 UUID

`manifest.json` 的 `header.uuid` 与 `modules[].uuid` 原样沿用上游。

**理由**:UUID 是行为包在玩家世界中的身份。改名/换 UUID 会让已安装上游版本的玩家得到「两个不同包」,而不是升级。虽然目录从 `BP/AutoRefill` 改为 `behavior_packs/auto-refill`,但 UUID 不变即可被视为同一包的更新。

**备选**:重新生成 UUID。否决理由:只在需要与上游彻底割裂时才必要,本次是迁移而非另起。

### D9: 图标重绘为 128×128

`mods/auto-refill/tools/generate-pack-icon.js` 按 `keepinventory` 的做法生成 32×32 逻辑像素 → 4 倍最近邻放大到 128×128,画面表达「工具自动替换」。

**理由**:`pack-icon` 规格要求 128×128 与像素画风格,且要求不使用占位图。直接缩放上游 256×256 图会得到非整数比例的重采样,破坏像素画锐利边缘。

## Risks / Trade-offs

- **[共享包改动会同时影响所有模组]** → `packages/*` 无版本隔离,一次改动两个模组都受影响。缓解:`packages/packaging` 自带纯逻辑测试;每次改动后跑两个模组的 `npm run pack` 并比对产物。
- **[TS 源码直出对消费方 tsconfig 有隐性耦合]** → 若某模组把 `target` 降到 `es5`,共享包的语法可能编译失败。缓解:共享包源码以最保守语法书写,并在 `packages/*` 各自的 `tsconfig.json` 中用 `target: es6` 自检。
- **[`HudManager` 的 `/scriptevent` 协议与外部包耦合]** → 若未来有人「优化」协议或 `modId`,会与用户世界中的 spectator-mode / item-route 冲突。缓解:在 `shared-runtime` 规格中把「同优先级按标识决胜」「心跳过期」写成可观察行为,并在代码注释中标注协议不可改。
- **[最低游戏版本抬到 1.21.100 会挡住旧客户端]** → 1.21.20–1.21.99 的玩家无法加载。缓解:这是明确决策(用户已选定 1.21.100),在模组 README 中记录最低版本要求。
- **[`entityHeal` 在 1.21.100–1.26.0 上缺失]** → 图腾补充在这些版本上静默失效。缓解:上游已有 `if (world.afterEvents.entityHeal)` 守卫,保留即可;在模组 README 中明确记录「图腾补充需 1.26.10+」。
- **[`dependencies[].version` 是手写常量,不会被打包工具同步]** → 改 `package.json` 的依赖版本时容易漏改 manifest,造成声明与代码错位。缓解:在 `mods/auto-refill/README.md` 与 design D7 中写明「三处必须同时改」;不引入自动校验(避免 `packages/packaging` 承担它不该知道的兼容性策略)。
- **[删掉 `mods/keepinventory/tools/packaging.ts` 是破坏性改动]** → 任何指向该路径的外部脚本或文档会失效。缓解:全仓库检索引用点(`just.config.ts`、README、`tsconfig` 的 `include`),一并更新;`git` 历史仍可回溯。
- **[新增 `@minecraft/server-ui` 依赖]** → 仓库此前没有该依赖,需要确认版本与 `@minecraft/server` 匹配。缓解:固定 `2.0.0`;`@minecraft/server-ui 2.0.0` 的 peer 要求是 `@minecraft/server >= 2.0.0`,与本次选定的 2.1.0 兼容;在 `manifest.json` 的 `dependencies` 中同步声明。
- **[60 项测试迁移后可能与新目录结构不匹配]** → `tsconfig.test.json` 的 `include` 是显式文件列表,搬移后路径需逐一校正。缓解:迁移后立即运行 `npm test -w @mc-toolchain/auto-refill`,以「60 项全通过」为完成判据。
- **[图标重绘可能与上游视觉不一致]** → 玩家会注意到图标变化。缓解:这是 `pack-icon` 规格的硬要求;重绘时保留上游的配色语义(工具/物品/替换箭头)。

## Migration Plan

1. **准备**:根 `package.json` 加 `packages/*` 工作区;根 `.gitignore` 补 `.test-build/`。
2. **抽出共享打包**:新建 `packages/packaging`,把 `keepinventory/tools/packaging.ts` 平移进去并拆出纯逻辑,补测试。
3. **切换 keepinventory**:改 `just.config.ts` 为 import 共享包,删 `tools/packaging.ts`,跑 `npm run pack` 并与迁移前产物比对(文件名、包内清单、`min_engine_version`、版本字段)。
4. **抽出共享运行时**:新建 `packages/shared`,搬入 `color`/`style`/`HudManager`/`arbiter`,以 `es6` 目标自检。
5. **建模组骨架**:`mods/auto-refill` 按 keepinventory 同构创建 `package.json`、`just.config.ts`、`tsconfig.json`、`tsconfig.test.json`、`eslint.config.mjs`、`.env`(`PROJECT_NAME="auto-refill"`)。
6. **搬脚本**:21 个模块从上游 `scripts/` 平移,`AntiTouchHud.ts` 的 import 改为 `@mc-toolchain/shared`;包目录 `behavior_packs/auto-refill/`,`manifest.json` 保留上游 UUID、版本改 `[2,2,0]`、`min_engine_version` 改 `[1,21,90]`、`dependencies` 含 `@minecraft/server [2,0,0]` 与 `@minecraft/server-ui [2,0,0]`。
7. **搬测试**:6 个测试文件与 `tsconfig.test.json` 迁入,`include` 路径校正,`npm test -w @mc-toolchain/auto-refill` 全绿。
8. **图标**:`tools/generate-pack-icon.js` 生成 128×128 `pack_icon.png`。
9. **文档**:根 `README.md` 补模组表与 `packages/` 说明;`mods/README.md` 补「共享包引用」与「打包逻辑不在模组内」;`mods/auto-refill/README.md` 记录功能、命令、最低版本。
10. **验证**:两个模组各跑 `tsc --noEmit`、`lint`、`pack`、`mct validate -i .`;`openspec validate refactor-auto-refill-mod --strict`。

**回滚**:本次改动集中在新增目录与两处 `just.config.ts`/`package.json` 修改。回滚即恢复 `mods/keepinventory/tools/packaging.ts`、撤销根 `workspaces` 与 `keepinventory` 的 import 改动、删除 `packages/*` 与 `mods/auto-refill`。`keepinventory` 的产物不受回滚影响(第 3 步已验证等价)。

## Open Questions

- `packages/shared` 是否需要在后续把 `ModalFormBuilder` 等 UI 构造器也搬进来:取决于下一个模组是否真的用到表单构造器;当前无消费方,留待有需求时再评估。
- 两套测试框架(`vitest` 与 `node --test`)是否统一:与本次改动无关,可在独立改动中评估。
