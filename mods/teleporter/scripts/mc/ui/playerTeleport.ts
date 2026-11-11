// ─── 玩家间直接传送界面 ─────────────────────────────────────────
//
// 注意:此界面允许把对方拉过来而无需对方同意,与上游行为一致,
// 作为「全量对齐」的已知取舍记录在 design D9。需要征得同意请用 /tpa:tpa。

import { world, type Player } from "@minecraft/server";
import { ActionFormBuilder, notifySuccess } from "@mc-toolchain/mod-common";
import {
  dimensionFullName,
  dimensionDisplayName,
  formatCoordinates,
  formatLocation,
} from "../../core/naming";
import { teleportPlayerTo } from "../teleport";
import { showMainMenu } from "./menu";

/** 在线玩家列表 → 选择目标 → 选择传送方向。 */
export async function showPlayerTeleportMenu(player: Player): Promise<void> {
  const onlinePlayers = world
    .getAllPlayers()
    .filter((other) => other.id !== player.id);

  if (onlinePlayers.length === 0) {
    player.sendMessage("§c当前没有其他在线玩家");
    await showMainMenu(player);
    return;
  }

  const form = new ActionFormBuilder()
    .title("§l玩家传送")
    .body("§e选择一个玩家");

  for (const target of onlinePlayers) {
    const dimension = dimensionDisplayName(target.dimension.id);
    const coordinates = formatCoordinates(target.location);
    form.button(`§e${target.name}§r\n§f${dimension} ${coordinates}`, () =>
      showTeleportDirection(player, target),
    );
  }

  form.buttonWithIcon("§c← 返回主菜单", "textures/ui/teleporter/back", () => showMainMenu(player));

  await form.show(player);
}

/** 选择方向:我过去 / 他过来 / 返回。 */
async function showTeleportDirection(
  player: Player,
  target: Player,
): Promise<void> {
  await new ActionFormBuilder()
    .title(`§l与 §e${target.name}§r 传送`)
    .body(
      `§b目标: §e${target.name}\n` +
        `§b维度: §f${dimensionFullName(target.dimension.id)}\n` +
        `§b坐标: §f${formatCoordinates(target.location)}`,
    )
    .buttonWithIcon("§a传送到他身边", "textures/ui/teleporter/teleport_to", () => goToTarget(player, target))
    .buttonWithIcon("§b让他传送过来", "textures/ui/teleporter/teleport_bring", () => pullTarget(player, target))
    .buttonWithIcon("§c← 返回", "textures/ui/teleporter/back", () => showPlayerTeleportMenu(player))
    .show(player);
}

/** 我传送到目标身边。 */
function goToTarget(player: Player, target: Player): void {
  const ok = teleportPlayerTo(player, target.location, target.dimension.id);
  if (!ok) {
    player.sendMessage("§c传送失败");
    return;
  }

  notifySuccess(
    player,
    `已传送到 §e${target.name}§a 身边 §6（${formatLocation(target.location, target.dimension.id)}§6）`,
  );
  target.sendMessage(`§e${player.name}§a 传送到了你身边`);
}

/** 把目标拉到我身边。无需目标同意,与上游一致。 */
function pullTarget(player: Player, target: Player): void {
  const ok = teleportPlayerTo(target, player.location, player.dimension.id);
  if (!ok) {
    target.sendMessage("§c传送失败");
    return;
  }

  notifySuccess(
    target,
    `§e${player.name}§a 将你传送到了他身边 §6（${formatLocation(player.location, player.dimension.id)}§6）`,
  );
  player.sendMessage(`§e${target.name}§a 已传送到你身边`);
}
