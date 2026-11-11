# item-route Specification

## Purpose

物品路由仓库模组：玩家用木锄圈定仓库区域、把区域内的容器登记为仓库成员容器，模组按物品族规则把玩家投进仓库的物品自动分拣到对应容器，并提供整理、统计、容量预警、搜索定位与权限管理。

## Requirements

### Requirement: 仓库创建与区域圈定

玩家 MUST 能用信物（木锄）依次点击区域的两个角完成圈定并创建仓库；仓库 MUST 有玩家指定的显示名，创建者 MUST 成为该仓库的 owner。命令入口 MUST 允许在一条命令内直接给出名称与两个角坐标。

#### Scenario: 信物两次点击建仓

- **WHEN** 玩家手持木锄点击第一个角，再点击第二个角
- **THEN** 系统以该区域创建仓库，创建者为 owner，并提示仓库已创建

#### Scenario: 命令一次给出名称与坐标

- **WHEN** 玩家执行 `ir:create <名称> <pos1> <pos2>`
- **THEN** 系统以给定名称与该区域创建仓库，效果与信物圈定一致

#### Scenario: 名称重复被拒绝

- **WHEN** 玩家用已存在的仓库显示名创建仓库
- **THEN** 创建被拒绝并提示名称已被占用，不产生新仓库

### Requirement: 仓库成员与权限分级

每个仓库 MUST 维护 owner / member 两级成员关系。owner MUST 能增删 member、调整区域、删除仓库；member MUST 能重扫、搜索、整理；非成员 MUST NOT 触发任何改变仓库状态的操作，且越权操作 MUST 返回明确的拒绝提示而不是静默失败。

#### Scenario: member 执行 owner 操作被拒绝

- **WHEN** member 执行 `ir:resize` 或 `ir:delete`
- **THEN** 操作被拒绝并提示权限不足，仓库区域与仓库本身保持不变

#### Scenario: 非成员执行仓库操作被拒绝

- **WHEN** 非成员执行 `ir:rescan <名称>`
- **THEN** 操作被拒绝并提示无权访问该仓库

#### Scenario: owner 移除 member 后立即失效

- **WHEN** owner 移除某 member 后该玩家立即尝试 `ir:organize`
- **THEN** 该玩家不再具备 member 权限，操作被拒绝

### Requirement: 容器登记与角色

仓库 MUST 把区域内的容器登记为成员容器，每个容器 MUST 带一个角色：`input`（投放口）、`storage`（存储）、`overflow`（溢出）、`trash`（销毁）或 `unassigned`（未分配）。扫描 MUST 支持预览（只报告发现结果而不写入）与执行（写入并持久化）两种模式。

#### Scenario: 扫描预览不写入

- **WHEN** member 执行 `ir:rescan_preview <名称>`
- **THEN** 系统报告区域内发现的容器清单与数量，仓库的容器集合与持久化数据不变

#### Scenario: 扫描执行登记新容器

- **WHEN** member 执行 `ir:rescan <名称>`，区域内新增了 3 个容器
- **THEN** 这 3 个容器被登记为成员容器，角色为未分配，并在之后的重连中仍然存在

#### Scenario: 容器角色可改

- **WHEN** 玩家把某成员容器的角色从 `unassigned` 改为 `storage` 并指定物品族
- **THEN** 该容器此后参与该物品族的分拣，其它角色行为不变

### Requirement: 五级自动分拣路由

当物品进入仓库的投放口容器时，系统 MUST 按固定优先级为物品选择目标容器：1 指定容器（按物品类型精确匹配）、2 已存有该物品的容器、3 同物品族的存储容器、4 溢出容器、5 丢弃。目标容器满时 MUST 降级到下一优先级。系统 MUST NOT 把物品放进投放口自身作为存储目标。

#### Scenario: 优先并入已有同类物品的容器

- **WHEN** 某存储容器已存有该物品且未满，同时存在同族存储容器
- **THEN** 物品进入已存有该物品的容器，同族容器不被使用

#### Scenario: 全部存储容器满时进入溢出容器

- **WHEN** 指定容器、同类容器与同族容器都无法接收该物品，且存在溢出容器
- **THEN** 物品进入溢出容器

#### Scenario: 无处可放时丢弃

- **WHEN** 全部优先级都无可用目标容器
- **THEN** 物品被丢弃，投放口不残留该物品

### Requirement: 分拣调度与速度限制

系统 MUST 在安全上下文中按固定周期驱动分拣，MUST 支持全局启停与全局速度上限（tick 间隔），并对每次分拣的容器操作数设上限，避免单 tick 处理量过大。

#### Scenario: 全局关闭后停止分拣

- **WHEN** 管理员关闭全局开关后向投放口放入物品
- **THEN** 物品留在投放口，不发生分拣

#### Scenario: 速度上限生效

