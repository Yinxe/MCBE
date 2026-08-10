# AutoRefill

Minecraft Bedrock「自动替换」Add-On，行为包（TypeScript + Script API）。基于 `@minecraft/server`，主手物品被消耗或工具损坏时自动从背包补充同类型物品。

> **核心卖点：保留成就，无需开启作弊。** 不使用 `/replaceitem` 等作弊指令，替换完全在背包层面完成（`container` + `Equippable` 组件操作），不触发作弊判定。

## 功能

- **自动补充消耗品** — 生存/冒险模式下，主手物品被消耗（食物、药水、弓/弩/三叉戟射击等）后，自动从背包查找同 `typeId` 物品替换到主手
- **自动切换挖掘工具** — 开始挖掘方块时，识别方块所需工具类别（镐/斧/锹/锄/剪刀，`BlockClassifier` 四层启发式），从**能力候选池**按策略排序换入正确工具。默认**省耐久不择优**（主手已用对工具则不动，尊重玩家用铁镐省钻石镐耐久的自主选择）；每个方块可通过**方块偏好表**叠加**两级偏好（附魔 1 级 + 工具 2 级）**，完全可扩展
- **自动切换武器** — 攻击实体时，若主手**不是武器**则按**被攻击实体种类偏好**换入武器，**附魔 1 级优先**（亡灵 → 亡灵杀手最高、其次锋利；其它实体 → 锋利最高）、**工具 2 级优先**（同附魔下 剑→斧→其它武器）；**已持任意武器（含弓弩/三叉戟/重锤）一律不动**
- **自动换精准采集工具** — 挖掘玻璃/玻璃片/冰/萤石/海晶灯等不用精准采集就无法产出方块本体的方块时，自动换上任意带精准采集（Silk Touch）的工具
- **耐久保护（可开关）** — 工具/武器被使用后耐久低于阈值时，**未碎也提前收起**，替换背包中同类别、更耐久的同类工具；阈值支持**剩余占比（%）+ 剩余点数绝对下限**两个维度（取较大的生效），且可**配置**；旧工具带精准采集 → 优先换同样带精准采集的同款；无合格同类则不动（**绝不降级**）
- **替换音效** — 每次成功替换播放 `random.pop` 音效，给出即时反馈
- **模式守卫** — 仅生存/冒险模式生效，创造/旁观/假人不触发
- **管理员配置（ModalForm 一键保存）** — 命令 `/ar:menu`（仅**操作员**）打开配置表单：五个开关 + 耐久保护阈值滑条（占比）与绝对下限滑条（点数），一次调整、提交保存，持久化到世界（重启不变）

## 管理员配置

命令 `/ar:menu`（`CommandPermissionLevel.GameDirectors`，仅操作员）打开 **ModalForm**：每个开关一个 toggle（显示当前状态），耐久保护阈值两个滑条（占比 / 绝对下限点数），提交时一次性应用并保存：

| 项 | 控制 |
|---|---|
| 全局启用 | 总开关，关闭则所有功能不执行 |
| 物品补充 | 消耗品补货（使用后主手 `undefined` / 副作用残留 → 换同类 + 堆叠回收） |
| 武器替换 | 攻击实体时非武器主手换武器（附魔 1 级：亡灵亡灵杀手>锋利 / 其它锋利；工具 2 级：剑>斧>其它） |
| 工具替换 | 挖掘工具核对换入 + 工具破碎换同类 |
| 耐久保护 | 工具低耐久未碎也提前收起换同类（影响替代阈值） |
| 保护阈值 | 剩余耐久占比低于该值即替换（滑条 1%~50%，默认 10%） |
| 绝对下限 | 剩余耐久点数低于该值即替换（滑条 1~64，默认 16；与占比阈值取较大的生效） |

开关与两个阈值存世界动态属性（键 `autorefill:global/refill/weapon/tool/durability/durabilityThreshold/durabilityFloor`），重启世界保持。

## 架构

按「**评分选择引擎（纯逻辑）+ 两个核心功能域 + 主手状态判定**」构建：
- **工具/武器选择引擎**（`ToolScorer` + `MinePreference` + `WeaponPreference`）：把"这块/这刀用什么、或要不要换"建模为**候选特征向量 → 策略打分排序 → Keep/Swap 决策**。命名策略可注册，更可**按方块/实体种类绑定两级偏好（`PreferenceSpec`：附魔 1 级 + 工具 2 级，越靠前越优先）**，统一由 `preferenceScorer` 排序，带双层 fallback
- **工具切换/耐久保护**（`ToolManager`）：`entityHitBlock` / `entityHitEntity` / `playerBreakBlock` 触发
- **自动填充**（`RefillManager`）：使用/交互事件触发，按**使用后主手状态**决定是否补货

