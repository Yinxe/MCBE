# Spec Delta

## Purpose

定义开发期 API 探针模组的行为契约:一条带坐标参数的自定义命令读取该坐标方块的容器真实 Script API 数据,并用表单 UI 把槽位、物品与空槽统计原样呈现给开发者核对,同时保证探针本身不改变世界状态、不影响正常玩法。

## ADDED Requirements

### Requirement: 命令按传入坐标读取容器

模组 MUST 注册一条自定义命令,接受三个必填坐标参数(x、y、z),读取该坐标处方块上的容器。坐标 MUST 按方块坐标取整处理。维度 MUST 取执行者所在维度,命令 MUST NOT 提供维度参数。

#### Scenario: 读取指定坐标的箱子

- **WHEN** 玩家对一个 27 槽、其中 5 槽有物品的箱子执行 `/apitest:container 100 64 -20`
- **THEN** 读取的是该坐标的箱子容器,表单显示总槽位 27、空槽 22,并列出 5 条非空槽位条目

#### Scenario: 小数坐标按方块取整

- **WHEN** 玩家传入 `100.7 64.2 -20.9` 这样的非整数坐标
- **THEN** 按所在方块取整读取,不因小数部分报错

#### Scenario: 维度跟随执行者

- **WHEN** 玩家站在下界对同一组坐标执行命令
- **THEN** 读取的是下界该坐标的方块,而不是主世界同名坐标的方块

#### Scenario: 缺少坐标参数

- **WHEN** 玩家执行命令时未给出完整的三个坐标
- **THEN** 命令被游戏拒绝执行(参数为必填),模组不读取任何容器

### Requirement: 目标方块无容器须给出明确提示

当目标坐标的方块没有容器组件时,模组 MUST 向执行者给出可读的失败提示,MUST NOT 静默返回成功,也 MUST NOT 抛出未捕获异常。

#### Scenario: 目标为石头

- **WHEN** 玩家对一块石头的坐标执行命令
- **THEN** 玩家收到「该方块没有容器」类提示,表单不打开

#### Scenario: 目标坐标无方块

- **WHEN** 目标坐标为空气或超出世界高度
- **THEN** 玩家收到可读的失败提示,不产生未捕获异常

#### Scenario: 目标方块已被破坏

- **WHEN** 读取时该坐标的方块已不存在或容器已失效
- **THEN** 玩家收到可读的失败提示,命令不静默成功

### Requirement: 容器信息以表单 UI 呈现

模组 MUST 用官方 UI 模块的表单把容器信息呈现给执行者。表单 MUST 至少展示容器总槽位数、空槽数量,以及**每个非空槽位一行**的条目,条目内容 MUST 包含槽位下标、物品标识与堆叠数量。

#### Scenario: 条目含槽位下标

- **WHEN** 容器的第 0 槽与第 13 槽各有一组物品
- **THEN** 两条条目的文本分别以 `0` 与 `13` 标明槽位下标,可据此与游戏内槽位对照

#### Scenario: 容器全空

- **WHEN** 被读取的容器没有任何物品
- **THEN** 表单仍然打开,显示总槽位数、空槽数等于总槽位数,并明确说明没有非空槽位

#### Scenario: 容器槽位数随类型变化

- **WHEN** 分别读取箱子(27 槽)与大型箱子(54 槽)
- **THEN** 表单展示的总槽位数分别为 27 与 54,取自容器自身而非写死的常量

### Requirement: 逐槽位查看物品详情

表单中每个非空槽位 MUST 可被点击,点击后 MUST 打开一个详情表单,展示该槽位物品的标识、数量与 NBT 序列化文本。

#### Scenario: 查看某槽位详情

- **WHEN** 玩家在容器表单中点击第 3 槽的条目
- **THEN** 打开详情表单,显示该物品的标识、数量与其 NBT 序列化文本

#### Scenario: 物品无额外数据

