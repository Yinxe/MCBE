# Spec Delta

## Purpose

约束全仓模组图标与 UI 按钮图标的视觉风格、格式规范与自动化产出方式：确立 Minecraft 3D 体素拟物风格，并在全仓统一执行 256×256 分辨率与透明通道规范。

## ADDED Requirements

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
