// ─── 事件订阅 ───────────────────────────────────────────────────
//
// ⚠ 所有 subscribe() 只能在启动阶段调用:事件信号的 subscribe/unsubscribe
// 在 d.ts 里标注了 "can't be called in read-only mode",运行期再订阅会抛错。
// 因此本文件只在 main.ts 的 startup 回调里被调用一次。
//
// 事件回调本身也是受限上下文:记录死亡点、发信物、打开界面都要推迟到安全 tick。

import { system, world, type Player } from "@minecraft/server";
import { MessageFormBuilder, runSafeDetached } from "@mc-toolchain/mod-common";
import { listDeathPoints, recordDeathPoint } from "../core/deathPoints";
import { distanceBetween, formatLocation, formatTimeAgo } from "../core/naming";
import { ensureTeleportToken, hasTeleportToken } from "./token";
import { loadPlayerData, savePlayerData } from "./store";
import { teleportToSavedPoint } from "./teleport";
import { isTeleportToken } from "../core/token";
import { showMainMenu } from "./ui/menu";

/**
 * 注册全部事件订阅。
 *
 * 必须在 startup 阶段调用一次,不要在游戏运行中重复调用。
 */
export function registerAllEvents(): void {
  subscribeDeathEvent();
  subscribeSpawnEvent();
  subscribeTokenUseEvent();
}

/**
 * 玩家死亡:记录死亡点。
 *
 * 只处理玩家,僵尸等生物死亡不会产生死亡点。
 */
function subscribeDeathEvent(): void {
  world.afterEvents.entityDie.subscribe((event) => {
    const deadEntity = event.deadEntity;
    if (deadEntity.typeId !== "minecraft:player") return;

    const player = deadEntity as Player;
    const location = player.location;
    const dimensionId = player.dimension.id;

    runSafeDetached(() => {
      const data = loadPlayerData(player.id);
      recordDeathPoint(data, location, dimensionId);
      savePlayerData(player.id, data);
    });
  });
}

/**
 * 玩家重生 / 进入游戏。
 *
 * 首次进入:补发信物(已有信物或背包没空位时不发)。
 * 死亡重生:存在死亡点时弹出回传对话框。
 */
function subscribeSpawnEvent(): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;

    if (event.initialSpawn) {
      // 等 3 tick 让背包组件就绪,再检查信物
      system.runTimeout(() => {
        runSafeDetached(() => {
          ensureTeleportToken(player);
        });
      }, 3);
      return;
    }

    // 死亡重生:稍等 2 tick 让玩家实体完全就绪
    system.runTimeout(() => {
      runSafeDetached(() => showDeathTeleportDialog(player));
    }, 2);
  });
}

/** 死亡重生后的回传对话框。没有死亡点或已无信物时不弹。 */
async function showDeathTeleportDialog(player: Player): Promise<void> {
  const data = loadPlayerData(player.id);
  const points = listDeathPoints(data);
  const latest = points[0];
  if (!latest) return;

  // 没有信物就不打扰玩家(信物是模组功能的入口凭证)
  const container = player.getComponent("inventory")?.container;
  if (!container || !hasTeleportToken(container)) return;

  const sameDimension = latest.dimensionId === player.dimension.id;
  const distanceText = sameDimension
    ? ` §6(相距 §f${distanceBetween(player.location, latest.location)}§6 格)`
    : "";

  const confirmed = await new MessageFormBuilder()
    .title("§c☠ 你死了!")
    .body(
      `§f死亡位置: ${formatLocation(latest.location, latest.dimensionId)}${distanceText}\n` +
        `§f死亡时间: §b${formatTimeAgo(latest.deathTime)}\n\n` +
        `§b是否立即传送到死亡点?`,
    )
    .confirmButton("§a✓ 传送")
    .cancelButton("§c✗ 留下")
    .show(player);

  if (!confirmed) return;
  teleportToSavedPoint(player, "死亡点", latest.location, latest.dimensionId);
}

/**
 * 使用传送信物:打开主菜单。
 *
 * 两条路径都要拦:`itemUse` 覆盖空气右键,`playerInteractWithBlock` 覆盖
 * 对着方块右键(否则会先触发方块交互)。两处都取消事件,物品不消耗。
 */
function subscribeTokenUseEvent(): void {
  world.beforeEvents.itemUse.subscribe((event) => {
    if (
      !isTeleportToken({
        typeId: event.itemStack.typeId,
        lore: event.itemStack.getLore(),
      })
    )
      return;
    event.cancel = true;
    const player = event.source;
    runSafeDetached(() => showMainMenu(player));
  });

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const item = event.itemStack;
    if (!item) return;
    if (!isTeleportToken({ typeId: item.typeId, lore: item.getLore() })) return;
    event.cancel = true;
    const player = event.player;
    runSafeDetached(() => showMainMenu(player));
  });
}
