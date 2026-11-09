## MODIFIED Requirements

### Requirement: 图标文件的位置与格式

行为包 MUST 在其包目录根部提供名为 `pack_icon.png` 的图标文件,供游戏与分发平台展示该包。图标 MUST 为 PNG 格式,尺寸 MUST 为 128×128 像素,色彩 MUST 带 alpha 通道(RGBA)。

#### Scenario: 图标位于包目录根部

- **WHEN** 检查 `behavior_packs/<name>/` 包目录
- **THEN** 根部存在 `pack_icon.png`,且它与 `manifest.json` 同级

#### Scenario: 图标尺寸与格式符合约定

- **WHEN** 读取该图标文件的图像信息
- **THEN** 格式为 PNG、尺寸为 128×128、色彩类型为带 alpha 通道的 RGBA

#### Scenario: 图标缺失被检出

- **WHEN** 包目录根部没有 `pack_icon.png`
- **THEN** 校验流程报出图标缺失,而不是静默通过
