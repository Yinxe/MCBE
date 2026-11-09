# Design

## Context

动机见 `proposal.md`。本节只记录约束与已核实的现状。

### 上游模组现状(`MCBE/mcaddon/spectator-mode` v1.0.10)

- 包目录 `BP/SpectatorMode`,包名 `spectator-mode`(无 scope),`min_engine_version [1,21,0]`,`@minecraft/server` 声明 `[2,5,0]`。
- `scripts/` 13 个文件:`main.ts` + `core/`(types/config/engine/colors/hud,零 `@minecraft` 依赖)+ `mc/`(store/particles/controller/playerUtil/commands/menu)。
- `tests/` 4 个文件(config/engine/colors/hud),`tsc -p tsconfig.test.json` + `node --test`。
- 运行时依赖 `@yinxe/toolkit`:控制器用 `HudManager`(actionbar,priority 200,`modId: "spectator-mode"`),命令层用 `defineCommand` 与 `canManage`,表单用 `ModalFormBuilder`。打包依赖 `@yinxe/toolkit-build` 与 `@minecraft/core-build-tasks` 的模板任务。
- `pack_icon.png` 为 256×256 RGBA。

### 本仓现状

- `mods/` 已有 `auto-refill`(2.2.0,`@minecraft/server 2.1.0`,`min_engine_version [1,21,100]`)与 `keepinventory`(0.0.1,`2.0.0` / `[1,21,90]`)。两者都只有行为包,`packing.mode: "auto"`,`pack` 走 `@mc-toolchain/packaging`。
- `@mc-toolchain/shared` 提供 `color` / `style` / `HudManager` / `HUD_SLOTS` / `pickWinner` / `isStale`;`HudManager` 通过 `/scriptevent yinxe:hud` 与同世界其它包交换槽位声明,同优先级按 `modId` 字典序决胜。
- `@mc-toolchain/packaging` 的 `synchronizePackVersions` 会把 `package.json#version` 与推导出的最低游戏版本写进各包清单;`SCRIPT_API_VERSION_MAPPINGS` 中 `2.1.0 → [1,21,100]`。
- 纯逻辑测试口径:模组侧用 `tsc -p tests/tsconfig.json` 编到 `.test-build` 后 `node --test`(`auto-refill` 是既有样板)。
- `pack-icon` 规范要求 128×128 RGBA 像素画,`auto-refill` 用 `tools/generate-pack-icon.js` 生成(32×32 逻辑像素 4 倍最近邻放大)。

### 已核实的 API 可用性

在 `@minecraft/server` 2.1.0 的类型面中逐一确认存在：`world.isHardcore`、`system.beforeEvents.startup` / `StartupEvent.customCommandRegistry`、`CustomCommandRegistry` / `CustomCommand` / `CustomCommandOrigin` / `CommandPermissionLevel` / `CustomCommandParamType`、`world.afterEvents.playerJoin` / `playerLeave`、`Player.getGameMode` / `setGameMode` / `teleport` / `getDynamicProperty` / `setDynamicProperty`、`Dimension.spawnParticle` / `getBlock`、`MolangVariableMap`(`setColorRGBA` / `setVector3` / `setFloat`)、`Player.playerPermissionLevel` 与 `PlayerPermissionLevel`。`@minecraft/server-ui` 2.0.0 的 `ModalFormData.toggle/slider/submitButton` 支持 `tooltip`。

### 已核实的夜视相关事实

- `Entity.addEffect(effectType, duration, options?)` / `getEffect(effectType)` / `removeEffect(effectType)` / `getEffects()` 均存在于 2.1.0 类型面(行 6971 / 7311 / 7595 / 7322),不需提升兼容下限。
- **`Effect.duration` 是「总时长」而不是「剩余时长」**:本地 `index.d.ts` 与 Microsoft Learn 均明确写着 *"Gets the entire specified duration, in ticks, of this effect"*。因此无法从 API 直接读到「玩家原有夜视还剩多久」,必须在进入灵魂出窍时自行快照。这是本功能最关键的技术约束。
- `Effect` 暴露 `amplifier` / `duration` / `typeId` / `isValid`,无 `remainingTicks` 一类的属性。
- `EntityEffectOptions` 只有 `amplifier` 与 `showParticles`,无「是否显示图标」开关;因此灵魂阶段用 `showParticles: false` 减少视觉干扰,但无法隐藏效果图标。
- `system.currentTick`(`readonly`,行 16127)可作为自计时的单调时钟,精度满足「按已消耗 tick 扣减」的需求。
- 夜视的效果标识为 `minecraft:night_vision`(Minecraft Wiki 状态效果 ID)。

