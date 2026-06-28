import { world, system } from "@minecraft/server";

world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) {
    world.sendMessage("HELLO WORLD");
  }
});

function mainTick() {

  // add main loop code here.
  system.run(mainTick);
}

// Uncomment the line below to ensure your main tick code is called from the start.
// system.run(mainTick);
