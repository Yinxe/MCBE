# Design

## Context

仓库 `mc-toolchain` 目前只有 `openspec/` 规划目录,没有任何业务代码或构建配置;动机见 `proposal.md` 的 Why。约束如下:

- **平台约束**:Minecraft Bedrock 的成就判定受「世界是否使用外部(非市场)行为包」影响;1.26.50 起侧载外部行为包会禁用成就(见下文调研)。脚本 API 模块版本与游戏版本严格一一对应,`manifest.json` 的 `min_engine_version` 与脚本模块依赖共同决定兼容区间。
- **工具链约束**:项目以官方 `mct create`(`@minecraft/creator-tools` 0.21.0)生成的模板为基础,构建走 `just-scripts` + `@minecraft/core-build-tasks`。
- **`mct` 对模板文件的所有权**(实测,见「调研数据 3」):`ProjectStandard.ensureIsStandard()` 会把 `just.config.ts` 重置为默认内容、把 `eslint.config.mjs` 重置、并按白名单裁剪 `package.json`;但它只在 `ProjectUtilities.processNewProject()`(新建/导入项目)时调用,`mct setup` / `mct validate` / `mct export` / `mct deploy` 都不会触发。
- **用户约定**:模组放 `mods/`,用 npm workspaces 管理;模组包名 `@mc-toolchain/keepinventory`;初始版本 `0.0.1`;模组版本号与 npm 版本号一致。

## Goals / Non-Goals

**Goals:**

- 交付 `mods/keepinventory`,并在 1.21.90 → 1.26.40 全部「仍允许成就」的版本上生效。
- 用 npm workspaces 承载多个模组,给出可复制的模组布局与版本约定。
- 提供唯一的 `pack` 入口,由 `packing.mode` 决定产出 BP `.mcpack` / RP `.mcpack` / `.mcaddon`,文件名带模组名与版本号。

**Non-Goals:**

- 不修复 1.26.50 的平台成就 bug(MCPE-242529)——非模组可解决。
- 不支持自定义成就系统(当前 Bedrock 附加内容不支持)。
- 不改变世界的作弊状态、不新增游戏规则、不引入实验性能力。
- 本次不把打包逻辑抽成独立 workspace 包(留待第二个模组出现时再评估)。

## Decisions

### D1 兼容下限 = Minecraft 1.21.90 / `@minecraft/server` 2.0.0

选用 `world.afterEvents.worldLoad` 作为「世界加载后设置规则」的触发点,下限随之落在该事件首次出现的版本:

- `world.gameRules`(含可写的 `keepInventory: boolean`)首次出现于 `@minecraft/server` **1.11.0** = Minecraft **1.21.0**(2024-06-13)。
- `world.afterEvents.worldLoad` 首次出现于 `@minecraft/server` **2.0.0** = Minecraft **1.21.90**(2025-06-17)。采用它后,下限即被抬到 1.21.90。
- 于是下限锁在 **1.21.90**,覆盖 1.21.90 → 1.26.40 全部成就可用版本;1.26.50+ 仍可加载,但成就受平台 bug 影响。

**考虑的替代方案**:

1. 把下限压到 1.21.0(`@minecraft/server` 1.11.0),不使用 `worldLoad`,改为「脚本模块求值 + `system.run` 推迟一个 tick」写入 → 版本覆盖更广,但没有用官方事件名,语义靠求值时机隐式保证;已弃用。
2. 用数据包/世界模板而非脚本 → 无法随包分发并自动开启规则,且会改变分发形态,弃用。

### D2 仓库结构:npm workspaces + `mods/`

```text
mc-toolchain/
├── package.json            # private, workspaces: ["mods/*"], name: mc-toolchain
├── .gitignore
├── openspec/               # 规划(已存在)
└── mods/
    └── keepinventory/      # @mc-toolchain/keepinventory@0.0.1
        ├── BP/keepinventory/   # 行为包(manifest.json + pack_icon.png + 内容)
        ├── scripts/            # TypeScript 源码
        └── package.json        # 版本唯一来源 + packing 配置
```