- **WHEN** 管理员把全局速度上限设为 40 tick
- **THEN** 两次分拣之间的间隔不短于 40 tick

### Requirement: 容器整理

member MUST 能触发仓库整理：系统 MUST 把容器内物品按物品类型合并同类堆叠、按规则重排，并报告整理结果（处理容器数、移动/合并数量）。玩家背包整理 MUST 分两阶段：先整理主栏，主栏归零后提示再整理快捷栏。

#### Scenario: 整理合并同类堆叠

- **WHEN** member 对存在同类零散堆叠的仓库执行 `ir:organize`
- **THEN** 同类堆叠被合并，并报告合并数量

#### Scenario: 背包整理分两阶段

- **WHEN** 玩家触发背包整理且主栏存在可整理物品
- **THEN** 本次只整理主栏并提示快捷栏需再整理一次

### Requirement: 物品族同族收纳

系统 MUST 支持物品族规则：把多个物品类型归入同一物品族，使这些类型的物品在分拣时进入同一族容器。未命中任何族的物品 MUST 仍按通用优先级路由。

#### Scenario: 同族物品进同族容器

- **WHEN** 物品族「原木」包含若干原木类型，存储容器被指派为该族容器
- **THEN** 这些类型的物品都进入该容器

#### Scenario: 未归族物品走通用路由

- **WHEN** 某物品不属于任何已定义物品族
- **THEN** 该物品按通用优先级路由，不被强行塞进族容器

### Requirement: 仓库统计与容量预警

系统 MUST 能统计仓库的容量使用情况（每容器占用与总量、按物品类型的分布），并在容量超过阈值时向 owner 与 member 发出预警。统计 MUST 基于仓库当前已加载的容器数据。

#### Scenario: 统计报告总量与占用

- **WHEN** member 请求仓库统计
- **THEN** 系统返回各容器占用、总量与使用率

#### Scenario: 超阈值触发预警

- **WHEN** 仓库总占用率超过配置的预警阈值
- **THEN** 系统向该仓库的 owner 与 member 发出容量预警

### Requirement: 物品搜索与定位

member MUST 能按关键词搜索仓库内物品，系统 MUST 返回匹配物品所在的容器与位置，使玩家能按提示前往取用。搜索 MUST 限定在玩家有权限的仓库范围内。

#### Scenario: 按关键词命中并给出位置

- **WHEN** member 执行 `ir:search 钻石`
- **THEN** 系统返回包含钻石的容器与位置信息

#### Scenario: 无命中给出空结果提示

- **WHEN** 搜索关键词在仓库内不存在任何匹配
- **THEN** 系统提示未找到匹配物品，不返回其它仓库的结果

### Requirement: 信物交互与选区会话

玩家 MUST 用木锄作为信物完成圈定与容器点选交互。系统 MUST 维护选区会话状态，使同一玩家的多次点击按流程推进，并 MUST 在会话取消或超时后清除状态，不残留半成品仓库。

#### Scenario: 两次点击推进选区

- **WHEN** 玩家持木锄点击第一个角后点击第二个角
- **THEN** 会话从「等待第一角」推进到「完成」，随后被清除

#### Scenario: 取消会话不产生仓库

- **WHEN** 玩家圈定第一个角后取消选区
- **THEN** 会话被清除且不产生任何仓库

### Requirement: 命令集与帮助

模组 MUST 提供 9 条命名空间为 `ir:` 的命令：`create`、`resize`、`delete`、`rescan`、`rescan_preview`、`organize`、`search`、`menu`、`help`，参数形态分别为「名称 + 两角坐标」「名称」「查询词」「无参」。命令 MUST 对所有玩家可用（不要求 cheats），权限由仓库成员关系在回调内判定。`ir:help` MUST 输出可用命令与用法。

#### Scenario: 帮助列出全部命令

- **WHEN** 玩家执行 `ir:help`
- **THEN** 输出包含上述 9 条命令及其参数用法

#### Scenario: 命令无需 cheats

- **WHEN** 未开启 cheats 的世界中玩家执行 `ir:menu`
- **THEN** 命令可被调用，不因 cheats 设置被拒绝

### Requirement: 图形界面菜单

模组 MUST 提供玩家可操作的界面：主菜单、仓库管理、成员管理、容器角色与物品族设置、统计视图、确认对话框，以及物品列表表格。界面 MUST 对取消/关闭做出安全处理，不因玩家取消而留下半完成的状态变更。

#### Scenario: 主菜单进入仓库管理

- **WHEN** 玩家执行 `ir:menu` 并选择某个仓库
- **THEN** 进入该仓库的管理界面，展示该玩家在该仓库可用的操作

#### Scenario: 取消界面不改变状态

- **WHEN** 玩家在成员增删界面点击取消
- **THEN** 成员关系保持不变