## Goals / Non-Goals

**Goals:**

- 上游全部可观察行为在本仓原样成立(命令形态、键名、容忍时长、HUD 文案、粒子语义、自愈与恢复)。
- 新增灵魂阶段夜视增益(本仓在迁移之外唯一的行为增量),且能做到「管理员可关」与「回归时还原玩家原有夜视」两者兼得。
- 模组在目录、包名、版本来源、打包入口、测试入口上与 `auto-refill` 同构,零外部 workspace 依赖(`@yinxe/*` 全部去掉)。
- 纯逻辑保持可单测,且测试范围与上游一致(4 个文件的行为)。
- 产物与 `pack` 入口符合 `addon-packaging` / `mod-workspace` / `pack-icon` 现有要求。

**Non-Goals:**

- 不重构上游决策逻辑(状态机相位、颜色阈值、粒子常量、HUD 排版都保持数值一致)。
- 不为「上游包与本模组共存于同一世界」提供兼容层或命令重命名。
- 不为夜视做「灵魂阶段保留玩家自饮药水」的兼容:灵魂阶段由模组接管夜视,回归时按进入前快照还原。
- 不把 `ModalFormBuilder` / `defineCommand` / `canManage` 抽进 `@mc-toolchain/shared`(共享包 README 明确排除这三项,且目前只有本模组会用到)。
- 不改变 `sp:*` 键名、不提供旧键名到新键名的迁移读写。
- 不改动 `packages/packaging` 与 `packages/shared` 的源码。

## Decisions

### D1: 命令面保留 `/sp:soul` + 可选 `menu` 子命令

`sp:soul` 用 `optionalParameters: [{ name: "action", type: CustomCommandParamType.String }]` 承载子命令,`permissionLevel: CommandPermissionLevel.Any`、`cheatsRequired: false`。`menu` 分支在回调内自行判断操作员权限(`player.playerPermissionLevel >= PlayerPermissionLevel.Operator`),不满足只发提示、不拉起表单。

**理由**:用户明确要求保留上游手感(老玩家不必改习惯),且 `menu` 子命令让「切换」与「管理」共用一条命令,权限模型也仍是「命令人人可执行、表单仅 OP」。

**备选**:拆成 `/sp:menu`(与 `auto-refill` 的 `/ar:menu` 一致,可用 `permissionLevel: GameDirectors` 由引擎兜住权限)。否决理由:会改变玩家可见的命令面,与本次「语义完整保留」目标冲突。

**代价**:命令回调里必须自己写权限判断与用法提示分支;`CustomCommandParamType.String` 的可选参数在玩家不传时回调收到的 `params.action` 为 `undefined`,需显式区分「未传」「menu」「其它」三种情况。

### D2: 持久化键名沿用上游 `sp:*`

世界级动态属性 `sp:enabled` / `sp:maxDist` / `sp:showLink`,玩家级 `sp:soul`(JSON 字符串,含 `dimensionId` / `x` / `y` / `z` / `gameMode`)。

**理由**:用户明确选择延续上游键名。旧世界的管理员配置与「以灵魂状态离线」的锚点因此无缝延续,这是迁移最容易被忽略却最影响玩家的一环。

**与本仓命名规范的张力**:根 `openspec/config.yaml` 要求「避免缩写」,但同一条也写明「仅在与上游生态约定一致时保留既有缩写」。`sp:` 属于后者,因此在模组 `README.md` 与源码注释里显式记录该例外及其理由,避免后续维护者把它当笔误改掉。

**备选**:改为 `spectator_mode:*` 全词键名。否决理由:会让旧世界的配置回落到默认值、让离线灵魂锚点失效(玩家重连后变成普通旁观者且无逃逸口),必须额外写一次性迁移逻辑,收益只是命名整齐。

### D3: `@yinxe/toolkit` 三处用法分别替换,不引入新的共享封装

