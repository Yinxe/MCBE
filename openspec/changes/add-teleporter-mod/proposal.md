# Proposal

## Why

仓库外已有一个功能完整的「传送」Bedrock 行为包(`~/coding/MCBE/mcaddon/teleporter`,16 条 `/tpa:*` 自定义命令、7 组表单界面、约 2100 行 TypeScript),但它长在另一套工程体系里:`BP/Teleporter` 缩写包目录、外部共享包 `@yinxe/toolkit` / `@yinxe/toolkit-build`、模组自带的 `just-scripts mcpack` 打包入口、以及一份自相矛盾的清单(`header.min_engine_version [1,21,120]` 与 `dependencies @minecraft/server [2,6,0]` 无法同时成立)。

本仓库的 `packages/shared` 在 README 中明确把表单构建器(`ActionFormBuilder` / `ModalFormBuilder` / `MessageFormBuilder`)列为**刻意不包含**,理由是「等出现第二个消费方再抽」。传送模组正是第二个真正需要表单封装的模组(`auto-refill` 直接使用原生 `ModalFormData`),因此这次迁移同时也是把界面层抽成独立共享包的时机:一个模组迁移 + 一次沉淀,而不是再复制一份表单代码。

## What Changes

- 新增 `packages/ui`(`@mc-toolchain/ui`):界面层共享包,承载三种表单构建器、安全上下文执行助手与界面消息助手。来源是外部 `@yinxe/toolkit` 的 `ui/` 模块,按本仓库约定重写:只以官方 Script API 包为对等依赖,零第三方运行时依赖,`target: es6` 自检。
- 迁移模组到 `mods/teleporter/`:包名 `@mc-toolchain/teleporter`,版本**继承上游 `0.0.6`**(不重置为 `0.0.1`),包目录 `behavior_packs/teleporter/`(由上游 `BP/Teleporter` 改名)。
- 脚本模块依赖定为 `@minecraft/server 2.3.0`(`Dimension.getBiome` 自该版本起可用,传送点需要检测群系),`packing.minimum_engine_version` **显式**声明为 `[1, 21, 120]`,不依赖映射表推导;清单的 `dependencies[].version` 与之保持自洽。
- **行为对等**:保留上游全部 16 条 `/tpa:*` 命令与 7 组界面。迁移不做功能裁剪,但按「是否接触 `@minecraft` API」把脚本分为 `scripts/core/`(纯逻辑)与 `scripts/mc/`(适配层),与仓库已有先例一致,并给 `core/` 补 `node --test` 单测(传送点排序、死亡点上限裁剪、TPA 请求簿的覆盖与超时、群系与维度名称映射、表单取值解析)。
- 图标从上游 256×256 重制为 128×128 RGBA 像素画,满足 `pack-icon` 规范。
- 保留上游包与模块 UUID,使已安装旧包的世界把新产物识别为同一包的更新。

## Capabilities

### New Capabilities

- `shared-ui`: 约束仓库内部共享界面包 `@mc-toolchain/ui` 的定位、承载范围(三种表单的回调式/命名取值封装、安全上下文执行、界面消息助手)与依赖约束,使表单封装在所有模组间只有一份实现,且与 `packages/shared` 的运行时仲裁职责互不重叠。
- `teleporter`: 定义「传送」模组对玩家的可观察行为:传送点的创建/编辑/删除/置顶/公开与排序、快速传送、死亡点记录与回传、玩家间传送请求(60 秒超时)、公共传送点跨玩家枚举、管理员配置、传送信物物品、群系检测,以及传送失败的可观察反馈。

### Modified Capabilities

(无。`mod-workspace`、`addon-packaging`、`pack-icon`、`shared-runtime` 的既有要求无需改动:本改动只是新增一个符合它们的模组与一个 `packages/` 共享包;`shared-runtime` 的「刻意不包含表单构建器」是其能力边界描述而非要求,新包恰好落在该边界之外。)

## Impact

**新增**

- `packages/ui/`:`package.json`、`tsconfig.json`、`tests/tsconfig.json`、`src/`(三个表单构建器、`runSafe`、界面消息助手)、`tests/`、`README.md`。
- `mods/teleporter/`:`package.json`(version `0.0.6`)、`just.config.ts`、`tsconfig.json`、`tests/tsconfig.json`、`eslint.config.mjs`、`.env`、`scripts/`(`core/` 纯逻辑 + `mc/` 适配层 + `main.ts`,约 20 个模块)、`tests/`、`tools/generate-pack-icon.js`、`behavior_packs/teleporter/`(`manifest.json` + `pack_icon.png`)、`README.md`。
- `docs/research/read-only-context.md`:只读上下文调研,记录 `@minecraft/server@2.1.0` 的 341 个受限成员、判据(以声明标注为准,而非「是否写操作」)、实践规则与可复现的提取脚本。此前这条引擎级知识只存在于两处代码注释里。

**修改**

- `README.md`(根):模组表增加 `teleporter`,`packages/` 说明增加 `ui`。
- `mods/README.md`:补充「界面/表单封装来自 `@mc-toolchain/ui`」。
- `packages/shared/README.md`:「刻意不包含」一节补充指向 `@mc-toolchain/ui`,说明表单构建器已有独立归属,避免后来者以为仍无归属。
- `docs/research/README.md`:索引加入新增的 `read-only-context.md`。

**依赖变化**

- 新增 workspace 依赖 `@mc-toolchain/ui`(由 `mods/teleporter` 以开发依赖引用)。
- `mods/teleporter` 依赖 `@minecraft/server 2.3.0` 与 `@minecraft/server-ui 2.0.0`;根 `node_modules` 需能解析这两个版本(与 `auto-refill` 的 `2.1.0` 各自独立)。
- 移除对外部 `@yinxe/toolkit` / `@yinxe/toolkit-build` 的依赖;不引入任何 pnpm 专有依赖。

**兼容性**

- 上游清单的 `header.min_engine_version` 为 `[1, 21, 120]`,本次显式保持同值,因此最低游戏版本**不收紧**;但上游 `dependencies` 声明的 `@minecraft/server [2, 6, 0]` 与 `2.3.0` 不兼容,迁移后改为 `[2, 3, 0]`,与 `package.json` 同源。
- 包目录与包名改变,但保留上游包与模块 UUID,重新导入后被视作同一包的更新。
- 16 条命令名(`tpa:menu`、`tpa:warp` … `tpa:token`)与 UI 层级保持上游形状,已习惯旧命令的玩家不需要重新学习。
- 上游 `scripts/main.ts` 的启动日志硬编码 `v0.0.1`,而 `package.json` 为 `0.0.6`;迁移后不再出现硬编码版本号。

**风险**

- 上游「玩家传送」界面允许任意玩家把自己传到任意在线玩家身边,**也能把对方无同意地拉到自己身边**。本次按「行为对等」保留,需在 `design.md` 记为已知取舍并给出后续收紧路径。
- 公共传送点枚举依赖 `teleporter:players` 这个玩家 ID 索引 DynamicProperty,而索引只增不减(`deletePlayerData` 无调用方),长期运行后索引会累积失效 ID。迁移保持现有行为,记为待评估项。
- `ModalFormResponse.formValues` 在部分 Bedrock 版本中 `label` / `header` / `divider` 是否占用索引不一致,上游用「取值个数等于字段个数」的启发式判定。迁移保留该启发式并用单测覆盖两种排布,避免回归。
- 新共享包被两个模组共用后,一处改动同时影响两者;需 `packages/ui` 自带纯逻辑单测兜底。