根包 `private: true` 且不发布;各模组为独立 workspace 包,可用 `npm run <script> -w @mc-toolchain/<mod-name>` 调用。理由:满足用户约定,并让根目录的 `npm install` 一次安装全部模组依赖。

### D3 以官方模板为基础并精简为纯行为包

- 保留模板核心:`scripts/main.ts`、`just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env`、`.prettierrc.json`、`.vscode/`,以及包目录 `BP/keepinventory/`(`manifest.json` + `pack_icon.png`)。
- 包目录采用 `BP/<name>` / `RP/<name>` 约定(`<name>` = 去掉 scope 的包名),同时兼容全名 `behavior_packs/<name>` / `resource_packs/<name>`;已实测 `mct validate` 按 `manifest.json` 判包,与目录名无关(见「调研数据 5」)。
- `pack_icon.png` 直接复用模板生成的占位图标。
- **删除**官方模板的 `resource_packs/` 与默认 tick 示例逻辑(`sendMessage`):本模组是纯行为包,`mct create` 生成后把 `behavior_packs/` 重命名为 `BP/`。
- `PROJECT_NAME` 设为 `keepinventory`,使包目录与模组目录名一致;包显示名 `header.name` 设为「死亡不掉落」。

### D4 打包配置:唯一 `pack` 入口 + `package.json` 的 `packing` 块

打包实现放在 `mods/keepinventory/tools/packaging.ts`(`ensureIsStandard` 不会改写该文件),由 `just.config.ts` 引入并注册为**唯一的** `pack` 任务;复用 `@minecraft/core-build-tasks` 已导出的通用 `zipTask`,不新增打包库。官方任务与脚本保持不动,只追加一个 `"pack": "just-scripts pack"`。

配置全部可选,零配置即可工作(约定优于配置):

```jsonc
{
  "name": "@mc-toolchain/keepinventory",   // 去 scope ⟶ 模组名 <name>
  "version": "0.0.1",                      // ⟶ manifest 版本 + 产物版本(唯一来源)
  "packing": {                              // 整块可选
    "mode": "auto",                         // "auto"(默认) | "mcpack" | "mcaddon"
    "behavior_packs": "BP/keepinventory",   // 可选:显式指定行为包目录(默认按清单文件探测)
    "resource_packs": "RP/keepinventory",   // 可选:显式指定资源包目录(默认按清单文件探测)
    "output": "dist/packages"                  // 默认 dist/packages
  }
}
```

包类型判定规则(**以清单文件为准**):读取每个候选包目录的 `manifest.json`,含 `data` / `script` 模块 ⟶ 行为包,含 `resources` 模块 ⟶ 资源包;目录名只是探测线索,不参与类型判定。

解析顺序:显式配置 → 探测含 `manifest.json` 的包目录并按清单模块类型判定 → 未命中即视为该包不存在;同类型命中多个则报歧义错误。

`pack` 任务流水线:`series("clean-local", "build", synchronizePackVersions, createPackagesByMode)`

```ts
// tools/packaging.ts(要点)
// resolvePackDirectories():      扫描含 manifest.json 的包目录,按 modules[].type 判定行为包/资源包,
//                                返回 { behaviorPackDirectory?, resourcePackDirectory? }
// synchronizePackVersions():     把 package.json#version 写成 [major,minor,patch],写入各 manifest 的
//                                header.version、modules[].version 与资源包对行为包的依赖 version;解析失败 throw
// createPackagesByMode():        mode=auto → 1 个包出 <name>-v<version>_bp.mcpack / 2 个包出 <name>-v<version>.mcaddon
//                                mode=mcpack → 每个包各出一个 mcpack
//                                mode=mcaddon → 单个 <name>-v<version>.mcaddon(少于 2 个包则 throw)
```

**考虑的替代方案**:直接用官方 `mcaddonTask` 默认产物 → 文件名不带版本号、无法只出 mcpack、缺资源包时会产出空 `_rp.mcpack`;用多个打包脚本入口 → 与「只有一个 `pack`」相悖,故都弃用。

