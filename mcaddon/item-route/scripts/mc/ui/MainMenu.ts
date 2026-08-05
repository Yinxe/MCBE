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
import { btn } from "./uiColor";

export async function showMainMenu(player: Player, deps: CommandDeps): Promise<void> {
  await tryShowNewPlayerGuide(player, deps.config);

  // 管理员入口：拥有任意仓库（与 WarehouseManageMenu 口径一致）
  // 不能用 canRunCommand(undefined) —— 无仓库上下文时 requireRole 恒 false，入口永不可达
  const isAdmin = deps.loadedWarehouses().some((w) => w.ownerId === player.id);
  const canManage = isAdmin;

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