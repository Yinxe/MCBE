## ADDED Requirements

### Requirement: 工作台配方集与产物

模组 MUST 提供一组只使用 `crafting_table` 标签的合成配方,使玩家能在原版工作台上合成原版中不可合成、不可再生或仅能通过非合成途径获得的物品。每个配方 MUST 产出其声明的产物与数量,且 MUST NOT 依赖工作台以外的设备(熔炉、切石机、锻造台等)。

#### Scenario: 配方全部绑定工作台

- **WHEN** 检查模组内任一配方文件
- **THEN** 其 `tags` 仅含 `crafting_table`,不含 `furnace`、`stonecutter`、`smithing_table` 等其它标签

#### Scenario: 产物与数量与配方声明一致

- **WHEN** 玩家在工作台按某配方的图案或材料摆满并取出产物
- **THEN** 获得的物品与数量等于该配方 `result` 声明的 `item` 与 `count`(未声明 `count` 时按 1)

#### Scenario: 稀有物品可合成

- **WHEN** 玩家按配方摆出基岩、附魔金苹果、鞘翅、海洋之心、下界之星或海绵的材料
- **THEN** 工作台产出对应物品,不因该物品在原版中不可合成而拒绝合成

### Requirement: 配方标识符使用命名空间冒号形式

每个配方的 `description.identifier` MUST 形如 `<namespace>:<name>`,以冒号分隔命名空间与名称,MUST NOT 使用斜杠(`/`)或其它分隔符。命名空间 MUST 为本模组的命名空间,使配方 ID 不与原版或其它附加内容的配方冲突。

#### Scenario: 标识符使用冒号

- **WHEN** 读取任一配方的 `description.identifier`
- **THEN** 其形式为 `craftablerarities:<name>`,不含 `/`

#### Scenario: 配方 ID 全局唯一

- **WHEN** 汇总模组内全部配方的 `description.identifier`
- **THEN** 不存在重复值,且没有值与原版配方的 ID 相同

### Requirement: 物品引用使用完整命名空间 ID

配方中的材料与产物 MUST 使用带 `minecraft:` 前缀的完整命名空间 ID 引用物品,MUST NOT 依赖省略命名空间的简写或大小写旧别名(如 `Feather`、`String`、`TNT`)。引用 MUST 指向当前游戏版本仍可识别的 ID。

#### Scenario: 材料与产物带命名空间前缀

- **WHEN** 检查配方中任一 `item` 字段
- **THEN** 其值以 `minecraft:` 开头

#### Scenario: 不再使用大小写旧别名

- **WHEN** 检查配方中引用羽毛、线、TNT 的 `item` 字段
- **THEN** 其值为 `minecraft:feather`、`minecraft:string`、`minecraft:tnt`,而非 `Feather`、`String`、`TNT`

#### Scenario: 隐藏与 legacy 方块引用保持可识别

- **WHEN** 配方引用只存在于隐藏或 legacy 方块集合的物品(如 `netherreactor`、`glowingobsidian`、`moving_block`、`invisible_bedrock`、`end_gateway`)
- **THEN** 引用仍使用游戏可识别的 ID 形式,不因该 ID 未出现在物品清单中而被删除或替换为其它物品

### Requirement: 变种物品的引用写法以可证明等价为准

当配方引用原版中已按变种拆分的基础 ID 时,是否改写为拆分后的显式 ID,取决于该改写能否被证明与原有「基础 ID + 数据值」等价。**能证明等价的 MUST 改写为显式 ID;不能证明等价的 MUST 保留原写法**,MUST NOT 依据推测替换为未经证实的 ID。

#### Scenario: 可证明等价的变种被改写

- **WHEN** 某「基础 ID + 数据值」组合在官方数据值表中有唯一确定的拆分后 ID(如珊瑚、珊瑚块、头颅、虫蚀方块、石砖、染色玻璃板、染色陶瓦、双层植物、羊毛)
- **THEN** 配方引用拆分后的显式 ID(如 `minecraft:tube_coral`、`minecraft:infested_stone`、`minecraft:wither_skeleton_skull`、`minecraft:pink_tulip`)

#### Scenario: 无法证明等价的变种保留原写法

- **WHEN** 某「基础 ID + 数据值」组合没有可机械核对的拆分后 ID(如 `bubble_column` 的数据值只表达气泡柱的推拉方向、药水数据值表达药水种类)
- **THEN** 该引用保留「基础 ID + 数据值」写法,不被改写为推测的显式 ID

### Requirement: 配方规范化不改变合成结果

配方从旧式写法(斜杠标识符、省略命名空间前缀、基础 ID 加数据值)规范化为当前写法时,MUST 保持每个配方「材料集合 + 图案 + 产物 + 数量」四要素不变,使玩家用同一组材料仍得到同一产物。无法静态证明与规范化写法等价的引用 MUST 保留原写法,而不是改写为推测的 ID。

#### Scenario: 同一组材料仍产出同一物品

- **WHEN** 对比规范化前后的任一配方
- **THEN** 其材料集合、图案(有序配方)或材料列表(无序配方)、产物与数量完全一致,仅物品 ID 写法发生变化,配方版本号与配方书解锁条件不变

#### Scenario: 无法证明等价的引用保持原样

- **WHEN** 某物品 ID 只存在于 legacy 或隐藏方块集合,且没有可确认的扁平化对应 ID
- **THEN** 该引用保留原有写法,不做猜测性替换

#### Scenario: 配方总数不变

- **WHEN** 对比规范化前后的配方文件集合
- **THEN** 配方数量与每个配方的产物一一对应,没有配方被删除或合并

### Requirement: 创造物品栏补充

模组 MUST 通过行为包内的物品目录清单,把原版创造模式物品栏中不可直接获取的隐藏或技术性方块补充进创造物品栏,使创造模式玩家无需命令即可取用。

#### Scenario: 隐藏方块出现在创造物品栏

- **WHEN** 创造模式玩家打开物品栏并浏览对应分类
- **THEN** 可看到屏障、结构方块、结构空位、命令方块变种、传送门类方块、静态水与静态岩浆、气泡柱、移动方块、活塞头等技术性方块条目

#### Scenario: 物品目录清单随行为包生效

- **WHEN** 行为包被世界启用
- **THEN** 其物品目录清单被游戏加载,补充条目无需脚本或命令即可生效

### Requirement: 模组不引入脚本运行时依赖

模组 MUST 只由行为包内容(配方与物品目录清单)构成,MUST NOT 声明脚本模块或脚本 API 依赖,使模组可在不开启实验性玩法、不依赖脚本 API 版本的前提下加载。

#### Scenario: 行为包清单不含脚本模块

- **WHEN** 检查行为包 `manifest.json` 的 `modules`
- **THEN** 不存在 `type` 为 `script` 的模块,也不存在对 `@minecraft/server` 的模块依赖

#### Scenario: 无脚本也能生效

- **WHEN** 世界启用该行为包且未启用任何实验性开关
- **THEN** 配方与创造物品栏补充均正常生效
