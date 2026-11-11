// ─── 主菜单：搜索/管理/仓库列表/建仓/帮助 + 管理员专属配置入口 ──
// 入口点：`ir:menu` 命令 + 对空右键信物（ToolInteractionController.itemUse）。
// 新手引导优先（tryShowNewPlayerGuide，每玩家一次）；管理员专属"模组配置"按 OP 判定。
// "管理仓库"对齐 v1：就近找玩家有管理权的仓库直接进其设置；附近没有则回退仓库列表。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@mc-toolchain/mod-common";
import { canManage } from "../auth/admin";
import type { CommandDeps } from "../commands/deps";
import { tryShowNewPlayerGuide } from "./NewPlayerGuide";
import { showSearchUI } from "./SearchUI";
import { showWarehouseManageMenu } from "./WarehouseManageMenu";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";
import { showWarehouseCreateForm } from "./WarehouseCreateFlow";
import { showOPConfigUI } from "./OPConfigUI";
import { showHelpGuide } from "./HelpGuide";
import { nearestWarehouseByPermission } from "../../core/model/Area";
import { playerGuard } from "../util/playerGuard";
import { playerNameOf } from "../util/playerName";
import { btn } from "./uiColor";

/** "管理仓库"就近判定：距仓库中心不超过此格数才算"附近"（v1 WAREHOUSE_NEARBY_MARGIN 同款） */
const NEARBY_MARGIN = 8;

/**
 * 展示主菜单：容器搜索 / 管理仓库（就近） / 仓库列表 / 创建仓库 / 帮助，
 * 管理员（OP）额外显示模组配置。
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
    .buttonWithIcon(`${btn.nav}容器搜索`, "textures/ui/item-route/search", () => void showSearchUI(player, deps))
    .buttonWithIcon(`${btn.nav}管理仓库`, "textures/ui/item-route/manage", () => void manageNearest(player, deps))
    .buttonWithIcon(`${btn.nav}仓库列表`, "textures/ui/item-route/warehouse_list", () => void showWarehouseManageMenu(player, deps))
    .buttonWithIcon(`${btn.primary}创建仓库`, "textures/ui/item-route/create_warehouse", () => void showWarehouseCreateForm(player, deps))
    .buttonWithIcon(`${btn.info}帮助`, "textures/ui/item-route/help", () => void showHelpGuide(player));

  if (isAdmin) {
    form.buttonWithIcon(`${btn.accent}模组配置`, "textures/ui/item-route/config", () => void showOPConfigUI(player, deps));
  }

  await form.show(player);
}

/**
 * "管理仓库"：就近找玩家有管理权（owner/member）的仓库直接进设置；附近没有则回退列表。
 * v1 同款：管理入口是高频操作，就近直达省一次菜单点击。
 */
function manageNearest(player: Player, deps: CommandDeps): void {
  // ⚠️ 玩家名与位置统一走守卫：菜单回调可能拿到瞬态失效句柄（假人/刚下线），
  // 裸读 `.name` / `.dimension` / `.location` 会 TypeError。取不到就回退列表。
  const playerName = playerNameOf(player);
  const snapshot = playerGuard.safePlayerCall(player, (p) => ({
    dimensionId: p.dimension.id,
    position: { x: p.location.x, z: p.location.z },
  }));
  if (playerName === undefined || snapshot === undefined) {
    player.sendMessage(`${btn.info}无法读取你的位置，显示全部列表`);
    void showWarehouseManageMenu(player, deps);
    return;
  }
  const warehouses = deps.loadedWarehouses();
  const target = nearestWarehouseByPermission(
    warehouses,
    snapshot.dimensionId,
    snapshot.position,
    (w) => deps.members.can(w, playerName, "member")
  );
  if (target === undefined) {
    player.sendMessage(`${btn.info}附近没有找到你有管理权的仓库，显示全部列表`);
    void showWarehouseManageMenu(player, deps);
    return;
  }
  // 距离过远 → 也回退列表（v1 "附近"语义）
  const cx =
    (Math.min(target.area.corner1.x, target.area.corner2.x) + Math.max(target.area.corner1.x, target.area.corner2.x)) /
    2;
  const cz =
    (Math.min(target.area.corner1.z, target.area.corner2.z) + Math.max(target.area.corner1.z, target.area.corner2.z)) /
    2;
  if (Math.hypot(snapshot.position.x - cx, snapshot.position.z - cz) > NEARBY_MARGIN) {
    player.sendMessage(`${btn.info}附近没有找到你有管理权的仓库，显示全部列表`);
    void showWarehouseManageMenu(player, deps);
    return;
  }
  deps.ensureContainersLoaded(target);
  void showWarehouseSettingsMenu(player, deps, target);
}
