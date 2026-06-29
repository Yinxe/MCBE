// ─── 命令注册中心 — 统一调用各命令的注册函数 ──────────
// 每个命令一个独立文件，在此统一导入和注册

import { StartupEvent } from "@minecraft/server";

import { registerCreateCommand } from "./create";
import { registerListCommand } from "./list";
import { registerDeleteCommand } from "./delete";
import { registerOnlineCommand } from "./online";
import { registerOfflineCommand } from "./offline";
import { registerKillCommand } from "./kill";
import { registerRespawnCommand, registerSetRespawnCommand } from "./respawn";
import { registerTpCommand, registerTpHereCommand } from "./teleport";
import { registerMoveCommand } from "./move";
import { registerControlCommand } from "./control";
import { registerSneakCommand } from "./sneak";
import { registerTagsCommand, registerTagCommand } from "./tag";
import { registerMenuCommand } from "./menu";
import { registerDataCommand } from "./data";
import { registerReclaimCommand } from "./reclaim";

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
  registerControlCommand(registry);
  registerSneakCommand(registry);
  registerTagsCommand(registry);
  registerTagCommand(registry);
  registerMenuCommand(registry);
  registerDataCommand(registry);
  registerReclaimCommand(registry);
}