### D5 版本同步:`pack` 的一部分,`package.json#version` 为唯一来源

- 版本只在 `mods/<mod>/package.json#version` 维护;`pack` 在压缩前把 `x.y.z` 写入包内所有 `manifest.json`(`header.version`、`modules[].version` 与资源包对行为包的依赖 `version`)。
- 仅支持三段数字:遇到 `0.0.1-beta.1` 这类预发布后缀时,若前三位可解析则取前三位并告警,否则报错中止(见 spec 的「非法版本号被拒绝」场景)。

### D6 模组行为:世界加载时设一次规则,不碰其它规则

```ts
import { system, world } from "@minecraft/server";

function enableKeepInventory(): void {
  world.gameRules.keepInventory = true;
}

// worldLoad 在世界加载完成、玩家进入之前触发,此时 gameRules 已可写。
// 再包一层 system.run 推迟到下一个 tick,避开加载当帧可能存在的只读窗口。
world.afterEvents.worldLoad.subscribe(() => {
  system.run(enableKeepInventory);
});
```

- `keepInventory` 是世界级游戏规则,与具体玩家无关,因此**只在世界加载后设置一次**,不订阅 `playerSpawn` 等玩家事件重复设置。
- 触发点用官方事件 `world.afterEvents.worldLoad`(需 `@minecraft/server` 2.0.0),语义明确;`system.run` 只用于把写入推迟到下一个 tick,避开加载当帧的只读窗口。
- 只写 `keepInventory`;不像现有 MCBE 参考模组那样额外开启 `commandBlocksEnabled`(那会无谓地扩大改动面)。
- 不调用任何开启作弊/实验性的 API;稳定版 `@minecraft/server` 模块不需要「Beta APIs」实验开关。

### D7 依赖裁剪

以模板默认依赖为起点,把 `@minecraft/server` 固定为与 `manifest.json` 模块版本一致的 **2.0.0**(仅用于类型,运行期由游戏解析)。`@minecraft/server-ui` / `@minecraft/math` / `@minecraft/vanilla-data` 若未被本模组使用则移除;注意 `mct setup` 会把 `@minecraft/server` 与 `@minecraft/server-ui` 视为必需依赖,可能重新补回 `server-ui`,这属可接受的冗余。安装后用 `npm install` 成功作为验收。

### D8 命名约定:标识符用完整单词,避免缩写歧义

打包相关代码、数据类型与配置字段 MUST 使用完整单词,不使用 `bp` / `rp` / `out` / `ver` / `pkg` 一类缩写。

| 类别 | 采用 | 不采用 |
| --- | --- | --- |
| 配置字段 | `mode`、`behavior_packs`、`resource_packs`、`output` | `out`、`bp`、`rp` |
| 类型与变量 | `behaviorPackDirectory`、`resourcePackDirectory`、`packageJson`、`version`、`outputDirectory` | `bp`、`rp`、`pkg`、`ver`、`out` |
| 函数 | `resolvePackDirectories()`、`synchronizePackVersions()`、`createPackagesByMode()` | `resolvePacks()`、`syncPackVersions()`、`packByMode()` |

唯一例外是产物文件名后缀 `_bp.mcpack` / `_rp.mcpack`:它是 `@minecraft/core-build-tasks` 与 Bedrock 附加内容生态的既有约定,改成全名会与官方工具及社区产物不一致,故保留。

## Risks / Trade-offs

