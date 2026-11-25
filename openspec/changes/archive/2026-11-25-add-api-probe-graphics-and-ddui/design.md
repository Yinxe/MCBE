# Design: server-graphics 探针与 DDUI 面板

## 一、为什么必须先报告图形模式

`@minecraft/server-graphics` 全部 112 个方法改的是**延迟渲染管线参数**。文档里 45 处提到 Vibrant Visuals（鲜艳视觉），而它要求客户端把图形模式设为 `Deferred`。

三种图形模式（`@minecraft/server` 的 `GraphicsMode` 枚举）：

| 枚举值 | 含义 | graphics 模块是否生效 |
| --- | --- | --- |
| `Deferred` | 延迟渲染（= 鲜艳视觉） | **是** |
| `Fancy` | 精美 | 否 |
| `Simple` | 简单 | 否 |
| `RayTraced` | 光线追踪 | 否 |

非 `Deferred` 时的失败模式极其隐蔽：

1. `setSkyHorizonColor(...)` 不抛错；
2. 读回值正确（因为模块没有 getter，连读回都做不到）；
3. **画面完全不变**。

也就是说，调用方拿到「成功」的结果，玩家看到「没变化」，而中间没有任何信号。这比 `debug-utilities` 的「写入 ≠ 渲染」更危险——后者至少画面可能变，前者可能永远不变。

所以 `probePrecondition()` 放在最前面，并且：

- 用 `Player.graphicsMode` 读取（这个属性在 `@minecraft/server` 里，不需要 graphics 模块）；
- 读取失败时返回 `undefined` 而不是猜一个值——探针宁可说「不知道」；
- 判定结果影响最后的总结论：非 `Deferred` 时明确写「读数只证明调用成功、不证明渲染生效」。

`vibrantVisualsVerdict()` 是纯函数，可单测。它对三种输入分别给结论：`Deferred` 可下结论、其它模式不可下结论、`undefined` 如实说无法读取。

## 二、关键帧表：这个模块最独特的设计

`setSkyHorizonColor` 等方法的参数类型是联合类型：

```ts
setSkyHorizonColor(color: Record<number, RGB> | RGB): void
```

- 传单个 `RGB` → 全时段同色；
- 传 `Record<number, RGB>` → 关键帧表，键是时间点（0~1）。

时间点语义（取自 doc block）：

| 键 | 含义 |
| --- | --- |
| `0.0` 和 `1.0` | 正午 |
| `0.25` | 日落 |
| `0.5` | 午夜 |
| `0.75` | 日出 |

这是**唯一能让颜色随时间连续变化的 API**。资源包只能给静态值，`@minecraft/server` 完全没有。

探针分三小节验证：

1. **单色**：传 `{red:1, green:0, blue:1}`（品红，与默认天空色差异极大）；
2. **关键帧**：传 4 个时间点的对比色。若抛 `InvalidArgumentError`，说明该版本不支持关键帧；
3. **reset**：验证退回的是资源包设定值而非硬编码默认值。

关键观察点：**引擎是否接受关键帧表**。如果接受但画面恒定一色，说明被当成单值处理了。

## 三、单值 vs 关键帧表的运行时判定

类型上是 `T | Record<number, T>`，运行时必须靠结构判断。坑在于**颜色对象本身也是对象**：

```ts
{ red: 1, green: 0, blue: 0 }   // 单色
{ 0: {...}, 0.25: {...} }        // 关键帧表
```

`isKeyframeTable()` 的判据是「所有键都能解析成有限数字」：

- `{red, green, blue}` 的键是 `"red"` 等，`Number("red")` 是 `NaN` → 不是关键帧 ✓
- `{0, 0.25}` 的键是数字形字符串 → 是关键帧 ✓
- `{}` 空对象 → 不是（避免误判）
- `0.5` / `"abc"` 非对象 → 不是

`describeSetterArgument()` 把它翻译成回执文本，让玩家能确认「我们真的传了关键帧表」。这一点重要：如果回执只写「setSkyHorizonColor 成功」，无法区分是单值还是关键帧生效。

## 四、set / reset 配对：reset 退回什么

`reset*` 方法不是「退回硬编码默认值」，而是**退回资源包/行为包设定的值**。doc block 原文：

> Resets the horizon blend max to the value set by resource packs or via the 'setHorizonBlendMax' API in behavior packs

这个差异对调用方影响很大：如果资源包设了天空色，`reset` 会回到那个色而不是原版色。探针必须如实说明这个前提。

`describeSetReset()` 把四种组合分别翻译：

| set | reset | 结论 |
| --- | --- | --- |
| ✓ | ✓ | 两者均成功 |
| ✓ | ✗ | set 成功但 reset 抛错，状态可能残留 |
| ✗ | ✓ | set 抛错但 reset 成功，检查参数范围 |
| ✗ | ✗ | 该组方法在此环境不可用 |

第三种组合最容易被忽略：set 失败了，但 reset 成功——说明对象拿得到、方法存在，只是参数不被接受。

