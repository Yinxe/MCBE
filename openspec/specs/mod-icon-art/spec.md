# mod-icon-art Specification

## Purpose

约束全仓模组图标与 UI 按钮图标的视觉风格、格式规范与自动化产出方式：确立 Minecraft 3D 体素拟物风格，并在全仓统一执行 256×256 分辨率与透明通道规范。

## Requirements

### Requirement: 图标尺寸与色彩格式

全仓模组图标（`pack_icon.png`）及 ActionForm 按钮图标 MUST 为 PNG 格式、尺寸 MUST 为 256×256 像素、色彩 MUST 具备透明通道（RGBA），背景区域 MUST 完全透明以适应游戏各类浅灰/半透明界面底板。

#### Scenario: 图像尺寸与通道核验

- **WHEN** 读取任一包图标或 UI 按钮图标的图像数据
- **THEN** 宽度与高度均为 256，色彩格式为带 Alpha 通道的 RGBA，且不存在无效断层

### Requirement: 视觉风格一致性

全仓模组图标 MUST 统一采用 Minecraft 3D 体素拟物风格（Minecraft Blocky Voxel Art）：外沿带有深色厚重手绘质感轮廓描边的圆角正方形徽章，中心展示具有原版材质纹理与立体阴影的方块/物品，禁止使用简陋的纯色块平涂占位图。

#### Scenario: 风格对齐核验

- **WHEN** 检查各模组的图标设计
- **THEN** 构图均具备立体体素结构与倒角光影，与 MockPlayer UI 图标风格视觉统一

### Requirement: 工具包统一收敛

全仓模组图标的切片与导出逻辑 MUST 集中维护于 `tools/icon-forge/`，禁止在各模组内部维护重复的独立生成脚本；各模组的 `generate:icon` 脚本统一调用 icon-forge 提供的批量工具入口。

#### Scenario: 脚本统一调用

- **WHEN** 在任意模组目录下执行 `npm run generate:icon`
- **THEN** 调用 icon-forge 工具从版本受控源图进行确定性分发与复现

### Requirement: 物品纹理的尺寸与格式

模组为自定义物品提供的物品纹理 MUST 为 PNG 格式、尺寸 MUST 为 16×16 像素、色彩 MUST 具备透明通道（RGBA），主体 MUST 填满画布内可辨识的范围且背景 MUST 完全透明。物品纹理 MUST 在资源包的 `textures/item_texture.json` 中以短名登记，并由物品定义通过该短名引用。

#### Scenario: 纹理尺寸与通道核验

- **WHEN** 读取任一物品纹理的图像数据
- **THEN** 宽度与高度均为 16，色彩格式为带 Alpha 通道的 RGBA

#### Scenario: 短名与文件路径一一对应

- **WHEN** 检查物品定义的图标短名与 `item_texture.json` 的条目
- **THEN** 该短名存在，且其纹理路径指向资源包内实际存在的 PNG 文件（路径不含扩展名）

#### Scenario: 短名缺失不导致包加载失败

- **WHEN** 物品定义引用的短名在 `item_texture.json` 中不存在
- **THEN** 包仍可加载，该物品仅缺少图标，不影响其它物品与模组功能

### Requirement: 物品纹理的风格与产出方式

物品纹理 MUST 采用与全仓图标同一画法的像素画风格（硬边轮廓、格内明暗层次、alpha 仅取 0 或 255），MUST NOT 使用照片素材或抗锯齿过渡像素。物品纹理 MUST 由 `tools/icon-forge/` 确定性生成，MUST NOT 在各模组内部维护独立的物品纹理生成脚本。

#### Scenario: 像素画风格核验

- **WHEN** 放大观察物品纹理
- **THEN** 边缘由离散像素块构成，不存在半透明过渡像素，主体具备明暗层次而非单色平涂

#### Scenario: 重复生成结果一致

- **WHEN** 在同一份版本受控源图与同一份生成配置下重复执行生成
- **THEN** 产出的物品纹理逐字节一致，可复现