- **WHEN** 被查看的物品没有任何附加 NBT 数据
- **THEN** 详情表单明确显示「无额外数据」,不显示空字符串或 `undefined`

#### Scenario: NBT 序列化抛错

- **WHEN** 某个物品的 NBT 序列化抛错
- **THEN** 该槽位的详情降级为「无法序列化」提示,其余槽位仍可正常查看

### Requirement: 探针只读不写世界

模组 MUST NOT 对容器做任何写入操作(增删物品、清空、改槽位),MUST NOT 修改世界游戏规则、玩家状态或方块状态。命令的全部效果 MUST 限于向执行者展示信息。

#### Scenario: 执行后容器不变

- **WHEN** 玩家对箱子执行命令并关闭表单
- **THEN** 箱子内物品的种类、数量与槽位分布与执行前完全一致

#### Scenario: 不修改世界设置

- **WHEN** 对比启用模组前后的世界游戏规则与作弊开关
- **THEN** 两者均未改变

### Requirement: 命令回调中的受限操作须推迟到安全上下文

自定义命令的回调是受限上下文,模组 MUST 把读取容器与打开表单的操作推迟到安全上下文执行,MUST NOT 在回调内直接调用受限 API。

#### Scenario: 表单确实打开

- **WHEN** 玩家执行命令
- **THEN** 表单确实弹出,而不是命令返回成功但界面未出现

#### Scenario: 执行者在推迟期间离线

- **WHEN** 玩家执行命令后立刻断线
- **THEN** 打开表单的尝试被安全跳过,不向已离线玩家写入,也不抛出未捕获异常

### Requirement: 命令无需作弊且不引入实验性功能

命令 MUST 声明为不需要作弊(`cheatsRequired: false`),权限等级 MUST 为操作员/游戏导演级别。模组 MUST NOT 依赖任何实验性(experimental)能力,也 MUST NOT 要求开启 Beta APIs 开关。

#### Scenario: 未开作弊的世界可用

- **WHEN** 在关闭世界作弊、由操作员执行命令
- **THEN** 命令可正常执行并展示容器信息

#### Scenario: 普通玩家被拒绝

- **WHEN** 非操作员玩家执行该命令
- **THEN** 命令被拒绝执行,不展示任何容器信息

### Requirement: 运行时只依赖官方 Script API 模块

模组 MUST 只把 `@minecraft/server` 与 `@minecraft/server-ui` 作为运行时依赖,MUST NOT 引入任何第三方运行时库。打包产物的外部模块引用 MUST 只有这两个官方模块。

#### Scenario: 产物无第三方引用

- **WHEN** 检查该模组的构建产物
- **THEN** 除 `@minecraft/server` 与 `@minecraft/server-ui` 外不存在其它外部模块导入

### Requirement: 模组按仓库脚手架约定构建与登记

模组 MUST 位于 `mods/api-probe/`,包名 MUST 为 `@mc-toolchain/api-probe`,初始版本 MUST 为 `0.0.1`,产物 MUST 输出到仓库根 `release/`。模组 MUST 出现在 `mods/README.md` 与根 `README.md` 的模组表中。

#### Scenario: 打包产物落在 release

- **WHEN** 在模组目录执行 `npm run pack`
- **THEN** 产物为 `release/api-probe-v0.0.1_bp.mcpack`

#### Scenario: 文档清单与目录一致

- **WHEN** 对比 `mods/` 下的实际目录与两处 README 的模组表
- **THEN** `api-probe` 同时出现在目录与两张表中

### Requirement: 模组须标注为开发期探针

模组 README MUST 在开头明确声明这是开发期探针、不面向正式世界使用,并 MUST 给出命令用法与参数含义的说明。

#### Scenario: 读者仅看 README 就知用途

- **WHEN** 使用者打开 `mods/api-probe/README.md`
- **THEN** 首段即说明这是开发期探针,随后给出命令名、坐标参数含义与维度跟随执行者的规则
