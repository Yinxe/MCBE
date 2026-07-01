import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { ContainerId, ContainerRole, StoredContainer, WarehouseData } from "../types";
import { ROLE_LABELS, ROLE_ORDER, ROLE_DESCRIPTIONS } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import type { WarehouseService } from "../warehouse/WarehouseService";

/**
 * 显示容器设置菜单。
 *
 * 根据玩家权限提供不同界面：
 * - 非管理员：只读查看容器信息（仓库名、容器 ID、启用状态、角色），仅有关闭按钮。
 * - 管理员：使用 ModalForm 统一设置容器的启用状态、角色，并提供删除（禁用）选项。
 *
 * @param player      - 请求查看/修改容器设置的玩家
 * @param warehouse   - 容器所属的仓库数据
 * @param containerId - 容器的唯一标识符
 * @param container   - 容器存储数据
 * @param service     - 仓库服务实例
 */
export async function showContainerRoleMenu(
  player: Player,
  warehouse: WarehouseData,
  containerId: ContainerId,
  container: StoredContainer,
  service: WarehouseService
): Promise<void> {
  const isManager = canManageWarehouse(player);

  if (!isManager) {
    // ── 非管理员玩家：只读查看容器信息 ──
    const roleLabel = ROLE_LABELS[container.role];
    const roleDesc = ROLE_DESCRIPTIONS[container.role];

    const form = new ActionFormData()
      .title("容器信息")
      .body(
        `仓库: ${warehouse.displayName}\n` +
          `容器ID: ${containerId}\n` +
          `状态: ${container.enabled ? "§a启用" : "§c禁用"}\n` +
          `角色: ${roleLabel}\n` +
          `描述: ${roleDesc}`
      )
      .button("关闭");
    await form.show(player);
    return;
  }

  // ── 管理员玩家：ModalForm 统一设置 ──
  const currentRoleIndex = ROLE_ORDER.indexOf(container.role);
  const roleOptions = ROLE_ORDER.map((r) => `${ROLE_LABELS[r]} — ${ROLE_DESCRIPTIONS[r]}`);
  const currentRoleLabel = ROLE_LABELS[container.role];
  const roleDesc = ROLE_DESCRIPTIONS[container.role];

  const form = new ModalFormData()
    .title("容器设置")
    .label(
      `§7仓库: ${warehouse.displayName}\n` +
      `§7容器ID: ${containerId}\n` +
      `§7状态: ${container.enabled ? "§a已启用" : "§c已禁用"}\n` +
      `§7角色: §f${currentRoleLabel} — ${roleDesc}§r`
    )
    .toggle("启用容器", { defaultValue: container.enabled })
    .dropdown("容器角色", roleOptions, { defaultValueIndex: currentRoleIndex >= 0 ? currentRoleIndex : 0 })
    .toggle("删除此容器（提交后需确认）", { defaultValue: false });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 3) return;

  const newEnabled = values[0] as boolean;
  const newRoleIndex = values[1] as number;
  const shouldDelete = values[2] as boolean;

  if (shouldDelete) {
    // ── 删除确认 ──
    const confirm = new ActionFormData()
      .title("确认删除")
      .body(`确定要删除容器 ${containerId} 吗？此操作不可撤销。`)
      .button("§c确认删除")
      .button("取消");
    const confirmResponse = await confirm.show(player);
    if (confirmResponse.canceled || confirmResponse.selection !== 0) return;

    // 执行删除：禁用容器
    service.setContainerRoleAndState(warehouse.id, containerId, null, false);
    player.sendMessage("§c容器已禁用");
    return;
  }

  // ── 提交角色和状态变更 ──
  try {
    const newRole = ROLE_ORDER[newRoleIndex];
    service.setContainerRoleAndState(warehouse.id, containerId, newRole, newEnabled);
    player.sendMessage(`§a容器已更新：${newEnabled ? "启用" : "禁用"}，角色=${ROLE_LABELS[newRole]}`);
  } catch (error) {
    player.sendMessage(`§c操作失败: ${error}`);
  }
}
