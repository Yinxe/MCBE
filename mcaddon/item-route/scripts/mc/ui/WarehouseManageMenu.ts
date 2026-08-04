// ─── 仓库列表：管理员全部 / 普通玩家成员身份 ────────────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";

export async function showWarehouseManageMenu(player: Player, deps: CommandDeps): Promise<void> {
  const all = deps.loadedWarehouses();
  // 拥有任一仓库视为管理员（管理列表：全部）；否则仅显示有成员身份的仓库
  const ownsAny = all.some((w) => w.ownerId === player.id);
  const visible = ownsAny
    ? all
    : all.filter((w) => deps.members.getRole(w, player.id) !== undefined);

  if (visible.length === 0) {
    player.sendMessage("§7没有可管理的仓库");
    return;
  }

  const form = new ActionFormBuilder().title("§9仓库列表").body("选择仓库：");
  for (const w of [...visible].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    form.button(`§f${w.displayName}`, () => void showWarehouseSettingsMenu(player, deps, w));
  }
  await form.show(player);
}