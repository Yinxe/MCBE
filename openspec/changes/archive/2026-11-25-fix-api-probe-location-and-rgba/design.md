# Design: 坐标改 `Location`，颜色补 `alpha`

## 问题一：`alpha` 缺失——类型定义与运行时不符

### 报错

```
native setter cannot be assigned null or undefined interface property
['alpha'] expected number (failed parsing interface to function return value)
```

### 根因链

```
package.json   @minecraft/debug-utilities: 1.0.0-beta.1.21.100-stable
                 ↓ 提供类型定义,DebugShape.color: RGB(三分量)
manifest.json  { "module_name": "@minecraft/debug-utilities", "version": "1.0.0-beta" }
                 ↓ 运行时按「引擎当前携带的 beta 版本」解析
引擎           版本比 1.21.100 新,color 已是 RGBA(四分量,含 alpha)
                 ↓
               JS 传三分量对象 → 原生层解析失败 → 构造形状抛错
```

关键认知：**`"1.0.0-beta"` 不等于 `1.0.0-beta.1.21.100-stable`。** 前者是一个「跟随引擎」的浮动版本号，后者是钉死的快照。`package.json` 里钉版本只影响**类型检查**，不影响**运行时加载哪一版**。

所以「类型定义说 `color` 是 `RGB`」这句话本身是对的——它准确描述了 1.21.100 那一版。错的是我们拿它当运行时依据。

### 对策：构造用超集，读回如实报

`RGBA extends RGB`，所以四分量是两版都接受的超集：

```ts
function toNativeColor(color, fallbackAlpha = 1) {
  return { red: color.red, green: color.green, blue: color.blue, alpha: color.alpha ?? fallbackAlpha };
}
```

- 老引擎（RGB）：多收一个 `alpha` 字段，忽略即可；
- 新引擎（RGBA）：正是它要的。

`alpha` 用 `??` 而不是 `||`：`alpha=0`（全透明）是合法值，`||` 会把它错判成缺失并补成 1。

反过来，**读回值不做补齐**。`alphaOf()` 在字段缺失时返回 `undefined` 而不是默认值——因为「读回带不带 alpha」本身就是判定运行时版本的直接证据，补上就毁了这条信息。探针里专门有一节把这件事报出来。

### 探针如何暴露这类问题

`debugshape` 的颜色探针分三组并排：

| 组 | 写法 | 预期 |
| --- | --- | --- |
| 三分量 | `{ red, green, blue }` | 若运行时是 RGBA，这一行抛错并提到 `alpha` |
| 四分量 `alpha=1` | `toNativeColor(...)` | 正常，全不透明 |
| 四分量 `alpha=0.35` | 同上，`alpha` 显式给 | 若明显更淡则 alpha 生效 |

第一组是**故意保留的旧写法**——它是这个 bug 的回归测试。如果哪天引擎退回 RGB，这一行会从「抛错」变成「正常」，探针立刻能看出来。

## 问题二：坐标参数该用 `Location`

### 之前的错误结论

三处写死了同一句话：

> `Location` 参数在本项目的 `@minecraft/server 2.1.0` 上实测会导致整条命令不注册（命令从命令表里消失）。

这次核对的结果：

1. `CustomCommandParamType.Location` 在 `@minecraft/server` **2.1.0 到 2.11.0 每个版本都存在**；
2. 仓库内 `item-route` 用**同样的** `2.1.0` + `min_engine_version 1.21.100`，`ir:create` / `ir:resize` 一直在用 `Location` 参数，已发布 v0.1.21；
3. 那句「实测」没有任何记录支撑——git 历史里也找不到当时的排查过程。

结论：**那是一个未经验证的判断，被自己反复引用成了「既有结论」。** 这是比 bug 更值得记下来的教训。

### `Location` 参数运行时的真实形状

翻遍 `@minecraft/server` 2.1.0 ~ 2.11.0 的 `index.d.ts`，**没有 `Location` 这个导出类**——只有 `LocationInUnloadedChunkError`、`DimensionLocation` 等。枚举的文档注释写着「provides a `@minecraft/server.Location`」，但那个类不存在。这个参数类型在类型定义里是半成品。

运行时实际收到的是 `{ x, y, z }` 形状的对象：

- 三个分量都是 `number`；
- **不带维度**——维度必须另外从执行者身上取；
- **不保证是整数**——玩家可以写 `100.7 64.2 -20.9`。

所以 `CommandLocation.ts` 显式声明成 `Vector3` 形状，而不是假装有个 `Location` 类可以 import。注释里写清这三条，避免下一个人再踩。

### 取整：统一 `Math.floor`

方块 `n` 占据 `[n, n+1)` 区间，所以：

- `5.9` → 方块 `5`（不是 `6`）；
- `-0.1` → 方块 `-1`（`Math.trunc` 会错误地给 `0`）。

`toBlockCoordinate()` 统一用 `Math.floor`，三条命令共用同一套规则，避免「有的命令 floor、有的命令 round」。

## 命令签名变更

| 命令 | 旧 | 新 |
| --- | --- | --- |
| `container` | `<x> <y> <z>` | `<目标>` |
| `box` | `<x1> <y1> <z1> <x2> <y2> <z2>` | `<角点1> <角点2>` |
| `debugbox` | `<x1> <y1> <z1> <x2> <y2> <z2>` | `<角点1> <角点2>` |

收益：

- 玩家可以「望准方块」直接取点，不用手抄坐标；
- 支持 `~` 相对坐标；
- 签名从 8 个参数降到 4 个。

代价：旧写法失效。开发期模组，无外部使用者，可接受。

## 为什么 `count` / `disable` 仍用 `Integer`

`/apitest:debuglimits <count>` 与 `/apitest:debugwatchdog <disable>` 的参数是**数量**和**开关**，不是坐标。`Location` 对它们没有意义（玩家不会「望准一个数量」）。所以只有真正表示坐标的参数改用 `Location`，其余保持 `Integer`。

## 测试

新增 15 项断言：

- `DebugColor`（10 项）：三分量补出 `alpha=1`、显式 alpha 保留、`alpha=0` 不被 `??` 误判、返回新对象不污染源、读回时缺失与存在可区分、非对象安全返回、`rgb`/`rgba` 文本格式。
- `CommandLocation`（5 项）：整数原样、正小数向下取整、负小数向下而非向零、零值、相对坐标解析后取整。

`alpha=0` 那项尤其重要——它钉住了 `??` 与 `||` 的区别，而这类错误在代码 review 里极难看出来。
