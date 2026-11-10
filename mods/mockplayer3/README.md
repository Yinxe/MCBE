# 模拟玩家III（mockplayer3）

Minecraft Bedrock 模拟玩家（假人）Addon：创建、上下线、工作模式、物品与经验回收、面板交互。

> 当前 `3.0.32` · 显示名「模拟玩家III」· `module_name = "MockPlayer"` · `min_engine_version [1,21,130]`
> 本模组由外部仓库整体迁入，行为与上游版本等价；版本号、包 UUID、模块依赖声明均未改动。

## ⚠️ 运行前必读

### 1. 必须开启 Beta APIs 实验开关

行为包清单把两个模块依赖声明为 `"beta"`：

| 依赖 | 声明版本 | 原因 |
| --- | --- | --- |
| `@minecraft/server` | `"beta"` | 上游既有声明，本模组使用其中的 beta 成员 |
| `@minecraft/server-gametest` | `"beta"` | 该包**全生态只有 beta/internal 版本**（无 stable），而本模组 15 个文件依赖 `spawnSimulatedPlayer` / `SimulatedPlayer` / `LookDuration` 等 |
| `@minecraft/server-ui` | `"2.0.0"` | 正式版本号，不受影响 |

因此**世界必须开启「Beta APIs」实验开关**，否则脚本不会加载。这不是迁移引入的限制，是上游既有事实。

### 2. 声明的最低游戏版本与代码实际要求不一致（已知问题，未修改）

清单声明 `min_engine_version [1,21,130]`，但代码直接调用 `world.tickingAreaManager` 且无存在性判空：

- `scripts/engine/TickingAreas.ts:89`、`scripts/engine/Rig.ts:262/267/292`、`scripts/interface/Commands.Admin.ts:152`
- 该属性自 `@minecraft/server` **2.6.0**（对应游戏 **1.26.10**）起才存在

实测：用 `@minecraft/server` 2.4.0 / 2.5.0 编译全量 `scripts/` 各报 8 处 `TS2339: Property 'tickingAreaManager' does not exist on type 'World'`；2.6.0 起消失。

**结论**：实际可用的最低游戏版本是 **1.26.10**，而非清单所写的 1.21.130。在 1.21.130 ~ 1.26.0 上启用本模组，常加载相关代码会在运行时失败（属性为 `undefined`，调用即抛错）。

本次迁移**按原值保留 `[1,21,130]` 不做修改**，仅在此记录，供后续独立评估（改成 `[1,26,10]`，或给 `tickingAreaManager` 加存在性判空并降级）。

## 功能概览

功能文档按四组归在 [`docs/features/`](./docs/features/) 下，共 13 篇。

### 上线 / 下线 / 常加载

假人的生命周期由 `safeOnline` / `safeOffline` 两个唯一入口驱动，覆盖命令、面板、重连、自动、恢复五类触发源；两类辅助常加载（Sim4 圆形域与 SingleChunk）保障区块稳定。

| 主题 | 文档 |
| --- | --- |
| 全局面板入口与导航 | [UI交互菜单.md](./docs/features/UI交互菜单.md) |

### 工作模式

每个模式是一个能力相位机，由 `domain/Catalog.ts` 的 `WORK_MODES` 表登记。

| 模式 | 文档 | 一句话 |
| --- | --- | --- |
| 跟随 | [跟随.md](./docs/features/跟随.md) | 10 tick 节拍追踪指定真人，超距/跨维度自动解除 |
| 闲逛 | [闲逛.md](./docs/features/闲逛.md) | 以站立点为圆心 16 格内随机游走，走停节律永循环 |
| 劫掠 | [劫掠.md](./docs/features/劫掠.md) | 袭击事件中参战 |
| 宝库模式 | [宝库模式.md](./docs/features/宝库模式.md) | 自动感知试炼宝库、寻路开箱 |
| 定点挖掘 | [定点挖掘.md](./docs/features/定点挖掘.md) | 常驻节拍挖掘正前方方块 |
| 定点放置 | [定点放置.md](./docs/features/定点放置.md) | 常驻节拍把主手方块放到正前方 |
| 定点自动攻击 | [定点自动攻击.md](./docs/features/定点自动攻击.md) | 常驻节拍攻击范围内的目标 |
| 资源采集 | [资源采集.md](./docs/features/资源采集.md) | 采集指定资源并存入物品仓 |
| 自动钓鱼 | [自动钓鱼.md](./docs/features/自动钓鱼.md) | 自动抛竿、等待、收竿、存鱼 |
| 三叉戟绑定 | [三叉戟绑定.md](./docs/features/三叉戟绑定.md) | 绑定三叉戟后的投掷与回收 |
| 长流程模式 | [自定义动作.md](./docs/features/自定义动作.md) | `/mp:flow` 指令串执行（原「自定义动作」，3.x 起改名） |

