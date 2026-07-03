/**
 * ============================================================================
 * ConfigUI —— 模组全局配置界面
 * ============================================================================
 *
 * 职责：
 * 1. 提供信物配选择界面（下拉选择框）
 * 2. 仅管理员可访问
 * 3. 配置通过 ModConfigStore 持久化到 DynamicProperty
 * ============================================================================
 */

import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { TOKEN_OPTIONS } from "../storage/ModConfigStore";
import { canManageWarehouse } from "../util/PlayerAuth";

/**
 * 显示模组全局配置界面。
 *
 * @param player      - 操作玩家
 * @param configStore - 模组配置仓储
 */
export async function showConfigUI(player: Player, configStore: ModConfigStore): Promise<void> {
  // 权限检查：仅管理员
  if (!canManageWarehouse(player)) {
    player.sendMessage("§c你没有权限修改模组配置（需要 op）");
    return;
  }

  const current = configStore.load();
  const currentTokenId = current.tokenItemId;

  // 找出当前信物在选项列表中的索引
  const defaultIndex = TOKEN_OPTIONS.findIndex(
    (opt) => opt.itemId === currentTokenId
  );

  const form = new ModalFormBuilder()
    .title("SmartWarehouse 配置")
    .label("info", "§7配置模组的全局信物物品\n手持信物可替代木锄触发仓库交互和边界显示")
    .dropdown(
      "token",
      "§a选择信物",
      TOKEN_OPTIONS.map((opt) => opt.label),
      { defaultValueIndex: defaultIndex >= 0 ? defaultIndex : 0 }
    );

  const vals = await form.show(player);
  if (!vals) return;
  const selectedIndex = vals.token as number;

  const selected = TOKEN_OPTIONS[selectedIndex];
  if (!selected) return;

  configStore.setTokenId(selected.itemId);

  if (selected.itemId === null) {
    player.sendMessage("§a已关闭信物，手持任何物品均不触发仓库交互");
  } else {
    player.sendMessage(`§a信物已设置为 ${selected.label}§a，手持该物品即可触发仓库交互`);
  }
}
