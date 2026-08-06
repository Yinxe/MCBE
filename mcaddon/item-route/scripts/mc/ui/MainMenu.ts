// ─── 主菜单：搜索/管理/列表/建仓/配置（管理员） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, canManage } from "@yinxe/toolkit";
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

  // 管理员专属入口（v1 口径）：OP（@yinxe/toolkit canManage）可进"模组配置"。
  // 注意不能用"是否拥有已加载仓库"判定——那会让无仓库/仓库未激活的 OP 看不到
  // 管理员菜单，也违背全局配置（速度/信物/全局开关）只属管理员的原则。
  const isAdmin = canManage(player);

  // 按钮文字用深色（ActionForm 浅灰按钮背景，见 uiColor.btn）
  const form = new ActionFormBuilder()
    .title("物品路由")
    .body("选择一个操作")
    .button(`${btn.nav}容器搜索`, () => void showSearchUI(player, deps))
    .button(`${btn.nav}仓库列表`, () => void showWarehouseManageMenu(player, deps))
    .button(`${btn.primary}创建仓库`, () => void showWarehouseCreateForm(player, deps))
    .button(`${btn.info}帮助`, () => void showHelpGuide(player));

  if (isAdmin) {
    form.button(`${btn.accent}模组配置`, () => void showConfigUI(player, deps));
  }

  await form.show(player);
}