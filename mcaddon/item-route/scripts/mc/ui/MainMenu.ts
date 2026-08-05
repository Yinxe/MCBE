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
import { btn } from "./uiColor";

export async function showMainMenu(player: Player, deps: CommandDeps): Promise<void> {
  await tryShowNewPlayerGuide(player, deps.config);

  const isAdmin = canRunCommand(deps.members, undefined, player.id, "delete");
  const canManage = isAdmin; // 管理员包含 owner（delete=owner 权限）

  // 按钮文字用深色（ActionForm 浅灰按钮背景，见 uiColor.btn）
  const form = new ActionFormBuilder()
    .title("物品路由")
    .body("选择一个操作")
    .button(`${btn.nav}容器搜索`, () => void showSearchUI(player, deps))
    .button(`${btn.nav}仓库列表`, () => void showWarehouseManageMenu(player, deps))
    .button(`${btn.primary}创建仓库`, () => void showWarehouseCreateForm(player, deps))
    .button(`${btn.info}帮助`, () => void showHelpGuide(player));

  if (canManage) {
    form.button(`${btn.accent}模组配置`, () => void showConfigUI(player, deps));
  }

  await form.show(player);
}