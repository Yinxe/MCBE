import { system, world } from "@minecraft/server";

/**
 * 「死亡不掉落」:在世界加载时把世界游戏规则 keepInventory 设为开启。
 *
 * 这是世界级规则,与具体玩家无关,因此只在世界加载后设置一次,
 * 不订阅玩家事件重复设置。也只写 keepInventory 这一个规则 —— 不开启作弊。
 */
function enableKeepInventory(): void {
  try {
    world.gameRules.keepInventory = true;
  } catch (error) {
    console.warn(`[keepinventory] 设置 keepInventory 失败:${String(error)}`);
  }
}

// worldLoad 在世界加载完成、玩家进入之前触发,此时 gameRules 已可写。
// 再包一层 system.run 推迟到下一个 tick,避开加载当帧可能存在的只读窗口。
world.afterEvents.worldLoad.subscribe(() => {
  system.run(enableKeepInventory);
});