### 物品与资源

| 主题 | 文档 |
| --- | --- |
| 物品与经验回收、离线物品仓 | [资源回收.md](./docs/features/资源回收.md) |

### 交互面板

| 主题 | 文档 |
| --- | --- |
| 全部面板式交互（ActionForm / ModalForm / 确认框） | [UI交互菜单.md](./docs/features/UI交互菜单.md) |

## 命令

前缀 `mp:`，共 37 条，按用途分组（详见 `scripts/interface/Commands*.ts`）：

| 分组 | 命令 |
| --- | --- |
| 生命周期 | `/mp:create` `/mp:online` `/mp:offline` `/mp:safeonline` `/mp:safeoffline` `/mp:reconnect` `/mp:delete` `/mp:killbot` `/mp:respawn` `/mp:setrespawn` |
| 导航 | `/mp:move` `/mp:tphere` `/mp:teleportbot` |
| 行为 | `/mp:work` `/mp:follow` `/mp:sneak` `/mp:flow` `/mp:trident` |
| 物品与存储 | `/mp:storage` `/mp:reclaim` `/mp:recover` `/mp:migrate` `/mp:container` |
| 钓鱼 | `/mp:fish` `/mp:fishstore` `/mp:fishlock` `/mp:fishspot` |
| 检查与运维 | `/mp:listbots` `/mp:data` `/mp:cmdlist` `/mp:test` `/mp:chunkarea` `/mp:breakblock` `/mp:fixrule` `/mp:notify` |
| 面板与管理 | `/mp:menu` `/mp:admin` |

## 目录结构

本模组**保留上游的四层目录**，与本仓库其他模组的 `core` / `mc` 两层不同（迁移目标是行为等价，不是形状统一）：

```
scripts/
  domain/       45 个文件  零 @minecraft 依赖的纯逻辑（模型、目录、规则、路由策略）
  application/  21 个文件  用例编排（生命周期、模式切换、配额）
  engine/       45 个文件  适配层（方块/容器/实体 IO、寻路、常加载、物品仓）
  interface/    32 个文件  命令目录、面板、事件订阅、通知
  Composition.ts           组合根（装配 domain/engine/application）
  main.ts                  入口（startup 注册命令、订阅事件）
tests/          28 个文件  离线单测（domain + 部分 engine 适配层）
docs/features/  13 篇     功能文档
behavior_packs/mockplayer3/
resource_packs/mockplayer3/
```

## 构建与测试

```bash
# 类型检查（不产生持久化副作用）
npx tsc -p tsconfig.json --noEmit

# 离线单测（340 条用例）
npm test

# 打包（产物进仓库根 release/）
npm run pack              # → release/mockplayer3-v3.0.32.mcaddon
npm run local-deploy      # watch 模式增量部署
```

离线测试不代表实机验收；世界行为以游戏内冒烟为准。

## 依赖

| 包 | 版本 | 说明 |
| --- | --- | --- |
| `@minecraft/server` | 2.8.0 | 运行时 |
| `@minecraft/server-gametest` | 1.0.0-beta.1.26.0-stable | 运行时（假人生成） |
| `@minecraft/server-ui` | ^2.0.0 | 运行时（面板） |
| `@minecraft/math` | 2.2.7 | 保留声明（上游遗留） |
| `@minecraft/vanilla-data` | 1.26.20 | 方块类型枚举 |
| `@mc-toolchain/mod-common` | workspace | 文本样式、表单构建器、安全上下文助手 |
| `@mc-toolchain/nbt-data-storage` | workspace | 物品仓存储 |
| `@mc-toolchain/mod-packaging` | workspace | 打包流程 |

打包配置见 `package.json` 的 `packing` 段：`mode: "auto"`（双包 → `.mcaddon`）、`output: "../../release/"`、`minimum_engine_version: [1, 21, 130]`（显式钉定，避免由 `@minecraft/server` 版本推导成 `[1,26,30]`）。

## 许可

ISC
