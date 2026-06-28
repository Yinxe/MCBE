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
- **`SimulatedPlayer.respawn()` 在实体死亡后仍可用**：杀死假人后，只要实体还在世界中，调用 `respawn()` 即可重生。配合 `applyPositionState` 可以在重生后恢复所有体态。
- **`world.getEntity(id)` 可通过 ID 查找任意实体**：存储 `entityId` 后，即使假人死亡了也能通过 ID 找回并操作。注意死亡后实体可能在一段时间后被世界移除。
- **`entity.dimension.id` 在死亡实体上仍可访问**：`entityDie` 事件中的 `deadEntity` 虽然已死，但 `dimension.id`、`location`、`getRotation()` 等方法/属性仍然可用。
