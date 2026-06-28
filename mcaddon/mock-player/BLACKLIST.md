# 踩坑记录

_遇到问题持续增加踩坑记录_

- **`@minecraft/server-gametest` 的包需要在 esbuild 的 `external` 中声明**：构建时如果用到 gametest 模块，需要在 `just.config.ts` 的 `bundleTaskOptions.external` 中加入 `"@minecraft/server-gametest"`，否则 esbuild 会报模块解析失败。
- **自定义命令注册必须用 `system.beforeEvents.startup`**：`customCommandRegistry` 不在 `world` 上，而是在 `StartupEvent` 上。必须通过 `system.beforeEvents.startup.subscribe((event) => { event.customCommandRegistry.registerCommand(...) })` 在 early-execution mode 中注册。
- **`spawnSimulatedPlayer` 不能在受限执行模式中调用**：自定义命令的回调默认是受限执行模式，直接调用 `spawnSimulatedPlayer` 会报错。必须用 `system.run()` 包装，让创建逻辑在主 tick（非受限模式）中执行。
- **`Player.sendMessage` vs `Entity`**：`sendMessage` 是 `Player` 类型的方法。`origin.sourceEntity` 类型为 `Entity`，直接使用时需断言为 `Player`。
- **自定义命令参数的维度类型处理**：`CustomCommandParamType` 没有内置的维度类型，需使用 `String` 类型参数接收维度名，然后用 `world.getDimension(dimensionName)` 解析。维度 ID 值为 `"overworld"`、`"nether"`、`"the_end"`。
- **`spawnSimulatedPlayer` 无视坐标永远生成在西北角**：该函数传入的 `DimensionLocation` 参数中的坐标被忽略，假人始终在世界西北角生成。需要创建后用 `bot.teleport(pos, { rotation })` 传送修正位置和朝向。
- **`lookAtLocation` 的 `LookDuration` 选择**：`LookDuration.Instant` 只让假人看一眼就回正，`LookDuration.Continuous` 才能持续看向目标位置。
