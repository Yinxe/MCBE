import { StartupEvent } from "@minecraft/server";
import { registerMenuCommand } from "./menu";

export function registerAllCommands(event: StartupEvent): void {
  const registry = event.customCommandRegistry;
  registerMenuCommand(registry);
}
