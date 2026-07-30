import { world, system, Player } from "@minecraft/server";
import { MessageFormBuilder } from "@yinxe/toolkit";
import { getLatestDeathPoint } from "../teleporter/deathManager";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import { loadPlayerData } from "../teleporter/persistence";
import { isTeleportToken, createTeleportToken } from "../teleporter/token";

/**
 * 订阅 playerSpawn 事件。
 * 区分初次进入和死亡后重生：
 * - initialSpawn === true → 初次进入游戏，不处理
 * - initialSpawn === false → 死亡重生，如果存在死亡点则弹出对话框
 */
export function subscribeSpawnEvent(): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    const { player, initialSpawn } = event;

    if (initialSpawn) {
      // 首次进入游戏：检查是否有传送信物，没有且背包有空位则发一个
      system.runTimeout(() => {
        tryGiveTokenOnJoin(player);
      }, 3);
      return;
    }

    system.runTimeout(() => {
      try {
        const data = loadPlayerData(player.id);
        if (data.deathPoints.length === 0) return;

        const latestDeath = getLatestDeathPoint(player.id);
        if (!latestDeath) return;

        showDeathTeleportDialog(player, latestDeath);
      } catch {
        // 忽略
      }
    }, 2);
  });
}

/**
 * 玩家进入游戏时，如果背包没有传送信物且有空位，自动发一个。
 */
function tryGiveTokenOnJoin(player: Player): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) return;

  // 检查是否已有信物
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && isTeleportToken(item)) return;
  }

  // 找空位放入，背包满了就忽略
  for (let i = 0; i < container.size; i++) {
    if (!container.getItem(i)) {
      container.setItem(i, createTeleportToken());
      player.sendMessage("§a已获得 §b传送信物§a，右键使用打开传送菜单（§6/tpa:token§a 可再次获取）");
      return;
    }
  }
}

function showDeathTeleportDialog(
  player: Player,
  deathPoint: NonNullable<ReturnType<typeof getLatestDeathPoint>>,
): void {
  const loc = formatLocation(deathPoint.location, deathPoint.dimensionId);
  const timeAgo = formatTimeAgo(deathPoint.deathTime);
  const sameDim = deathPoint.dimensionId === player.dimension.id;
  const distText = sameDim
    ? ` §6（相距 §f${Math.round(distance(player.location, deathPoint.location))}§6 格）`
    : "";

  new MessageFormBuilder()
    .title("§c☠ 你死了！")
    .body(
      `§f死亡位置: ${loc}${distText}\n` +
      `§f死亡时间: §b${timeAgo}\n\n` +
      `§b是否立即传送到死亡点？`,
    )
    .confirmButton("§a传送回去", () => {
      const ok = teleportPlayerTo(player, deathPoint.location, deathPoint.dimensionId);
      if (ok) {
        player.sendMessage(`§a已传送到死亡点 §6（${loc}§6）`);
      } else {
        player.sendMessage("§c传送失败，目标位置可能已卸载");
      }
    })
    .cancelButton("§c取消")
    .show(player);
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}
