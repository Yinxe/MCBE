# @yinxe/mc — MCBE Addon Monorepo

> Minecraft Bedrock Edition 模组集合：官方 ScriptAPI Addon、纯行为包插件与共享 TypeScript 包。

## 模组一览

| 显示名       | 包名                | 目录                             | 版本   | 说明                                 |
| ------------ | ------------------- | -------------------------------- | ------ | ------------------------------------ |
| 模拟玩家III  | `mockplayer3`       | `mcaddon/mockplayer3`            | 3.0.32 | 假人；四层架构、资源租约、能力相位机 |
| 物品路由     | `item-route`        | `mcaddon/item-route`             | 0.1.20 | 仓库整理；六边形 `core/mc` 参考架构  |
| 自动替换     | `auto-refill`       | `mcaddon/auto-refill`            | 2.2.0  | 消耗品补货 + 工具/武器自动切换       |
| 合成配方扩展 | `craftablerarities` | `mcaddon/craftablerarities`      | 1.0.1  | 稀有方块/物品合成                    |
| 死亡不掉落   | `keepinventory`     | `mcaddon/keepinventory`          | 1.0.0  | 免作弊保成就                         |
| 传送         | `teleporter`        | `mcaddon/teleporter`             | 0.0.6  | TPA / TPHERE / 返回点                |
| 灵魂出窍     | `spectator-mode`    | `mcaddon/spectator-mode`         | 1.0.10 | 旁观侦查                             |
| 反收纳袋刷物 | `antibundledup`     | `server-plugin/antibundledup`    | 1.0.0  | 收纳袋改食物防刷                     |
| NBT存储测试  | `nds-demo`          | `packages/nbt-data-storage/demo` | 0.1.21 | 存储包游戏内冒烟                     |

`archive/` 下为已归档模组（`mock-player` v2、`smartwarehouse` v1），不再维护，不参与 workspace、构建与发布。

## 目录结构

```
MCBE/
├── mcaddon/<name>/        # 官方 Addon（TypeScript + just-scripts + esbuild）
│   ├── BP/<Project>/      # 行为包
│   ├── RP/<Project>/      # 资源包（可选）
│   ├── scripts/           # 源码
│   ├── tests/             # 离线测试（可选）
│   ├── docs/features/     # 功能说明（mockplayer3 等）
│   └── just.config.ts / tsconfig.json / package.json
├── server-plugin/<name>/  # 纯 JSON/BP 插件
├── packages/              # 共享包
│   ├── toolkit/           # @yinxe/toolkit — 运行时共享
│   ├── toolkit-build/     # @yinxe/toolkit-build — 构建与版本同步
│   ├── nbt-data-storage/  # @yinxe/nbt-data-storage — 区块锚定 NBT 存储
│   └── tool-strategy/     # @yinxe/tool-strategy — 工具选择策略
├── archive/               # 归档模组
├── docs/mc-api/           # 本地 API 类型快照
├── .agents/skills/        # 项目级开发规范 Skill
├── pnpm-workspace.yaml
└── package.json
```

## 要求

- **Node.js** >= 20
- **pnpm** >= 11.1.3

## 常用命令

```bash
pnpm install

# 构建
pnpm run build                    # 全仓（会同步 manifest 版本）
pnpm run build:mockplayer3        # 单模块

# 打包 → dist/packages/{中文名}-v{version}.mcaddon
pnpm run pack:mockplayer3
pnpm run pack:craftablerarities

# 测试
pnpm run test:auto-refill
pnpm --filter mockplayer3 run test:core
pnpm run test:nbt-data-storage
pnpm run test:tool-strategy

# 清理 / 格式
pnpm run clean
pnpm run format
```

无根快捷脚本的模块使用 `pnpm --filter <包名> run <script>`。

## 共享包

- `@yinxe/toolkit`：运行时 `color` / `ui` / `command` / `player` 等。
- `@yinxe/toolkit-build`：`syncManifestVersion()`、`bundleOptions()`、`copyOptions()`，供各 Addon 的 `just.config.ts` 复用。
- `@yinxe/nbt-data-storage`：区块锚定木桶存储矩阵，支持完整 NBT。
- `@yinxe/tool-strategy`：工具/武器选择策略，供 `auto-refill`、`mockplayer3` 等复用。

## 开发规范

- 通用约定与架构模式：`.agents/skills/mcbe-addon-dev/SKILL.md`
- 仓库级约束：`AGENTS.md`
- 模块细节：各模块目录内 `AGENTS.md`

## 发布

```bash
git tag mockplayer3@3.0.10
git push --tags        # release.yml 构建并发布
```

版本号只在明确发版时修改；`package.json#version` 同步到 BP/RP manifest 由构建脚本完成。

## 许可

ISC
