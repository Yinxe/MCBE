// ─── 玩家守卫（Policy） ────────────────────────────────
// 统一"谁是可操作的玩家"规则：真实玩家（非模拟假人）+ 生存/冒险模式。
// 组装根（main.ts）用它在每个事件回调里校验来源实体。

import { GameMode, type Entity, type Player } from "@minecraft/server";

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
    // 假人标识 tag（mock-player 模组给所有假人打的标），带 tag 即假人
    if (player.hasTag("mockplayer:tag:bot")) return undefined;
    // 模拟玩家的 getGameMode() 会抛异常或返回 undefined
    let mode: GameMode | undefined;
    try {
      mode = player.getGameMode();
    } catch {
      return undefined;
    }
    if (mode === undefined) return undefined;
    if (mode === GameMode.Survival || mode === GameMode.Adventure) return player;
    return undefined;
  }
}