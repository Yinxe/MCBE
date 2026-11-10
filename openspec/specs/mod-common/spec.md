# mod-common Specification

## Purpose

定义仓库内部合并后的共享包 `@mc-toolchain/mod-common` 的定位与能力边界,使多个 Bedrock 模组共用同一套文本样式、HUD 逐玩家优先级仲裁、表单封装、安全上下文执行与界面消息助手,而不必各自复制代码或依赖仓库外的共享包。

## Requirements

### Requirement: 共享工具包位于 `packages/` 工作区

仓库 MUST 提供内部共享包 `@mc-toolchain/mod-common`,位于 `packages/mod-common/`,并被根 `package.json` 的 `workspaces` 覆盖。该包 MUST 标记为私有(`private: true`),MUST NOT 发布到 npm,且 MUST 以 workspace 依赖的形式被模组引用。

#### Scenario: 模组以 workspace 依赖引用共享工具包

- **WHEN** 某模组的 `package.json` 声明对 `@mc-toolchain/mod-common` 的依赖
- **THEN** 在仓库根执行 `npm install` 后,该依赖解析到 `packages/mod-common/`,不需要任何网络安装

#### Scenario: 共享工具包不被发布

- **WHEN** 检查 `packages/mod-common/package.json`
- **THEN** `private` 为 `true`,且该包不在任何发布脚本的发布清单中

### Requirement: 运行时依赖只允许官方 Script API 包

`@mc-toolchain/mod-common` MUST 只把 `@minecraft/server` 与 `@minecraft/server-ui` 作为对等依赖(peerDependency),MUST NOT 依赖任何第三方运行时库。打包进模组后,MUST NOT 引入除官方 Script API 模块外的外部模块引用。

#### Scenario: 打包产物无第三方运行时引用

- **WHEN** 检查使用该共享包的模组的构建产物
- **THEN** 其中除 `@minecraft/server` 与 `@minecraft/server-ui` 外,不存在其它外部模块的导入

#### Scenario: 依赖官方模块的版本由模组决定

- **WHEN** 两个模组分别依赖不同的 `@minecraft/server` 版本并各自打包
- **THEN** 共享包本身不锁定官方模块版本,各模组产物按自身声明解析

### Requirement: 文本样式工具

`@mc-toolchain/mod-common` MUST 提供给文本附加 Bedrock 格式码的工具:一个格式码常量集合(至少含颜色与加粗、重置),以及一个把若干格式码按给定顺序前置到文本上的样式函数。样式函数 MUST NOT 自动追加重置码,由调用方决定是否追加。

#### Scenario: 给文本着色

- **WHEN** 以某颜色码调用样式函数包裹一段文本
- **THEN** 返回的字符串以该颜色码开头,且文本内容原样保留

#### Scenario: 多段拼接由调用方控制重置

- **WHEN** 调用方把两段已着色文本直接拼接且未追加重置码
- **THEN** 样式工具不插入任何隐式重置码,第二段的格式码对后续文本生效

### Requirement: 屏幕 HUD 逐玩家优先级仲裁

`@mc-toolchain/mod-common` MUST 提供 HUD 管理器:调用方按「槽位 + 优先级 + 渲染回调」注册显示源,管理器按固定周期驱动,对每个玩家分别选出优先级最高的显示源并只渲染该源的内容。槽位 MUST 至少覆盖 actionbar。渲染回调对某玩家返回空值 MUST 表示该源对该玩家无内容,该玩家不参与该源的仲裁。

#### Scenario: 高优先级源覆盖低优先级源

- **WHEN** 两个显示源对同一玩家在同一槽位都有内容,优先级分别为 10 与 60
- **THEN** 该玩家只看到优先级 60 的源的内容

#### Scenario: 源对某玩家无内容则不参与仲裁

- **WHEN** 高优先级源的渲染回调对某玩家返回空值
- **THEN** 该玩家看到低优先级源的内容,而非空白

