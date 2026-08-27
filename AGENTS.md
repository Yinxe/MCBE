# @yinxe/mc — MCBE Addon Monorepo

> Minecraft Bedrock Addon 单体仓库：官方 ScriptAPI (`mcaddon/`) + 轻量 BP (`server-plugin/`) + BDS 专用 LL 插件 (`plugins/`) + 共享包 (`packages/`)。本文档为 **AI Agent / 贡献者** 专用，改动前必读。

## 1. 仓库清单

| 目录 | 包名 | 说明 |
|------|------|------|
| `mcaddon/mock-player` | 模拟玩家 | GameTest 假人：生成/行为/交互/持久化 |
| `mcaddon/smartwarehouse` | 智能仓库 | 仓库 v1，分拣/整理/统计/预警（`item-route` 前身） |
| `mcaddon/item-route` | 物品路由 | **参考架构**：六边形 `core/mc` 分层，零 `@minecraft` 可测 |
| `mcaddon/keepinventory` | 死亡不掉落 | 免作弊保成就 |
| `mcaddon/auto-refill` | 自动替换 | 消耗品补货 + 工具/武器自动切换 |
| `mcaddon/craftablerarities` | 合成扩展 | 稀有方块/物品合成 |
| `mcaddon/teleporter` | 传送 | TPA/TPHERE/返回点 |
| `mcaddon/spectator-mode` | 灵魂出窍 | 旁观侦查 |
| `server-plugin/antibundledup` | 反收纳袋刷物 | 收纳袋改食物防刷 |
| `plugins/villager-trade` | 村民交易示例 | LL 下 `Offers.Recipes` 读写演示 |
| `plugins/_template` | LL 模板 | `@levimc-lse/types` + `tsc` |
| `packages/toolkit` | @yinxe/toolkit | 运行时共享：color/ui/command/player |
| `packages/toolkit-build` | @yinxe/toolkit-build | 构建：版本同步/esbuild 配置 |
| `packages/nbt-data-storage` | @yinxe/nbt-data-storage | 区块锚定木桶矩阵，完整 NBT |
| `packages/tool-strategy` | @yinxe/tool-strategy | 工具策略 |

## 2. 项目结构

```
mc/
├── mcaddon/<name>/        # 官方 Addon：TS + just-scripts
│   ├── BP/<Project>/      # 行为包（含 manifest.json）
│   ├── RP/<Project>/      # 资源包（可选）
│   ├── scripts/           # TS 源码
│   ├── just.config.ts     # 构建
│   ├── tsconfig.json      # 2.6.0 基准（item-route 另有 tsconfig.test.json）
│   └── package.json       # version + mcbe.packName（中文显示名）
├── server-plugin/<name>/  # 纯 JSON/BP 插件
├── plugins/<name>/        # BDS 专用 LL 插件：@levimc-lse/types + tsc
│   ├── src/main.ts        # 入口（全局 ll/mc/NbtCompound）
│   ├── package.json       # @plugins/<name>
│   └── tsconfig.json      # types: ["@levimc-lse/types"]，与 mcaddon 隔离
├── packages/<pkg>/        # 共享包
├── docs/mc-api/           # 本地 d.ts 镜像（server.d.ts 2.6.0）
├── pnpm-workspace.yaml    # packages/* + mcaddon/* + server-plugin/* + plugins/*
└── package.json           # 根 workspace + 快捷脚本
```

## 3. 环境与快速开始

* **要求**：`Node >=20` `pnpm >=11.1.3`
* **安装**：`pnpm install`（根目录一次，`overrides` 统一 `@minecraft/server: 2.8.0`）
* **日常**：`改代码 → pnpm run build:<mod> → pnpm run pack:<mod> → 部署 .mcpack/.js → 进游戏/BDS 测试`

```bash
pnpm install
pnpm run build              # 全仓
pnpm run build:mock-player  # 单 Addon
pnpm run build:plugins      # 全部 LL 插件
pnpm run build:villager-trade
pnpm run pack:mock-player   # BP/RP → .mcaddon/.mcpack
pnpm run lint / format / clean
```

**版本同步**：`just-scripts` 构建时把 `package.json#version` 同步到 `BP/manifest.json`（幂等）。该改动为 **release-only**，日常不提交。

## 4. 测试

```bash
cd mcaddon/item-route && pnpm run test:core   # tsc -p tsconfig.test.json && node --test
pnpm --filter @yinxe/tool-strategy run test
pnpm run test:nbt-data-storage
```

* `core` 零 `@minecraft` 可 `node:test`；`mc` 层仅游戏内冒烟
* 用 `InMemory*` 替身 + `node:assert/strict`

## 5. 开发流程

**版本规则**（`2.0.0` 起，semver）：架构重构 `+1.0.0` / 新功能 `+0.1.0` / 修复 `+0.01`
* `package.json#version` 维护版本，`commit: <包名>@<版本>: 中文`，`tag: <包名>@<版本>`，`push` 同时推 tag

**分支**
* `main` 稳定（`tag` → Release） / `dev` 集成（→ prerelease） / `feat/<name>` 新模块
* `release.yml` 仅处理 `main`/`dev` 上的 `*@*` tag

