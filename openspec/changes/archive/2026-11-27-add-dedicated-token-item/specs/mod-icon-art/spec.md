# mod-icon-art Delta

## ADDED Requirements

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