| 上游用法 | 本仓替代 |
| --- | --- |
| `HudManager` / `color` / `style` | `@mc-toolchain/shared` 的同名导出 |
| `defineCommand(registry, config, handler)` | 直接 `registry.registerCommand(config, (origin, ...args) => …)`,在回调内从 `origin.sourceEntity` 取玩家并做 `instanceof Player` 判定 |
| `canManage(player)` | `player.playerPermissionLevel >= PlayerPermissionLevel.Operator` |
| `ModalFormBuilder` | `@minecraft/server-ui` 的 `ModalFormData`(`.toggle(label, { defaultValue, tooltip })` / `.slider(label, min, max, { valueStep, defaultValue, tooltip })`) |

**理由**:`auto-refill` 已经用原生 `ModalFormData` 与 `registerCommand` 跑通同一套形态,本模组照抄即可,不新增共享包 API 面。`defineCommand` 的唯一附加价值是「非玩家来源返回失败消息」与「按声明顺序把位置参数映射成对象」——本模组只有 1 个可选参数,直写更清楚。

**备选**:把 `defineCommand` / `canManage` 搬进 `@mc-toolchain/shared`。否决理由:共享包 README 已明确把这三项列为「刻意不包含」,且搬进来后仍需为「只有一个消费方」付维护成本。若将来第三个模组也需要,再单独立项抽取。

### D4: 依赖 `@minecraft/server 2.1.0`,最低游戏版本 `[1,21,100]`

`package.json` 声明 `dependencies["@minecraft/server"] = "2.1.0"` 与 `"@minecraft/server-ui": "2.0.0"`;不写 `packing.minimum_engine_version`,由 `SCRIPT_API_VERSION_MAPPINGS` 推导出 `[1,21,100]`。

**理由**:原生自定义命令(`StartupEvent.customCommandRegistry`、`CommandPermissionLevel`、`CustomCommandOrigin`)自 2.1.0 起可用,这是本模组 `/sp:soul` 的硬依赖;取 2.1.0 而非上游声明的 2.5.0,是为了把兼容下限压在 1.21.100,与 `auto-refill` 完全一致。

**代价**:上游声明的是 `[2,5,0]`(`1.26.0`),本仓版本对 1.21.100–1.25.x 的玩家更宽松,但也意味着本模组必须确认代码不实际依赖 2.2.0+ 才有的 API。已核实的 2.1.0 类型面清单见 Context 末节,足以覆盖现有全部调用。

**备选**:显式写 `packing.minimum_engine_version: [1,21,100]` 并保留 `@minecraft/server 2.5.0`。否决理由:两者会互相矛盾(声明 2.5.0 却写 1.21.100 的最低版本),`addon-packaging` 要求三者自洽。

### D5: 分层与文件划分沿用上游,仅替换 import 与命令/表单实现

```
scripts/
├── main.ts                 装配:事件订阅 + 命令注册 + 延迟启动
├── core/                   零 @minecraft 依赖
│   ├── types.ts            SpConfig / SoulAnchor / Vec3
│   ├── config.ts           默认值 / 钳制 / 键名常量
│   ├── engine.ts           距离与容忍状态机
│   ├── colors.ts           距离占比 → § 颜色码
│   └── hud.ts              actionBar 文案组装
└── mc/                     @minecraft 副作用
    ├── store.ts            世界配置 DP + 玩家锚点 DP
    ├── particles.ts        标记 / 光环 / 双向扫掠连线
    ├── controller.ts       会话编排:tick、恢复、自愈、强制回归
    ├── playerUtil.ts       无效/假人玩家对象过滤
    ├── commands.ts         /sp:soul 注册与权限分支
    └── menu.ts             ModalFormData 管理表单
```

**理由**:这套分层让「4 个纯逻辑文件可 node 单测」这条规格成立,也让适配层与游戏强耦合的部分集中在一处。`tests/tsconfig.json` 只需 include `core/*.ts`,与 `auto-refill` 的测试编译配置同构。

**命名说明**:`core` / `mc` 是上游既有的目录名,本仓没有冲突的同级目录,保留以免与上游源码对照时错位。

### D6: HUD 继续走 `HudManager`,但注册方式改为在本包 `start()` 内注册

`modId: "spectator-mode"`、`slot: "actionbar"`、`priority: 200` 保持不变;`render` 从控制器内存里的 `Map<playerId, SoulHudState>` 取状态,无状态返回 `undefined`。

