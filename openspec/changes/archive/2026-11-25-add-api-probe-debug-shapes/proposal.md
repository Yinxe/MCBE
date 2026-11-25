# Proposal: api-probe 增加 `@minecraft/debug-utilities` 线框绘制

## Why

`api-probe` 已经有粒子版框选(`/apitest:box`),但它有两处不适合当「尺子」用:

1. **只有面片和棱线,没有文字。** 想知道「这个框到底多少格」得靠回执里的聊天消息,聊天栏一刷就没了。
2. **要改资源包。** 粒子、材质、贴图都在资源包里,想调线宽、换颜色都得改资源包再重进世界。

`@minecraft/debug-utilities` 提供的是**引擎直接渲染的调试形状**:`DebugBox`、`DebugLine`、`DebugText` 等。纯脚本、零资源包、自带文字、无需连接 VS Code 调试器——玩家在游戏里就能看见。这正好补上粒子版缺的两块。

同时,`api-probe` 是开发期探针,「这个 API 到底能干什么」本身就是它要回答的问题。把该模块的形状逐个画出来,比翻 `.d.ts` 或读文档更直接。

## What Changes

新增三条命令:

| 命令 | 作用 |
| --- | --- |
| `/apitest:debugbox <x1> <y1> <z1> <x2> <y2> <z2> [秒数] [尺寸系数]` | 两角点框选,画出 `DebugBox` + 3 条三色轴 `DebugLine` + 1 个尺寸 `DebugText` |
| `/apitest:debugshow [秒数]` | 在玩家面前把该模块支持的 6 种形状各画一份(版本探针) |
| `/apitest:debugclear` | 立即清掉本模组画的全部形状 |

`/apitest:debugbox` 与 `/apitest:box` 画的盒子位置、尺寸、三色轴完全一致,用来横向对比两种渲染路径。

依赖版本钉在 `1.0.0-beta.1.21.100-stable`。该模块每个引擎版本一个包,能力随版本增长(1.21.130 才加维度参数、1.26.60 才加 alpha 与 `diagnosticsManager`)。模组的 `min_engine_version` 是 `[1,21,100]`,选更高版本的模块会强迫抬高最低游戏版本,让模组在旧版游戏上直接不可用。开发期调试模组不值得为半透明付这个代价。

**明确不做:**

- 不替换粒子版 `/apitest:box`。两条命令并存:粒子版是能正式发布的那条,线框版是 beta 且仅供开发期对比。
- 不引入玩法功能。仍然只是开发期探针。
- 不追新版本模块,不为了 alpha 或新形状把 `min_engine_version` 抬上去。
- 不做持久化。形状只活在客户端渲染层,不写世界、不进存档。

## Capabilities

### New Capabilities

- `api-probe`: 在既有能力上新增「按两角点绘制调试线框」「调试形状可用性探针」「规避调试绘制引擎缺陷」三条契约,并修改既有的 beta 依赖与外部模块依赖两条契约。

### Modified Capabilities

- `api-probe`: 既有契约「命令无需作弊且不引入实验性功能」原本禁止任何 Beta APIs 依赖,现需允许受控引入 beta 模块并要求文档前置声明后果;「运行时只依赖官方 Script API 模块」原本只列 `server` 与 `server-ui` 两个模块,现需扩展到官方模块集合与清单依赖的一致性。

## Impact

- 新增 `scripts/DebugShapeMath.ts`(纯函数,可单测)、`scripts/DebugShapeBuilder.ts`、`scripts/DebugRenderer.ts`、`scripts/DebugCommand.ts`
- 新增 `tests/DebugShapeMath.test.mjs`
- `main.ts` 挂上命令注册
- `just.config.ts` 的 `external` 加入 `@minecraft/debug-utilities`
- `tsconfig.json` 的 `paths` 钉住该模块到 mod 本地 `node_modules`
- `behavior_packs/api-probe/manifest.json` 增加 `{ "module_name": "@minecraft/debug-utilities", "version": "1.0.0-beta" }` 依赖
- `package.json` 增加该模块依赖(`--save-exact`)
- `README.md` 补命令表、调试线框章节、版本限制表与三个引擎缺陷

**代价:整包依赖 Beta APIs 开关。** `@minecraft/debug-utilities` 是 beta 模块。世界未开启 Beta APIs 实验时,**整个脚本模块都会加载失败**,包括不依赖 beta 的 `/apitest:container` 与 `/apitest:box`。这是包的粒度决定的,无法只让三条新命令失效。`api-probe` 本来就是开发期探针、不进正式世界,这个代价可以接受,但必须在 README 首屏写清楚——否则使用者会遇到「整个模组都没了」的困惑。
