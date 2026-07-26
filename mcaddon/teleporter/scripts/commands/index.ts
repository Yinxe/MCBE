import { StartupEvent } from "@minecraft/server";
import { registerMenuCommand } from "./menu";
import { registerWarpCommand, registerSetWarpCommand, registerDelWarpCommand, registerWarpsCommand } from "./warp";
import { registerBackCommand } from "./back";
import { registerDeathPointsCommand } from "./deathpoints";
import { registerTpaCommand, registerTpHereCommand, registerTpAcceptCommand, registerTpDenyCommand } from "./tpa";
import { registerPublicCommand, registerPublicListCommand } from "./public";
import { registerAdminCommand, registerConfigCommand } from "./admin";
import { registerTokenCommand } from "./token";

/**
 * 注册所有命令。
 */
export function registerAllCommands(event: StartupEvent): void {
  const registry = event.customCommandRegistry;

  registerMenuCommand(registry);
  registerWarpCommand(registry);
  registerSetWarpCommand(registry);
  registerDelWarpCommand(registry);
  registerWarpsCommand(registry);
  registerBackCommand(registry);
  registerDeathPointsCommand(registry);
  registerTpaCommand(registry);
  registerTpHereCommand(registry);
  registerTpAcceptCommand(registry);
  registerTpDenyCommand(registry);
  registerPublicCommand(registry);
  registerPublicListCommand(registry);
  registerAdminCommand(registry);
  registerConfigCommand(registry);
  registerTokenCommand(registry);
}