```
scripts/
├── main.ts             组装根：只订阅事件 → PlayerPolicy 守卫 → 按事件路由到领域服务（无业务逻辑）
├── types.ts            领域类型：ToolCategory/WeaponClass / ToolRequirement / RankableCandidate /
│                        RankContext / RankDecision / PreferenceSpec（两级偏好）/ EnchantKey / ToolKey
├── ItemDomain.ts        物品域判定：resolve(typeId) → 'tool' | 'consumable'（补货的消耗分支兜底守卫）
├── PlayerPolicy.ts      玩家守卫：真实玩家 + 生存/冒险模式
├── Inventory.ts         背包端口（Port & Adapter）：唯一封装 Container I/O + 候选泛型扫描 scanCandidates
├── ToolProfile.ts       特征提取（Adapter）：ItemStack → RankableCandidate（品质/耐久/占比/附魔）
├── BlockClassifier.ts   方块识别（Strategy 表驱动）：tag 优先 + 关键词兜底 + 精准采集标记
├── ToolScorer.ts        评分选择引擎（纯逻辑，零 @minecraft 依赖，可 node 单测）：
│                        roleOf / matchesTargetProfile / isMineCapable（跨类别附魔池 / 排除角色）/
│                        preferenceScorer（附魔 1 级 + 工具 2 级组合排序）/ 命名策略 /
│                        ToolSelector 决策（双层 fallback）/ isUrgent / buildReplacePool
├── MinePreference.ts    方块偏好表（纯逻辑）：按方块 typeId 绑定两级偏好
│                        （如农作物→时运优先、树叶→精准锄>剪；附魔 1 级 + 工具 2 级）
├── WeaponPreference.ts  实体种类偏好表（纯逻辑）：按被攻击实体 typeId 绑定武器两级偏好
│                        （亡灵→亡灵杀手>锋利；其它→锋利；同附魔下 剑>斧）
├── ToolManager.ts       工具领域服务（Facade）：挖掘核对 / 武器切换 / 耐久保护 / 工具破碎换同类
├── Settings.ts          全局配置：五项开关 + 耐久保护两个阈值（占比/绝对下限）+ 世界 DP 持久化
├── AdminMenu.ts         管理员菜单（ModalFormData 一键配置）
└── RefillManager.ts     消耗品领域服务（Facade）：按主手状态补货 + 副作用堆叠
```

**冲突设计（按主手状态化解）**：早前版本存在冲突——工具切换（`entityHitBlock` / 武器 `entityHitEntity` / 耐久保护）把正确物品换上后，连带触发的"使用"事件又触发补货把旧物品换回。现在 `RefillManager` 不再按 typeId 拦，而是**检查使用后的主手**三段分派：
1. 主手 `undefined` → 被完全消耗 → 安全补同类（仅消耗品域）
2. 主手是**已枚举的副作用残留**（空瓶/空桶/碗，`SIDE_EFFECT_ITEMS`）→ 交换补同类 + 残留堆叠回收
3. 主手是其他物品（工具/武器切换已换入的主手 / 主手仍同类仅数量减少）→ **与消耗无关，忽略**

场景 3 即旧冲突的根：主手已被 `ToolManager` 换成正确物品，既非 undefined 也非副作用残留 → 补货忽略，不撤销切换。

## 评分选择引擎（核心设计）

**同一个引擎管挖掘、武器、耐久保护三件事**，三层抽象：

```
候选（RankableCandidate 特征向量）→ 策略（CandidateScorer 打分排序）→ 决策（ToolSelector）
```

- **候选特征**（`RankableCandidate`）：槽位 / typeId / 角色（工具类别或武器类别）/ 品质 `tier` / 剩余耐久 / 剩余占比 / 精准采集 `silk` / 效率 / 时运 / 亡灵杀手 / 锋利。
- **策略**（`CandidateScorer.rank(cands, ctx) → 排序列表 | null`）：策略只出"偏好排序"，`null` = 表达不了偏好 → 交给 fallback。
  - **命名策略**：挖掘域 `frugal`(默认·省耐久不择优，等价旧 SilkTouch+Category) / `quality`(品质优先) / `durability`(耐久占比优先) / `priority`(目标优先级序列)；武器域 `weapon`(默认 剑→斧→重锤/三叉戟)
  - **两级偏好（组合策略 `preferenceScorer`）**：`PreferenceSpec` = 附魔链 `enchantChain`（**1 级优先**，越靠前越优先，同键等级越高越优先）+ 工具链 `toolChain`（**2 级优先**，越靠前越优先，`*` 兜底任意角色）；排序 = 附魔元组字典序 → 工具角色位置 → 品质/耐久。方块/实体偏好表都产出 `PreferenceSpec`，同一套引擎管挖掘/武器两域。扩展位：`strict`（无候选命中附魔 → 表达不了 → fallback）、`exclude`（排除角色，如农作物排除时运锹）、`crossEnchant`（候选池跨类别：命中任一附魔的任意工具入池，如树叶的任意精准工具）、`tieBreak: "durability"`（打平按耐久占比）
