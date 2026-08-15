// ─── UI 领域事件订阅装配（分散订阅的注册入口） ──────────
// 各功能模块在自己的文件里实现 registerUiSubscriptions()（感知自己感兴趣的
// UI 事件字段/动作），此处统一 import 并调用——保证模块可达（esbuild bundle
// 只包含被引用模块）且订阅代码内聚在各功能文件内。
// UI 层（ui/bot.ts、ui/tags.ts）只发布事件，不 import 任何业务动作函数；
// AI 任务的 UI 反馈订阅（宝库/劫掠不在线提示）在 mc/ai/BotBrain.startBrainEngine。

import { registerUiSubscriptions as registerSneakUi } from "../features/basic/sneak";
import { registerUiSubscriptions as registerSpawnModeUi } from "../features/manage/spawnMode";
import { registerUiSubscriptions as registerUseItemUi } from "../features/basic/useItem";
import { registerUiSubscriptions as registerOnlineUi } from "../features/manage/onlineBot";
import { registerUiSubscriptions as registerTeleportUi } from "../features/basic/teleport";
import { registerUiSubscriptions as registerSpawnPointUi } from "../features/manage/spawnPoint";
import { registerUiSubscriptions as registerRenameUi } from "../features/manage/rename";
import { registerUiSubscriptions as registerKillUi } from "../features/manage/killBot";
import { registerUiSubscriptions as registerFollowUi } from "../features/state/follow";
import { registerUiSubscriptions as registerSwapUi } from "../interaction/ui/panels/swap";
import { registerUiSubscriptions as registerMainhandUi } from "../interaction/ui/panels/mainhand";
import { registerUiSubscriptions as registerReclaimUi } from "../interaction/ui/panels/reclaim";
import { registerUiSubscriptions as registerTagUi } from "../interaction/ui/panels/tags";
import { registerUiSubscriptions as registerTridentUi } from "../interaction/ui/panels/trident";
import { registerUiSubscriptions as registerTridentClaimUi } from "../interaction/ui/panels/tridentClaim";
import { registerUiSubscriptions as registerMoveUi } from "../interaction/ui/panels/move";
import { registerUiSubscriptions as registerDataUi } from "../interaction/commands/inspect/data";

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
  registerSwapUi();
  registerMainhandUi();
  registerReclaimUi();
  registerTagUi();
  registerTridentUi();
  registerTridentClaimUi();
  registerMoveUi();
  registerDataUi();
}
