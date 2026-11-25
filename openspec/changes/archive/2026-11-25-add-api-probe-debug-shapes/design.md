# 设计：api-probe 的调试线框绘制

## 分层：形状算术 / 形状构造 / 绘制 / 命令

四层，每层的失败点不同，分开才能分别定位：

```
DebugShapeMath.ts     纯函数:轴长、轴段、文字位置、尺寸文本   ← 可单测,不 import @minecraft/*
DebugShapeBuilder.ts  构造 DebugBox / DebugLine / DebugText    ← 只碰参数取值
DebugRenderer.ts      debugDrawer.addShape 与生命周期登记       ← 只碰引擎状态
DebugCommand.ts       参数解析、夹取、回执、命令注册            ← 只碰命令层
```

单测只覆盖第一层。这与 `BoxGeometry.ts` 的既有做法一致：几何算术抽成纯函数，`node --test` 直接跑，不用进游戏。

## 一个盒子画 5 个形状

`DebugBox` 只有一种构造形式：`new DebugBox(location)`，`location` 是**中心点**，尺寸走 `bound` 属性。所以一个"看起来像框选"的盒子需要拼：

| 形状 | 数量 | 作用 |
| --- | --- | --- |
| `DebugBox` | 1 | 盒体线框，`bound` = 真实边长，`scale` = 尺寸系数 |
| `DebugLine` | 3 | 最小角三色轴：X 红、Y 绿、Z 蓝 |
| `DebugText` | 1 | 盒子上方一格的尺寸文字，如 `10×8×10` |

三色轴为什么不用 `DebugArrow`：箭头有 `headLength` / `headRadius` / `headSegments` 三个参数要调，在 4 格长的轴末端画个箭头既不好看也占地方。箭头只在 `/apitest:debugshow` 的清单里出现，用来证明该形状可用。

## 轴长取 `min(4, 该轴边长)`

固定 4 格会让单格选区看起来像 4 格框；固定取边长又会让 200 格的大盒子画出 200 格长的轴，比盒子本身还刺眼。

`min(AXIS_MAX_LENGTH, size[axis])` 两头都顾：大盒子轴长封顶 4 格，小盒子（含单格）轴正好等于边长，不伸出盒子。

## `DebugBox.bound` 的口径问题沿用 `尺寸系数`

官方描述只有一句：「final box will be this bound multiplied by the shape's scale」。**没说 `bound` 是全宽还是半宽。**

这与粒子版 `particle_appearance_billboard.size` 的历史问题完全同构（见 `add-api-probe-box-visual` 的 design）。解法也照抄：`bound` 一律填真实边长，把口径未知量交给命令的第二个可选参数 `尺寸系数`——实测框大一倍就传 `0.5`，小一半就传 `2`。现场一次标定，不改代码。

两个命令的 `尺寸系数` 语义完全一致，这是刻意的：使用者不需要记两套约定。

## 三个引擎缺陷决定了 `DebugRenderer` 的写法

`@minecraft/debug-utilities` 在 `1.21.100` 上有三个已确认的崩溃/异常行为，`DebugRenderer.ts` 里所有"多余"的防御都是针对它们：

| 缺陷 | 对应写法 |
| --- | --- |
| 同一 shape 实例重复 `addShape` → 崩溃 | 重复执行命令时先 `remove()` 旧形状，`playerShapes` 按玩家 id 记账 |
| 形状列表为空时 `removeAll()` → 崩溃 | 只用逐个 `remove()`，从不用 `removeAll()` |
| 绘制代码被注释掉后热重载 → 崩溃 | 每个形状都设 `timeLeft`，脚本被热重载掉也自行到期 |

逐个 `remove()` 还顺带解决了另一个问题：`removeAll()` 会连带清掉其它插件画的形状。

## 为什么每个形状都设 `timeLeft`

`timeLeft` 是引擎侧的自动到期，不依赖本模组的脚本继续运行。这意味着：

- 脚本崩溃 → 形状照样按时消失
- 脚本热重载 → 形状照样按时消失
- 玩家登出再登入 → 形状已经过期，不会留一个删不掉的框

代价是形状无法"永久"存在。对开发期探针来说，秒数上限 120 秒已经够用。

## 部分失败要回滚

`debugDrawer.addShape` 可能在循环中途抛出（比如第 3 个形状参数非法）。这时前 2 个已经进了世界，如果不收回就会留下半个盒子。

`drawDebugBox` 因此把已加入的形状记在 `added` 里，catch 时整体 `removeShapes(added)` 再返回失败。**要么整个盒子出现，要么一个形状都不留。**

`/apitest:debugshow` 则是另一种策略：每个形状独立成败，单个失败只记进 `failed` 列表，其余照画。因为它的目的是"看哪些形状能用"，一个失败不该让整份清单都不显示。

## 为什么 `/apitest:debugshow` 也算功能

它是**版本探针**。模块版本与代码不匹配时（比如有人把 `package.json` 升到 1.26 但 `manifest.json` 还写 1.21.100），类型检查抓不到，游戏里也只会表现为"某条命令没反应"。把全部形状画一遍，少哪个一眼就能看出来。

清单里出现的形状必须与当前模块的类型定义一致。**新增形状时同步更新这份清单**，它就是文档。

## 参数用整数而非 `Location`

沿用 `BoxCommand.ts` 的既有结论：`Location` 参数在本项目的 `@minecraft/server 2.1.0` 上会导致整条命令不注册（命令从命令表里消失，无报错）。六个 `Integer` 参数稳定可用。

## 推迟到安全 tick

命令回调是受限上下文，`debugDrawer.addShape` 与 `sendMessage` 都要推迟。用 `runSafeDetached`，并在回调里重新判 `player.isValid`——玩家可能在推迟的那一 tick 内离线。
