// ─── 主菜单：搜索/管理/列表/建仓/配置（管理员） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { tryShowNewPlayerGuide } from "./NewPlayerGuide";
import { showSearchUI } from "./SearchUI";
import { showWarehouseManageMenu } from "./WarehouseManageMenu";
import { showWarehouseCreateForm } from "./WarehouseCreateFlow";
import { showConfigUI } from "./ConfigUI";
import { showHelpGuide } from "./HelpGuide";
import { canRunCommand } from "../commands/auth";

export async function showMainMenu(player: Player, deps: CommandDeps): Promise<void> {
  await tryShowNewPlayerGuide(player, deps.config);

  const isAdmin = canRunCommand(deps.members, undefined, player.id, "delete");
  const canManage = isAdmin; // 管理员包含 owner（delete=owner 权限）

  const form = new ActionFormBuilder()
    .title("§b物品路由")
    .body("选择一个操作")
    .button("§d容器搜索", () => void showSearchUI(player, deps))
    .button("§9仓库列表", () => void showWarehouseManageMenu(player, deps))
    .button("§a创建仓库", () => void showWarehouseCreateForm(player, deps))
    .button("§e❓ 帮助", () => void showHelpGuide(player));

  if (canManage) {
    form.button("§e⚙ 模组配置", () => void showConfigUI(player, deps));
  }

  await form.show(player);
}