# Design

## Context

见 `proposal.md` — Why。设计相关现状：

- `McModConfig` 把信物当**配置数据**：`tokenItemId` 默认 `minecraft:wooden_hoe`，`TOKEN_OPTIONS` 列出 12 种原版物品，`isToken(typeId)` 做字符串比较，`setTokenItemId()` 落盘到 `ir2:modcfg`。信物判定被 4 处消费：`ToolInteractionController`（方块交互）、`persistentBoundary`（边界光幕守卫）、`SearchUI`（搜索粒子标记）、`organizeInventory` 之外的 HUD 逻辑。
- 模组当前**没有任何自定义物品**：`behavior_packs/item-route/` 与 `resource_packs/item-route/` 只有 `manifest.json` 与 `pack_icon.png`，`items/`、`recipes/`、`texts/`、`textures/item_texture.json` 全不存在。资源包已有 `textures/ui/item-route/*.png` 与 `particles/itemroute/*.particle.json`，证明命名空间 `itemroute` 与资源包分发链路已通。
- 命名空间 `itemroute` 已被粒子占用（`itemroute:sort` / `itemroute:deposit`），自定义物品沿用同一命名空间可避免再造一个域。
- `tools/icon-forge/` 是既有的图标确定性产出工具（`src/png.js` 暴露 `decodePng`/`encodePng`，`bin/slice-all.js` 负责分发），但只服务 256×256 的包图标与 UI 按钮图标。
- 测试用 Node 原生 test runner + `tsx`，通过 `tests/tsconfig.json` 的 include 白名单限定可测模块；`storage/**` 与 `core/**` 在列，`mc/**` 的 UI/命令层只在 `commands/register.ts`、`auth/*` 等少数文件被覆盖。测试环境没有 `@minecraft/server` 运行时，物品定义类校验只能读 JSON。

## Goals / Non-Goals

**Goals:**

- 让「什么是信物」成为**单一事实来源**：一个常量 + 一个纯函数，所有调用点与测试共用。
- 让信物身份可被玩家从**物品本身**识别：图标、中文名、创造栏分类、合成配方。
- 让移除可选信物配置**不产生兼容崩溃**：旧配置字段静默忽略，不抛错、不回退。
- 让物品纹理产出走既有 icon-forge 通道，避免模组内二次实现像素生成。

**Non-Goals:**

- 不做信物与玩家绑定（不写 owner、不做「仅某人可用」）。信物仍是可交易、可多人共用的工具。
- 不做旧木锄自动换成新信物（不做在线迁移、不扫描背包替换）。理由见 Decisions。
- 不改动信物的**交互语义**（两次点击圈定、右键开菜单、选区会话状态机、超时）——只换判定依据。
- 不引入 NBT 打标（`nameTag`/`lore`）来区分信物。理由见 Decisions。
- 不把信物加入 `ItemNameMap` 搜索宇宙：`searchItems` 服务的是**仓库内容搜索**，信物不是被搜的仓库物品。
- 不提升版本号：本次是功能重构，`package.json` 与两个 manifest 的版本保持 `0.1.21`，发版节奏由常规发布流程决定。

## Decisions

### 1. 用数据驱动自定义物品，而非 NBT 打标的原版物品

**选择**：新增 `itemroute:warehouse_token` 数据驱动物品（BP `items/*.json`）。

**备选 A**：沿用原版物品 + NBT 标记（teleporter 的做法：`minecraft:lodestone_compass` + `nameTag`/`lore` 判定）。
**备选 B**：沿用原版物品 + 全局配置（现状）。

**理由**：备选 A/B 都要求「原版物品 + 附加判据」。备选 B 的问题正是本次要修的（配置漂移、占用原版物品）。备选 A 虽解决了配置漂移，但仍**占用一个原版物品**：玩家手里的磁石罗盘会莫名变成信物或反之，且 `lore` 判定对玩家可编辑（铁砧改 lore 即可伪造/破坏信物），判定成本也高于一次 `typeId` 比较。数据驱动物品有独立 typeId，判定退化为一次字符串相等，且物品身份对玩家可见（图标 + 名称）。

