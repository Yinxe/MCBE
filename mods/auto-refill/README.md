# 自动替换（auto-refill）

自动替换主手消耗品——工具挖坏了自动换同款、物品用完了自动补、武器打怪自动选对、不死图腾触发后自动补回副手。**不使用任何作弊指令，未开作弊的世界同样可用。**

| 项 | 值 |
| --- | --- |
| 包名 | `自动替换` |
| 版本 | 2.2.0 |
| 最低游戏版本 | **Minecraft 1.21.100** |
| 脚本 API 依赖 | `@minecraft/server 2.1.0`、`@minecraft/server-ui 2.0.0` |
| 是否需要作弊 | 否 |

## 功能

七个开关，可在管理员菜单里逐项开关：

| 功能 | 说明 |
| --- | --- |
| 全局开关 | 关闭后所有自动行为停止，等同于临时禁用本模组 |
| 物品补充 | 主手消耗品（食物、药水、投掷物等）用完后自动从背包补一组 |
| 武器替换 | 攻击实体时自动换成合适的武器（亡灵优先亡灵杀手，其余优先锋利；剑优先于斧） |
| 工具替换 | 挖掘时自动换成合适的工具；工具挖坏后自动换同款 |
| 图腾补充 | 不死图腾被消耗触发保护后，自动把背包里的图腾补到副手 |
| 挖掘防误触 | 手持错误工具误挖方块时拦下并提示，2.5 秒内再次挖掘才放行 |
| 耐久保护 | 工具耐久低于阈值时提前换成同类，避免用碎；绝不换成更低级的工具 |

### 图腾补充需要 Minecraft 1.26.10+

图腾触发检测依赖 `world.afterEvents.entityHeal`，该事件自 `@minecraft/server 2.6.0` 起才提供。本模组声明的最低依赖是 `2.1.0`，因此在 **1.21.100 – 1.26.0** 上：

- 其余六个功能全部正常
- **图腾补充静默失效**，不报错、不崩溃、不影响其它功能

从 1.26.10 起，图腾补充自动恢复，无需更换包。

## 命令

| 命令 | 权限 | 作用 |
| --- | --- | --- |
| `/ar:menu` | 仅操作员（游戏导演） | 打开配置表单，一次性调整全部开关与耐久保护的两个阈值 |
| `/ar:help` | 全体玩家 | 查看功能与机制说明 |

两个命令都不需要开启作弊。`/ar:menu` 仅接受玩家执行，从控制台或命令方块执行会被拒绝并说明原因。

配置保存在世界动态属性中，键前缀 `autorefill:`，世界重启后自动恢复。

## 耐久保护的两个阈值

工具是否「该换了」由两个值共同判定，**任一条件成立即更换**（即两个阈值任一触发）：

| 配置项 | 默认值 | 取值范围 | 含义 |
| --- | --- | --- | --- |
| `durabilityThreshold` | `0.05` | `0.01` – `0.2` | 剩余耐久**占比**低于此值即换 |
| `durabilityFloor` | `16` | `1` – `64` | 剩余耐久**点数**低于此值即换 |

判定式为 `剩余占比 < durabilityThreshold || 剩余点数 < durabilityFloor`，因此两个阈值中**先被触发的那个生效**。

两个阈值并存是因为单看占比对大耐久工具太激进、单看点数对小耐久工具太激进：

- 满耐久 1561 的钻石镐：占比阈值为 `0.05 × 1561 ≈ 78` 点，大于 `16`，因此**点数阈值先触发**——剩 16 点时就换。否则要等到剩 78 点就换，相当于浪费了一把镐头近 5% 的寿命
- 满耐久 59 的木镐：占比阈值为 `0.05 × 59 ≈ 3` 点，小于 `16`，因此**占比阈值先触发**——剩约 3 点时才换。否则等到剩 16 点就换，木镐还剩 27% 寿命就被丢掉了

更换时只会换到**品质不降级、严格更耐久、且占比达标**的同类；没有合格候选时保持不动，绝不换成更差的工具。

## 不使用作弊指令

全部替换通过背包容器与装备槽操作完成，不调用 `/replaceitem` 之类需要作弊的指令，因此**开启本模组不会关闭世界成就**。

## 开发

```bash
npm install              # 在仓库根目录执行一次即可（npm workspace）
cd mods/auto-refill

npm run build            # 编译 + 打包脚本
npm run pack             # 产出 <仓库根>/release/auto-refill-v2.2.0_bp.mcpack
npm test                 # 60 项纯逻辑单测（不加载游戏运行时）
npm run lint             # eslint + prettier
npm run generate:icon    # 重新生成 128×128 的 pack_icon.png
```

### 目录结构

```text
mods/auto-refill/
├── behavior_packs/auto-refill/   # 行为包（manifest.json、pack_icon.png）
├── scripts/                      # 21 个脚本模块
├── tests/                        # 6 个测试文件，60 项用例 + 测试专用 tsconfig.json
├── tools/generate-pack-icon.js   # 图标生成（32×32 逻辑像素 4 倍最近邻）
├── tsconfig.json                 # 编译配置（target es6）
└── package.json
```

> 测试用的 `tsconfig.json` 刻意放在 `tests/` 子目录，不放在模组根目录：`mct validate` 会把模组根层的未知 `.json` 当成包内容并报 `UNKJSON101`。详见 `docs/research/minecraft-creator-tools.md`。

打包逻辑来自 `@mc-toolchain/mod-packaging`，运行时共享代码（文本样式、HUD 总线）来自 `@mc-toolchain/mod-common`，本目录内不含这两部分实现。

### 版本声明的三处一致性

改动脚本 API 版本时，**以下三处必须同时改**，否则会出现「编译期有该 API、运行时没有」的错位：

| 位置 | 字段 | 当前值 |
| --- | --- | --- |
| `package.json` | `dependencies["@minecraft/server"]` | `2.1.0` |
| `behavior_packs/auto-refill/manifest.json` | `dependencies[].version`（`@minecraft/server` 项） | `[2, 1, 0]` |
| `package.json` | `packing.minimum_engine_version` | `[1, 21, 100]` |

打包工具只同步 `header.version`、`modules[].version` 与 `min_engine_version`，**不会改写 `dependencies[].version`**——那一行是手写常量。

机制说明见 `docs/research/version-semantics-and-backward-compatibility.md`。

## 测试

`npm test` 运行 60 项纯逻辑用例，覆盖工具评分、防误触、图腾判定、瞬破判定、偏好表排序。这些模块零 `@minecraft` 依赖，可脱离游戏环境运行。

`tests/tsconfig.json` 的 `include` 是显式文件列表，只包含纯逻辑层；背包、方块分类器、界面等适配层不参与测试编译。
