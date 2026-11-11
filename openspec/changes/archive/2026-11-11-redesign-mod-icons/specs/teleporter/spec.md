# Spec Delta

## ADDED Requirements

### Requirement: 传送菜单按钮带图标

模组的传送主菜单与二级菜单按钮 MUST 显示图标，图标 MUST 来自资源包 `textures/ui/teleporter/` 目录，并按 `textures/ui/teleporter/<图标名>` 的路径在代码中引用。图标风格 MUST 与 `textures/ui/mockplayer/` 下的既有图标一致。

#### Scenario: 主菜单按钮显示图标

- **WHEN** 玩家使用传送信物打开传送主菜单
- **THEN** 每个按钮左侧显示对应图标，而不是仅有文字标签

#### Scenario: 图标缺失时菜单仍可用

- **WHEN** 某个按钮引用的图标纹理在资源包中不存在
- **THEN** 按钮仍可点击并触发对应功能，不因缺少纹理而导致菜单打不开

#### Scenario: 图标风格与基准一致

- **WHEN** 并列观察 `textures/ui/teleporter/` 与 `textures/ui/mockplayer/` 下的图标
- **THEN** 两者的轮廓硬度、明暗处理与色彩层次属于同一画法

### Requirement: 资源包形态

模组 MUST 以行为包加资源包的双包形态存在，打包 MUST 产出 `.mcaddon` 到仓库根 `release/` 目录，MUST NOT 把产物留在模组目录内。资源包 MUST 只承载纹理与包元数据，MUST NOT 含脚本。

#### Scenario: 打包产出 mcaddon

- **WHEN** 执行打包命令
- **THEN** 在 `release/` 下产出包含行为包与资源包的 `.mcaddon` 文件

#### Scenario: 资源包不含脚本

- **WHEN** 检查资源包目录内容
- **THEN** 其中不存在 JavaScript 或 TypeScript 源文件，只有纹理、清单与图标
