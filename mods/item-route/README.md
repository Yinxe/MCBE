# item-route

物品路由仓库：玩家用木锄圈定仓库区域，把区域内的容器登记为成员容器，模组按物品族规则把投进仓库的物品自动分拣到对应容器，并提供容器整理、仓库统计、容量预警、物品搜索定位与权限管理。

本模组是仓库内**唯一带资源包**的模组：行为包负责脚本与逻辑，资源包提供两个自定义粒子（`itemroute:sort`、`itemroute:deposit`）与对应纹理。打包时 `packing.mode: "auto"` 探测到两个包，产出单个 `.mcaddon`。

## 玩法概要

1. **建仓**：手持木锄依次点击区域两个角，或执行 `ir:create <名称> <pos1> <pos2>`。创建者成为 owner。
2. **扫容器**：`ir:rescan <名称>` 把区域内的容器登记为成员容器，并给每个容器指定角色。
3. **投料**：把物品丢进 `input` 角色的容器，模组按五级路由把物品搬到目标容器。
4. **整理与查看**：`ir:organize` 就地整理容器，`ir:menu` 打开管理界面，`ir:search <关键词>` 定位物品。

## 命令

命令前缀 `ir:`，全部无需开启作弊（`cheatsRequired: false`，`permissionLevel: Any`）。权限在命令回调内经 `scripts/mc/auth/commands.ts` 的 `COMMAND_MIN_ROLE` 矩阵校验，**管理员（OP）豁免**任意角色要求。

| 命令 | 参数 | 最低角色 | 作用 |
| --- | --- | --- | --- |
| `ir:create` | `<名称> <pos1> <pos2>` | 任意玩家 | 按两对角坐标创建仓库，创建者为 owner |
| `ir:resize` | `<名称> <pos1> <pos2>` | owner | 调整仓库区域到新的两对角 |
| `ir:rescan` | `<名称>` | member | 重扫区域，登记新容器并持久化 |
| `ir:rescan_preview` | `<名称>` | member | 只报告区域内容器清单，不写入 |
| `ir:delete` | `<名称>` | owner | 删除仓库（含成员关系、容器注册表、统计） |
| `ir:organize` | 无 | 任意玩家 | 就地整理玩家所在仓库的全部容器 |
| `ir:search` | `<关键词>` | member | 在就近有权限的仓库内搜索并粒子标记命中位置 |
| `ir:menu` | 无 | 任意玩家 | 打开主菜单（内部再按身份分级展示入口） |
| `ir:help` | 无 | 任意玩家 | 打开图文帮助手册 |

## 信物（木锄）交互

- **圈定区域**：手持木锄左/右键点击方块推进选区会话，两次点击完成建仓；会话进行中 actionbar 显示当前进度。
- **查询/取消**：交互过程中再次点击可推进或重置会话；切换维度或下线会清空该玩家的会话。

## 五级路由优先级

投进 `input` 容器的物品按以下顺序寻找落点，逐级下降：

1. **指定容器** — 物品族规则显式指定的容器。
2. **已存同类** — 已有同种物品堆叠的 `storage` 容器。
3. **同族收纳** — 配置了同族规则的 `storage` 容器。
4. **溢出容器** — `overflow` 角色的容器。
5. **丢弃** — `trash` 角色容器，或无处可放时按丢弃处理。

路由策略实现在 `scripts/core/routing/RouteStrategy.ts`（`SingleItemStrategy` → `MultiItemStrategy` → `FamilyStrategy` → `MiscStrategy`，按序尝试），候选容器排序在 `scripts/core/routing/CandidateSorter.ts`。

## 容器角色

每个容器带一个角色，在界面或 `ir:menu` 的容器角色菜单里改：

| 角色 | 含义 |
| --- | --- |
| `input` | 投放口，玩家的物品从这里进入仓库 |
| `storage` | 存储容器，路由的主要目标 |
| `overflow` | 溢出容器，`storage` 都放不下时的兜底 |
| `trash` | 销毁容器，最终落点 |
| `unassigned` | 未分配，新扫描到的容器默认角色 |

## 最低游戏版本与依赖

