# Proposal: 坐标改用 `Location` 参数，颜色补齐 `alpha`

## Why

实机跑 `/apitest:debugbox` 报了一个错，追下去发现是两个独立问题：

**一、`color` 少了 `alpha`，形状根本构造不出来。**

```
native setter cannot be assigned null or undefined interface property
['alpha'] expected number (failed parsing interface to function return value)
```

安装的类型定义 `@minecraft/debug-utilities@1.0.0-beta.1.21.100-stable` 写的是 `color: RGB`（三分量，无 `alpha`），但引擎要 `alpha`。根因在 `manifest.json`：

```json
{ "module_name": "@minecraft/debug-utilities", "version": "1.0.0-beta" }
```

`"1.0.0-beta"` 解析成**引擎当前携带的 beta 版本**，而不是我们钉在 `package.json` 里的 `1.21.100-stable`。引擎版本比类型定义新，那一版起 `color` 就是 `RGBA`。**类型定义在这里是误导性的**——它描述的是一份已经不存在的运行时。

**二、坐标参数用三个 `Integer`，是我之前未经验证的结论。**

此前在 `BoxCommand.ts`、`DebugCommand.ts`、`README.md` 三处写死了一句「`Location` 参数在 `@minecraft/server 2.1.0` 上实测会导致整条命令不注册」。这次核对：

- `CustomCommandParamType.Location` 在 `@minecraft/server` 2.1.0 ~ 2.11.0 **每个版本都存在**；
- 仓库内 `item-route` 模组用**同样的** `2.1.0` + `min_engine_version 1.21.100`，`ir:create` / `ir:resize` 早就用着 `Location` 参数，已发布 v0.1.21；
- 那句「实测」没有任何记录支撑，是我当初的误判，然后被自己反复引用成了「既有结论」。

代价是玩家失去「望准方块」取点和 `~` 相对坐标，命令签名也多出一倍参数。

## What Changes

- 新增 `scripts/DebugColor.ts`（纯函数）：`toNativeColor()` 总是补出 `alpha`（`RGBA extends RGB`，四分量是两版都接受的超集写法）、`alphaOf()` / `hasAlpha()` 用于从读回值判定运行时到底是 RGB 还是 RGBA、`describeColor()` 按有无 alpha 分别输出 `rgb(...)` / `rgba(...)`。
- 全部颜色赋值改经 `toNativeColor()`：`DebugShapeBuilder.ts`、`DebugShapeProbe.ts`、`DebugMotionProbe.ts`、`DebugCommand.ts`。
- 新增 `scripts/CommandLocation.ts`：`CommandLocation = Vector3`（显式说明命令 `Location` 参数运行时的真实形状），`toBlockCoordinate()` 统一用 `Math.floor` 取整。
- 三条坐标命令全部改用 `Location` 参数：
  - `/apitest:container <目标>`（原 `<x> <y> <z>`）
  - `/apitest:box <角点1> <角点2> [秒数] [尺寸系数]`（原六个整数）
  - `/apitest:debugbox <角点1> <角点2> [秒数] [尺寸系数]`（原六个整数）
- `debugshape` 的颜色探针重写为「RGB 还是 RGBA」三组并排：三分量（旧写法，预期报错）、四分量 `alpha=1`、四分量 `alpha=0.35`（验证透明度是否真的生效）。
- `DebugProbeShared.formatValue` 的颜色格式化支持 alpha，带不带如实输出——这本身就是判定运行时版本的证据。
- 新增 `tests/DebugColor.test.mjs`（10 项）与 `tests/CommandLocation.test.mjs`（5 项）。
- 清除 `BoxCommand.ts`、`DebugCommand.ts`、`README.md` 三处的错误结论，改为说明 `Location` 的正确用法与取整约定。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `api-probe`：新增「命令坐标参数 MUST 使用 `Location`」「颜色构造 MUST 兼容 RGB 与 RGBA 两种运行时结构」两项要求；「调试线框只读不写世界」一条补充「不得依赖类型定义推断运行时结构」的说明。

## Impact

- **新增代码**：`scripts/DebugColor.ts`、`scripts/CommandLocation.ts`。
- **修改代码**：`BoxCommand.ts`、`DebugCommand.ts`、`ProbeCommand.ts`、`DebugShapeBuilder.ts`、`DebugShapeProbe.ts`、`DebugMotionProbe.ts`、`DebugProbeShared.ts`。
- **修改文档**：`README.md` 命令表与坐标参数说明。
- **破坏性变更**：三条命令的签名变了（参数个数与类型），旧写法 `/apitest:box 100 64 -20 109 71 -11` 不再可用。这是开发期模组，无外部使用者。
- **测试数**：27 → 42。
- **不影响**：`min_engine_version`、打包流水线、产物名。
- **遗留风险**：`manifest.json` 的 `"1.0.0-beta"` 会继续跟随引擎 beta 版本，类型定义与运行时的偏差可能再次出现。本次的对策是「构造时用超集写法 + 读回时如实报告」，而不是把类型定义当权威。