### Requirement: 管理员全局配置

管理员 MUST 能查看与修改全局配置：全局启停、全局速度上限、容量预警阈值、HUD 显示开关。配置 MUST 持久化并在重连/重载后保持。

#### Scenario: 修改后持久化

- **WHEN** 管理员把全局速度上限改为 20 并重连世界
- **THEN** 配置仍为 20

#### Scenario: 越界值被收敛

- **WHEN** 管理员把全局速度上限设为 999
- **THEN** 该值被收敛到允许的最大值，而不是被原样保存

### Requirement: 仓库 HUD 显示

模组 MUST 向玩家显示仓库相关的 actionbar 提示（分拣摘要与仓库状态），并 MUST 受全局 HUD 开关控制；关闭后 MUST NOT 继续占用 actionbar。

#### Scenario: 关闭 HUD 后不显示

- **WHEN** 管理员关闭 HUD 显示
- **THEN** 玩家不再收到仓库 actionbar 提示，其它模组的 actionbar 内容不被压制

### Requirement: 分拣特效

分拣发生时 MUST 能在投放口与目标容器位置播放视觉特效（粒子 + 音效），特效 MUST 可按配置关闭，且特效的播放 MUST NOT 改变分拣结果。

#### Scenario: 特效关闭不影响分拣

- **WHEN** 特效被关闭后向投放口放入物品
- **THEN** 物品仍被正确分拣，只是没有粒子与音效

### Requirement: 在仓库内的版本与打包形态

`item-route` MUST 作为 `mods/` 下的模组存在，包目录为 `behavior_packs/item-route/` 与 `resource_packs/item-route/`。模组版本 MUST 从迁移前的 `0.1.20` 起步，两个包的 manifest 版本、显示名与描述 MUST 由 `package.json` 派生而非手写。打包产物 MUST 为包含行为包与资源包的 `.mcaddon`，输出到仓库根 `release/`。

#### Scenario: 版本由包清单派生

- **WHEN** 修改 `mods/item-route/package.json` 的版本号后打包
- **THEN** 两个包 manifest 中的版本随之改变，无需手改 manifest

#### Scenario: 产出双包 mcaddon

- **WHEN** 在 `mods/item-route` 下执行打包
- **THEN** `release/` 下产生一个同时含行为包与资源包的 `.mcaddon`，模组目录内不留产物

### Requirement: 包标识与最低游戏版本

迁移 MUST 保留迁移前两个包及其模块的 UUID，使已启用该模组的世界继续识别为同一模组。manifest MUST 声明显式的最低引擎版本，且该版本 MUST 不低于模组实际使用的脚本 API 所需的版本。

#### Scenario: UUID 保持不变

- **WHEN** 用迁移后的包替换迁移前的包并进入既有世界
- **THEN** 世界继续识别为同一行为包与资源包，不产生重复包条目

#### Scenario: 最低引擎版本与实际 API 匹配

- **WHEN** 模组使用了某脚本 API 版本引入的成员
- **THEN** manifest 声明的最低引擎版本不低于该版本，游戏不会在加载期因版本不足而拒绝模块

### Requirement: 不依赖仓库外私有包

模组的构建与运行 MUST NOT 依赖本仓库之外的私有包；命令注册、表单、HUD、打包与权限判定 MUST 使用仓库内的共享包或模组内实现。运行时依赖 MUST 只包含官方 Script API 包与官方数据包。

#### Scenario: 无外部私有依赖

- **WHEN** 在干净检出后安装依赖并构建 `mods/item-route`
- **THEN** 构建成功，且依赖树中不存在仓库外的私有包

#### Scenario: 运行时依赖限于官方包

- **WHEN** 检查 `mods/item-route/package.json` 的 `dependencies`
- **THEN** 只包含 `@minecraft/server`、`@minecraft/server-ui` 与 `@minecraft/vanilla-data`，不含其它第三方运行时库

### Requirement: 物品名称映射的全量来源

模组的物品搜索 MUST 覆盖全部可用物品类型，包括预计算中文名映射表未收录的条目。物品类型的权威来源 MUST 是官方数据包提供的类型枚举，MUST NOT 依赖手写的类型清单。

#### Scenario: 未收录条目仍可被搜到

- **WHEN** 玩家搜索一个不在预计算中文名映射表中的物品类型（例如 `raw_iron`）
- **THEN** 该物品出现在搜索结果中，不会因为映射表缺条目而搜不到

#### Scenario: 全量来源随数据包版本固定

- **WHEN** 审查模组的运行时依赖与可搜物品集合
- **THEN** 官方数据包的版本被精确固定，可搜物品集合不随安装环境漂移

### Requirement: 玩家枚举与属性读取须容忍模拟玩家与坏句柄

