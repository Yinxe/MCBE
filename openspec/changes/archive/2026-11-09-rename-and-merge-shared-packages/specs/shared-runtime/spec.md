# Spec Delta

## REMOVED Requirements

### Requirement: 共享运行时包位于 `packages/` 工作区

**Reason**: 共享运行时包 `@mc-toolchain/shared` 与共享界面包 `@mc-toolchain/ui` 合并为单一共享包 `@mc-toolchain/mod-common`,本能力不再对应独立包。
**Migration**: 模组把对 `@mc-toolchain/shared` 的依赖与导入改为 `@mc-toolchain/mod-common`;包位置与依赖约束见 `mod-common` 能力。

### Requirement: 运行时依赖只允许官方 Script API 包

**Reason**: 该约束已并入合并后的 `@mc-toolchain/mod-common`,在 `mod-common` 中作为同一要求继续生效。
**Migration**: 见 `mod-common` 能力的「运行时依赖只允许官方 Script API 包」。

### Requirement: 文本样式工具

**Reason**: 文本样式能力由 `@mc-toolchain/mod-common` 继续提供,不再由独立的 `@mc-toolchain/shared` 承载。
**Migration**: 把从 `@mc-toolchain/shared` 导入的 `color` / `style` 改为从 `@mc-toolchain/mod-common` 导入。

### Requirement: 屏幕 HUD 逐玩家优先级仲裁

**Reason**: HUD 仲裁能力由 `@mc-toolchain/mod-common` 继续提供,不再由独立的 `@mc-toolchain/shared` 承载。
**Migration**: 把从 `@mc-toolchain/shared` 导入的 `HudManager` / `HUD_SLOTS` 改为从 `@mc-toolchain/mod-common` 导入。

### Requirement: 同优先级决胜与声明过期

**Reason**: 该行为并入 `@mc-toolchain/mod-common` 的 HUD 仲裁实现,要求文本迁移至 `mod-common`。
**Migration**: 见 `mod-common` 能力的「同优先级决胜与声明过期」;跨包 `/scriptevent yinxe:hud` 协定不变。

### Requirement: 排除模拟玩家

**Reason**: 该行为并入 `@mc-toolchain/mod-common` 的 HUD 仲裁实现,要求文本迁移至 `mod-common`。
**Migration**: 见 `mod-common` 能力的「排除模拟玩家」。

### Requirement: 启停控制与源注销

**Reason**: 该行为并入 `@mc-toolchain/mod-common` 的 HUD 仲裁实现,要求文本迁移至 `mod-common`。
**Migration**: 见 `mod-common` 能力的「启停控制与源注销」。
