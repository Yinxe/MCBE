// ─── 命令注册中心 — 统一调用各命令的注册函数 ──────────
// 每个命令一个独立文件，在此统一导入和注册

import { StartupEvent } from "@minecraft/server";

import { registerCreateCommand } from "./lifecycle/create";
import { registerListCommand } from "./inspect/list";
import { registerDeleteCommand } from "./lifecycle/delete";
import { registerOnlineCommand } from "./lifecycle/online";
import { registerOfflineCommand } from "./lifecycle/offline";
import { registerKillCommand } from "./lifecycle/kill";
import { registerRespawnCommand, registerSetRespawnCommand } from "./lifecycle/respawn";
import { registerTpCommand, registerTpHereCommand } from "./navigation/teleport";
import { registerMoveCommand, registerLongMoveCommand } from "./navigation/move";
import { registerControlCommand } from "./behavior/control";
import { registerSneakCommand } from "./behavior/sneak";
import { registerTagsCommand, registerTagCommand } from "./behavior/tag";
import { registerMenuCommand } from "./system/menu";
import { registerDataCommand } from "./inspect/data";
import { registerReclaimCommand } from "./lifecycle/reclaim";
import { registerFollowCommand } from "./behavior/follow";
import { registerTridentCommand } from "./activity/trident";

import { registerRecoverCommand } from "./lifecycle/recover";
import { registerAdminCommand } from "./system/admin";
import { registerStorageCommand } from "./inspect/storage";
import { registerTestCommand } from "./system/test";
import { registerScanlogsCommand, registerScanleavesCommand, registerScantreeCommand } from "./system/blockscan";
import { registerFishingCommands } from "./activity/fishing";
import { registerBreakBlockCommand } from "./activity/blockbreak";
import { registerWoodcutCommands } from "./activity/woodcut";

export function registerAllCommands(event: StartupEvent): void {
  const registry = event.customCommandRegistry;

  registerCreateCommand(registry);
  registerListCommand(registry);
  registerDeleteCommand(registry);
  registerOnlineCommand(registry);
  registerOfflineCommand(registry);
  registerKillCommand(registry);
  registerRespawnCommand(registry);
  registerSetRespawnCommand(registry);
  registerTpCommand(registry);
  registerTpHereCommand(registry);
  registerMoveCommand(registry);
  registerLongMoveCommand(registry);
  registerControlCommand(registry);
  registerSneakCommand(registry);
  registerTagsCommand(registry);
  registerTagCommand(registry);
  registerMenuCommand(registry);
  registerDataCommand(registry);
  registerReclaimCommand(registry);
  registerFollowCommand(registry);
  registerTridentCommand(registry);
  registerRecoverCommand(registry);
  registerAdminCommand(registry);
  registerStorageCommand(registry);
  registerTestCommand(registry);
  registerScanlogsCommand(registry);
  registerScanleavesCommand(registry);
  registerScantreeCommand(registry);
  registerFishingCommands(registry);
  registerBreakBlockCommand(registry);
  registerWoodcutCommands(registry);
}
