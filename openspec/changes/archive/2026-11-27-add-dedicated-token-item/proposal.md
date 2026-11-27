# 提案：为物品路由模组提供专属信物

## Why

当前 `item-route` 的信物是「可选的原版物品」：`McModConfig.tokenItemId` 默认 `minecraft:wooden_hoe`，管理员可在 `TOKEN_OPTIONS`（12 种原版物品）之间随意切换。这带来三个实际问题：

1. **信物与原版物品冲突**：木锄、木棍、羽毛等被选为信物后，玩家对这些物品的正常用途（耕地、合成、丢弃）被模组劫持并取消默认行为，而玩家无法从物品本身看出它已被模组占用。
2. **全服配置不一致**：信物是全局配置项，管理员改一次会影响所有玩家已持有的物品；不同世界的信物不同，玩家之间无法互相告知「用什么开启仓库」。
3. **缺少可辨识的物品身份**：模组没有任何自定义物品，玩家无法通过物品外观、名称、创造物品栏识别「这是物品路由模组的信物」。

模组已经具备资源包（粒子纹理与 UI 图标），具备承载自定义物品纹理的能力，因此可以引入一个模组专属信物物品，并把「信物可换」这一可选配置整体移除。

## What Changes

- **新增自定义物品** `itemroute:warehouse_token`（中文名「仓库信物」）：行为包物品定义 + 资源包 16×16 物品纹理 + `item_texture.json` 短名 + 语言文件条目。
- **新增获取途径（三种同时提供）**：
  - 创造物品栏 `items` 分类中直接取得；
  - 原版 `/give itemroute:warehouse_token`；
  - 新增命令 `ir:token`，任意玩家可把自己的信物补齐到背包（背包满则掉落在脚下）。
- **新增合成配方**：工作台无序合成（箱子 + 木棍 → 1 个仓库信物），使生存模式玩家可自行制作。
- **移除可选信物配置**：删除 `ModConfigData.tokenItemId`、`setTokenItemId()`、`TOKEN_OPTIONS` 与管理员配置界面的「信物」下拉与状态行；信物判定改为固定常量 `itemroute:warehouse_token` 的类型比较。
- **木锄不再是信物**：更新后原版木锄、木棍等任何原版物品都不再触发模组交互；旧世界中已保存的 `tokenItemId` 字段被忽略且在下一次保存配置时被丢弃，不回退到任何原版物品。
- **界面与文档同步**：新手引导、帮助手册、管理员配置面板、README 中的「木锄」表述改为「仓库信物」，并说明获取方式。
- **新增物品纹理生成工具**：在 `tools/icon-forge/` 下新增 16×16 物品纹理的确定性生成入口，避免在模组内部另写生成脚本。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `item-route`: 信物从「可配置的原版物品」改为「模组专属自定义物品」，并新增获取途径（创造栏 / `/give` / 合成 / `ir:token`）；建仓圈定与信物交互两条需求中的「木锄」改为「仓库信物」；命令集从 9 条变为 10 条。
- `mod-icon-art`: 新增「物品纹理」资产类别——16×16 PNG、像素画风格、由 `tools/icon-forge/` 确定性生成并在资源包中以 `item_texture.json` 短名登记。

## Impact

- **行为包**：`mods/item-route/behavior_packs/item-route/` 新增 `items/warehouse_token.json` 与 `recipes/warehouse_token.json`。
- **资源包**：`mods/item-route/resource_packs/item-route/` 新增 `textures/itemroute/items/warehouse_token.png`、`textures/item_texture.json`、`texts/languages.json`、`texts/zh_CN.lang`、`texts/en_US.lang`。
- **脚本**：
  - 新增 `scripts/core/token.ts`（信物类型常量与 `isToken` 纯判定）。
  - 新增 `scripts/mc/token.ts`（`ItemStack` 构造与发放，含背包满溢出）与 `scripts/mc/commands/token.ts`（`ir:token`）。
  - 修改 `scripts/mc/storage/McModConfig.ts`（删字段/删选项/删 setter）、`scripts/mc/ui/OPConfigUI.ts`（删下拉）、`scripts/mc/ui/NewPlayerGuide.ts`、`scripts/mc/ui/HelpGuide.ts`、`scripts/mc/auth/commands.ts`（权限矩阵加 `token`）、`scripts/mc/commands/index.ts`、`scripts/main.ts` 及四处 `isToken` 调用点。
- **工具**：`tools/icon-forge/` 新增物品纹理生成入口；`mods/item-route/package.json` 增加对应脚本。
- **测试**：`tests/mc-mod-config.test.ts` 删除信物配置用例；新增信物判定与「物品定义/短名/纹理/语言」一致性用例。
- **兼容性**：旧世界配置中的 `tokenItemId` 被静默忽略；玩家已持有的木锄失去信物功能，需要重新获取仓库信物。本次按功能重构合入，版本号保持 `0.1.21` 不变，版本提升留到下一次常规发版统一处理。