#### Scenario: 无内容时不占用槽位

- **WHEN** 某玩家的槽位上没有任何显示源返回内容
- **THEN** 管理器清除自己在该玩家该槽位留下的残留内容

### Requirement: 同优先级决胜与声明过期

当多个显示源对同一玩家同一槽位的优先级相同时,管理器 MUST 按显示源所属模组的标识做确定性的字典序决胜,MUST NOT 依赖注册顺序。跨包声明 MUST 带心跳并在超过过期阈值后失效,使崩溃或卸载的模组不会长期占住槽位。

#### Scenario: 同优先级按标识决胜

- **WHEN** 两个模组的显示源对同一玩家同槽位优先级相同,标识分别为 `alpha` 与 `beta`
- **THEN** 每次仲裁都选出同一方(标识字典序小者),结果稳定可复现

#### Scenario: 声明超时后释放槽位

- **WHEN** 某模组的跨包声明在超过过期阈值后不再刷新
- **THEN** 其声明被视为失效,该槽位由剩余的有效声明重新仲裁

### Requirement: 排除模拟玩家

HUD 管理器 MUST 只对真实玩家渲染与广播声明，模拟玩家（假人）MUST 被排除。排除 MUST 复用共享的玩家守卫（见「假人判别不依赖模组私有标记」），MUST NOT 在 HUD 内部另立一套私有判别。调用方 MAY 追加额外的玩家过滤条件。

#### Scenario: 假人不被渲染

- **WHEN** 世界中存在模拟玩家且某显示源对其有内容
- **THEN** 该模拟玩家不会收到 HUD 内容，也不会出现在跨包声明的覆盖集合中

#### Scenario: 调用方追加过滤

- **WHEN** 调用方提供额外的玩家过滤条件
- **THEN** 不满足该条件的玩家既不被渲染，也不参与声明

#### Scenario: HUD 与模组使用同一套判别

- **WHEN** 某玩家被共享守卫判为模拟玩家
- **THEN** HUD 也不对其渲染，两处结论一致

### Requirement: 启停控制与源注销

HUD 管理器 MUST 支持在安全上下文启动驱动循环、暂停驱动并释放全部槽位声明,以及注销单个显示源。暂停时 MUST 立即释放声明并清除残留,使其它模组可以接管该槽位。

#### Scenario: 暂停后让出槽位

- **WHEN** 调用方暂停 HUD 管理器
- **THEN** 本模组的全部槽位声明被释放,且本模组渲染过的残留内容被清除

#### Scenario: 注销单个源

- **WHEN** 调用方注销某个显示源的注册句柄
- **THEN** 该源不再参与仲裁与渲染,其它源不受影响

### Requirement: 源码须在保守编译配置下通过

`@mc-toolchain/mod-common` 的源码 MUST 在 `target: es6`、`module: ES2020` 的编译配置下无错误通过。因此源码 MUST NOT 使用 ES2015 之后的语法特性,包括但不限于 `.at()`、可选链赋值与顶层 `await`。

#### Scenario: 以 es6 目标自检

- **WHEN** 在 `packages/mod-common` 下执行其 `typecheck` 脚本
- **THEN** 编译在 `target: es6` 下无错误通过

#### Scenario: 使用超范围语法被自检拦下

- **WHEN** 源码中使用 `.at()` 或可选链赋值
- **THEN** 该包的 `typecheck` 报错,而不是等到消费方模组打包时才暴露

### Requirement: 选项式表单收集并返回命名结果

`@mc-toolchain/mod-common` MUST 提供选项式表单封装:调用方按字段名依次声明输入项,提交后得到「字段名 → 值」的结果,而不需要调用方自己维护字段下标。字段 MUST 至少覆盖文本输入、下拉选择、开关与滑条;表单 MUST 支持提交按钮文本、标题、正文与分隔线。玩家取消时 MUST 返回「无结果」而不是抛出异常。

