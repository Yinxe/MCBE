# 传送（teleporter）

单人/多人传送管理：传送点、死亡点、玩家间传送请求。无需开启作弊，保留成就。

- 包名：`@mc-toolchain/teleporter`
- 版本：`0.0.6`（沿用上游版本号，见 design D3）
- 最低游戏版本：`1.21.120`
- 脚本 API 依赖：`@minecraft/server 2.3.0`、`@minecraft/server-ui 2.0.0`

## 功能

- **传送点**：在当前位置创建、分类（家/资源点/生电/遗迹/群系/其他）、备注、置顶、更新坐标、删除；自动记录群系中文名
- **公共传送点**：把传送点设为公开，所有玩家可见可传送，标注所有者与传送次数
- **死亡点**：死亡自动记录（每人保留最近 10 条），`/tpa:back` 一键回传，重生时可选择立即回传
- **玩家间传送**：`/tpa:tpa` 请求传送、`/tpa:tphere` 请求对方过来，60 秒有效，需对方接受
- **传送信物**：纸做的信物，右键打开主菜单；死亡不掉落、锁在背包内；首次进入自动发放

## 命令

全部命令由玩家执行；控制台与命令方块执行会返回失败（见「已知约束」）。

| 命令 | 说明 | 参数 |
| --- | --- | --- |
| `/tpa:menu` | 打开传送管理菜单 | — |
| `/tpa:warp [名称]` | 传送到指定传送点；不带名称则打开选择界面 | 可选：`名称` |
| `/tpa:setwarp <名称>` | 在当前位置设置传送点 | 必填：`名称` |
| `/tpa:delwarp <名称>` | 删除指定传送点 | 必填：`名称` |
| `/tpa:warps` | 打开传送点选择界面 | — |
| `/tpa:back` | 传送到最近的死亡点 | — |
| `/tpa:deathpoints` | 查看并传送至死亡点 | — |
| `/tpa:tpa <玩家>` | 请求传送到指定玩家身边 | 必填：`玩家` |
| `/tpa:tphere <玩家>` | 请求指定玩家传送到自己身边 | 必填：`玩家` |
| `/tpa:tpaccept` | 接受待处理的传送请求 | — |
| `/tpa:tpadeny` | 拒绝待处理的传送请求 | — |
| `/tpa:public <名称>` | 切换传送点是否公开 | 必填：`名称` |
| `/tpa:publiclist` | 查看所有公共传送点 | — |
| `/tpa:admin` | 打开管理配置界面（需 OP 或 `op` 标签） | — |
| `/tpa:config` | 查看当前模组配置（需 OP 或 `op` 标签） | — |
| `/tpa:token` | 获得传送信物（右键打开传送菜单） | — |

## 目录分层

```
scripts/
├── core/       纯逻辑:类型、配置归一化、传送点、死亡点、请求簿、命名映射、信物判定
│               不 import @minecraft/*,可被 node --test 直接覆盖
├── mc/         适配层:唯一接触 @minecraft 的地方
│   ├── ui/     本模组的 7 个屏幕(与共享包 packages/mod-common 不是同一层)
│   └── ...     存档、探测、传送、信物、请求、事件、命令、业务动作
├── version.ts  日志版本号常量
└── main.ts     组合根:startup 阶段一次性注册命令与事件
```

`core/` 依赖 `mc/` 是禁止的;`mc/` 可以依赖 `core/`。`tests/tsconfig.json` 的 `include`
只含 `core/` 与 `tests/`,因此 `@minecraft` 一旦泄漏进 `core/` 会立刻编译失败。

界面与表单来自共享包 [`@mc-toolchain/mod-common`](../../packages/mod-common/README.md);存档键名与
JSON 载荷沿用上游，老存档可直接升级。

## 已知约束与取舍

- **命令只能由玩家执行**：所有命令在控制台与命令方块中返回失败。原因是界面、传送、
  存档写入都依赖玩家上下文。
- **命令回调不直接干活**：命令回调运行在受限上下文（read-only mode），传送、打开界面、
  写存档都会抛 `cannot be called in read-only mode`。回调体只做参数解包、来源校验与鉴权，
  其余全部交给 `@mc-toolchain/mod-common` 的执行助手推迟到安全 tick。机制与判定标准见
  [`docs/research/read-only-context.md`](../../docs/research/read-only-context.md)。
- **玩家传送可无同意移动他人**：`/tpa:menu` → 玩家传送 → 「让他传送过来」会把对方拉过来
  而无需对方同意。与上游行为一致，属「全量对齐」的已知取舍；需要征得同意请用 `/tpa:tpa`。
- **公共传送点索引只增不减**：`teleporter:players` 索引记录过所有写数据的玩家 ID，
  玩家离开后不会清理。数据量极小（每 ID 约 36 字节），暂不处理。
- **传送计数在成功后才累加**：命令与界面两条入口都先确认传送成功再计次，避免失败也涨次数
  （上游公共传送点界面存在先计次后传送的问题，此处已修正）。

## 开发

```bash
npm run lint          # eslint + prettier + minecraft-linting
npx tsc -p tsconfig.json --noEmit
npm test              # 编译并运行 core 层单元测试
npm run pack          # 生成 .mcpack 到仓库根的 release/
npm run generate:icon # 重新生成 128×128 pack_icon.png
npm run local-deploy  # 部署到本地 Minecraft
```
