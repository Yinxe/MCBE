/**
 * ============================================================================
 * FamilyConfigMenu —— 家庭成员分拣配置界面
 * ============================================================================
 *
 * 提供仓库级别的家庭成员分拣开关配置界面。
 * 玩家可在此界面按族启用或禁用 Family 分类功能。
 *
 * 配置存储在 WarehouseSettings.enabledFamilies 中，
 * 分拣引擎在运行时根据此配置决定是否对某族物品进行聚集。
 * ============================================================================
 */

import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { WarehouseId } from "../types";
import { ALL_FAMILIES } from "../data/ItemFamilies";

/**
 * 显示家庭成员配置界面。
 *
 * 首次显示时提供一个概述 + 入口按钮，
 * 点击后进入族级开关配置。
 *
 * @param player      - 操作的玩家
 * @param warehouseId - 仓库 ID
 * @param repository  - 仓库数据持久化仓储
 * @param service     - 仓库服务实例
 */
export async function showFamilyConfigMenu(
  player: Player,
  warehouseId: WarehouseId,
  repository: WarehouseRepository,
  service: WarehouseService
): Promise<void> {
  const warehouse = repository.load(warehouseId);
  if (!warehouse) {
    player.sendMessage("§c仓库不存在");
    return;
  }

  const enabledFamilies = warehouse.settings.enabledFamilies ?? [];
  const enabledCount = enabledFamilies.length;
  const totalCount = ALL_FAMILIES.length;

  // ── 构建族配置 ModalForm ──
  const form = new ModalFormBuilder()
    .title("家庭成员")
    .label(
      "info",
      `§7启用 Family 分类后，同一分类的物品（如各色羊毛）会自动聚集到同一个容器中。\n` +
        `§7当前已启用 §f${enabledCount}§7/§f${totalCount} §7个分类`
    );

  // 为每个族添加一个命名开关
  for (const family of ALL_FAMILIES) {
    const isEnabled = enabledFamilies.includes(family.id);
    form.toggle(family.id, `§6${family.displayName} §7(${family.items.length}种)`, {
      defaultValue: isEnabled,
    });
  }

  const vals = await form.show(player);
  if (!vals) return;

  // 读取每个族的开关状态，构建新的 enabledFamilies 列表
  const newEnabledFamilies: string[] = [];
  for (const family of ALL_FAMILIES) {
    if (vals[family.id] === true) {
      newEnabledFamilies.push(family.id);
    }
  }

  // 如果配置有变化则保存
  if (arraysDiffer(enabledFamilies, newEnabledFamilies)) {
    try {
      service.updateSettings(warehouseId, { enabledFamilies: newEnabledFamilies });
      player.sendMessage(`§a家庭成员配置已更新，已启用 §f${newEnabledFamilies.length}§a/§f${totalCount} §a个分类`);
    } catch (error) {
      player.sendMessage(`§c保存失败: ${error}`);
    }
  } else {
    player.sendMessage("§e配置未变更");
  }
}

/**
 * 比较两个字符串数组是否不同（忽略顺序）。
 */
function arraysDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.some((v, i) => v !== sortedB[i]);
}