#### Scenario: 按字段名取回结果

- **WHEN** 调用方声明名为 `maxWaypoints` 的滑条与名为 `publicEnabled` 的开关,玩家调整后提交
- **THEN** 调用方按这两个名字取得数值与布尔值,不需要知道它们在表单中的位置

#### Scenario: 玩家取消表单

- **WHEN** 玩家关闭表单而没有提交
- **THEN** 封装返回「无结果」,调用方可以据此跳过后续处理,且不产生未捕获异常

#### Scenario: 字段类型与值类型对应

- **WHEN** 表单包含文本输入、下拉选择、开关与滑条各一个
- **THEN** 返回结果中文本为字符串、下拉为选中项下标、开关为布尔值、滑条为数值

### Requirement: 表单字段下标解析须兼容两种排布

非输入类元素(标题区、只读文本、分隔线)在部分 Bedrock 版本中占用表单值下标、在另一些版本中不占用。共享包的取值解析 MUST 同时兼容这两种排布,使同一份调用代码在不同游戏版本上都能取到正确字段值。

#### Scenario: 非输入元素占用下标

- **WHEN** 表单包含一个只读文本与两个输入项,且运行版本使只读文本占用下标
- **THEN** 两个输入项取到各自正确的值,不因偏移而错位

#### Scenario: 非输入元素不占用下标

- **WHEN** 同一份调用代码运行在只读文本不占用下标的版本上
- **THEN** 两个输入项仍取到各自正确的值

### Requirement: 按钮式菜单收集并派发选择

`@mc-toolchain/mod-common` MUST 提供按钮式菜单封装:调用方按顺序添加按钮并为每个按钮绑定处理函数,玩家点击后封装 MUST 执行对应处理函数;玩家取消时 MUST 不执行任何处理函数。按钮 MUST 支持纯文本标签与带图标标签。

#### Scenario: 点击按钮触发对应处理

- **WHEN** 菜单有「传送」与「管理传送点」两个按钮,玩家点击第二个
- **THEN** 只有第二个按钮绑定的处理函数被执行

#### Scenario: 取消菜单不触发处理

- **WHEN** 玩家关闭按钮式菜单而没有点击任何按钮
- **THEN** 没有任何按钮处理函数被执行

### Requirement: 双按钮确认对话框

`@mc-toolchain/mod-common` MUST 提供双按钮对话框封装:两个按钮的文本可由调用方指定,分别绑定确认与取消处理函数。封装 MUST 在玩家确认时返回「已确认」、取消或关闭时返回「未确认」。

#### Scenario: 确认与取消分别派发

- **WHEN** 对话框的确认按钮与取消按钮各绑定了一个处理函数
- **THEN** 玩家点确认只执行确认处理函数,点取消只执行取消处理函数

#### Scenario: 关闭对话框视为未确认

- **WHEN** 玩家直接关闭双按钮对话框
- **THEN** 封装返回「未确认」,两个处理函数都不执行

### Requirement: 受限上下文的回调必须推迟执行

`@mc-toolchain/mod-common` MUST 提供执行助手,把调用方传入的回调推迟到安全上下文执行。所有从自定义命令回调、`beforeEvents` 回调与表单/按钮回调进入的受限操作 MUST 经该助手执行。

#### Scenario: 命令回调中的受限操作确实生效

- **WHEN** 玩家执行一个会传送自己的命令,回调经执行助手推迟
- **THEN** 玩家确实被传送到目标位置,而不是命令返回成功却没有发生传送

#### Scenario: 同步回调被推迟执行

- **WHEN** 调用方把一个同步函数交给执行助手
- **THEN** 该函数在安全上下文中执行,且助手在它返回后完成

#### Scenario: 异步回调被等待

- **WHEN** 调用方把一个返回 Promise 的函数交给执行助手
- **THEN** 助手在该 Promise 落定后才完成

