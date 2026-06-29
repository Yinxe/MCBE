# 踩坑记录

_遇到问题持续增加踩坑记录_

- **`@minecraft/server-gametest` 的包需要在 esbuild 的 `external` 中声明**：构建时如果用到 gametest 模块，需要在 `just.config.ts` 的 `bundleTaskOptions.external` 中加入 `"@minecraft/server-gametest"`，否则 esbuild 会报模块解析失败。
- **自定义命令注册必须用 `system.beforeEvents.startup`**：`customCommandRegistry` 不在 `world` 上，而是在 `StartupEvent` 上。必须通过 `system.beforeEvents.startup.subscribe((event) => { event.customCommandRegistry.registerCommand(...) })` 在 early-execution mode 中注册。
- **`spawnSimulatedPlayer` 不能在受限执行模式中调用**：自定义命令的回调默认是受限执行模式，直接调用 `spawnSimulatedPlayer` 会报错。必须用 `system.run()` 包装，让创建逻辑在主 tick（非受限模式）中执行。
- **`Player.sendMessage` vs `Entity`**：`sendMessage` 是 `Player` 类型的方法。`origin.sourceEntity` 类型为 `Entity`，直接使用时需断言为 `Player`。
- **自定义命令参数的维度类型处理**：`CustomCommandParamType` 没有内置的维度类型，需使用 `String` 类型参数接收维度名，然后用 `world.getDimension(dimensionName)` 解析。维度 ID 值为 `"overworld"`、`"nether"`、`"the_end"`。
- **`spawnSimulatedPlayer` 无视坐标永远生成在西北角**：该函数传入的 `DimensionLocation` 参数中的坐标被忽略，假人始终在世界西北角生成。需要创建后用 `bot.teleport(pos, { rotation })` 传送修正位置和朝向。
- **`lookAtLocation` 的 `LookDuration` 选择**：`LookDuration.Instant` 只让假人看一眼就回正，`LookDuration.Continuous` 才能持续看向目标位置。
- **`world.getPlayers({ tags }) 只返回在线&存活的玩家**：死亡或离线的模拟玩家不会出现在查询结果中。需要自行维护注册表（`Map<string, BotRecord>`）来追踪所有已创建的假人，包括其在线/死亡状态。
- **SimulatedPlayer 状态追踪需要多个事件配合**：`entityDie`（死亡）、`playerSpawn`（重生）、`playerJoin`（加入）、`playerLeave`（离开）四个事件缺一不可。注意 `playerSpawn` 需要区分 `initialSpawn`（首次加入）和重生。
- **`Entity.name` 与 `Player.name` 区别**：`Entity` 有 `nameTag`（可修改），`Player` 有 `readonly name`。对于模拟玩家，`spawnSimulatedPlayer` 传入的名字会同时设置两者，但在 `entityDie` 事件中 `deadEntity` 类型为 `Entity`，需要通过 `nameTag` 获取名字。
- **动态属性存储 JSON 字符串时注意 32KB 限制**：`world.setDynamicProperty` 支持 `string` 类型，单个 key 的 value 上限约 32KB。一个假人一条 key（前缀 `mockplayer:players:<name>`）完全够用，注意在批量操作时监控 `getDynamicPropertyTotalByteCount()`。
- **`world.getDynamicPropertyIds()` 可枚举所有 key**：可以遍历所有动态属性 ID，通过前缀过滤来批量加载。无需额外维护索引 key。
- **`worldLoad` 事件可用于重启后恢复数据**：`world.afterEvents.worldLoad` 在世界加载完成后触发，可在 early-execution mode 中订阅。此时可以安全读写动态属性。
- **`spawnSimulatedPlayer` 的 `DimensionLocation` 参数名是 `dimension` 不是 `dim`**：容易写成简写导致 TS 类型错误。`DimensionLocation` 包含 `dimension: Dimension`、`x`、`y`、`z`。
- **`SimulatedPlayer.respawn()` 只能在 entityDie 中调用**：假人死亡后，实体很快被移除，无法再从命令回调中获取实体引用。`respawn()` 必须在 `entityDie` 事件处理函数中调用，这是唯一还能操作实体的时机。之前以为可以通过命令回调 respawn（`/mp:respawn`），实际上死亡后实体 ID 已经无效了。
- **`world.getEntity(id)` 可通过 ID 查找任意实体**：存储 `entityId` 后，即使假人死亡了也能通过 ID 找回并操作。注意死亡后实体可能在一段时间后被世界移除。
- **`entity.dimension.id` 在死亡实体上仍可访问**：`entityDie` 事件中的 `deadEntity` 虽然已死，但 `dimension.id`、`location`、`getRotation()` 等方法/属性仍然可用。
- **Entity 的 tags 不随持久化保存**：`addTag` 添加的标签只在实体存活期间存在。重新上线时需要从 `BotRecord.tags` 中恢复所有业务标签（如 `mockplayer:tag:respawn`）。`BOT_TAG` 作为基础标识每次上线时单独添加。
- **`entity.removeTag()` 可移除标签**：用于在线切换假人行为时实时更新实体上的标签状态。
- **`playerInteractWithEntity` 使用 `beforeEvents` 而非 `afterEvents`**：`afterEvents.playerInteractWithEntity` 对玩家类型实体（包括 SimulatedPlayer）可能不触发。必须用 `world.beforeEvents.playerInteractWithEntity`，它一定会触发，且可以通过 `event.cancel = true` 取消默认交互行为。
- **Before 事件回调运行在 restricted-execution mode**：`beforeEvents` 的回调文档标注 "called with restricted-execution privilege"，不能在回调中直接调用 `form.show()` 等受限 API。需要用 `system.run()` 或 `system.runTimeout()` 延迟到主线程执行。
- **空手交互的 `itemStack` 判断**：`beforeEvents.playerInteractWithEntity.itemStack` 在空手时是 `undefined`，但手持空气时（`minecraft:air`）也可能是 ItemStack 对象。稳健判断：`if (itemStack && itemStack.typeId !== "minecraft:air") return;`。
- **`@minecraft/server-ui` v2 ModalFormData 使用 options 对象**：v2 的 `textField`/`toggle`/`dropdown` 方法接收 options 对象而非直接的默认值。例如 `toggle("标签", { defaultValue: true })` 而非 `toggle("标签", true)`。查看 `ModalFormDataToggleOptions` 接口。
- **`Player.setSpawnPoint()` 使用 `DimensionLocation` 含独立坐标**：该方法接受 `{ dimension, x, y, z }`（`DimensionLocation` 接口），不是 `{ dimension, location: Vector3 }`。坐标是平铺的三个字段 `x`、`y`、`z`。
- **`LookDuration.Continuous` 是枚举值，不是数字 `1`**：直接写 `1` 会导致类型错误，必须 `import { LookDuration } from "@minecraft/server-gametest"` 并使用枚举值。
- **`Player.name` 是只读属性**：`Player` 有 `readonly name`（唯一标识名）和从 `Entity` 继承的 `nameTag`（可修改的头顶显示名）。`spawnSimulatedPlayer` 的第二个参数同时设置两者。
- **批量在线操作使用 `system.runTimeout` 错开间隔**：多个实体操作（如同时上线/下线多个假人）同时执行可能出问题。使用 `system.runTimeout(() => {...}, tickDelay)` 每次延迟 4 tick 逐个执行。
- **设置重生点要同步调用 `Player.setSpawnPoint()`**：仅更新 `BotRecord.respawnPoint` 不够，`SimulatedPlayer.respawn()` 默认使用世界出生点。必须同时调用 `bot.setSpawnPoint({ dimension, x, y, z })` 设置实体的实际出生点。
- **ItemStack 不能直接 JSON.stringify 序列化**：Script API 的 `ItemStack` 不是纯数据对象，必须手动抽取 `typeId`/`amount`/`nameTag`/`lore`/组件数据等字段。写入时使用 `container.setItem(slot, newStack)`。部分数据（BlockEntityTag、AttributeModifiers、HideFlags 等）Script API 无法读取。
- **装备栏（盔甲+副手）没有变化事件**：`EntityEquippableComponent` 的装备变化不触发任何 `afterEvents`。只能通过 100tick 周期轮询 + 死亡/下线事件兜底。对比之下，背包有 `playerInventoryItemChange` 事件可以实时保存。
- **`PlayerJoinAfterEvent` 只有 `playerName`，没有 `player` 属性**：要获取 Player 对象需使用 `world.getPlayers({ name, tags })`。与 `PlayerSpawnAfterEvent`（有 `player` 属性）不同，注意区分。
- **`playerSpawn.initialSpawn` 的含义**：`initialSpawn=true` 是首次生成（`spawnSimulatedPlayer` 触发），`initialSpawn=false` 是死亡重生（`bot.respawn()` 触发）。恢复背包的时机应该是 `playerJoin`（仅加入时触发），而不是 `playerSpawn`（重生时会错误覆盖背包）。
- **死亡时无论是否自动重生都要先保存状态**：`entityDie` 中有自动重生分支时，保存逻辑必须在分支之前执行。必须先 `saveBotFullState()` 再 `bot.respawn()`，否则自动重生的假人丢失死亡时的状态快照。
- **`saveBotFullState` 改了 `record.experience` 后必须调 `saveBotRecord`**：经验值存在 `BotRecord` 中，修改后不保存不会持久化。其他模块同理——任何对 `record` 对象的修改后都需要显式调用 `saveBotRecord`。
- **背包持久化避免 32KB 上限使用每格独立 key**：单条 DynamicProperty 上限约 32KB。一个装满潜影盒的背包（36格 × 27格子物品）远超此限制。每格独立 key（`<name>:inv:<slot>`）彻底规避此问题。
- **`ItemStack.getComponent("minecraft:inventory")` 运行时对原版潜影盒/收纳袋返回 `undefined`**：类型定义中有 `ItemInventoryComponent`（componentId `"minecraft:inventory"`），但运行时只对自定义 BP 物品（含 `minecraft:storage_item` 组件）生效。原版潜影盒/收纳袋的内部物品 Script API 无法读取、无法序列化，重启后内容丢失。解决方向：`structureManager.createFromWorld` 对特殊物品做结构快照存储（`scripts/lib/ItemStorage.ts`），绕过 Script API 序列化限制直接由引擎保留完整 NBT。目前因时间原因未实装，等待 Mojang 修复或后续实现 ItemStorage 模块。
