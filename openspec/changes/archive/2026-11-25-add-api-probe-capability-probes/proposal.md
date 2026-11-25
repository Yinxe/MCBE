# Proposal: 把 `@minecraft/debug-utilities` 的每项能力做成可执行探针

## Why

`api-probe` 的目标是「探明 Script API 到底能做到什么」，但上一轮只把 `debug-utilities` 当成画框工具用了：

- **只用了 1/4 的导出**：该模块导出 `debugDrawer`、`collectRuntimeStats()`、`collectPluginStats()`、`disableWatchdogTimingWarnings()`，此前只接入了 `debugDrawer`。后三项正是排查内存泄漏、句柄泄漏、脚本卡顿的直接手段，却完全没接。
- **形状参数只试了默认值**：`/apitest:debugshow` 把 6 种形状按默认参数各画一份，看不到任何参数的效果。而该模块最需要实测的恰恰是那些文档没写清的地方——`DebugBox.bound` 是全宽还是半宽、`scale` 是乘在 `bound` 上还是替换它、`rotation` 三个分量分别绕哪个轴、`color` 超出 0~1 会不会被夹取。
- **只测了「写进去」，没测「生不生效」**：读回一致只能证明 JS 侧 setter 存下了值，不证明渲染器读了这个值。改 `location` 之后形状会不会移动、改 `bound` 之后会不会重新渲染——这类问题读属性永远读不出来，只能「改完盯着看」，而此前没有任何动态探针。
- **「安全调用」这个问题没有实验支撑**：此前结论是「类型定义里没标注，但不赌，全部推迟到安全 tick」。这是稳妥的工程判断，但它没有回答「到底会不会抛错」，而这个答案直接决定后续能不能省掉推迟。

一句话：模组名为 api-probe，但 `debug-utilities` 这一块目前是「画得出来」，不是「测得出来」。

## What Changes

- 新增 7 条**测量命令**（与既有 3 条绘图命令并列，不替换）：

  | 命令 | 探什么 |
  | --- | --- |
  | `/apitest:debugshape [秒数]` | 逐形状逐参数：`endLocation`、箭头三个头部参数、`bound` 口径、`scale` 作用、Sphere/Circle 缩放、`DebugText` 朝向与长度、`rotation` 三分量、`hasDuration`/`totalTimeLeft` 语义、`color` 是否夹取、`remove()` 后能否重加 |
  | `/apitest:debugmotion` | 动态探针：改 `location`/`bound`/`scale`/`color` 后已在世界上的形状是否重新渲染；`timeLeft` 是实时倒数还是快照 |
  | `/apitest:debuglimits [数量]` | 规模上限：一次画 N 个（默认 200，上限 2000），看加到第几个失败、耗时多少 |
  | `/apitest:debugcontext` | 受限上下文：在命令回调里**直接**调 `addShape` 会不会抛错 |
  | `/apitest:debugstats` | `collectRuntimeStats()` 的内存/对象数、`collectPluginStats()` 的各插件句柄计数 |
  | `/apitest:debugwatchdog <0\|1>` | `disableWatchdogTimingWarnings()` 开关 |
  | `/apitest:debugall` | 能力总览：哪些导出可用、本版有哪些形状类 |

- 新增 `scripts/DebugProbeShared.ts`：报告格式（`kv` / `heading` / `verdict` / `warning`）、`attempt` 容错包装（把抛错转成一行文本而不是让整条探针失败）、`readShapeState`（逐项独立读取形状状态）、`rowPositions`（在玩家面前排等间距站位，供并排比对）。
- 新增 `scripts/DebugShapeProbe.ts`（静态探针，10 组）、`scripts/DebugMotionProbe.ts`（动态探针 + 规模上限 + 受限上下文）、`scripts/DebugStatsProbe.ts`（统计类）、`scripts/DebugProbeCommands.ts`（命令注册）。
- 新增 `tests/DebugProbeShared.test.mjs`：10 项断言，覆盖数字格式化、向量/颜色格式化、站位排布（居中、间距、俯仰不影响水平距离、朝向任意方向都对）。
- 更新 `README.md`：新增「测量命令」表与「两类探针的区别」对照表，明确写出**属性写入成功 ≠ 渲染生效**。

## Capabilities

### New Capabilities

无。本次只扩充既有 `api-probe` 能力的实现手段，不引入新的对外契约对象。

### Modified Capabilities

- `api-probe`：新增「探针须区分写入成功与渲染生效」「探针须覆盖模块全部导出」「受限上下文的调用安全性须由实测回答」三项要求。既有「调试线框提供形状可用性探针」一条从「画出来就算」升级为「逐参数探明并回执读写结果」。

## Impact

- **新增代码**：`mods/api-probe/scripts/` 下 4 个文件（约 900 行，含大量注释说明每个探针在验证什么）、`tests/` 下 1 个测试文件（10 项断言）。
- **修改代码**：`scripts/main.ts` 挂上 `registerDebugProbeCommands()`。
- **修改文档**：`mods/api-probe/README.md` 命令表与探针说明。
- **命令数**：从 5 条增至 12 条。
- **测试数**：从 17 项增至 27 项。
- **不影响**：`/apitest:container` 与 `/apitest:box` 的行为、打包流水线、`min_engine_version`、`release/` 产物名。仍为 beta 依赖，仍需 Beta APIs 开关。
- **已知代价**：`/apitest:debuglimits` 在数量大时会明显掉帧（这本身就是它要测的东西），`/apitest:debugwatchdog 1` 会全局关闭看门狗告警（所以默认关闭该开关，需显式开启）。