**理由**:`priority: 200` 与 `modId` 一起决定跨包仲裁结果(`auto-refill` 的防误触是 60),改动任一项都会让同世界其它包的 HUD 表现变化。注册放在 `start()` 而不是构造函数,是为了与世界动态属性读取同处一个「延迟到安全 tick」的时机。

**风险**:`HudManager` 内部已默认过滤假人(读 `getGameMode()` 抛错即剔除),而控制器的 `playerUtil` 也做了一层过滤。两层过滤是有意保留的冗余——HUD 层的过滤保护的是「渲染循环不被假人打断」,控制器层的过滤保护的是「会话状态不被假人污染」,两者失败模式不同。

### D7: 图标重绘为 128×128,沿用 `auto-refill` 的生成脚本形态

新增 `mods/spectator-mode/tools/generate-pack-icon.js`,用 32×32 逻辑像素画 4 倍最近邻放大到 128×128 RGBA PNG,构图语义为「人形轮廓 + 向外飘离的灵魂光点 + 距离环」,色板控制在 8–12 色。图标是静态资源,构建期不生成。

**理由**:`pack-icon` 规范要求 128×128 RGBA 像素画且不得沿用模板占位图;上游 256×256 图标既不满足尺寸也携带上游仓库信息。沿用 `auto-refill` 的脚本形态可以让两个模组的图标维护方式一致,且脚本本身就是「构图可复现」的文档。

**备选**:直接用图像工具缩放上游 256×256 图。否决理由:缩小会破坏硬边像素块(出现抗锯齿),违反规范里「边缘由离散像素块构成」的要求。

### D8: 版本保留 `1.0.10`,不重置

`package.json#version` 写 `1.0.10`,`manifest.json` 的版本字段由打包写入。模组 `productName` 用「灵魂出窍」,`description` 沿用上游文案的主体。

**理由**:`mod-workspace` 明确要求「从仓库外迁移的既有模组 MUST 保留其原有版本号」。玩家侧也靠版本号判断是否需要更新。

### D9: 测试范围与上游一致,断言值保持数值不变

`tests/` 保留 4 个文件:配置(默认值与钳制边界)、状态机(范围内 / 首次超限 / 容忍内回到范围 / 倒计时耗尽 / 跨维度 Infinity)、颜色(阈值分档)、HUD 文案(范围内与容忍两种形态、Infinity 显示)。

**理由**:这四组用例是「行为不变」最直接的证据。迁移过程中若某处数值被无意改动(例如容忍时长从 5000ms 写成 500ms),用例会立即失败。

### D10: 夜视增益用「进入时快照 + 短时长周期刷新 + 按差值还原」

**快照**:进入灵魂出窍时读 `player.getEffect("minecraft:night_vision")`,把 `{ amplifier, durationTicks, enteredTick: system.currentTick }` 存入玩家动态属性 `sp:nvSave`(与锚点同生命周期,回归时一并清除)。

**灵魂阶段**:每 200 tick 施加一次 `addEffect("minecraft:night_vision", 300, { amplifier: 0, showParticles: false })`。效果时长 300 tick 大于刷新间隔 200 tick,留 100 tick 余量,即使某次 tick 被跳过也不会断档。

**回归还原**:读快照,`elapsed = system.currentTick - enteredTick`;`remaining = snapshot.durationTicks - elapsed`。快照不存在(进入前无夜视)→ `removeEffect`;`snapshot.durationTicks` 为非正数(无限时长)→ 用非正数时长重新施加,保持无限;`remaining > 0` → 按原 `amplifier` 施加 `remaining` tick;`remaining <= 0` → 视为已在灵魂阶段自然过期,不施加(保留自然结束的语义)。

**理由**:`Effect.duration` 只给总时长、不给剩余时长(见 Context),所以「还原玩家原有夜视」只能靠自计时。快照放在玩家 DP 而非内存,是为了让「以灵魂状态离线再重连」也能量对时间基准——`system.currentTick` 在重启后会重置,因此快照的 `enteredTick` 在重连场景下不可信,此时按「保留快照时长」处理并在 README 说明该近似。

