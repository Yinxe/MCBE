import { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit/ui";
import { getDeathPoints, deleteDeathPoint } from "../teleporter/deathManager";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import { showMainMenu } from "./menu";

const PAGE_SIZE = 8;

/**
 * 死亡点列表。
 */
export function showDeathPointsList(
  player: Player,
  page: number = 0,
): void {
  const points = getDeathPoints(player.id);
  const totalPages = Math.max(1, Math.ceil(points.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagePoints = points.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  const form = new ActionFormBuilder()
    .title(`§l死亡传送点 (${points.length})`);

  if (points.length === 0) {
    form.body("§6暂无死亡记录");
  } else {
    form.body("§6点击传送");
  }

  for (const dp of pagePoints) {
    const dim = shortDimension(dp.dimensionId);
    const loc = `${Math.floor(dp.location.x)} ${Math.floor(dp.location.y)} ${Math.floor(dp.location.z)}`;
    const time = formatTime(dp.deathTime);
    const label = `§c☠ §f${dim} ${loc}\n§6${time}`;

    form.button(label, () => {
      const ok = teleportPlayerTo(player, dp.location, dp.dimensionId);
      if (ok) {
        player.sendMessage(`§a已传送到死亡点 §6（${formatLocation(dp.location, dp.dimensionId)}§6）`);
      } else {
        player.sendMessage("§c传送失败，目标位置可能已卸载");
      }
    });
  }

  // 分页
  if (totalPages > 1) {
    if (currentPage > 0) {
      form.button("◀ 上一页", () => showDeathPointsList(player, currentPage - 1));
    }
    if (currentPage < totalPages - 1) {
      form.button("▶ 下一页", () => showDeathPointsList(player, currentPage + 1));
    }
  }

  form.button("§c清除所有死亡点", () => {
    for (const dp of points) {
      deleteDeathPoint(player.id, dp.id);
    }
    player.sendMessage("§c已清除所有死亡点");
    showDeathPointsList(player);
  });

  form.button("§c← 返回主菜单", () => showMainMenu(player));

  form.show(player);
}

function shortDimension(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld":
      return "主世界";
    case "minecraft:nether":
      return "下界";
    case "minecraft:the_end":
      return "末地";
    default:
      return dimId.split(":")[1] || dimId;
  }
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
