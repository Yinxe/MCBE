// ─── 主菜单：搜索/仓库列表/建仓/帮助 + 管理员专属配置入口 ──
// 入口点：`ir:menu` 命令 + 对空右键信物（ToolInteractionController.itemUse）。
// 新手引导优先（tryShowNewPlayerGuide，每玩家一次）；管理员专属"模组配置"按 OP 判定。
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

/**
 * 展示主菜单：容器搜索 / 仓库列表 / 创建仓库 / 帮助，管理员（OP）额外显示模组配置。
 * 管理员入口**不能**按"是否拥有已加载仓库"判定——那会让无仓/仓库未激活的 OP 看不到
 * 管理员菜单，也违背全局配置只属管理员的原则（v1 口径：canManage = OP）。
 *
 * @param player - 打开菜单的玩家
 * @param deps   - 命令共享依赖门面
 */
export async function showMainMenu(player: Player, deps: CommandDeps): Promise<void> {
  await tryShowNewPlayerGuide(player, deps.config);

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
