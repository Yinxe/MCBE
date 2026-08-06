// ─── 仓库列表：管理员全部 / 普通玩家成员身份 ────────────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, canManage } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";
import * as uiColor from "./uiColor";

export async function showWarehouseManageMenu(player: Player, deps: CommandDeps): Promise<void> {
  const all = deps.loadedWarehouses();
  // 管理员（OP）或拥有任一仓库：可见全部；否则仅显示有成员身份的仓库（v1 管理员可管理所有）
  const ownsAny = all.some((w) => w.ownerId === player.id);
  const visible = canManage(player) || ownsAny
    ? all
    : all.filter((w) => deps.members.getRole(w, player.id) !== undefined);

  if (visible.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}没有可管理的仓库`);
    return;
  }

  // 仓库名按钮在浅灰背景上 → 深色前景
  const form = new ActionFormBuilder().title(`${uiColor.form.title}仓库列表`).body(`${uiColor.form.body}选择仓库：`);
  for (const w of [...visible].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    form.button(`${uiColor.btn.nav}${w.displayName}`, () => void showWarehouseSettingsMenu(player, deps, w));
  }
  await form.show(player);
}