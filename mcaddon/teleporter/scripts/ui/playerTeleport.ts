import { Player, world } from "@minecraft/server";
import { ActionFormBuilder, notifySuccess } from "@yinxe/toolkit/ui";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import { showMainMenu } from "./menu";

/**
 * 玩家传送菜单。
 * 选择在线玩家，然后选择传送方向。
 */
export function showPlayerTeleportMenu(player: Player): void {
  const onlinePlayers = Array.from(world.getAllPlayers()).filter(
    (p) => p.id !== player.id,
  );

  if (onlinePlayers.length === 0) {
    player.sendMessage("§c当前没有其他在线玩家");
    showMainMenu(player);
    return;
  }

  const form = new ActionFormBuilder()
    .title("§l玩家传送")
    .body("§e选择一个玩家");

  for (const target of onlinePlayers) {
    const dim = shortDimension(target.dimension.id);
    const loc = `${Math.floor(target.location.x)} ${Math.floor(target.location.y)} ${Math.floor(target.location.z)}`;
    form.button(
      `§e${target.name}§r\n§f${dim} ${loc}`,
      () => showTeleportDirection(player, target),
    );
  }

  form.button("§c← 返回主菜单", () => showMainMenu(player));

  form.show(player);
}

/**
 * 选择传送方向。
 */
function showTeleportDirection(
  player: Player,
  target: Player,
): void {
  new ActionFormBuilder()
    .title(`§l与 §e${target.name}§r 传送`)
    .body(
      `§b目标: §e${target.name}\n` +
        `§b维度: §f${fullDimension(target.dimension.id)}\n` +
        `§b坐标: §f${Math.floor(target.location.x)} ${Math.floor(target.location.y)} ${Math.floor(target.location.z)}`,
    )
    .button("§a传送到他身边", () => {
      const ok = teleportPlayerTo(player, target.location, target.dimension.id);
      if (ok) {
        notifySuccess(player, `§a已传送到 §e${target.name}§a 身边 §6（${formatLocation(target.location, target.dimension.id)}§6）`);
        target.sendMessage(`§e${player.name}§a 传送到了你身边`);
      } else {
        player.sendMessage("§c传送失败");
      }
    })
    .button("§b让他传送过来", () => {
      const ok = teleportPlayerTo(target, player.location, player.dimension.id);
      if (ok) {
        notifySuccess(target, `§e${player.name}§a 将你传送到了他身边 §6（${formatLocation(player.location, player.dimension.id)}§6）`);
        player.sendMessage(`§e${target.name}§a 已传送到你身边`);
      } else {
        target.sendMessage("§c传送失败");
      }
    })
    .button("§c← 返回", () => showPlayerTeleportMenu(player))
    .show(player);
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

function fullDimension(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld":
      return "主世界";
    case "minecraft:nether":
      return "下界";
    case "minecraft:the_end":
      return "末地";
    default:
      return dimId;
  }
}
