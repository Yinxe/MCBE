import type { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { ROLE_LABELS, ROLE_ORDER } from "../types";
import { setSession } from "../interaction/SelectionSessionStore";

/**
 * 显示仓库创建表单。
 * 以模态表单（ModalForm）收集仓库名称、默认容器角色和新容器默认启用状态，
 * 然后将这些信息保存到玩家的选择会话（SelectionSession）中，
 * 随后提示玩家使用木锄在游戏内选择仓库区域（两个对角点）。
 *
 * @param player - 要创建仓库的玩家
 */
export async function showWarehouseCreateForm(player: Player): Promise<void> {
  // 按 ROLE_ORDER 顺序生成角色下拉标签列表
  const roleLabels = ROLE_ORDER.map((r) => ROLE_LABELS[r]);

  const form = new ModalFormData()
    .title("创建仓库")
    .textField("仓库名称", "输入仓库名称...")
    .dropdown("默认容器角色", roleLabels, { defaultValueIndex: 0 })
    .dropdown("新容器默认启用", ["是", "否"], { defaultValueIndex: 0 });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 3) {
    player.sendMessage("§c表单数据异常，请重试");
    return;
  }

  const warehouseName = values[0] as string;
  const roleIndex = values[1] as number;
  const enabledIndex = values[2] as number;

  if (typeof warehouseName !== "string" || typeof roleIndex !== "number" || typeof enabledIndex !== "number") {
    player.sendMessage("§c表单数据格式错误，请重试");
    return;
  }

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

  player.sendMessage("§a请在两个对角位置使用木锄点击方块来选择仓库区域");
}