## 五、参数越界：夹取还是抛错

类型定义给了明确范围（如 `blendMax` 是 `[0,1]`），但**没说越界会抛错还是静默夹取**。这个差异对调用方影响很大：

- 抛错 → 调用方必须自己防；
- 夹取 → 意图被静默改变，`setHorizonBlendMax(5)` 实际设成 1。

探针传三个值（0.5 / 5 / -5）实测。全部「接受」说明引擎静默夹取；越界抛错说明要调用方自己防。

## 六、DDUI 面板：为什么用 CustomForm

已有 12 条探针命令，每条都要完整敲一遍。DDUI 正好解决这个痛点，因为它的行为与旧表单**相反**：

| | 旧表单 | DDUI `CustomForm` |
| --- | --- | --- |
| 点按钮 | 表单关闭 | **保持打开** |
| 回调 | 无（`show()` 统一 resolve） | 每个按钮挂 `onClick` |
| 连续操作 | 每次重开 | 可连续点 |

「保持打开」正是需要的：连续点多个探针，不必每次重开面板。

### 绕开 UserBusy

代价是：**在按钮回调里直接开新表单会以 `UserBusy` 失败**——当前表单还开着，玩家仍处于「UI 交互中」。

本实现从根上避开这个坑：**探针只往聊天栏输出，不换面板**。所以按钮回调里根本不需要 `show()` 新表单，也就不可能撞上 `UserBusy`。

只有「关闭面板」按钮走 `close()`，那是终结操作。

### 权限：全部推迟到安全 tick

`CustomForm` 的构造器**不受限**，但 `.label()` / `.button()` / `.show()` 全部标注 `can't be called in restricted-execution mode`。这个差异很容易踩：能在受限上下文 `new CustomForm(...)`，下一行 `.label()` 就抛错。

所以 `showProbePanel()` 整个在 `runSafeDetached` 的安全上下文里调用。

按钮回调里的探针执行再套一层 `system.run()`：按钮回调的权限语义在文档里没有明确说明（`ddui-behavior.md` §5.1 只有实测推断），而所有探针都要调受限成员。多推迟一层成本极低，且 DDUI 不会因此关闭表单。

### 登记表与清理

`CustomForm` 实例不知道自己属于哪个玩家，只能按 `playerId` 记一张表：

```ts
const openForms = new Map<string, CustomForm>();
```

用途有二：

1. 换面板前先关旧的，避免 `UserBusy`；
2. 玩家离线时清理，防止泄漏。

`closePanel()` 在 `close()` 前先判 `isShowing()`——`close()` 在非显示状态抛 `FormVisibilityError`。

### show() 的返回值必须检查

`show()` 不抛异常，只 resolve 一个 `DataDrivenScreenClosedReason`。若调用方不看这个值，「面板没弹出来」会被完全忽略。所以 `UserBusy` 时明确告诉玩家「你正在操作另一个界面」。

### debugcontext 为什么不在面板里

`/apitest:debugcontext` 的实验本体**必须**在命令回调（受限上下文）里同步执行，否则测的就不是受限上下文了。面板按钮的回调不是那个上下文，放进去会失去意义。所以它保留为独立命令。

## 七、升级带来的破坏性变更

`@minecraft/debug-utilities` 从 `1.21.100-stable` 升到 `1.21.130-stable`，发现一处破坏性变更：

| 成员 | 1.21.100 | 1.21.130 |
| --- | --- | --- |
| `DebugShape.location` | 可写 | **readonly** |
| `DebugShape.setLocation()` | 无 | 新增 |
| `DebugShape.dimension` | 无 | 新增（只读） |
| `DebugDrawer.addShape()` | `(shape)` | `(shape, dimension?)` |

`DebugMotionProbe.ts` 第 2 步原本写 `box.location = moved`，升级后编译失败。改为 `box.setLocation(moved)`。

这个变更本身很有价值——它说明「1.21.100 上能写 location」这个结论在升级后不再成立。探针的注释已记下这一点。

## 八、测试

新增 14 项断言（`GraphicsProbeMath.test.mjs`），重点钉住：

- 关键帧排序：`0.25` / `0.5` 这类非整数键在 JS 里按插入序枚举，探针要展示时间轴必须显式排序
- 单色不被误判为关键帧表：颜色对象的键是 `red`/`green`/`blue`，`Number("red")` 是 `NaN`
- 空对象 / 非对象都不是关键帧表
- 时间点翻译：四个标准点各有名字，其它如实说「自定义」
- `vibrantVisualsVerdict`：**非 Deferred 的三个模式全部判为不可下结论**，且消息里含「不证明」
- `undefined` 如实说「无法读取」
- set/reset 四种组合各有不同结论

其中「非 Deferred 判为不可下结论」那组用循环覆盖 `Fancy` / `Simple` / `RayTraced`，防止将来只改了一个分支。

总计 42 → **55** 项。
