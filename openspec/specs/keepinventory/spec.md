# KeepInventory Specification

## Purpose

一个面向 Minecraft Bedrock 的行为包:玩家死亡后保留物品栏,且不通过开启作弊来达成,使世界在平台允许外部行为包的版本上仍可正常获得成就。

## Requirements

### Requirement: 死亡后保留物品

模组 MUST 在世界加载完成事件(`world.afterEvents.worldLoad`)触发后把 `keepInventory` 游戏规则设为开启,使玩家死亡时不掉落物品栏与经验。该规则是世界级状态,与具体玩家无关,因此模组 MUST NOT 订阅玩家事件来重复设置。

#### Scenario: 世界加载后规则被开启

- **WHEN** 装模组的世界被加载
- **THEN** `keepInventory` 游戏规则为开启,玩家死亡后物品栏内容保留

#### Scenario: 不依赖玩家事件触发

- **WHEN** 世界加载完成但尚未有任何玩家加入
- **THEN** `keepInventory` 已经是开启状态,规则设置不依赖玩家生成事件

### Requirement: 不开启作弊且不引入实验性功能

模组 MUST NOT 开启世界作弊、MUST NOT 声明或依赖实验性(experimental)能力,且 MUST NOT 修改 `keepInventory` 之外的任何游戏规则(尤其不得开启 `commandBlocksEnabled`)。

#### Scenario: 世界不需要作弊

- **WHEN** 在未开启作弊的世界中启用模组
- **THEN** 死亡不掉落正常生效,且世界的作弊开关保持为关闭

#### Scenario: 只改动一个游戏规则

- **WHEN** 对比启用模组前后的世界游戏规则
- **THEN** 只有 `keepInventory` 被模组改变

### Requirement: 兼容下限为 Minecraft 1.21.90

行为包 MUST 声明 `min_engine_version` 为 `[1, 21, 90]` 且脚本模块依赖为 `@minecraft/server [2, 0, 0]`;实现 MUST 只使用 `@minecraft/server` 2.0.0 起可用的 API。

#### Scenario: 在最低支持版本加载

- **WHEN** 在 Minecraft 1.21.90 世界的脚本环境加载该行为包
- **THEN** 行为包成功加载,`keepInventory` 被设为开启

#### Scenario: 不使用高版本专属 API

- **WHEN** 审查模组源码所引用的 `@minecraft/server` API
- **THEN** 所用 API 均存在于 `@minecraft/server` 2.0.0 中

### Requirement: 声明为附加内容以争取成就可用

行为包的 `manifest.json` MUST 通过 `metadata.product_type: "addon"` 自我标识为附加内容;在平台允许外部行为包保留成就的版本(Minecraft < 1.26.50)上,启用本模组后成就 MUST 仍可获得。Minecraft ≥ 1.26.50 因平台 bug(MCPE-242529)会禁用侧载行为包的成就,该限制 MUST 在模组文档中记录为平台限制而非模组行为。

#### Scenario: 低版本成就仍可获得

- **WHEN** 在 Minecraft 1.26.40 及更早、未开启作弊的世界中启用本模组并完成一个成就条件
- **THEN** 成就正常解锁

#### Scenario: 高版本限制被记录

- **WHEN** 阅读模组文档
- **THEN** 明确说明 1.26.50 及以后因外部行为包导致成就被禁用属已知平台问题(MCPE-242529)