**新建模块**
* Addon：复制 `just.config.ts/tsconfig.json/package.json/BP/manifest.json` → 改 `package.json` → `pnpm install` → `build` → 补根 `build:<mod>/pack:<mod>` → 写模块 `AGENTS.md`
* LL 插件：`cp -r plugins/_template plugins/<name>` → 改 `package.json#name=@plugins/<name>` → `pnpm install` → `pnpm --filter @plugins/<name> run build`（`tsc → dist/main.js`）→ 部署到 `BDS/plugins/`

## 6. 架构参考（`item-route`）

六边形 `core`（纯领域，事件驱动）/`mc`（副作用） via `EventBus`。详见 `mcaddon/item-route/AGENTS.md`。

* `core` 无副作用，事件负载仅 `string/number`
* 按需加载 + 统一生命周期，`ir2:c:{cid}` 等 DP 键单容器单键，事件写穿
* 概念 `ItemStack` 保留源 `mc.ItemStack`，堆叠以 `mc.addItem` 为准，防刷/防覆盖
* 区块访问 `try-catch`，`beforeEvents` 内不触世界（延至 `system.run`）

## 7. 关键约束（必读）

* **`system.run` 上下文**：所有世界操作（维度/方块/容器/DP）必须在 `system.run` 或事件回调内；`world.getDynamicProperty` 需在 Phase4 `system.run` 后
* **4 Phase 启动**：1 无状态 2 有状态 3 注册事件/命令 4 `system.run(()=>scheduler.start())`
* **命令**：`system.beforeEvents.startup` 中 `customCommandRegistry.registerCommand`
* **区块安全**：方块/容器访问 `try-catch`，回调内 `try-catch` 隔离
* **日志**：`console.warn("[前缀] 消息")`，玩家提示中文，调试英文；`GameTest` 假人 `disconnect` 后 20tick 再 `spawnSimulatedPlayer`

## 8. 参考文档 & API 查寻

> 严禁手写 `Entity`/`NbtCompound` 等类型，一律以依赖 `d.ts` 为准

| 资源 | 链接 |
|------|------|
| 官方 ScriptAPI | https://learn.microsoft.com/zh-cn/minecraft/creator/?view=minecraft-bedrock-stable |
| 社区 WIKI | https://wiki.bedrock.dev/ |
| LeviLamina | https://docs.levilamina.org/ / https://lamina.levimc.org/ |
| 中文翻译表 | https://raw.githubusercontent.com/SkyEye-FAST/mcbe-chinese-patch/main/.../zh_CN.json |

**① WIKI（游戏机制）**：`https://zh.minecraft.wiki/w/${keyword}` 如 `村民`/`交易`/`命令`，查 NBT（`Offers`/`VillagerData`）与机制

**② 官方 ScriptAPI（`mcaddon`）**
```json
"dependencies": {
  "@minecraft/math": "2.2.7",
  "@minecraft/server": "2.6.0",
  "@minecraft/server-gametest": "1.0.0-beta.1.26.0-stable",
  "@minecraft/server-ui": "2.0.0",
  "@minecraft/vanilla-data": "1.26.20"
}
```
本地优先：`node_modules/@minecraft/server/index.d.ts`、`@minecraft/server-ui`、`@minecraft/vanilla-data`、`docs/mc-api/server.d.ts`（2.6.0 快照）；`grep -n "class Entity" node_modules/@minecraft/server/index.d.ts`

**③ 非官方 LSE（`plugins`）**
```json
"devDependencies": { "@levimc-lse/types": "^2.18.7" }
```
本地：`node_modules/@levimc-lse/types/src/**/*.d.ts`（`Entity`/`Player`/`NbtCompound`），`tsconfig.json: types: ["@levimc-lse/types"]`
在线：https://github.com/LiteLDev/legacy-script-engine-api/blob/develop/platforms/javascript/README.md / https://lse.levimc.org/zh/apis/

## 9. 命名与发布

* 显示名中文（`manifest header.name` / `package.json#mcbe.packName`）
* 产物 `{中文名}-v{version}.{mcaddon,mcpack}`，`tag: <包名>@<版本>`
* 构建产物不提交，`manifest.json` 仅 release 提交

## 10. 代码规范

**技术栈**：`TS es6 strict` / `mcaddon: just-scripts+esbuild` / `plugins: tsc` / `prettier 120/2/semi`

**命名**：类/接口/类型 `PascalCase`，文件 `PascalCase`，函数/私有方法 `camelCase`，常量 `UPPER_SNAKE`，入口 `main.ts/types.ts` 小写

**导入顺序**
```ts
import { world, system } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { normalizeId } from "../storage/Repository";
```

**JSDoc**：中文，导出函数必写 `@param/@returns/@throws`

**分段注释**
```
// ── 生命周期 ──
// ── 公开入口 ──
// ── 私有方法 ──
```

**错误处理**：轻校验 `return "中文"` / 业务 `throw` / IO `try-catch→undefined` / 事件回调整体 `try-catch`

**依赖注入**：构造函数注入，可选参数给默认值

**通用**：`private readonly` 简写，`Map/Record` 显式泛型，常量就近，模块级 `AGENTS.md` 单独维护

