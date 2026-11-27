# item-route Delta

## ADDED Requirements

### Requirement: 专属信物物品的身份

模组 MUST 提供一个命名空间不属于 `minecraft:` 的自定义物品作为唯一信物。信物判定 MUST 只认该物品类型，MUST NOT 把任何原版物品当作信物；信物的获取与使用 MUST NOT 依赖可配置的物品 ID。使用信物 MUST NOT 消耗该物品。

#### Scenario: 原版物品不再触发交互

- **WHEN** 玩家手持木锄右键方块
- **THEN** 模组不记录选点、不打开仓库菜单、不取消原版交互，木锄照常执行原版行为

#### Scenario: 旧世界的信物配置被忽略

- **WHEN** 一个保存过旧版 `tokenItemId`（例如木锄）的世界加载新版本模组
- **THEN** 该字段被忽略，木锄不是信物，模组不因此报错

#### Scenario: 使用信物不消耗

- **WHEN** 玩家手持信物右键方块或对空使用
- **THEN** 信物仍在玩家手中，数量不变

### Requirement: 信物获取途径

信物 MUST 可通过创造物品栏取得，MUST 可通过原版 `/give` 按物品类型取得，MUST 可通过 `ir:token` 命令补齐到背包；背包已满时 `ir:token` MUST 把信物丢在玩家脚下并提示，MUST NOT 静默失败。

#### Scenario: 创造物品栏取得

- **WHEN** 玩家在创造模式打开物品栏并翻到物品分类
- **THEN** 信物出现在该分类中，可被取出

#### Scenario: 命令补齐信物

- **WHEN** 玩家背包没有信物且存在空位，执行 `ir:token`
- **THEN** 信物被放进背包并提示已获得

#### Scenario: 背包已满时溢出到地面

- **WHEN** 玩家背包没有空位时执行 `ir:token`
- **THEN** 信物被丢在玩家脚下，并提示已丢在地上

### Requirement: 信物合成配方

信物 MUST 有可在工作台完成的原版合成配方，使生存模式玩家无需管理员介入即可自制信物。

#### Scenario: 生存模式自制信物

- **WHEN** 生存模式玩家在工作台按配方摆放原料并取出产物
- **THEN** 得到信物，且原料按配方消耗

#### Scenario: 配方产物是信物

- **WHEN** 检查配方定义
- **THEN** 配方产物类型与模组信物的物品类型一致，不是任何原版物品

## MODIFIED Requirements

### Requirement: 仓库创建与区域圈定

玩家 MUST 能用信物依次点击区域的两个角完成圈定并创建仓库；仓库 MUST 有玩家指定的显示名，创建者 MUST 成为该仓库的 owner。命令入口 MUST 允许在一条命令内直接给出名称与两个角坐标。

#### Scenario: 信物两次点击建仓

- **WHEN** 玩家手持信物点击第一个角，再点击第二个角
- **THEN** 系统以该区域创建仓库，创建者为 owner，并提示仓库已创建

#### Scenario: 命令一次给出名称与坐标

- **WHEN** 玩家执行 `ir:create <名称> <pos1> <pos2>`
- **THEN** 系统以给定名称与该区域创建仓库，效果与信物圈定一致

#### Scenario: 名称重复被拒绝

- **WHEN** 玩家用已存在的仓库显示名创建仓库
- **THEN** 创建被拒绝并提示名称已被占用，不产生新仓库

### Requirement: 信物交互与选区会话

玩家 MUST 用模组专属信物完成圈定与容器点选交互。系统 MUST 维护选区会话状态，使同一玩家的多次点击按流程推进，并 MUST 在会话取消或超时后清除状态，不残留半成品仓库。

#### Scenario: 两次点击推进选区

- **WHEN** 玩家持信物点击第一个角后点击第二个角
- **THEN** 会话从「等待第一角」推进到「完成」，随后被清除

#### Scenario: 取消会话不产生仓库

- **WHEN** 玩家圈定第一个角后取消选区
- **THEN** 会话被清除且不产生任何仓库

### Requirement: 命令集与帮助

模组 MUST 提供 10 条命名空间为 `ir:` 的命令：`create`、`resize`、`delete`、`rescan`、`rescan_preview`、`organize`、`search`、`menu`、`help`、`token`，参数形态分别为「名称 + 两角坐标」「名称」「查询词」「无参」。命令 MUST 对所有玩家可用（不要求 cheats），权限由仓库成员关系在回调内判定。`ir:help` MUST 输出可用命令与用法。

#### Scenario: 帮助列出全部命令

- **WHEN** 玩家执行 `ir:help`
- **THEN** 输出包含上述 10 条命令及其参数用法

#### Scenario: 命令无需 cheats

- **WHEN** 未开启 cheats 的世界中玩家执行 `ir:menu`
- **THEN** 命令可被调用，不因 cheats 设置被拒绝
