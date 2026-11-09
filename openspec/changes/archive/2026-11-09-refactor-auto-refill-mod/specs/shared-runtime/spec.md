# Spec Delta

## Purpose

定义仓库内部共享运行时包 `@mc-toolchain/shared` 的定位与能力边界,使多个 Bedrock 模组共用同一套文本样式与屏幕 HUD 仲裁实现,而不必各自复制代码或依赖仓库外的共享包。

## ADDED Requirements

### Requirement: 共享运行时包位于 `packages/` 工作区

仓库 MUST 提供内部共享运行时包 `@mc-toolchain/shared`,位于 `packages/shared/`,并被根 `package.json` 的 `workspaces` 覆盖。该包 MUST 标记为私有(`private: true`),MUST NOT 发布到 npm,且 MUST 以 workspace 依赖的形式被模组引用。

#### Scenario: 模组以 workspace 依赖引用共享运行时

- **WHEN** 某模组的 `package.json` 声明对 `@mc-toolchain/shared` 的依赖
- **THEN** 在仓库根执行 `npm install` 后,该依赖解析到 `packages/shared/`,不需要任何网络安装

#### Scenario: 共享运行时不被发布

- **WHEN** 检查 `packages/shared/package.json`
- **THEN** `private` 为 `true`,且该包不在任何发布脚本的发布清单中

### Requirement: 运行时依赖只允许官方 Script API 包

`@mc-toolchain/shared` MUST 只把 `@minecraft/server` 与 `@minecraft/server-ui` 作为对等依赖(peerDependency),MUST NOT 依赖任何第三方运行时库。打包进模组后,MUST NOT 引入除官方 Script API 模块外的外部模块引用。

#### Scenario: 打包产物无第三方运行时引用

- **WHEN** 检查使用该共享包的模组的构建产物
- **THEN** 其中除 `@minecraft/server` 与 `@minecraft/server-ui` 外,不存在其它外部模块的导入

#### Scenario: 依赖官方模块的版本由模组决定

- **WHEN** 两个模组分别依赖不同的 `@minecraft/server` 版本并各自打包
- **THEN** 共享包本身不锁定官方模块版本,各模组产物按自身声明解析

### Requirement: 文本样式工具

`@mc-toolchain/shared` MUST 提供给文本附加 Bedrock 格式码的工具:一个格式码常量集合(至少含颜色与加粗、重置),以及一个把若干格式码按给定顺序前置到文本上的样式函数。样式函数 MUST NOT 自动追加重置码,由调用方决定是否追加。

#### Scenario: 给文本着色

- **WHEN** 以某颜色码调用样式函数包裹一段文本
- **THEN** 返回的字符串以该颜色码开头,且文本内容原样保留

#### Scenario: 多段拼接由调用方控制重置

- **WHEN** 调用方把两段已着色文本直接拼接且未追加重置码
- **THEN** 样式工具不插入任何隐式重置码,第二段的格式码对后续文本生效

### Requirement: 屏幕 HUD 逐玩家优先级仲裁

`@mc-toolchain/shared` MUST 提供 HUD 管理器:调用方按「槽位 + 优先级 + 渲染回调」注册显示源,管理器按固定周期驱动,对每个玩家分别选出优先级最高的显示源并只渲染该源的内容。槽位 MUST 至少覆盖 actionbar。渲染回调对某玩家返回空值 MUST 表示该源对该玩家无内容,该玩家不参与该源的仲裁。

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

HUD 管理器 MUST 只对真实玩家渲染与广播声明,模拟玩家(假人)MUST 被排除,且排除方式 MUST NOT 依赖特定假人模组的标记。调用方 MAY 追加额外的玩家过滤条件。

#### Scenario: 假人不被渲染

- **WHEN** 世界中存在模拟玩家且某显示源对其有内容
- **THEN** 该模拟玩家不会收到 HUD 内容,也不会出现在跨包声明的覆盖集合中

#### Scenario: 调用方追加过滤

- **WHEN** 调用方提供额外的玩家过滤条件
- **THEN** 不满足该条件的玩家既不被渲染,也不参与声明

### Requirement: 启停控制与源注销

HUD 管理器 MUST 支持在安全上下文启动驱动循环、暂停驱动并释放全部槽位声明,以及注销单个显示源。暂停时 MUST 立即释放声明并清除残留,使其它模组可以接管该槽位。

#### Scenario: 暂停后让出槽位

- **WHEN** 调用方暂停 HUD 管理器
- **THEN** 本模组的全部槽位声明被释放,且本模组渲染过的残留内容被清除

#### Scenario: 注销单个源

- **WHEN** 调用方注销某个显示源的注册句柄
- **THEN** 该源不再参与仲裁与渲染,其它源不受影响