- **决策**（`ToolSelector.decide`）：当前主手若达标则以 `isCurrent` 伪候选入池——策略把它排第 0 就 Keep，排后面就 Swap（`frugal` 给主手特权→不升级；`quality`/两级偏好不给→背包有更好的就升级）。`pool` 为空（无适用工具）→ 保持。
- **双层 fallback**：垂直（策略未注册/抛错）→ 跳过；横向（rank 返回 `null`，如 `strict` 附魔偏好但没人带精准工具）→ 走下一条；链尾落到默认策略；默认也表达不了 → 保持。

### 策略扩展（方块 / 实体偏好表）

新增偏好 = 往表里加一行（写成 `PreferenceSpec`）；新增排序维度 = 在 `ToolScorer` 的组合位扩展。均不碰分类/执行代码：

- **方块偏好表**（`MinePreference.PREFERENCE_TABLE`，已是多行数据表）：

| 规则 | 命中 | 两级偏好（附魔 1 级 → 工具 2 级） |
|---|---|---|
| `crop-fortune` | 小麦 / 胡萝卜 / 马铃薯 / 甜菜根 | 时运（锄>其它，**排除锹**；无时运 → 回落默认） |
| `grass-silk` | 草方块 / 灰化土 / 菌丝 | 精准（锹>其它） |
| `leaves-silk` | `*_leaves` 树叶 | 精准（锄>剪>任意精准工具，跨类别） |
| `glass-silk` | 玻璃 / 冰 / 萤石 / 海晶灯 | 精准（镐>其它） |
| *(注释示例)* `ore-quality` | `_ore` / 下界合金块 | 无附魔偏好；只收镐、同镐内品质优先 |
| *(注释示例)* `durability-first` | 石头 / 深板岩 | 无附魔偏好；只收镐/锹、打平按耐久占比 |

- **实体种类偏好表**（`WeaponPreference.ENTITY_WEAPON_TABLE`）：

| 规则 | 命中 | 两级偏好（附魔 1 级 → 工具 2 级） |
|---|---|---|
| `undead-smite` | 亡灵（僵尸/骷髅/凋零/幻翼/猪人变异者…） | 亡灵杀手>锋利；剑>斧>其它 |
| `sharpness-general` | 其它所有实体 | 锋利；剑>斧>其它 |

### 挖掘工具切换（`ToolManager.onPlayerHitBlock`）

由 `entityHitBlock` 触发（命中即换，无需给工具挂自定义组件）。流程：

1. 主手锁定/自定义 → 尊重不动
2. `classify(block)` 识别（四层：瞬破排除 → 现代挖掘标签 `is_*_item_destructible` + 镐最低品质 → 遗留标签 → 关键词）＋ `wantsSilkTouch` 标记；`lookupMineStrategy(block.typeId)` 取方块两级偏好（无则默认 `frugal`）
3. 按「类别 + 偏好」建**能力候选池**：默认扫能力类别（镐/斧/锹/锄/剪）；方块偏好 `crossEnchant` 时额外把在线命中附魔的任意工具入池（如树叶的任意精准工具、农作物的时运工具）；`exclude` 角色（如时运锹）永不入池
4. `ToolSelector.decide`（`preferenceScorer`：附魔 1 级 → 工具 2 级 → 品质/耐久）出 Keep/Swap，`execute` 统一执行 + pop 音效

> **默认省耐久**：无偏好的方块走 `frugal`，把已达标的当前主手排第 0 → 一律保持、不择优升级（尊重玩家省钻石镐耐久）。绑定了 `PreferenceSpec` 的方块按"附魔 1 级 → 工具 2 级"择优（同一优先维内会升级到更优的偏好工具）。"无适用工具"（能力池为空）→ 保持。

### 武器切换（`ToolManager.onAttackEntity`）

由 `entityHitEntity` 触发，携带 `hitEntity.typeId`：

1. 主手锁定/自定义 → 尊重不动
2. **已持任意武器**（剑/斧/镐/重锤/三叉戟/弓弩）→ 不动
3. 空手/非武器主手 → 从**武器库**（剑/斧/重锤/三叉戟）建池，按**被攻击实体种类偏好**决策（`preferenceScorer`）：
   - **亡灵** → 附魔 1 级：亡灵杀手最高 → 其次锋利最高；工具 2 级：剑→斧→其它
   - **其它实体** → 附魔 1 级：锋利最高；工具 2 级：剑→斧→其它
   - 全场无附魔 → 落到工具 2 级（剑优先），与默认 `weapon` 兜底一致