**备选一:一次性施加超长时长**(如 999999 tick)。否决理由:会覆盖玩家原有的剩余时长,回归时无法区分「原本就没有」与「原本快到期」,直接违背「恢复他的夜视能力」这一诉求。

**备选二:把夜视写进 `manifest` 或常驻效果**。否决理由:常驻效果无法做到「管理员可关」与「回归还原」,且会影响非灵魂阶段的玩家。

**备选三:每 tick 读 `getEffect` 判断是否还有效**。否决理由:仍有同样的问题——读不到「玩家原本还剩多久」,只能知道「现在有没有」,无法做差值还原。

**代价**:灵魂阶段玩家自行饮用夜视药水时,其效果会被模组的周期刷新覆盖(强度归 0、时长归 300);回归时按进入前快照还原,玩家在灵魂阶段获得的额外夜视会丢失。这是有意取舍:灵魂阶段本来就应该由模组接管夜视,在 README 中说明。

## Risks / Trade-offs

- **[与上游包共存] 同一世界同时启用上游包与本模组时,两者都注册 `/sp:soul`、都以 priority 200 争抢 actionbar** → 引擎对同名自定义命令的行为不可靠;README 明确写「只装其一」,并在 `manifest.json` 的 `header.name` 用「灵魂出窍」而非上游的「灵魂出窍 v1.0.10」以在包列表中可区分。不提供代码级兼容层。
- **[键名与命名规范冲突] `sp:*` 是本仓唯一的缩写持久化键** → 在 `README.md` 与 `core/config.ts` 的键名常量处各写一段注释说明理由与来源,并在 `design.md`(本文 D2)留存决策记录。新增的 `sp:nightVision` / `sp:nvSave` 沿用同一前缀而非另起 `spectator_mode:*`:该前缀已成为本模组的持久化命名空间,混用两套前缀比沿用缩写更难维护。
- **[夜视快照依赖自计时] `Effect.duration` 只给总时长、不给剩余时长,「还原原有夜视」只能靠 `system.currentTick` 差值** → 快照写入玩家 DP 并在回归时按差值还原;重连场景下 `currentTick` 已重置、差值不可信,按「保留快照时长」处理(近似而非精确),并在 README 说明。
- **[灵魂阶段覆盖玩家自饮的夜视] 周期刷新会把玩家在灵魂阶段喝的夜视药水覆盖为强度 0、时长 300,回归时又按进入前快照还原,那段额外夜视会丢失** → 有意取舍:灵魂阶段由模组接管夜视;在 README 的玩法说明中写明「灵魂阶段请勿依赖自行饮用的夜视药水」。
- **[夜视效果意外丢失] 被其它效果或指令清除时下一刷新周期才恢复** → 刷新间隔 200 tick 远小于效果时长 300 tick,且 tick 循环本身 2 tick 一次,实际断档窗口小于 10 秒。
- **[兼容下限下调] 上游声明 2.5.0,本仓声明 2.1.0** → 已在 Context 末节逐一核实所用 API 在 2.1.0 类型面中存在;tasks 中安排一次「用 2.1.0 类型面跑 `tsc` 全绿」作为验证,而不只依赖人工核对。
- **[自愈逻辑与假人过滤互相干扰] 假人读 `getGameMode()` 抛错,若过滤层漏判会让自愈循环每 tick 抛错** → 自愈与 tick 内所有玩家相关调用都包 `try/catch`,单个玩家失败只跳过该玩家,不中断整个循环。
- **[区块未加载导致粒子抛错] 真身所在区块卸载后 `spawnParticle` 会抛 `LocationInUnloadedChunkError`** → 真身侧粒子先用 `getBlock` 探测区块是否加载,并对每次粒子调用独立 `try/catch` + 一次性日志(每玩家只记一次),避免刷屏。
- **[HUD 总线 best-effort] `/scriptevent` 有约 1 tick 延迟、极端负载可能丢事件** → 这是 `HudManager` 的既有已知限制,不在本变更解决;表现为极端情况下 actionbar 短暂闪烁,下一周期自愈。
- **[管理表单权限只在回调内判定] 命令声明为 `Any`,非 OP 也能触发命令** → 非 OP 收到的是「该菜单仅管理员可操作」提示而非命令被拒绝;这是上游既有行为,保留以免改变玩家可见语义,但需在 README 的权限列写清「命令人人可执行、表单仅 OP」。