**代价**：需要维护物品 JSON + 纹理 + 语言文件 + `item_texture.json`，是四份新增资产。

### 2. 信物判定抽到 `core/token.ts` 纯函数，配置层只保留一个常量

**选择**：`scripts/core/token.ts` 导出 `TOKEN_TYPE_ID = "itemroute:warehouse_token"` 与 `isWarehouseToken(typeId)`。

**理由**：`core/**` 在 `tests/tsconfig.json` 白名单内且不 import `@minecraft/server`，测试可直接跑；`McModConfig` 从「配置读取者」退化为「配置存储者」，不再承担信物语义。所有 4 处调用点改为引用常量，避免「4 个地方各写一次字符串」。

**备选**：把常量放在 `McModConfig` 里保留 `config.isToken()`。否决原因：那会让配置层继续承载语义，且删字段后 `isToken` 仍存在，容易让人误以为信物可配。

### 3. 删除而非废弃 `tokenItemId`

**选择**：`ModConfigData` 删除 `tokenItemId` 字段、`TOKEN_OPTIONS`、`setTokenItemId()`；`OPConfigUI` 删除下拉与状态行。

**理由**：保留字段但不读取会产生「配置界面没这个选项，但存档里有」的僵尸字段；保留 `setTokenItemId` 但无 UI 则留下死代码。本次按功能重构合入，不提升版本号、不写迁移代码。

**兼容处理**：`DynamicPropertyStore` 读到的旧 JSON 里多出的 `tokenItemId` 键在 `JSON.parse` 后成为对象多余属性，`ModConfigData` 类型不声明即自然忽略；下次保存时整体覆盖写回，字段被丢弃。**不需要**迁移代码。

### 4. 不自动把旧木锄换成新信物

**选择**：升级后玩家需通过 `ir:token` / 合成 / 创造栏自行取得信物。

**备选**：启动时扫描在线玩家背包，把 `minecraft:wooden_hoe` 替换为信物。
**否决理由**：木锄是正常可合成物品，玩家可能真的在用它耕地；无差别替换会毁掉玩家的农具。只替换「带旧 lore 的木锄」也不成立——旧版信物就是**裸木锄**，没有标记可依据。因此自动迁移在信息上不可能正确，只能靠玩家主动获取，用 `ir:token` 把成本降到一条命令。

### 5. 发放逻辑放 `mc/token.ts`，命令只做权限与提示

**选择**：`createWarehouseToken()` 返回 `ItemStack`，`giveWarehouseToken(player)` 负责「优先放背包，满了丢脚下」并返回结果枚举；`commands/token.ts` 只负责调用与发消息。

**理由**：与 teleporter 的 `mc/token.ts` 结构对齐；发放策略（背包满怎么办）是可被单测覆盖的纯决策，抽成 `decideGiveOutcome` 式纯函数便于测试，也避免命令层掺入容器操作。

**物品属性**：`keepOnDeath = true`（死亡不掉落，信物是工具不是资源）、`lockMode = ItemLockMode.inventory`（不可放入容器/展示框，避免信物被塞进仓库箱子后玩家找不到）、`maxAmount` 保持默认 64。

### 6. 合成配方用无序合成（箱子 + 木棍）

**选择**：`minecraft:recipe_shapeless`，ingredients = `minecraft:chest` + `minecraft:stick`，产物 1 个信物，`tags: ["crafting_table"]`，`unlock` 指向 `minecraft:chest`。

**理由**：信物是「仓库」的钥匙，箱子是最贴近语义的原料；木棍保证生存早期可得。无序合成对 2 个原料足够，避免形状记忆负担。`unlock` 让配方在玩家见过箱子后出现在配方书里（`min_engine_version` 已满足 `>= 1.20.11` 的要求）。

**备选**：铁锭 + 箱子（更「贵重」）。否决：会让信物在游戏早期不可得，而仓库本身是早期需求。