### 耐久保护（`ToolManager.checkDurability`，独立开关）

1. 每次使用工具后（`playerBreakBlock` / `entityHitEntity` 尾部）读主手耐久
2. **达到紧急** → 提前触发替换：紧急判定为「剩余占比 < 设置阈值 **或** 剩余点数 < 设置的绝对下限」（两路取较大的剩余地即触发，兜住低耐久上限的工具如木制低耐久）；两个阈值都可在 `/ar:menu` 调整
3. 替换池 = 背包**同 role** 候选，且**严格更耐久 (remaining 更大) + 占比达标**；排序 同 typeId → 同精准采集属性 → 品质 → 耐久（**旧带精准 → 优先带精准的同款**）
4. 无合格候选 → 保持不动，绝不降级

> 作用：工具在 **摧毁前** 就收起换新，不用等 `playerBreakBlock` 的"破碎补同类"兜底（后者保留作最后防线）。

## 领域职责与事件路由

| 事件 | 分派 | 所属领域 |
|---|---|---|
| `entityHitBlock` | `ToolManager.onPlayerHitBlock`（挖掘开始、破坏前核对换入） | tool |
| `entityHitEntity` | `ToolManager.onAttackEntity`（攻击实体，按实体偏好换武器）＋ `checkDurability` | tool |
| `playerBreakBlock` | 工具**破碎** → `onToolBroke` 换同类；**未碎** → `checkDurability` 低耐久提前收 | tool |
| `itemCompleteUse` / `itemReleaseUse` / `itemUse` / `playerInteractWithBlock` | `RefillManager.onConsumed`（按使用后主手状态判断） | 消耗 / 工具切换由主手状态判别 |

### 守卫 `PlayerPolicy`（`scripts/PlayerPolicy.ts`）

仅当：**真实玩家**（非 mock-player 假人）**且**游戏模式为**生存/冒险**时才处理，创造/旁观/假人一律跳过。

> **日志分级**（`scripts/Logger.ts`，统一 `[AutoRefill]` 前缀）：`debug`（命中追踪/无动作保持，游戏内 Content Log 默认收敛）→ `info`（正常结果：已换入/破碎补齐/耐久保护/替换/已持武器尊重）→ `warn`（意外可恢复：背包无达标工具、无同类可替、残留堆叠失败）→ `error`（操作失败：swap 失败、事件处理器异常）。
>
> 时序说明：稳定 Script API 中**没有**"挖掘开始"的全局事件；`playerBreakBlock` 在破坏才触发（已晚）。`entityHitBlock`（玩家命中方块）是唯一能在破坏前拦截、且不依赖物品自定义组件的入口。

## 安装

1. 从 `dist/packages/` 下载 `auto-refill-v{version}.mcpack`
2. 双击/导入 Minecraft
3. 在世界设置中启用「自动替换」行为包
4. 进入世界，生存/冒险模式下主手消耗物品即可自动补充

### 需求

- Minecraft Bedrock（`min_engine_version` 1.21.20+）
- 无需开启作弊（不依赖 `/replaceitem`）

## 开发

### 命令

```bash
pnpm run test:core     # 纯逻辑单测（tsc -p tsconfig.test.json + node --test）
pnpm run lint          # ESLint + Prettier 检查
pnpm run build         # 构建（同步版本 → tsc → esbuild）
pnpm run pack          # 打包 .mcpack 发行包（just-scripts mcaddon）
pnpm run local-deploy  # watch 模式自动构建并部署到游戏
pnpm run clean         # 清理构建产物
```

根 workspace 快捷命令：`pnpm build:auto-refill` / `pnpm pack:auto-refill` / `pnpm test:auto-refill`。

### 测试

- **纯逻辑层**（`ToolScorer` / `MinePreference` / `WeaponPreference`）零 `@minecraft` 依赖，`tsconfig.test.json` 单独编译进 `node --test`（镜像 item-route 机制），覆盖：角色判定 / 达标判定 / 命名策略排序 / **两级偏好组合（附魔 1 级 + 工具 2 级字典序、strict 无命中→fallback、exclude 排除角色、crossEnchant 跨类别入池、tieBreak）** / 双层 fallback / 无适用→保持 / 耐久替换池规则。文件在 `tests/*.test.ts`（45 项）。
- **适配层**（分类器、背包、UI、接线）靠游戏内冒烟验证。

### 打包产物

`dist/packages/auto-refill-v{version}.mcpack`

### 依赖版本

| 包 | 版本 |
|---|---|
| `@minecraft/server` | 2.0.0 |
| `@minecraft/server-ui` | 2.0.0 |
| `@minecraft/core-build-tasks`（构建） | 5.5.0 |
| `just-scripts`（构建） | ^2.6.2 |
| `@yinxe/toolkit-build`（构建，workspace） | — |

## 许可证

MIT