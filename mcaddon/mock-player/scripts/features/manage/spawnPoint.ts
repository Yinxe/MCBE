// ─── 设置重生点（BOT 主菜单 updateSpawn 动作） ─────────

import { Player, system, world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { BOT_TAG } from "../../rules/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { getPlayerLookTarget } from "../basic/PoseGateway";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";

// ─── UI 事件订阅（BOT 主菜单 → 感知设置重生动作） ──────

/** 订阅 BOT 主菜单动作事件：把玩家当前位置设为假人重生点 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "updateSpawn") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    updateSpawn(player, e.botName);
  });
}

function updateSpawn(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      r.respawnPoint = {
        location: player.location,
        dimension: player.dimension.id,
        rotation: player.getRotation(),
        lookTarget: getPlayerLookTarget(player),
      };
      if (r.online && r.entityId) {
        const e = world.getEntity(r.entityId);
        if (e?.hasTag(BOT_TAG)) {
          (e as Player).setSpawnPoint({
            dimension: world.getDimension(r.respawnPoint.dimension),
            x: r.respawnPoint.location.x,
            y: r.respawnPoint.location.y,
            z: r.respawnPoint.location.z,
          });
        }
      }
      saveCoordinator.saveRecord(r);
      player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的重生点`);
    } catch (e: any) { player.sendMessage(`${color.error}${e.message}`); }
  });
}