#### Scenario: 按钮处理函数经执行助手

- **WHEN** 玩家在表单菜单中点击某个按钮
- **THEN** 该按钮的处理函数经执行助手在安全上下文执行

#### Scenario: 推迟后玩家已离线

- **WHEN** 回调推迟到安全上下文后玩家已经断线
- **THEN** 操作被安全跳过,不向已离线的玩家对象写入,也不抛出未捕获异常

### Requirement: 受限成员的判定以类型声明标注为准

某个 API 是否需要推迟,MUST 以 `@minecraft/server` 类型声明 doc block 中是否含 `This function can't be called in read-only mode.` 或 `This property can't be edited in read-only mode.` 为准。MUST NOT 以「是否属于写操作」类推。

#### Scenario: 写操作但不受限

- **WHEN** 命令回调中调用 `sendMessage` 或 `setDynamicProperty`
- **THEN** 调用不报错,不被强制推迟

#### Scenario: 非写操作但受限

- **WHEN** 在只读上下文中调用事件信号的 `subscribe` 或 `Entity.teleport`
- **THEN** 该调用会失败,因此必须经执行助手推迟

### Requirement: 执行助手不吞掉回调异常

执行助手 MUST 捕获回调同步抛出的错误与其返回 Promise 的拒绝,并把错误交给调用方。

#### Scenario: 同步抛错被捕获

- **WHEN** 交给执行助手的回调同步抛出错误
- **THEN** 该错误被交给调用方处理,不产生 unhandled rejection

#### Scenario: Promise 拒绝被捕获

- **WHEN** 回调返回的 Promise 被拒绝
- **THEN** 该错误被交给调用方处理,不使游戏报错刷屏

### Requirement: 界面消息助手容忍玩家离线

`@mc-toolchain/mod-common` MUST 提供面向界面的消息助手:成功提示与失败提示各一个,并 MUST 在玩家已离线时静默跳过发送,而不是抛出异常中断后续流程。

#### Scenario: 玩家离线时发送提示

- **WHEN** 调用方对一名已断开连接的玩家发送成功提示
- **THEN** 发送失败被吞掉,调用方流程继续执行

#### Scenario: 成功与失败提示可区分

- **WHEN** 调用方分别使用成功提示与失败提示
- **THEN** 两条消息在游戏内以可区分的颜色呈现

### Requirement: 每个表单封装须有版式与返回值文档

`@mc-toolchain/mod-common` 的 README MUST 为每类表单给出 ASCII 版式图,标明每个构建方法对应界面上的哪一行;MUST 给出 `show()` 在各情形下的返回值,以及调用方必须处理的分支。文档 MUST 说明 `ActionFormBuilder` 与 `MessageFormBuilder` 不向调用方暴露按钮下标。

#### Scenario: 调用方按文档判断取消

- **WHEN** 使用者只读 README 就要写一个「取消则跳过」的流程
- **THEN** 文档明确写出取消时 `ModalFormBuilder` 返回 `null`、按钮式与对话框返回 `false`,无需阅读源码

#### Scenario: 版式图与构建方法对应

- **WHEN** 使用者查看任一表单的版式图
- **THEN** 图中每一行都标注了产生它的构建方法,可据此判断该调用 `.divider()` 还是 `.label()`

### Requirement: 表单文档须标注会误导调用方的行为

README MUST 显式标注以下易错点:下拉框返回选项下标而非文本;装饰行在部分版本占用表单值下标;`MessageFormBuilder` 两个按钮的左右摆放不由本包保证;执行助手已内含 `system.run`,模组不得再包一层。

#### Scenario: 下拉框取值需二次映射

- **WHEN** 使用者按文档读取下拉框的值
- **THEN** 文档说明该值为下标,并给出用选项数组映射回文本的写法

#### Scenario: 不依赖按钮左右位置

