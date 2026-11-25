## MODIFIED Requirements

### Requirement: 命令按传入坐标读取容器

模组 MUST 注册一条自定义命令,接受**一个必填的 `Location` 参数**作为目标坐标,读取该坐标处方块上的容器。坐标 MUST 按方块坐标取整(`Math.floor`)处理。维度 MUST 取执行者所在维度,命令 MUST NOT 提供维度参数。

命令参数 MUST 使用 `CustomCommandParamType.Location`,而非三个独立的 `Integer` 参数。理由是 `Location` 支持「望准方块」取点与 `~` 相对坐标,而三个整数只能手敲。

模组 MUST NOT 依据类型定义推断 `Location` 参数运行时的形状:该参数在 `@minecraft/server` 的类型定义中缺少配套的 `Location` 类(文档注释引用的 `@minecraft/server.Location` 并不存在),运行时实际传入的是 `{ x, y, z }` 对象,不带维度信息,且不保证为整数。

#### Scenario: 读取指定坐标的箱子

- **WHEN** 玩家对一个 27 槽、其中 5 槽有物品的箱子执行 `/apitest:container 100 64 -20`
- **THEN** 读取的是该坐标的箱子容器,表单显示总槽位 27、空槽 22,并列出 5 条非空槽位条目

#### Scenario: 小数坐标按方块取整

- **WHEN** 玩家传入 `100.7 64.2 -20.9` 这样的非整数坐标
- **THEN** 按 `Math.floor` 取整读取(100.7 → 100,64.2 → 64,-20.9 → -21),不因小数部分报错

#### Scenario: 负坐标不向零截断

- **WHEN** 玩家传入 `-0.1` 作为某一坐标分量
- **THEN** 取整结果为 `-1`(该分量所在方块),而非 `0`

#### Scenario: 维度跟随执行者

- **WHEN** 玩家站在下界对同一组坐标执行命令
- **THEN** 读取的是下界该坐标的方块,而不是主世界同名坐标的方块

#### Scenario: 缺少坐标参数

- **WHEN** 玩家执行命令时未给出目标坐标
- **THEN** 命令被游戏拒绝执行(参数为必填),模组不读取任何容器

## ADDED Requirements

### Requirement: 调试形状的颜色构造须兼容 RGB 与 RGBA 两种运行时结构

模组 MUST 在构造调试形状的颜色对象时**总是**带上 `alpha` 分量,不得只按类型定义构造三分量 `RGB` 对象。

`RGBA extends RGB`,因此四分量是两版运行时都接受的超集写法:老引擎忽略多余的 `alpha`,新引擎正需要它。

`alpha` 的补齐 MUST 使用空值合并(`??`)而非逻辑或(`||`),以保证 `alpha = 0`(全透明)这一合法值不被误判为缺失。

模组 MUST NOT 在读取颜色时补齐 `alpha`:读回值是否包含 `alpha` 是判定运行时结构的直接证据。

#### Scenario: 三分量输入自动补齐 alpha

- **WHEN** 代码以 `{ red, green, blue }` 构造颜色并赋给 `DebugShape.color`
- **THEN** 实际赋给引擎的对象包含 `alpha = 1`

#### Scenario: alpha 为 0 时不被覆盖

- **WHEN** 代码显式传入 `alpha: 0`
- **THEN** 赋给引擎的 `alpha` 为 `0`,不被替换为默认值 `1`

#### Scenario: 读回值如实反映运行时结构

- **WHEN** 探针读取 `DebugShape.color`
- **THEN** 读回对象含 `alpha` 时按 `rgba(r, g, b, a)` 输出,不含时按 `rgb(r, g, b)` 输出,不补默认值

#### Scenario: 颜色探针对比三分量与四分量

- **WHEN** 玩家执行 `/apitest:debugshape`
- **THEN** 探针并排画出三个盒子:三分量旧写法(预期抛错并提及 `alpha`)、四分量 `alpha=1`、四分量 `alpha=0.35`,用于判定运行时结构与 `alpha` 是否真的影响透明度

### Requirement: 坐标类命令参数须使用 Location 类型

模组中凡表示**世界坐标**的命令参数 MUST 使用 `CustomCommandParamType.Location`,不得拆成多个 `CustomCommandParamType.Integer`。

适用范围:`/apitest:container`、`/apitest:box`、`/apitest:debugbox`。

不适用范围:表示**数量**或**开关**的参数(如 `/apitest:debuglimits` 的 `count`、`/apitest:debugwatchdog` 的 `disable`),它们 MUST 保持 `Integer`——`Location` 对非坐标语义无意义。

模组 MUST 在代码中显式声明 `Location` 参数运行时的形状为 `{ x, y, z }`,并 MUST NOT 假装存在可导入的 `Location` 类型。所有坐标取整 MUST 遵循同一规则(`Math.floor`),不得出现不同命令使用不同取整方式的情况。

#### Scenario: 三条坐标命令均使用 Location

- **WHEN** 检查打包产物中 `/apitest:container`、`/apitest:box`、`/apitest:debugbox` 的参数定义
- **THEN** 坐标参数类型均为 `CustomCommandParamType.Location`

#### Scenario: 数量与开关参数仍为 Integer

- **WHEN** 检查 `/apitest:debuglimits` 与 `/apitest:debugwatchdog` 的参数定义
- **THEN** 参数类型为 `CustomCommandParamType.Integer`,未被误改为 `Location`

#### Scenario: 望准方块取点可用

- **WHEN** 玩家站在某方块前,用「望准方块」方式填入 `/apitest:box` 的角点参数
- **THEN** 命令接受该坐标并画出对应的线框

#### Scenario: 相对坐标可用

- **WHEN** 玩家用 `~ ~ ~` 形式的相对坐标作为角点参数
- **THEN** 引擎解析为绝对坐标后命令正常工作

#### Scenario: 取整规则一致

- **WHEN** 同一组小数坐标分别传给三条坐标命令
- **THEN** 三条命令落到同一个方块(`Math.floor` 语义),不出现一条 floor、另一条 round 的差异