模组 MUST 经共享玩家守卫枚举在线玩家，MUST NOT 直接遍历在线玩家集合后裸读玩家属性。枚举结果 MUST 一并取得该玩家的已解析名字、维度标识与坐标快照；后续流程 MUST 使用快照，MUST NOT 重新读取玩家对象的维度或坐标。取不到位置的玩家 MUST 按「位置不可用」跳过，而 MUST NOT 中断整轮处理。

#### Scenario: 视觉反馈不因坏句柄崩溃

- **WHEN** 分拣触发视觉反馈，而维度内在线玩家枚举含 `undefined` 项或半初始化实体
- **THEN** 特效照常播放，坏句柄被跳过，不产生 `cannot read property 'location' of undefined`

#### Scenario: 容量预警仍送达真人

- **WHEN** 播报容量预警时在线玩家中混有模拟玩家与坏句柄
- **THEN** 范围内的真实玩家收到预警，坏句柄被跳过，播报流程不中断

#### Scenario: 成员邻近判定使用快照

- **WHEN** 判断某仓库附近是否有在线成员
- **THEN** 使用枚举时取得的坐标快照，位置不可用的玩家不计入

#### Scenario: 信物交互来自假人

- **WHEN** 模拟玩家手持信物右键方块
- **THEN** 模组按守卫结论处理该交互，不因读取其属性而抛错

#### Scenario: 仓库 HUD 渲染遇瞬态失效

- **WHEN** HUD 渲染回调收到的玩家句柄在渲染时已失效
- **THEN** 本帧不渲染该玩家的 HUD，其它玩家的 HUD 不受影响

### Requirement: 成员判定按守卫解析出的名字匹配

仓库成员判定 MUST 使用守卫解析出的名字与 owner / member 表匹配，MUST NOT 裸读玩家对象的名字属性。

#### Scenario: 登录名为空的模拟玩家成员

- **WHEN** 一个登录名为空、显示名与成员表条目一致的模拟玩家在线
- **THEN** 模组仍能将其识别为对应成员

#### Scenario: 取不到名字的条目被丢弃

- **WHEN** 某个在线玩家条目的所有名字候选都不可读
- **THEN** 该条目被丢弃，不参与成员判定，也不使流程抛错

### Requirement: 命令入口须拒绝模拟玩家并交付已解析名字

自定义命令 MUST 在入口按守卫结论拒绝模拟玩家并返回失败状态与可读提示，MUST NOT 推迟后静默丢弃。命令回调经推迟执行时 MUST 在推迟内部重新校验句柄可用性。命令处理器 MUST 从上下文取得守卫解析出的玩家名，MUST NOT 裸读玩家对象的名字属性。

#### Scenario: 假人执行命令

- **WHEN** 模拟玩家执行任一条 `/ir:*` 命令
- **THEN** 命令返回失败状态与「该命令不能由模拟玩家执行」提示，处理器不被调用

#### Scenario: 推迟期间句柄失效

- **WHEN** 命令回调返回成功，但在推迟回调执行前玩家句柄失效
- **THEN** 推迟回调静默跳过，不向控制台抛出异常

#### Scenario: 命令内读取玩家维度与坐标

- **WHEN** 命令需要玩家所在维度或坐标（建仓、改区、整理、搜索）
- **THEN** 该读取经守卫完成，读取失败时给出可读提示而非抛错

### Requirement: 管理员判定须排除模拟玩家

管理员判定 MUST 在读取权限等级前排除模拟玩家，且权限等级读取失败时 MUST 按「非管理员」处理。

#### Scenario: 假人带 Operator 级别

- **WHEN** 模拟玩家的权限等级达到 Operator
- **THEN** 模组仍不将其视为管理员

#### Scenario: 权限字段不可读

- **WHEN** 玩家对象的权限等级读取抛错
- **THEN** 判定为「非管理员」，不使调用方抛错

### Requirement: 菜单按钮带图标

模组的主菜单与二级菜单按钮 MUST 显示图标，图标 MUST 来自资源包 `textures/ui/item-route/` 目录，并按 `textures/ui/item-route/<图标名>` 的路径在代码中引用。图标风格 MUST 与 `textures/ui/mockplayer/` 下的既有图标一致。

#### Scenario: 主菜单按钮显示图标

- **WHEN** 玩家执行 `ir:menu` 打开主菜单
- **THEN** 每个按钮左侧显示对应图标，而不是仅有文字标签

#### Scenario: 图标缺失时菜单仍可用

- **WHEN** 某个按钮引用的图标纹理在资源包中不存在
- **THEN** 按钮仍可点击并触发对应功能，不因缺少纹理而导致菜单打不开

#### Scenario: 图标风格与基准一致

- **WHEN** 并列观察 `textures/ui/item-route/` 与 `textures/ui/mockplayer/` 下的图标
- **THEN** 两者的轮廓硬度、明暗处理与色彩层次属于同一画法

