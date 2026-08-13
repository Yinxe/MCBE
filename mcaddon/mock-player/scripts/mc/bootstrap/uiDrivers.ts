// ─── UI 领域事件订阅装配（分散订阅的注册入口） ──────────
// 各功能模块在自己的文件里实现 registerUiSubscriptions()（感知自己感兴趣的
// UI 事件字段/动作），此处统一 import 并调用——保证模块可达（esbuild bundle
// 只包含被引用模块）且订阅代码内聚在各功能文件内。
// UI 层（ui/bot.ts、ui/tags.ts）只发布事件，不 import 任何业务动作函数；
// 工作流内的订阅由各自 init 注册（workflowManager.initAll）。

import { registerUiSubscriptions as registerSneakUi } from "../features/sneak";
import { registerUiSubscriptions as registerSpawnModeUi } from "../features/spawnMode";
import { registerUiSubscriptions as registerUseItemUi } from "../features/useItem";
import { registerUiSubscriptions as registerOnlineUi } from "../features/onlineBot";
import { registerUiSubscriptions as registerTeleportUi } from "../features/teleport";
import { registerUiSubscriptions as registerSpawnPointUi } from "../features/spawnPoint";
import { registerUiSubscriptions as registerRenameUi } from "../features/rename";
import { registerUiSubscriptions as registerKillUi } from "../features/killBot";
import { registerUiSubscriptions as registerFollowUi } from "../features/follow";
import { registerUiSubscriptions as registerRaidUi } from "../features/raidMode";
import { registerUiSubscriptions as registerSwapUi } from "../ui/swap";
import { registerUiSubscriptions as registerMainhandUi } from "../ui/mainhand";
import { registerUiSubscriptions as registerReclaimUi } from "../ui/reclaim";
import { registerUiSubscriptions as registerTagUi } from "../ui/tags";
import { registerUiSubscriptions as registerTridentUi } from "../ui/trident";
import { registerUiSubscriptions as registerTridentClaimUi } from "../ui/tridentClaim";
import { registerUiSubscriptions as registerMoveUi } from "../ui/move";
import { registerUiSubscriptions as registerDataUi } from "../commands/data";

/** 注册全部 UI 领域事件订阅（worldLoad 后调用一次） */
export function registerUiDrivers(): void {
  registerSneakUi();
  registerSpawnModeUi();
  registerUseItemUi();
  registerOnlineUi();
  registerTeleportUi();
  registerSpawnPointUi();
  registerRenameUi();
  registerKillUi();
  registerFollowUi();
  registerRaidUi();
  registerSwapUi();
  registerMainhandUi();
  registerReclaimUi();
  registerTagUi();
  registerTridentUi();
  registerTridentClaimUi();
  registerMoveUi();
  registerDataUi();
}
