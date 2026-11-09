# Spec Delta

## Purpose

定义仓库内部共享界面包 `@mc-toolchain/ui` 的定位与能力边界,使多个 Bedrock 模组共用同一套表单封装、安全上下文执行与界面消息助手,而不必各自复制代码或依赖仓库外的共享包。

## ADDED Requirements

### Requirement: 共享界面包位于 `packages/` 工作区

仓库 MUST 提供内部共享界面包 `@mc-toolchain/ui`,位于 `packages/ui/`,并被根 `package.json` 的 `workspaces` 覆盖。该包 MUST 标记为私有(`private: true`),MUST NOT 发布到 npm,且 MUST 以 workspace 依赖的形式被模组引用。

#### Scenario: 模组以 workspace 依赖引用共享界面包

- **WHEN** 某模组的 `package.json` 声明对 `@mc-toolchain/ui` 的依赖
- **THEN** 在仓库根执行 `npm install` 后,该依赖解析到 `packages/ui/`,不需要任何网络安装

#### Scenario: 共享界面包不被发布

- **WHEN** 检查 `packages/ui/package.json`
- **THEN** `private` 为 `true`,且该包不在任何发布脚本的发布清单中

### Requirement: 界面职责与运行时仲裁职责分离

共享界面包 MUST 只承载「把玩家输入收集成结构化结果」与「把结果安全地交给调用方」这两类能力;MUST NOT 承载屏幕 HUD 的跨包优先级仲裁,也 MUST NOT 承载文本样式码常量。HUD 仲裁与样式码 MUST 继续由 `@mc-toolchain/shared` 提供,两个包 MUST NOT 出现同一能力的重复实现。

#### Scenario: 界面包不复制样式码

- **WHEN** 检查 `packages/ui/src` 的导出清单
- **THEN** 其中不存在颜色码/格式码常量或给文本加样式码的函数

#### Scenario: 界面包不参与 HUD 仲裁

- **WHEN** 某模组同时需要表单与 actionbar HUD
- **THEN** 表单能力来自 `@mc-toolchain/ui`,HUD 仲裁来自 `@mc-toolchain/shared`,两者各自被独立引用

### Requirement: 运行时依赖只允许官方 Script API 包

`@mc-toolchain/ui` MUST 只把 `@minecraft/server` 与 `@minecraft/server-ui` 作为对等依赖(peerDependency),MUST NOT 依赖任何第三方运行时库。打包进模组后,MUST NOT 引入除官方 Script API 模块外的外部模块引用。

#### Scenario: 打包产物无第三方运行时引用

- **WHEN** 检查使用该共享包的模组的构建产物
- **THEN** 其中除 `@minecraft/server` 与 `@minecraft/server-ui` 外,不存在其它外部模块的导入

#### Scenario: 官方模块版本由模组决定

- **WHEN** 两个模组分别依赖不同的 `@minecraft/server` 版本并各自打包
- **THEN** 共享包本身不锁定官方模块版本,各模组产物按自身声明解析

### Requirement: 源码须在保守编译配置下通过

共享界面包的源码 MUST 在 `target: es6`、`module: ES2020` 的编译配置下无错误通过。因此源码 MUST NOT 使用 ES2015 之后的语法特性,包括但不限于 `.at()`、可选链赋值与顶层 `await`。

#### Scenario: 以 es6 目标自检

- **WHEN** 在 `packages/ui` 下执行其 `typecheck` 脚本
- **THEN** 编译在 `target: es6` 下无错误通过

#### Scenario: 使用超范围语法被自检拦下

- **WHEN** 源码中使用 `.at()` 或可选链赋值
- **THEN** 该包的 `typecheck` 报错,而不是等到消费方模组打包时才暴露

### Requirement: 选项式表单收集并返回命名结果

共享界面包 MUST 提供选项式表单封装:调用方按字段名依次声明输入项,提交后得到「字段名 → 值」的结果,而不需要调用方自己维护字段下标。字段 MUST 至少覆盖文本输入、下拉选择、开关与滑条;表单 MUST 支持提交按钮文本、标题、正文与分隔线。玩家取消时 MUST 返回「无结果」而不是抛出异常。

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

非输入类元素(标题区、只读文本、分隔线)在部分 Bedrock 版本中占用表单值下标、在另一些版本中不占用。共享界面包的取值解析 MUST 同时兼容这两种排布,使同一份调用代码在不同游戏版本上都能取到正确字段值。

#### Scenario: 非输入元素占用下标

- **WHEN** 表单包含一个只读文本与两个输入项,且运行版本使只读文本占用下标
- **THEN** 两个输入项取到各自正确的值,不因偏移而错位

#### Scenario: 非输入元素不占用下标

- **WHEN** 同一份调用代码运行在只读文本不占用下标的版本上
- **THEN** 两个输入项仍取到各自正确的值

### Requirement: 按钮式菜单收集并派发选择

共享界面包 MUST 提供按钮式菜单封装:调用方按顺序添加按钮并为每个按钮绑定处理函数,玩家点击后封装 MUST 执行对应处理函数;玩家取消时 MUST 不执行任何处理函数。按钮 MUST 支持纯文本标签与带图标标签。

#### Scenario: 点击按钮触发对应处理

- **WHEN** 菜单有「传送」与「管理传送点」两个按钮,玩家点击第二个
- **THEN** 只有第二个按钮绑定的处理函数被执行

#### Scenario: 取消菜单不触发处理

- **WHEN** 玩家关闭按钮式菜单而没有点击任何按钮
- **THEN** 没有任何按钮处理函数被执行

### Requirement: 双按钮确认对话框

共享界面包 MUST 提供双按钮对话框封装:两个按钮的文本可由调用方指定,分别绑定确认与取消处理函数。封装 MUST 在玩家确认时返回「已确认」、取消或关闭时返回「未确认」。

#### Scenario: 确认与取消分别派发

- **WHEN** 对话框的确认按钮与取消按钮各绑定了一个处理函数
- **THEN** 玩家点确认只执行确认处理函数,点取消只执行取消处理函数

#### Scenario: 关闭对话框视为未确认

- **WHEN** 玩家直接关闭双按钮对话框
- **THEN** 封装返回「未确认」,两个处理函数都不执行

### Requirement: 受限上下文的回调必须推迟执行

共享界面包 MUST 提供执行助手,把调用方传入的回调推迟到安全上下文执行。所有从自定义命令回调、`beforeEvents` 回调与表单/按钮回调进入的受限操作 MUST 经该助手执行。

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

共享界面包 MUST 提供面向界面的消息助手:成功提示与失败提示各一个,并 MUST 在玩家已离线时静默跳过发送,而不是抛出异常中断后续流程。

#### Scenario: 玩家离线时发送提示

- **WHEN** 调用方对一名已断开连接的玩家发送成功提示
- **THEN** 发送失败被吞掉,调用方流程继续执行

#### Scenario: 成功与失败提示可区分

- **WHEN** 调用方分别使用成功提示与失败提示
- **THEN** 两条消息在游戏内以可区分的颜色呈现
