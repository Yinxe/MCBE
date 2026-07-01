import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { showWarehouseCreateForm } from "./WarehouseCreateFlow";

/**
 * 显示 SmartWarehouse 系统的主菜单界面。
 * 通过 ActionForm 向玩家提供可用的仓库管理操作入口。
 * 当前版本支持"创建仓库"，"管理仓库"为后续版本预留。
 *
 * @param player - 要向其显示菜单的玩家
 */
export async function showMainMenu(player: Player): Promise<void> {
  // 构建操作选择表单：标题、说明文字和操作按钮
  const form = new ActionFormData()
    .title("SmartWarehouse")
    .body("选择一个操作")
    .button("创建仓库")           // 索引 0：进入仓库创建流程
    .button("管理仓库（后续扩展）"); // 索引 1：预留的仓库管理入口

  // 向玩家展示表单并等待响应
  const response = await form.show(player);
  // 如果玩家关闭了表单（未选择任何操作），直接返回
  if (response.canceled) return;

  // 根据玩家选择的按钮索引执行对应操作
  if (response.selection === 0) {
    // 玩家选择了"创建仓库"，跳转到仓库创建表单流程
    await showWarehouseCreateForm(player);
  }
  // 索引 1（管理仓库）当前版本暂未实现，直接忽略
}
