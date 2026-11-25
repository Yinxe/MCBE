# Spec Delta

## MODIFIED Requirements

### Requirement: 命令无需作弊且不引入实验性功能

命令 MUST 声明为不需要作弊(`cheatsRequired: false`),权限等级 MUST 为操作员/游戏导演级别。模组 MUST NOT 依赖任何实验性(experimental)能力。

模组 MAY 依赖 `@minecraft/debug-utilities` 这类 beta 模块,但 MUST 在 README 首屏明确写出「需开启 Beta APIs 实验开关」,并 MUST 说明未开启时整个脚本模块都会加载失败。依赖 beta 模块 MUST NOT 成为模组唯一形态:不依赖 beta 的探针能力 MUST 保持可用性说明。

#### Scenario: 未开作弊的世界可用

- **WHEN** 在关闭世界作弊、由操作员执行命令
- **THEN** 命令可正常执行并展示容器信息

#### Scenario: 普通玩家被拒绝

- **WHEN** 非操作员玩家执行该命令
- **THEN** 命令被拒绝执行,不展示任何容器信息

#### Scenario: beta 依赖在文档中前置声明

- **WHEN** 使用者打开 `mods/api-probe/README.md`
- **THEN** 首屏即能看到「需开启 Beta APIs 实验开关」以及未开启时整包不加载的后果

### Requirement: 运行时只依赖官方 Script API 模块

模组 MUST 只把官方 `@minecraft/*` 模块作为运行时依赖,MUST NOT 引入任何第三方运行时库。打包产物的外部模块引用 MUST 只包含官方模块,且 MUST 与行为包清单声明的模块依赖集合一致。

#### Scenario: 产物无第三方引用

- **WHEN** 检查该模组的构建产物
- **THEN** 外部模块导入全部来自 `@minecraft/*`,不存在第三方库

#### Scenario: 产物引用与清单依赖一致

- **WHEN** 对比构建产物的外部模块导入与行为包清单的 `dependencies`
- **THEN** 两侧的 `@minecraft/*` 模块集合完全相同

## ADDED Requirements

### Requirement: 按两个方块角点绘制调试线框

模组 MUST 注册一条自定义命令,接受两个方块角点坐标,用 `@minecraft/debug-utilities` 的 `debugDrawer` 在该区域上绘制 3D 线框。线框 MUST 包含盒体、最小角的三色坐标轴与一个尺寸文字。角点的传入顺序 MUST 无关。

框住的范围 MUST 与粒子版框选一致,即每轴边长 MUST 为 `|Δ| + 1`。命令 MUST 接受可选的存活秒数与尺寸系数,两者 MUST 有合法区间并被夹取。

#### Scenario: 按两角点画线框

- **WHEN** 玩家执行 `/apitest:debugbox 100 64 -20 109 71 -11`
- **THEN** 画出 `10×8×10` 的线框,回执写出尺寸、体积、两个角点与形状数量

#### Scenario: 角点顺序无关

- **WHEN** 玩家把同一条命令的两个角点顺序对调后执行
- **THEN** 画出完全相同的线框

#### Scenario: 三色轴从最小角出发

- **WHEN** 观察绘制出的线框
- **THEN** 最小角处沿 X、Y、Z 的三条线分别为红、绿、蓝

#### Scenario: 尺寸文字标注边长

- **WHEN** 观察绘制出的线框
- **THEN** 盒体上方有文字写出该框的三轴边长

#### Scenario: 尺寸系数用于现场标定

- **WHEN** 玩家传入第二个可选参数(尺寸系数)
- **THEN** 该系数只缩放盒体大小,不改变盒体中心位置与三色轴起点

### Requirement: 调试线框提供形状可用性探针

模组 MUST 注册一条命令,在当前模块版本支持的每种调试形状各画一份,并 MUST 在回执中逐个列出成功与失败的形状名。该清单 MUST 与所用模块版本的类型定义一致。

#### Scenario: 逐形状列出成败

- **WHEN** 玩家执行形状探针命令
- **THEN** 回执列出每个形状的绘制结果,单个形状失败不影响其余形状

#### Scenario: 可立即清除

- **WHEN** 玩家执行清除命令
- **THEN** 本模组绘制的全部形状立即消失,且不影响其它插件绘制的形状

### Requirement: 调试线框的绘制须规避引擎已知缺陷

绘制实现 MUST 规避以下已知行为:同一形状实例重复加入 MUST 被避免、形状集合为空时 MUST NOT 调用全量清除、每个形状 MUST 设置存活时间以便脚本中断后自行到期。部分形状加入失败时 MUST 回滚已加入的形状。

#### Scenario: 重复执行不崩溃

- **WHEN** 玩家连续执行两次框选命令
- **THEN** 旧线框被移除后画新的,不因重复加入同一实例而崩溃

#### Scenario: 脚本中断后自行到期

- **WHEN** 脚本在世界仍有线框时被热重载或崩溃
- **THEN** 已绘制的形状仍按各自存活时间到期消失

#### Scenario: 部分失败不留半个线框

- **WHEN** 绘制过程中某个形状加入失败
- **THEN** 已加入的形状被移除,世界上不残留半个线框

### Requirement: 调试线框只读不写世界

绘制 MUST 只通过客户端渲染层实现,MUST NOT 放置或修改任何方块,MUST NOT 写动态属性,MUST NOT 需要事后还原。形状 MUST NOT 持久化到存档。

#### Scenario: 绘制不改变世界

- **WHEN** 玩家执行框选命令后检查该区域
- **THEN** 方块没有任何变化,线框到时间自行消失

#### Scenario: 重载后不残留

- **WHEN** 世界重载或玩家重新进入维度
- **THEN** 此前的调试线框不会恢复,也不存在删不掉的残留形状
