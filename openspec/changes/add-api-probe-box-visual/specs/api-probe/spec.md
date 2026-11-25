# Spec Delta

## MODIFIED Requirements

### Requirement: 模组按仓库脚手架约定构建与登记

模组 MUST 位于 `mods/api-probe/`,包名 MUST 为 `@mc-toolchain/api-probe`,产物 MUST 输出到仓库根 `release/`。模组 MUST 同时含行为包与资源包,产物形态 MUST 为 `.mcaddon`。模组 MUST 出现在 `mods/README.md` 与根 `README.md` 的模组表中。

#### Scenario: 打包产物落在 release

- **WHEN** 在模组目录执行 `npm run pack`
- **THEN** 产物为 `release/api-probe-v<版本>.mcaddon`,其中同时含行为包与资源包

#### Scenario: 行为包依赖资源包

- **WHEN** 检查打包产出的行为包清单
- **THEN** 其中声明了对本模组资源包的依赖,版本与资源包清单一致

#### Scenario: 文档清单与目录一致

- **WHEN** 对比 `mods/` 下的实际目录与两处 README 的模组表
- **THEN** `api-probe` 同时出现在目录与两张表中

## ADDED Requirements

### Requirement: 按两个方块角点绘制 3D 框选线框

模组 MUST 注册一条自定义命令,接受两个方块角点坐标,在该区域上绘制由粒子构成的 3D 线框。线框 MUST 包含区域的外表面与棱线,并 MUST 在最小角处用三色轴标出坐标朝向。角点的传入顺序 MUST 无关。

框住的范围 MUST 是两角点所覆盖的全部方块,即每轴边长 MUST 为 `|Δ| + 1`。命令 MUST 接受一个可选的存活秒数参数,缺省值 MUST 为 10 秒,且 MUST 有上限。

#### Scenario: 按两角点框出区域

- **WHEN** 玩家执行 `/apitest:box 100 64 -20 109 71 -11`
- **THEN** 绘制一个 `10×8×10` 的线框,回执写出尺寸、体积与两个角点

#### Scenario: 角点顺序无关

- **WHEN** 玩家把同一条命令的两个角点顺序对调后执行
- **THEN** 画出完全相同的线框

#### Scenario: 可指定存活秒数

- **WHEN** 玩家在命令末尾追加 `30`
- **THEN** 线框存活 30 秒后消失,而不是缺省的 10 秒

#### Scenario: 存活秒数有上限

- **WHEN** 玩家传入一个超过上限的秒数
- **THEN** 按上限绘制,不把粒子留在世界上一整天

#### Scenario: 最小角标出三色轴

- **WHEN** 观察绘制出的线框
- **THEN** 最小角处沿 X、Y、Z 的三条棱线分别为红、绿、蓝

### Requirement: 线框绘制只读不写世界

绘制 MUST 只通过粒子实现,MUST NOT 放置或修改任何方块,MUST NOT 写动态属性,MUST NOT 需要事后还原。绘制 MUST NOT 引入逐帧驱动循环。

#### Scenario: 绘制不改变世界

- **WHEN** 玩家在任意区域执行框选命令后检查该区域
- **THEN** 方块没有任何变化,线框到时间自行消失

#### Scenario: 单次调用完成绘制

- **WHEN** 检查框选命令的执行路径
- **THEN** 绘制只发生在一个 `spawnParticle` 调用里,不存在持续运行的定时器在逐帧重绘

### Requirement: 框选不可绘制时给出可读提示

当区域单边超过可绘制上限,或绘制因区块未加载而失败时,模组 MUST 向执行者给出可读提示,MUST NOT 抛出未捕获异常,MUST NOT 静默失败。

#### Scenario: 单边超上限

- **WHEN** 玩家给出的两角点使某轴边长超过上限
- **THEN** 玩家收到「超过上限,拒绝绘制」类提示,不绘制任何粒子

#### Scenario: 区块未加载

- **WHEN** 目标区域所在区块尚未加载导致粒子生成失败
- **THEN** 玩家收到可读的失败提示,命令不静默成功

### Requirement: 线框依赖的资源包内容须与脚本变量名一致

资源包 MUST 提供绘制所需的驱动粒子、面片子粒子、棱线子粒子、自定义材质与贴图。驱动粒子读取的变量名 MUST 与脚本侧注入的变量名完全一致,且 MUST 全部为独立标量而非结构体字段。

#### Scenario: 脚本注入的变量都被驱动粒子读取

- **WHEN** 对比脚本侧注入的变量名与驱动粒子声明读取的变量名
- **THEN** 两侧集合完全相同,不存在任一侧多余的变量

#### Scenario: 变量不使用结构体字段

- **WHEN** 检查驱动粒子在 sequence 中暂存父级取值的写法
- **THEN** 暂存变量均为独立标量,不存在 `t.<name>.<component>` 形式的访问
