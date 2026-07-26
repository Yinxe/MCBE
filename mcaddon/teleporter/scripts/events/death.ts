import { world, system, Player } from "@minecraft/server";
import { recordDeath } from "../teleporter/deathManager";

/**
 * 订阅 entityDie 事件。
 * 仅处理玩家的死亡，记录死亡点。
 */
export function subscribeDeathEvent(): void {
  world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity } = event;

    // 只处理玩家死亡
    if (deadEntity.typeId !== "minecraft:player") return;

    const player = deadEntity as Player;

    // 记录死亡点
    const loc = player.location;
    const dim = player.dimension.id;

    system.run(() => {
      try {
        recordDeath(player, loc, dim);
        console.warn(`[Teleporter] 记录玩家 ${player.name} 的死亡点 [${dim}] ${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)}`);
      } catch (e: any) {
        console.warn(`[Teleporter] 记录死亡失败: ${e.message}`);
      }
    });
  });
}
