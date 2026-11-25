# api-probe Specification

## Purpose

定义开发期 API 探针模组的行为契约:带坐标参数的自定义命令读取该坐标方块的容器真实 Script API 数据,并用表单 UI 把槽位、物品与空槽统计原样呈现给开发者核对;另有两条框选绘制命令把坐标范围在世界上画出来(粒子版与调试线框版并存),以及一条把调试形状逐个画出来的可用性探针。模组整体保证不改变世界状态、不影响正常玩法。

## Requirements

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

### Requirement: 模组须标注为开发期探针

模组 README MUST 在开头明确声明这是开发期探针、不面向正式世界使用,并 MUST 给出命令用法与参数含义的说明。

#### Scenario: 读者仅看 README 就知用途

- **WHEN** 使用者打开 `mods/api-probe/README.md`
- **THEN** 首段即说明这是开发期探针,随后给出命令名、坐标参数含义与维度跟随执行者的规则

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

此外,模组 MUST 提供逐参数探明命令,把文档未写清的形状参数（`DebugBox.bound` 口径、`scale` 作用、`rotation` 分量含义、`color` 是否夹取）用并排摆放多个变体的方式让差异自显,而不是靠文字推测。

#### Scenario: 逐形状列出成败

- **WHEN** 玩家执行形状探针命令
- **THEN** 回执列出每个形状的绘制结果,单个形状失败不影响其余形状

#### Scenario: 可立即清除

- **WHEN** 玩家执行清除命令
- **THEN** 本模组绘制的全部形状立即消失,且不影响其它插件绘制的形状

#### Scenario: 逐参数探明

- **WHEN** 玩家执行逐参数探针命令
- **THEN** 每项探针报告「写入值」与「读回值」两项
- **AND** 对口径未定的参数,并排摆放多个变体供视觉比对
- **AND** 每项探针写明「预期看到什么」,使玩家对照画面即可下结论

### Requirement: 探针须区分「写入成功」与「渲染生效」

探针 MUST 把「JS 侧 setter 存下了值」与「渲染器读了这个值」当成两件不同的事分别验证,不得因读回一致就断言参数生效。

#### Scenario: 静态探针只证明第一层

- **WHEN** 探针写入某属性并读回一致
- **THEN** 回执 MUST 明确说明这只证明 JS 侧写入成功
- **AND** MUST 指出渲染是否生效需另行观察画面

#### Scenario: 动态探针验证第二层

- **WHEN** 玩家执行动态探针命令
- **THEN** 探针 MUST 先画出一个形状,再跨多个 tick 改写属性并采样回执
- **AND** 每一步 MUST 写明「该看到什么」,供玩家对照画面判定
- **AND** 采样窗口 MUST 严格短于该形状的存活期,避免到期后触碰句柄

### Requirement: 探针须覆盖模块的全部导出

`api-probe` MUST 为 `@minecraft/debug-utilities` 的每一项导出提供可执行探针,不得只接入形状绘制而忽略其余导出。

#### Scenario: 统计类导出

- **WHEN** 玩家执行统计探针命令
- **THEN** MUST 报告 `collectRuntimeStats()` 与 `collectPluginStats()` 的结果
- **AND** 某项抛错时 MUST 只把该项标为失败,其余照常输出

#### Scenario: 全局行为开关

- **WHEN** 玩家执行看门狗开关命令
- **THEN** 关闭看门狗告警 MUST 需要显式参数,默认不得关闭
- **AND** 关闭后 MUST 提示该操作会让卡顿不再产生告警日志,并提示恢复方式

#### Scenario: 规模上限

- **WHEN** 玩家执行规模上限命令
- **THEN** 探针 MUST 报告请求数量、实际成功数量、耗时与首次失败位置
- **AND** 首次失败后 MUST 停止继续加入,不加重引擎负担

### Requirement: 受限上下文的调用安全性须由实测回答

对于类型定义未标注上下文限制的 API,`api-probe` MUST 提供实测手段回答「能否在受限上下文调用」,而不是仅凭「没有标注」推断安全。

#### Scenario: 在受限上下文里直接调用

- **WHEN** 玩家执行受限上下文探针命令
- **THEN** 探针 MUST 在命令回调（受限上下文）内同步执行目标调用,不得推迟到安全 tick
- **AND** 调用的异常 MUST 被捕获并在推迟后的安全 tick 里回执

#### Scenario: 两种结论各自的后续动作

- **WHEN** 受限上下文内调用抛错
- **THEN** 回执 MUST 指出必须推迟到安全 tick
- **WHEN** 受限上下文内调用不抛错
- **THEN** 回执 MUST 指出这不等于渲染生效,仍需观察画面确认

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
