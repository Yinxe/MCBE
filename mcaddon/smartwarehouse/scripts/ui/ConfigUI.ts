/**
 * ============================================================================
 * ConfigUI —— 模组全局配置界面
 * ============================================================================
 *
 * 职责：
 * 1. 提供信物配选择界面（下拉选择框）
 * 2. 配置仓库最大体积和单仓库最大容器数
 * 3. 仅管理员可访问
 * 4. 配置通过 ModConfigStore 持久化到 DynamicProperty
 * ============================================================================
 */

import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { TOKEN_OPTIONS, VOLUME_OPTIONS, CONTAINER_OPTIONS } from "../storage/ModConfigStore";
import { canManageWarehouse } from "../util/PlayerAuth";

/**
 * 显示模组全局配置界面。
 *
 * @param player      - 操作玩家
 * @param configStore - 模组配置仓储
 */
export async function showConfigUI(player: Player, configStore: ModConfigStore): Promise<void> {
  if (!canManageWarehouse(player)) {
    player.sendMessage("§c你没有权限修改模组配置（需要 op）");
    return;
  }

  const config = configStore.load();
  const tokenIdx = TOKEN_OPTIONS.findIndex((o) => o.itemId === config.tokenItemId);
  const volIdx = VOLUME_OPTIONS.findIndex((o) => o.value === config.maxWarehouseVolume);
  const conIdx = CONTAINER_OPTIONS.findIndex((o) => o.value === config.maxContainers);

  const vals = await new ModalFormBuilder()
    .title("SmartWarehouse 配置")
    .label("info", "§7配置模组的全局设置")
    .dropdown(
      "token",
      "§a选择信物",
      TOKEN_OPTIONS.map((o) => o.label),
      { defaultValueIndex: Math.max(0, tokenIdx) }
    )
    .dropdown(
      "volume",
      "§a仓库最大体积",
      VOLUME_OPTIONS.map((o) => o.label),
      { defaultValueIndex: Math.max(0, volIdx) }
    )
    .dropdown(
      "containers",
      "§a单仓库最大容器数",
      CONTAINER_OPTIONS.map((o) => o.label),
      { defaultValueIndex: Math.max(0, conIdx) }
    )
    .show(player);

  if (!vals) return;

  const tIdx = vals.token as number;
  const vIdx = vals.volume as number;
  const cIdx = vals.containers as number;

  const selToken = TOKEN_OPTIONS[tIdx];
  const selVol = VOLUME_OPTIONS[vIdx];
  const selCon = CONTAINER_OPTIONS[cIdx];

  if (selVol && selCon) {
    configStore.save({
      tokenItemId: selToken?.itemId ?? null,
      maxWarehouseVolume: selVol.value,
      maxContainers: selCon.value,
    });
  }

  if (selToken?.itemId === null) {
    player.sendMessage("§a已关闭信物，手持任何物品均不触发仓库交互");
  } else if (selToken) {
    player.sendMessage(`§a信物已设置为 ${selToken.label}§a，手持该物品即可触发仓库交互`);
  }
  player.sendMessage(`§7仓库最大体积: ${selVol?.label ?? "32×32×16"}，最大容器数: ${selCon?.label ?? "200"}`);
}