- **[1.26.50+ 侧载行为包禁用成就(MCPE-242529)]** → 非模组可修复;在文档中记为平台限制,并把 `min_engine_version` 保持较低以便 bug 修复后无需改动。
- **[旧的 `@minecraft/server` 模块版本在新引擎上是否仍被支持]** → 证据:同仓库其它模组使用 2.0.0 模块并在更高引擎上工作,说明引擎保留旧稳定模块;`min_engine_version` 仍是真正的兼容门槛。缓解:实施时用 `mct validate` 校验,并在 1.21.x 与最新版各做一次实机验证。
- **[`ensureIsStandard` 会重置 `just.config.ts` 与 `package.json` 白名单外的键]** → 仅发生在新建/导入项目流程;`packing` 顶层键与自定义 script 名都在白名单外,会被一并清理。缓解:打包实现放在 `tools/packaging.ts`(不被重置),`just.config.ts` 与 `package.json#packing` 重新加回即可;并在模组 README 记录该行为。
- **[`local-deploy` / `deploy` 需要游戏部署路径与 `MINECRAFT_PRODUCT`]** → 与打包无关(`zipTask` 不依赖部署路径);本变更不把 `deploy` 作为验收项。
- **[`mct setup` 可能补回未使用的 `@minecraft/server-ui`]** → 冗余但无害;不为此改动 `mct` 行为。
- **[打包逻辑逐模组复制会造成重复]** → 本次接受,`tools/packaging.ts` 保持与模组解耦的参数形态,便于将来抽成共享 workspace 包。

## 调研数据

> 方法:`npm view @minecraft/server time` 的发布日期,与本地 `~/gitRepos/bedrock-samples/version.json` 的官方游戏版本发布日期逐条比对(两者日期完全对齐);API 可用性用「按版本下载 `index.d.ts` 并 grep 符号」的方式二分确认。

### 1. `@minecraft/server` 模块版本 ↔ Minecraft 游戏版本(实测对齐)

| 模块版本 | npm 发布日 | 对应 Minecraft(发布日期) |
| --- | --- | --- |
| 1.11.0 | 2024-06-13 | 1.21.0.3(2024-06-13) |
| 1.12.0 / 1.13.0 | 2024-08-13 | 1.21.20.3(2024-08-13) |
| 1.14.0 | 2024-09-17 | 1.21.30.3(2024-09-17) |
| 1.15.0 | 2024-10-22 | 1.21.40.3(2024-10-22) |
| 1.16.0 | 2024-12-03 | 1.21.50.7(2024-12-03) |
| 1.17.0 | 2025-02-11 | 1.21.60.10(2025-02-11) |
| 1.18.0 | 2025-03-25 | 1.21.70.3(2025-03-25) |
| 1.19.0 | 2025-05-06 | 1.21.80.3(2025-05-06) |
| 2.0.0 | 2025-06-17 | 1.21.90.3(2025-06-17) |
| 2.1.0 | 2025-08-06 | 1.21.100.6(2025-08-05) |
| 2.2.0 | 2025-09-30 | 1.21.110.2(2025-09-30) |
| 2.3.0 | 2025-10-28 | 1.21.120.4(2025-10-28) |
| 2.4.0 | 2025-12-09 | 1.21.130.3(2025-12-09) |
| 2.5.0 | 2026-02-10 | 1.26.0.2(2026-02-10) |
| 2.6.0 | 2026-03-24 | 1.26.10.4(2026-03-24) |
| 2.7.0 | 2026-05-05 | 1.26.20.4(2026-05-05) |
| 2.8.0 | 2026-06-16 | 1.26.30.5(2026-06-16) |
| 2.9.0 | 2026-08-04 | 1.26.40.5(2026-08-04) |
| **2.10.0** | **2026-09-15** | **1.26.50.4(2026-09-15,成就禁用起点)** |
| 2.11.0 | 2026-10-27 | 1.26.60.5(2026-10-27) |

### 2. 关键 API 可用性矩阵(按 `index.d.ts` 验证)

| API / 行为 | 首次可用模块版本 | 对应 Minecraft |
| --- | --- | --- |
| `world.gameRules`(含可写 `keepInventory`) | 1.11.0 | 1.21.0 |
| `world.afterEvents.playerSpawn` | ≤ 1.11.0(1.11.0 已具备,本模组不使用) | ≤ 1.21.0 |
| `world.afterEvents.worldLoad` | 2.0.0 | 1.21.90 |
| 侧载外部行为包禁用成就(MCPE-242529) | 2.10.0 | 1.26.50 |

