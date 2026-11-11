# Pack Icon Specification

## Purpose

约束行为包图标资源的位置、格式与画面语义,使模组在游戏与分发平台上具备与功能一致、且在小尺寸下仍可辨识的外观,而不是沿用脚手架生成的占位图。

## Requirements

### Requirement: 图标文件的位置与格式

行为包 MUST 在其包目录根部提供名为 `pack_icon.png` 的图标文件,供游戏与分发平台展示该包。图标 MUST 为 PNG 格式,尺寸 MUST 为 256×256 像素,色彩 MUST 带 alpha 通道(RGBA)。同时具备资源包的模组,MUST 在资源包目录根部同样提供一份满足相同约束的 `pack_icon.png`。

#### Scenario: 图标位于包目录根部

- **WHEN** 检查 `behavior_packs/<name>/` 包目录
- **THEN** 根部存在 `pack_icon.png`,且它与 `manifest.json` 同级

#### Scenario: 图标尺寸与格式符合约定

- **WHEN** 读取该图标文件的图像信息
- **THEN** 格式为 PNG、尺寸为 256×256、色彩类型为带 alpha 通道的 RGBA

#### Scenario: 图标缺失被检出

- **WHEN** 包目录根部没有 `pack_icon.png`
- **THEN** 校验流程报出图标缺失,而不是静默通过

#### Scenario: 资源包同样提供图标

- **WHEN** 检查一个同时具备行为包与资源包的模组的资源包目录
- **THEN** 其根部也存在满足 256×256 RGBA 约束的 `pack_icon.png`

### Requirement: 图标内容反映模组功能

图标 MUST 采用像素画(pixel art)风格,且画面 MUST 表达该模组的功能语义,不得使用脚手架生成的通用占位图。对保留物品栏类模组,画面 MUST 同时传达「玩家已死亡」与「背包物品仍保留」两个语义。

#### Scenario: 不使用模板占位图

- **WHEN** 审查图标内容
- **THEN** 它不是 `mct create` 模板自带的占位图,画面与模组功能相关

#### Scenario: 画面语义与功能对应

- **WHEN** 一个模组的功能是玩家死亡后保留物品栏
- **THEN** 图标画面同时体现死亡状态与物品保留,使玩家在不阅读描述的情况下也能大致判断模组用途

#### Scenario: 小尺寸下仍可辨识

- **WHEN** 图标以 64×64 或更小尺寸显示
- **THEN** 主体元素仍清晰可辨,不依赖细微纹理或小字说明

### Requirement: 图标风格一致性

图标 MUST 以 32×32 的逻辑造型网格构图,并在每格内部呈现柔和明暗,使主体具备体积感;风格基准 MUST 为 `mods/mockplayer3/resource_packs/mockplayer3/textures/ui/mockplayer/` 下的既有图标。图标 MUST 使用硬边轮廓,每个像素的 alpha MUST 为 0 或 255,MUST NOT 出现半透明抗锯齿像素;MUST NOT 使用照片素材或外部字体渲染的文字,如需文字 MUST 以像素块绘制且不得作为传达主要语义的唯一手段。

#### Scenario: 像素画风格

- **WHEN** 放大观察图标
- **THEN** 边缘由离散像素块构成,不出现半透明过渡像素,格内存在明暗层次而非一格一色的平涂

#### Scenario: alpha 为二值

- **WHEN** 遍历图标全部像素的 alpha 值
- **THEN** 只存在 0 与 255 两种取值

#### Scenario: 风格与基准图标一致

- **WHEN** 把图标与 `textures/ui/mockplayer/` 下的任一图标并列观察
- **THEN** 两者的轮廓硬度、明暗处理与色彩层次属于同一画法

#### Scenario: 不依赖文字传达语义

- **WHEN** 图标在无法显示文字的场合被展示
- **THEN** 仍能通过图形元素理解模组用途
