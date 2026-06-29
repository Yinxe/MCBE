import { world } from "@minecraft/server";

// Set keepInventory on world load — no cheats required via Script API.
// Achievements are preserved since experimental features and cheats are not enabled.
world.afterEvents.worldLoad.subscribe(() => {
  world.gameRules.keepInventory = true;
});
