# Spec Delta

## ADDED Requirements

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
