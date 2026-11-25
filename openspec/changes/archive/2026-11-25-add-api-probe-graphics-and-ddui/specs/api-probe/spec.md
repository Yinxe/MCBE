## ADDED Requirements

### Requirement: 渲染类模块的探针须先报告渲染前提

当探针测试的模块改的是**渲染管线参数**而非世界状态时,探针 MUST 在输出任何测试读数之前,先报告当前的渲染前提是否满足,并明确说明前提不满足时读数是否仍可下结论。

理由是 `@minecraft/server-graphics` 的全部 112 个方法都作用于延迟渲染管线(Vibrant Visuals),而它要求客户端图形模式为 `Deferred`。非 `Deferred` 时 setter 往往不抛错、调用返回成功,但画面完全不变——**没有任何信号提示失败**。此时若不先声明前提,后续所有「设置成功」的读数都会误导读者。

探针 MUST 通过 `Player.graphicsMode` 读取图形模式,而非猜测或要求玩家自行确认。读取失败时 MUST 如实报告「无法读取」,不得假设为已满足。

#### Scenario: 图形模式为 Deferred

- **WHEN** 玩家图形模式为 `Deferred`,执行 `/apitest:graphics`
- **THEN** 探针第一节报告该模式
- **AND** 结论区说明「读数可以对照画面验证」

#### Scenario: 图形模式非 Deferred

- **WHEN** 玩家图形模式为 `Fancy`、`Simple` 或 `RayTraced`,执行 `/apitest:graphics`
- **THEN** 探针第一节报告实际模式并指出它不是 `Deferred`
- **AND** 明确说明「以下读数只证明调用成功,不证明渲染生效」
- **AND** 提示玩家到视频设置里改为鲜艳视觉后重跑

#### Scenario: 无法读取图形模式

- **WHEN** 读取 `Player.graphicsMode` 抛错(例如玩家已离线)
- **THEN** 探针如实报告「无法读取」,不得填充默认值
- **AND** 判定为不可下结论

### Requirement: 探针须覆盖参数的单值与关键帧两种形态

当被测方法的参数类型是「单值或关键帧表」的联合类型时,探针 MUST 分别验证两种形态,并在回执中写明本次实际传入的是哪一种。

理由是 `@minecraft/server-graphics` 的多个 setter 接受 `Record<number, T> | T`:

```ts
setSkyHorizonColor(color: Record<number, RGB> | RGB): void
```

关键帧表的键是时间点(0.0/1.0 为正午、0.25 日落、0.5 午夜、0.75 日出),这是唯一能让颜色随时间连续变化的 API——资源包只能给静态值。若探针只测单值,就无法回答「该版本是否支持关键帧」这个关键问题。

探针 MUST 在回执中区分「关键帧表(N 个时间点)」与「单色 rgb(...)」,否则无法判断引擎把联合类型当成了哪一种处理。

判定关键帧表 MUST NOT 仅凭「是对象」——颜色对象本身也是对象。判据 MUST 是「所有键都能解析成有限数字」。

#### Scenario: 单色写入

- **WHEN** 探针向 `setSkyHorizonColor` 传入单个颜色对象
- **THEN** 回执标注为「单色 rgb(...)」
- **AND** 说明画面应恒为一种颜色

#### Scenario: 关键帧表写入

- **WHEN** 探针传入含 4 个时间点的关键帧表
- **THEN** 回执标注为「关键帧表(4 个时间点)」
- **AND** 逐时间点列出对应颜色,便于对照画面
- **AND** 若调用抛错,说明该版本不支持关键帧

#### Scenario: 关键帧表被当成单值

- **WHEN** 关键帧表被接受但画面颜色恒定不变
- **THEN** 回执中的「若天空随时间变化则关键帧生效」一句提供判定依据
- **AND** 探针不得因调用未抛错就断言关键帧生效

#### Scenario: 单色不被误判为关键帧表

- **WHEN** 判断 `{ red: 1, green: 0, blue: 0 }` 是否为关键帧表
- **THEN** 判定结果为否(键 `red` 无法解析为数字)
- **AND** `{ 0: {...}, 0.25: {...} }` 判定结果为是

### Requirement: 探针入口须提供统一面板

当探针命令数量超过 6 条时,模组 MUST 提供一条统一的面板命令,把各探针做成可点击的入口,使开发者无需逐条敲命令。

理由是探针数量已达 14 条,逐条敲完整命令的成本过高,导致实际使用中只会跑其中一两条。面板能显著降低「把所有探针跑一遍」的门槛。

面板 MUST 使用 DDUI(`CustomForm`) 而非旧表单,因为 DDUI 的按钮回调执行后**表单保持打开**,支持连续点击;旧表单每次点击即关闭,需要反复重开。

需要在**受限上下文同步执行**的探针(如 `/apitest:debugcontext`)MUST NOT 放入面板,因为面板按钮回调不是该上下文,放进去会失去测试意义。

#### Scenario: 打开面板

- **WHEN** 玩家执行 `/apitest:panel`
- **THEN** 打开一个 DDUI 表单,列出各探针按钮与说明提示
- **AND** 顶部有一行状态,显示上次执行的探针

#### Scenario: 连续点击多个探针

- **WHEN** 玩家在面板上依次点击多个探针按钮
- **THEN** 每次点击后表单保持打开
- **AND** 各探针结果依次输出到聊天栏
- **AND** 状态行更新为最近一次执行的探针

#### Scenario: 受限上下文探针不在面板中

- **WHEN** 检查面板按钮清单
- **THEN** `/apitest:debugcontext` 不在其中
- **AND** 它保留为独立命令,以便在命令回调的受限上下文里同步执行

### Requirement: 面板须遵守 DDUI 的可见性与忙碌约束

面板 MUST 在安全上下文构造与展示:`CustomForm` 的构造器不受限,但 `.label()` / `.button()` / `.show()` 全部属于受限成员。

面板 MUST NOT 在按钮回调中直接 `show()` 新表单,否则会以 `UserBusy` 失败且不抛异常。探针输出走聊天栏、不换面板,因此天然满足该约束。

面板 MUST 检查 `show()` 的 resolve 值,并在 `UserBusy` 时明确告知玩家,不得静默失败。

#### Scenario: 已有面板时再次打开

- **WHEN** 面板已打开时再次执行 `/apitest:panel`
- **THEN** 先关闭旧面板再打开新面板
- **AND** 不出现 `UserBusy` 导致的「点了没反应」

#### Scenario: 面板因玩家忙碌未能显示

- **WHEN** 玩家正在操作另一个界面,面板 `show()` 以 `UserBusy` resolve
- **THEN** 明确提示玩家「面板没能显示:你正在操作另一个界面」
- **AND** 不得静默丢弃该结果

#### Scenario: 关闭面板

- **WHEN** 玩家点击「关闭面板」按钮
- **THEN** 表单关闭并清理登记表
- **AND** `close()` 前先判 `isShowing()`,避免 `FormVisibilityError`