### 7. `ir:token` 归入 `create` 同级的 `any` 权限

**选择**：`COMMAND_MIN_ROLE` 增加 `token: "any"`。

**理由**：信物是所有玩家使用模组的前提，若要求 owner/member 才能拿信物，则新玩家无法自助加入（先有鸡还是先有蛋）。命令只能给**自己**发信物，无法指定他人，因此不存在滥用面。

### 8. 物品纹理走 icon-forge，新增 16×16 物品产出通道

**选择**：在 `tools/icon-forge/` 增加物品纹理生成入口（读版本受控源图 → 输出 16×16 RGBA PNG），`mods/item-route/package.json` 的 `generate:icon` 脚本串联调用；产物落在 `resource_packs/item-route/textures/itemroute/items/warehouse_token.png`。

**理由**：`mod-icon-art` 要求全仓图标逻辑收敛于 `tools/icon-forge/`。物品纹理虽然尺寸不同，但同样是「确定性产出 + 版本受控源」，复用同一工具避免第二次造轮子。

**备选**：模组内单独写 `scripts/gen-token-texture.mjs`。否决：直接违反 `mod-icon-art` 的收敛要求。

### 9. 语言文件只写 `zh_CN` 与 `en_US`

**选择**：`texts/languages.json = ["zh_CN","en_US"]`，两个 `.lang` 都写 `item.itemroute:warehouse_token.name`。

**理由**：项目文档与注释为简体中文，`zh_CN` 是主语言；`en_US` 是 Bedrock 回退语言，缺失会导致非中文客户端显示原始键名。其余语言由游戏回退到 `en_US`，不逐个维护。

## Risks / Trade-offs

- **旧世界玩家「信物失效」困惑** → 新手引导与 `ir:help` 明确写出「仓库信物（`ir:token` 获取）」，且 `ir:token` 可随时补齐；README 增加升级说明。
- **`ir:token` 被反复执行刷物品** → 判定「背包/主栏/副手已有信物则不再发放」，只补齐不叠加；信物本身不是资源，重复获取无收益。
- **自定义物品在旧版客户端/服务端不识别** → `min_engine_version` 已在 manifest 中约束；`item_texture.json` 短名缺失时游戏仅丢图标，不阻断加载（已写入 spec 场景）。
- **`keepOnDeath` + `lockMode: inventory` 可能与某些容器操作冲突** → 信物不可入容器是**期望行为**（防止信物被锁进仓库箱子）；若玩家把信物放进潜影盒，`lockMode` 会阻止该操作并给出原版提示，属可接受限制。
- **删除 `tokenItemId` 影响 `tests/mc-mod-config.test.ts`** → 该测试中两条信物用例随字段一起删除，其余配置用例不受影响；新增 `token.test.ts` 覆盖判定与物品资产一致性。
- **icon-forge 新增 16×16 通道可能影响既有 256×256 产出** → 新入口为独立函数与独立 npm 脚本，不改动 `slice-all.js` 的既有分支；以「既有图标产出逐字节不变」作为回归判据。
- **配方与自定义物品的 `format_version` 不匹配导致配方不生效** → 物品与配方统一用与 bedrock-samples 一致的 `1.26.30`（物品）/ `1.20.10`（配方）组合，并在任务中加一条「进游戏验证配方可见且可取产物」。

## Migration Plan

1. 本次按功能重构合入，`package.json` 与两个 manifest 的版本号保持 `0.1.21` 不变；版本提升留到下一次常规发版时统一处理。
2. 旧世界加载后：`ir2:modcfg` 中的 `tokenItemId` 被忽略；首次保存配置时字段消失。
3. 玩家侧：执行 `ir:token` 或合成取得信物；旧木锄恢复为普通农具。
4. 回滚策略：若需回退，玩家已获得的 `itemroute:warehouse_token` 会变成「未知物品」并在加载时被游戏移除；旧版本仍读 `tokenItemId`（若曾保存过则沿用，否则默认木锄），功能可恢复。**数据不迁移，双向均无需手工干预。**
