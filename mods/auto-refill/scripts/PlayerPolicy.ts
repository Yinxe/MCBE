// ─── 玩家守卫（Policy） ────────────────────────────────
// 统一"谁是可操作的玩家"规则：真实玩家（非模拟假人）+ 生存/冒险模式。
// 组装根（main.ts）用它在每个事件回调里校验来源实体。

import {
  GameMode,
  Player,
  type CustomCommandOrigin,
  type Entity,
} from "@minecraft/server";
import { playerGuard } from "./playerGuard";

/**
 * 从命令来源取玩家；非玩家来源（控制台/命令方块等）返回 undefined。
 * 供 /ar:menu 与 /ar:help 等命令共用（菜单/帮助只对玩家弹）。
 * @param origin 命令来源
 */
export function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

export class PlayerPolicy {
  /**
   * 校验事件来源实体是否为可操作的玩家。
   * 非玩家实体 / 假人 / 创造·旁观等一律返回 undefined（不处理）。
   * @param entity 事件来源实体
   * @returns 可操作的玩家；否则 undefined
   */
  asPlayer(entity: Entity | undefined): Player | undefined {
    if (entity === undefined) return undefined;
    if (entity.typeId !== "minecraft:player") return undefined;
    const player = entity as Player;
    // ⚠️ 假人守卫统一走 mod-common：判据为 `getGameMode()` 抛错/返回 undefined，
    // 不依赖 tag——第三方假人模组不保证打 `mockplayer:tag:bot`，故不用 tag 白名单。
    if (!playerGuard.isUsablePlayer(player) || playerGuard.isSimulatedPlayer(player)) return undefined;
    // 仅处理生存/冒险模式（创造/旁观不动）
    let mode: GameMode | undefined;
    try {
      mode = player.getGameMode();
    } catch {
      return undefined;
    }
    if (mode === GameMode.Survival || mode === GameMode.Adventure)
      return player;
    return undefined;
  }
}
