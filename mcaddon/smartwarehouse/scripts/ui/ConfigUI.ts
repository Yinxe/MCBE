/**
 * ============================================================================
 * ConfigUI —— 模组全局配置界面
 * ============================================================================
 *
 * 职责：
 * 1. 提供信物配选择界面（下拉选择框）
 * 2. 配置仓库最大体积和单仓库最大容器数
 * 3. 配置各玩家最大仓库数
 * 4. 配置全局处理速度最快限制
 * 5. 仅管理员可访问
 * ============================================================================
 */

import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import type { ModConfig, ModConfigStore } from "../storage/ModConfigStore";
import { TOKEN_OPTIONS, VOLUME_OPTIONS, CONTAINER_OPTIONS, GLOBAL_SPEED_OPTIONS } from "../storage/ModConfigStore";
import { canManageWarehouse } from "../util/PlayerAuth";
import { WarehouseRepository } from "../storage/WarehouseRepository";

/**
 * 显示模组全局配置界面。
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
  const speedIdx = GLOBAL_SPEED_OPTIONS.findIndex((o) => o.value === config.globalSpeedLimit);

  const vals = await new ModalFormBuilder()
    .title("SmartWarehouse 配置")
    .label("info", "§7配置模组的全局设置")
    .dropdown(
      "token",
      "§a信物物品",
      TOKEN_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, tokenIdx),
      }
    )
    .dropdown(
      "volume",
      "§a仓库最大体积",
      VOLUME_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, volIdx),
      }
    )
    .dropdown(
      "containers",
      "§a单仓最大容器数",
      CONTAINER_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, conIdx),
      }
    )
    .slider("maxWarehouses", "§a每玩家最多仓库数", 1, 5, { defaultValue: config.maxWarehousesPerPlayer })
    .dropdown(
      "speedLimit",
      "§a全局处理速度最快限制",
      GLOBAL_SPEED_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, speedIdx),
      }
    )
    .show(player);

  if (!vals) return;

  const newConfig: ModConfig = {
    tokenItemId: TOKEN_OPTIONS[vals.token as number]?.itemId ?? null,
    maxWarehouseVolume: VOLUME_OPTIONS[vals.volume as number]?.value ?? 16384,
    maxContainers: CONTAINER_OPTIONS[vals.containers as number]?.value ?? 100,
    maxWarehousesPerPlayer: vals.maxWarehouses as number,
    globalSpeedLimit: GLOBAL_SPEED_OPTIONS[vals.speedLimit as number]?.value ?? null,
  };

  // 如果全局速度限制变化，对所有仓库强制实施
  const oldLimit = config.globalSpeedLimit;
  const newLimit = newConfig.globalSpeedLimit;
  if (oldLimit !== newLimit && newLimit !== null) {
    const repo = new WarehouseRepository();
    for (const w of repo.loadAll()) {
      if (w.settings.processingSpeed < newLimit) {
        w.settings.processingSpeed = newLimit as any;
        repo.saveMetaOnly(w);
      }
    }
    player.sendMessage(`§7已调整所有仓库的处理速度以符合新限制`);
  }

  configStore.save(newConfig);

  const tokenLabel = TOKEN_OPTIONS.find((o) => o.itemId === newConfig.tokenItemId);
  player.sendMessage(
    `§a配置已保存。信物: §e${tokenLabel?.label ?? "无"}§a，` +
      `每玩家最多 §f${newConfig.maxWarehousesPerPlayer}§a 个仓库`
  );
}
