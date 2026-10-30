# @yinxe/mc — MCBE Addon Monorepo

> 仓库级事实与红线。架构、读码、排障、新增能力的工作流见 `.agents/skills/mcbe-addon-dev/SKILL.md`；模块专属事实见各模块 `AGENTS.md`。

## 仓库

| 类型       | 目录                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Addon      | `mcaddon/`：mockplayer3、item-route、auto-refill、craftablerarities、keepinventory、teleporter、spectator-mode |
| 纯 BP 插件 | `server-plugin/antibundledup`                                                                                  |
| 共享包     | `packages/toolkit`、`toolkit-build`、`nbt-data-storage`（含 `demo`）、`tool-strategy`                          |
| 归档       | `archive/mock-player`、`archive/smartwarehouse`（不构建、不发布）                                              |

各模块的显示名、版本与说明见 `README.md`。仓库当前没有 `apps/` 或 `plugins/` 目录。

## 环境与命令

- Node >= 20、pnpm >= 11.1.3；根目录 `pnpm install`。
- `pnpm-workspace.yaml#overrides` 将 `@minecraft/server` 统一到 2.8.0，避免共享包与 Addon 类型分裂。

```bash
pnpm --filter <包名> run build     # 构建单模块（会执行 update-version）
pnpm --filter <包名> run pack      # 生成 .mcaddon/.mcpack
pnpm --filter <包名> run test:core # 离线测试（模块提供时）
pnpm run clean / format / lint
```

根 `package.json` 提供常用 `build:<mod>` / `pack:<mod>` 快捷脚本；没有快捷脚本的模块直接用 `pnpm --filter`。

**发版动作会产生持久化副作用**：`build`/`pack` 的 `update-version` 会把 `package.json#version` 写进 BP/RP manifest。日常验证用 `npx tsc --noEmit` 与 `test:core`，不要跑完整 `build`/`pack`。

## 红线

- **版本**：`package.json#version` 是唯一版本源；只在用户明确要求发版时修改。tag `<包名>@<版本>`，提交信息 `<包名>@<版本>: 中文`；构建产物与日常 manifest 变更不提交。
- **ScriptAPI 上下文**：世界读写必须在 `system.run` 或事件回调内；`beforeEvents` 内只收集意图；DP 在启动 Phase 4 之后读取。
- **启动顺序**：无状态初始化 → 读取持久化 → 注册事件/命令 → `system.run` 启动调度。
- **异常隔离**：区块/容器访问 `try-catch`；事件回调整体 `try-catch`；失败记录并降级。
- **类型来源**：`node_modules/@minecraft/*/index.d.ts` 为准，禁止手写 `Entity`/`ItemStack`/`NbtCompound` 等类型。
- **模块边界**：模块 `AGENTS.md` 的层级纪律优先于通用规范。
- **假人**：`disconnect` 后至少 20 tick 再 `spawnSimulatedPlayer`，生成后校验名字。

## 外部资料

| 资源           | 用途                               | 链接                                                                                                                               |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 官方 ScriptAPI | 稳定版 API 与示例                  | https://learn.microsoft.com/zh-cn/minecraft/creator/?view=minecraft-bedrock-stable                                                 |
| 社区 WIKI      | Addon/行为包/脚本技巧              | https://wiki.bedrock.dev/                                                                                                          |
| 游戏机制 WIKI  | 查方块、村民、交易、附魔等原版机制 | `https://zh.minecraft.wiki/w/<关键词>`（如 `/w/村民`、`/w/交易`、`/w/附魔`）                                                       |
| 中文翻译表     | 物品/方块/实体/附魔 ID → 中文名    | https://raw.githubusercontent.com/SkyEye-FAST/mcbe-chinese-patch/main/merged/release/zh_CN.json                                    |
| LeviLamina     | BDS 插件/底层 API                  | https://docs.levilamina.org/ 、https://lamina.levimc.org/                                                                          |
| LSE API        | Legacy Script Engine 类型与示例    | https://lse.levimc.org/zh/apis/ 、https://github.com/LiteLDev/legacy-script-engine-api/blob/develop/platforms/javascript/README.md |

本地优先：

- `mcaddon/<mod>/node_modules/@minecraft/server/index.d.ts`、`server-ui`、`vanilla-data`。
- 类型快照：`docs/mc-api/`（server 2.6.0，仅检索；版本差异以 node_modules 为准）。
- 查 Vanilla ID：`@minecraft/vanilla-data` 的 `MinecraftItemTypes` / `MinecraftBlockTypes` / `MinecraftEntityTypes`。
- 查 API 形状：`grep -n "class Entity" node_modules/@minecraft/server/index.d.ts`。

> 外部链接只用于查证；类型与枚举最终以本地依赖为准，禁止凭网页记忆手写类型。

## 分支与发布

`main` 稳定（tag → Release）/ `dev` 集成 / `feat/<name>` 新模块；`release.yml` 只处理 `main`/`dev` 上的 `*@*` tag。备份/回退用 tag，不改历史。
