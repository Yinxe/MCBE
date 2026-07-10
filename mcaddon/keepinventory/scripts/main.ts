import { GameMode, world } from "@minecraft/server";

// Set keepInventory on world load — no cheats required via Script API.
// Achievements are preserved since experimental features and cheats are not enabled.
world.afterEvents.worldLoad.subscribe(() => { //世界加载时
  world.gameRules.keepInventory = true; //修改世界规则:开启死亡不掉落
  world.gameRules.commandBlocksEnabled = true;
});
world.afterEvents.playerSpawn.subscribe((event) => {
  console.log(event.player.name+'playerSpawn');
  event.player.setGameMode(GameMode.Survival);//玩家复活时:修改成生存模式
})
world.beforeEvents.playerGameModeChange.subscribe((event) => {
  if (event.toGameMode == GameMode.Spectator&&world.isHardcore) {
    event.cancel = true;
    console.log(event.player.name+'playerGameModeChange');
    event.player.setGameMode(GameMode.Survival);//玩家游戏模式改变时: 拦截游戏模式变化,并强制改成生存模式
  }
});
