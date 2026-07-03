import type { Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import { ROLE_LABELS, ROLE_ORDER } from "../types";
import { setSession } from "../interaction/SelectionSessionStore";

/**
 * 显示仓库创建表单。
 * 以模态表单（ModalForm）收集仓库名称、默认容器角色和新容器默认启用状态，
 * 然后将这些信息保存到玩家的选择会话（SelectionSession）中，
 * 随后提示玩家手持信物在游戏内选择仓库区域（两个对角点）。
 *
 * @param player - 要创建仓库的玩家
 */
export async function showWarehouseCreateForm(player: Player): Promise<void> {
  // 按 ROLE_ORDER 顺序生成角色下拉标签列表
  const roleLabels = ROLE_ORDER.map((r) => ROLE_LABELS[r]);

  const form = new ModalFormBuilder()
    .title("创建仓库")
    .textField("name", "仓库名称", "输入仓库名称...")
    .dropdown("role", "默认容器角色", roleLabels, { defaultValueIndex: 2 })  // 默认其他仓位(misc, ROLE_ORDER[2])
    .dropdown("enabled", "新容器默认启用", ["是", "否"], { defaultValueIndex: 0 });

  const vals = await form.show(player);
  if (!vals) return;
  const warehouseName = vals.name as string;
  const roleIndex = vals.role as number;
  const enabledIndex = vals.enabled as number;

  if (!warehouseName || warehouseName.trim() === "") {
    player.sendMessage("§c仓库名称不能为空");
    return;
  }

  if (roleIndex < 0 || roleIndex >= ROLE_ORDER.length) {
    player.sendMessage("§c角色选择无效，请重试");
    return;
  }

  const defaultNewContainerRole = ROLE_ORDER[roleIndex];
  const defaultNewContainerEnabled = enabledIndex === 0;

  setSession(player, {
    type: "createWarehouse",
    warehouseName: warehouseName.trim(),
    defaultNewContainerRole,
    defaultNewContainerEnabled,
  });

  player.sendMessage("§a请在两个对角位置使用信物点击方块来选择仓库区域");
}