- **WHEN** 使用者为对话框编写按钮文案
- **THEN** 文档已说明左右位置由游戏决定,避免写出「点击右侧按钮」这类失效文案

### Requirement: 玩家守卫不得泄漏共享库自身的 Player 类型

共享库向模组提供的玩家守卫 MUST 由调用方绑定自己的玩家类型与在线枚举，共享库 MUST NOT 在其公开返回值类型中包含共享库自己解析到的 `Player` 类型。

#### Scenario: 跨版本模组可消费守卫

- **WHEN** 某模组钉的 Script API 版本与共享库自身开发依赖版本不同
- **THEN** 该模组消费守卫时不产生类型不兼容错误

#### Scenario: 在线枚举由调用方提供

- **WHEN** 调用方未显式传入玩家集合
- **THEN** 守卫使用调用方绑定的在线枚举，而不是共享库自身的枚举

### Requirement: 假人判别不依赖模组私有标记

守卫 MUST 以「读取游戏模式抛错、该方法缺失或返回 `undefined`」判定模拟玩家，MUST NOT 依赖任何假人模组打上的 tag 或白名单。

#### Scenario: 未打标记的第三方假人

- **WHEN** 世界里存在一个未打任何已知 tag 的模拟玩家
- **THEN** 守卫仍判其为模拟玩家

#### Scenario: 真人不受影响

- **WHEN** 真实玩家读取游戏模式成功并返回具体模式
- **THEN** 守卫判其为真实玩家

### Requirement: 坏句柄与半初始化实体不得中断枚举

守卫遍历在线玩家时 MUST 丢弃对象缺失、关键属性缺失或属性访问抛错的条目；单条失败 MUST NOT 中断其余条目的处理，也 MUST NOT 向外抛出。

#### Scenario: 枚举结果含 undefined 项

- **WHEN** 在线玩家枚举结果含 `undefined` 项
- **THEN** 守卫跳过该项，其余玩家照常返回

#### Scenario: 枚举整体失败

- **WHEN** 在线枚举调用本身抛错
- **THEN** 守卫返回空集而不是向外抛出

### Requirement: 玩家名读取须逐级兜底

守卫取名 MUST 依次尝试登录名、事件负载名与实体显示名；任一键访问抛错时 MUST 继续尝试下一级；全部不可用时 MUST 返回「无名」而不是抛出。调用方 MUST 使用守卫解析出的名字，MUST NOT 再裸读玩家对象的名字属性。

#### Scenario: 登录名为空而显示名有效

- **WHEN** 一个模拟玩家的登录名为空、显示名有效
- **THEN** 守卫返回显示名

#### Scenario: 名字属性访问抛错

- **WHEN** 某个名字属性访问抛错
- **THEN** 守卫回退到下一级候选，不向外抛出

### Requirement: 位置与维度须在枚举时快照

守卫枚举玩家时 MUST 一并快照其维度标识与坐标；调用方 MUST 使用快照值，MUST NOT 在后续异步流程中裸读玩家对象的维度或坐标属性。快照失败时 MUST 保留该玩家的名字，并把位置标记为不可用。

#### Scenario: 坐标读取失败

- **WHEN** 某玩家的坐标读取抛错
- **THEN** 该玩家仍以名字形式保留，位置标记为不可用，由调用方据标记跳过

#### Scenario: 调用方据快照判定邻近

- **WHEN** 调用方需要判断玩家是否在某个区域内
- **THEN** 使用枚举时取得的快照坐标，而不是重新读取玩家对象

### Requirement: 守卫实现须拆为纯核与绑定两层

守卫实现 MUST 拆分为不依赖游戏运行时的纯核，以及绑定游戏类型的外层；纯核 MUST 能在无游戏进程的 Node 测试环境中直接加载。

#### Scenario: 脱机运行守卫单测

- **WHEN** 在无 Minecraft 运行时的环境执行守卫单测
- **THEN** 纯核可被加载，且全部分支可被覆盖