由此得到兼容区间:**成就可用区间 = 1.21.90 → 1.26.40**;下限由本模组采用的 `worldLoad` 事件决定 = **1.21.90**。

### 3. `mct` 0.21.0 对模板文件的所有权(实测)

- `lib/app/ProjectStandard.js#ensureIsStandard()` 会把 `just.config.ts` 覆盖为 `JustConfig.getDefaultContent()`、重置 `eslint.config.mjs`,并对 `package.json` 的 `devDependencies` / `dependencies` / `overrides` / `scripts` 做白名单校验(出现白名单外的 script 名或自定义顶层键时整体重置为默认)。
- 其唯一调用点:`lib/app/ProjectUtilities.js#processNewProject()`(新建/导入项目流程)。
- 实测:在 `mct create` 生成的项目里注入自定义 script(`pack:bp`)、自定义顶层键、并在 `just.config.ts` 末尾追加 marker 后,分别执行 `mct validate` 与 `mct setup`,三者**均被保留**(未被重置)。
- 结论:正常开发/打包/校验流程不会清掉自定义打包逻辑;仅「重新作为新项目导入」会重置 `just.config.ts`。

### 4. 官方模板打包实现(供 D4 参考)

- `@minecraft/core-build-tasks` 5.5.0 的导出含通用 `zipTask(outputFile, zipContents: {contents, targetPath?}[])` 与封装的 `mcaddonTask(params)`;后者产出 `<name>_bp.mcpack`、`<name>_rp.mcpack`、`<name>.mcaddon`(文件名不含版本号,且资源包缺失时会产出空 mcpack)。
- `copyTask` 用于把包复制到 **游戏部署目录**(`development_behavior_packs/...`),依赖 `.env` 的 `MINECRAFT_PRODUCT`;与「产出分发包」无关,故自定义打包不依赖它。
- 依赖 `zip-lib`,因此复用 `zipTask` **不需要**新增打包库。
- 模板的 `mcaddon:production` 与 `mcaddon` 等价:`just.config.ts` 从未读取 `argv().production`,`@minecraft/core-build-tasks` 5.5.0 也没有任何代码消费该标志(实测两者产物解压后逐字节一致,仅 zip 内时间戳不同)。因此本变更不为 `--production` 设计分支,只保留唯一的 `pack` 入口。

### 5. `BP/` / `RP/` 目录约定可行性(实测)

- 把 `mct create` 生成的项目由 `behavior_packs/<name>`、`resource_packs/<name>` 改为 `BP/<name>`、`RP/<name>` 后,`mct validate -i <folder>` 仍全部通过,且报告 `info.capabilities = ["behaviorPack","resourcePack"]`、`behaviorPackManifestCount = 1`、`resourcePackManifestCount = 1`。
- 结论:`mct` 依据 `manifest.json` 的模块类型判定包,不依赖目录名,因此缩写(`BP`/`RP`)与全名(`behavior_packs`/`resource_packs`)两种规范都可用。
- 本变更据此把同样的判定方式写进自己的打包工具:`resolvePackDirectories()` MUST 读 `manifest.json` 的 `modules[].type` 判类型,目录名仅作为探测线索。

## Migration Plan

本变更为纯新增(仓库无既有业务代码),无需数据迁移与回滚:

1. 新增根 `package.json` 与 `.gitignore`,在 `mods/keepinventory` 落模组代码与打包逻辑。
2. 回滚方式:删除 `mods/keepinventory`、根 `package.json`、`package-lock.json` 即可恢复原状;`openspec/` 规划产物不受影响。

## Open Questions

- 第二个模组出现时,是否把 `tools/packaging.ts` 提升为共享 workspace 包 `@mc-toolchain/packaging`,以避免重复?(不影响本次 spec 与任务划分)
- 若 MCPE-242529 修复,是否把 `min_engine_version` 上调到包含修复的版本?(保持当前较低下限即可向后兼容,可日后单独决策)
