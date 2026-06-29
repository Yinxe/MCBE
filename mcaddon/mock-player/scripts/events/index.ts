// ─── 事件注册中心 — 统一订阅所有事件 ────────────────────
// 每个事件独立文件，在此统一订阅

import { world } from "@minecraft/server";

import { onEntityDie } from "./entityDie";
import { onPlayerSpawn } from "./playerSpawn";
import { onPlayerJoin } from "./playerJoin";
import { onPlayerLeave } from "./playerLeave";
import { onItemUse } from "./itemUse";
import { onPlayerInteractWithEntity } from "./playerInteractWithEntity";
import { onPlayerInventoryItemChange } from "./playerInventoryItemChange";

export function registerAllEvents(): void {
  world.afterEvents.entityDie.subscribe(onEntityDie);
  world.afterEvents.playerSpawn.subscribe(onPlayerSpawn);
  world.afterEvents.playerJoin.subscribe(onPlayerJoin);
  world.afterEvents.playerLeave.subscribe(onPlayerLeave);
  world.afterEvents.itemUse.subscribe(onItemUse);
  world.beforeEvents.playerInteractWithEntity.subscribe(onPlayerInteractWithEntity);
  world.afterEvents.playerInventoryItemChange.subscribe(onPlayerInventoryItemChange);
}
