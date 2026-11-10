# Tasks

## 1. 共享守卫纯核与工厂

- [x] 1.1 新建 `packages/mod-common/src/playerGuardCore.ts`：`createPlayerGuard(isInstance)` 返回 `isUsablePlayer` / `safePlayers` / `namedPlayers` / `isRealPlayer` / `isSimulatedPlayer` / `readPlayerName`
- [x] 1.2 新建 `packages/mod-common/src/playerGuard.ts`：`createWorldPlayerGuard(Player, world)` 绑定官方类型与在线枚举
- [x] 1.3 `packages/mod-common/src/index.ts` 只导出两个工厂，不导出绑定实例

## 2. 假人判别与容错

- [x] 2.1 `isSimulatedPlayer` 用 `getGameMode()` 抛错/缺失/返回 `undefined` 判定，不依赖 tag
- [x] 2.2 `safePlayers` 逐条丢弃缺失对象与属性抛错项，整体枚举失败返回空集
- [x] 2.3 `readPlayerName` 依次尝试 `name` → 事件负载名 → `nameTag`，全失败返回无名哨兵
- [x] 2.4 `namedPlayers` 返回 `{ player, name, dimensionId?, position? }` 快照，位置读失败保留名字

## 3. HUD 复用共享守卫

- [x] 3.1 `packages/mod-common/src/HudManager.ts` 的玩家过滤改为复用共享守卫
- [x] 3.2 调用方追加过滤与共享判别合并，两者结论一致

## 4. 各模组绑定守卫

- [x] 4.1 `mods/teleporter/scripts/mc/playerGuard.ts` 绑定守卫
- [x] 4.2 `mods/item-route/scripts/mc/util/playerGuard.ts` 绑定守卫
- [x] 4.3 `mods/auto-refill/scripts/mc/playerGuard.ts` 绑定守卫
- [x] 4.4 `mods/spectator-mode/scripts/mc/playerUtil.ts` 内完成绑定（该模组无独立守卫文件）

## 5. teleporter 事件入口与推迟回调双重校验

- [x] 5.1 `playerSpawn` 入口校验玩家句柄
- [x] 5.2 首次进服发信物的 `system.runTimeout` 回调内二次校验
- [x] 5.3 `playerDie` 回传对话框的 `system.runTimeout` 回调内二次校验

## 6. item-route 玩家读取改造

- [x] 6.1 `SortEffects.ts` 改用 `namedPlayers` 快照，去掉裸读 `p.location`
- [x] 6.2 `BoundaryDisplay.ts` 改用守卫枚举
- [x] 6.3 `WarehouseHUD.ts` / `WarningRelay.ts` / `NotifyRelay.ts` 改用快照
- [x] 6.4 `McProximityChecker.ts` / `persistentBoundary.ts` 成员邻近判定用快照，位置不可用者跳过
- [x] 6.5 `ToolInteractionController.ts` / `SearchUI.ts` / `MainMenu.ts` / `organize.ts` / `search.ts` 的玩家位置读取加守卫
- [x] 6.6 `playerName.ts` 改为委托守卫取名
- [x] 6.7 `commands/register.ts` 入口拦截假人：`isSimulatedPlayer` 命中直接返回 `Failure` + `该命令不能由模拟玩家执行`（不推迟后静默丢弃）
- [x] 6.8 `CommandContext` 新增 `playerName` 字段，命令 handler 一律用它代替 `player.name`（`create` / `delete` / `rescan` / `rescanPreview` / `resize` / `search`）
- [x] 6.9 `create.ts` / `resize.ts` 的 `player.dimension.id`、`organize.ts` / `search.ts` 的 `player.dimension` + `player.location` 改走 `playerGuard.safePlayerCall` 快照
- [x] 6.10 `MainMenu.manageNearest` / `SearchUI.showSearchUI` 的名字与位置全部走守卫快照，失败时回退列表或提示，不裸读
- [x] 6.11 `tests/register.test.ts` 补齐守卫桩与 4 条回归用例（假人拒绝、推迟期间句柄失效静默跳过、`playerName` 已解析、`.name` 抛错回退 `nameTag`）

## 7. auto-refill 与 spectator-mode 改造
- [x] 7.1 `auto-refill` 各功能入口的玩家判定改用共享守卫
- [x] 7.2 `spectator-mode` 在线玩家枚举改用共享守卫
- [x] 7.3 `spectator-mode/scripts/mc/commands.ts` 的 `playerOf` 排除假人（`getGameMode()` 抛错/undefined → 拒绝执行）
- [x] 7.4 `spectator-mode/scripts/mc/controller.ts` 的 `toggle` 与 `enterSoul` 把模式/坐标/维度读取包 try，失败返回可读提示且不落盘锚点
- [x] 7.5 `teleporter/scripts/mc/token.ts` 的 `giveTeleportToken` / `ensureTeleportToken` 容错 `getComponent` 与 `spawnItem`
- [x] 7.6 `teleporter/scripts/mc/events.ts` 信物使用（`itemUse` / `playerInteractWithBlock`）入口与推迟回调双重校验

## 8. 单测

- [x] 8.1 `packages/mod-common/tests/player-guard.test.ts` 覆盖纯核全部分支（19 条）
- [x] 8.2 各模组测试改用新守卫，既有用例保持通过
- [x] 8.3 `mods/item-route/tests/register.test.ts` 补齐守卫桩与 6 条回归用例（假人拒绝执行命令、推迟期间句柄失效静默跳过、`playerName` 已解析、`.name` 抛错回退 `nameTag`、假人带 OP 级别不算管理员、权限字段不可读判为非管理员）

## 9. 验证

- [x] 9.1 `pnpm -r build` 全仓通过
- [x] 9.2 `pnpm -r test` 全仓通过（mod-common 50、nbt-data-storage 110、auto-refill 60、item-route 305、mockplayer3 347、spectator-mode 34、teleporter 55）
- [x] 9.3 `openspec validate --all --strict` 通过（18/18）
