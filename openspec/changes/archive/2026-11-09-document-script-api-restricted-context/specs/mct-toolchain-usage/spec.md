# Delta: mct-toolchain-usage

## ADDED Requirements

### Requirement: 自定义命令回调不得直接调用受限 API

自定义命令(`CustomCommandRegistry.registerCommand`)的回调运行在受限(只读)上下文。回调内 MUST 只做参数解析、来源校验与权限判断;任何会改变世界或玩家状态的调用 MUST 用 `system.run` 推迟到下一个安全 tick 执行。MUST NOT 在回调内同步执行游戏模式切换、传送、粒子生成、状态写入等写操作。

#### Scenario: 生存模式下切换旁观成功

- **WHEN** 生存模式玩家执行一条注册在自定义命令中的切换命令,该命令的写操作已用 `system.run` 推迟
- **THEN** 命令返回成功,下一 tick 玩家的游戏模式被正确切换

#### Scenario: 回调内同步写操作导致拒绝

- **WHEN** 命令回调内同步调用 `Player.setGameMode` 等写操作
- **THEN** 该调用抛错,玩家看到失败提示,状态不变

#### Scenario: 推迟执行时玩家已离线

- **WHEN** 命令回调把写操作推迟到 `system.run`,而玩家在下一 tick 前已离线
- **THEN** 推迟的回调检测到玩家对象失效并直接返回,不抛错、不改状态

#### Scenario: 非玩家来源执行命令

- **WHEN** 从控制台或命令方块执行该命令
- **THEN** 命令返回失败并说明只能由玩家执行,不进入任何写操作路径

### Requirement: 受限 API 以类型定义的上下文标注为判定依据

判断某个 Script API 是否可在受限上下文调用,MUST 以 `@minecraft/server` 类型定义中该成员的注释标注为准:标注 `can't be called in read-only mode` 的成员 MUST 视为受限,标注 `can be called in early-execution mode` 的成员才可在启动早期调用。MUST NOT 依据经验、其它模组写法或第三方封装的行为推断。

#### Scenario: 实现前核对调用链上的受限成员

- **WHEN** 实现一个由命令或早期事件触发的功能
- **THEN** 逐一核对该调用链上每个 `@minecraft/server` 成员的上下文标注,受限成员全部安排在 `system.run` 内

#### Scenario: 同一 API 家族标注不一致

- **WHEN** 家族中某个成员(如 `setDynamicProperty`)未标注为受限,而同家族其它成员(如 `setGameMode`)标注为受限
- **THEN** 按成员逐个判定,不因家族内多数受限就把未标注的成员也一并推迟

### Requirement: 替换第三方封装须逐项确认被移除的隐藏行为

把第三方封装(如 `defineCommand`、表单构造器、权限判断助手)替换为原生 API 时,MUST 先确认该封装除转发之外还做了什么——上下文推迟、权限校验、参数解析、错误兜底——并为每一项显式补回等价实现。MUST NOT 把"去掉一层封装"当作行为等价。

#### Scenario: 封装内隐藏了上下文推迟

- **WHEN** 被替换的封装内部会把回调推迟到安全 tick,而原生 API 不会
- **THEN** 替换时显式补上 `system.run` 推迟,否则玩家侧会出现功能直接失败

#### Scenario: 封装内隐藏了权限校验

- **WHEN** 被替换的封装内部做了操作员判断,而原生注册参数只控制命令可见性
- **THEN** 替换时在回调内显式补上权限判断,否则非管理员可越权进入管理入口

#### Scenario: 无法获得封装源码时

- **WHEN** 被替换的封装不可读(未安装、无源码)
- **THEN** 在实施前把该封装的行为列为未确认风险并明确写出应对方案,不得默认为纯转发