- `packing.minimum_engine_version: [1, 21, 100]` — 对应 `@minecraft/server` 2.1.0（本仓库 `mod-packaging` 的版本映射表中 `2.1.0 → 1.21.100`）。上游清单原先写 `[1, 21, 90]`（对应 2.0.0），与脚本实际用到的 API 不符，这里显式纠正并写成可审查的配置项，而不是依赖版本号的副产品。
- `@minecraft/server` 固定 `2.1.0`、`@minecraft/server-ui` 固定 `2.0.0`：与 `mods/spectator-mode` 一致，也在 `@mc-toolchain/mod-common` 的 peerDependency `>=2.0.0` 之上。三个依赖都写精确版本，不带 `^`。
- `@minecraft/vanilla-data` 固定 `1.26.20`：**运行时依赖，会被内联进 bundle**。`scripts/core/data/ItemNameMap.ts` 用它的 `MinecraftItemTypes` 作为物品全量 ID 的权威来源（搜索与名称映射依赖这份全量表，缺了就只能命中手工抄写的子集）。因此 `just.config.ts` 的 `bundleTaskOptions.external` **只列** `@minecraft/server` 与 `@minecraft/server-ui`，不能把 `vanilla-data` 加进去——游戏运行时并不提供这个包。

## 目录结构

```text
mods/item-route/
├── behavior_packs/item-route/     # 行为包：manifest.json + pack_icon.png
├── resource_packs/item-route/     # 资源包：manifest.json + 粒子 + 纹理 + pack_icon.png
├── scripts/
│   ├── core/                      # 纯逻辑（55 个文件）：模型、路由、整理、索引、统计、搜索、调度、服务、名称映射
│   ├── mc/                        # 适配层（64 个文件）：适配器、命令、交互、持久化、特效、事件、界面、工具、权限
│   └── main.ts                    # 唯一组合根，esbuild 入口
├── tests/                         # 32 个用例文件（286 条用例）
└── tools/generate-pack-icon.js    # 图标生成脚本
```

`core/` 不依赖 `@minecraft/server`（唯一例外是 `data/ItemNameMap.ts` 引用纯数据包 `@minecraft/vanilla-data`），因此可以脱离游戏单独跑单测；`mc/` 承担全部引擎适配。

## 构建与测试

```bash
npm run build -w @mc-toolchain/item-route     # tsc + esbuild
npm test -w @mc-toolchain/item-route          # tsc -p tests/tsconfig.json && node --test
npm run lint -w @mc-toolchain/item-route      # eslint + prettier
npm run pack -w @mc-toolchain/item-route      # 产出 ../../release/item-route-v0.1.20.mcaddon
npm run generate:icon -w @mc-toolchain/item-route  # 重新生成两个包的 pack_icon.png
```

测试编译配置在 `tests/tsconfig.json`，其 `include` 是**白名单**：`core/**` 全量 + 8 个被测试直接引用的 `mc/` 文件（`storage/**`、`ui/Table.ts`、`interaction/SelectionSessionStore.ts`、`interaction/interactionLogic.ts`、`auth/commands.ts`、`effects/SortEffects.ts`、`util/playerName.ts`）。不要简化成只含 `core/`——`node --test` 只跑编译产物，漏掉的文件会让对应用例静默不运行。

## 与上游的差异

本模组从 `~/coding/MCBE/mcaddon/item-route` v0.1.20 迁移而来，行为保持一致，工程侧有三处变化：

1. **包目录名**：`BP/ItemRoute`、`RP/ItemRoute` → `behavior_packs/item-route`、`resource_packs/item-route`（本仓库约定官方全名 + 包名）。
2. **依赖替换**：外部私有包 `@yinxe/toolkit` / `@yinxe/toolkit-build` 已移除。表单与 HUD 改用 `@mc-toolchain/mod-common`，打包改用 `@mc-toolchain/mod-packaging`；命令注册（`mc/commands/register.ts`）与管理员判定（`mc/auth/admin.ts`）按本仓库分工下沉到模组内。
3. **清单字段派生**：`header.name` / `header.description` / `header.version` / `modules[].version` / `min_engine_version` 全部由 `package.json` 派生，不手改。两个包的全部 UUID 与持久化键空间保持不变，已启用过旧包的世界无需重建仓库。
