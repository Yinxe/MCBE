import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { ContainerId, StoredContainer, WarehouseData } from "../types";
import { ROLE_LABELS, ROLE_ORDER, ROLE_DESCRIPTIONS } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import type { WarehouseService } from "../warehouse/WarehouseService";

/**
 * 显示容器设置菜单。
 *
 * 根据玩家权限提供不同界面：
 * - 非管理员：只读查看容器信息（仓库名、容器 ID、启用状态、角色），仅有关闭按钮。
 * - 管理员：可切换容器启用/禁用状态，并可选择新的容器角色。
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
    const statusText = container.enabled ? "启用" : "禁用";
    const roleLabel = ROLE_LABELS[container.role];
    const roleDesc = ROLE_DESCRIPTIONS[container.role];

    const form = new ActionFormData()
      .title("容器设置")
      .body(
        `仓库: ${warehouse.displayName}\n` +
          `容器ID: ${containerId}\n\n` +
          `状态: ${statusText}\n` +
          `角色: ${roleLabel} — ${roleDesc}`
      )
      .button("关闭");
    await form.show(player);
    return;
  }

  // ── 管理员玩家：显示切换开关和角色选择 ──
  const statusLine = container.enabled
    ? `当前状态: 启用 · 角色: ${ROLE_LABELS[container.role]}`
    : "当前状态: 禁用";

  const form = new ActionFormData()
    .title("容器设置")
    .body(
      `仓库: ${warehouse.displayName}\n` +
        `容器ID: ${containerId}\n\n` +
        statusLine
    );

  // 按钮 0：切换启用/禁用
  if (container.enabled) {
    form.button("§c禁用此容器");
  } else {
    form.button("§a启用此容器");
  }

  // 按钮 1~4：对应 ROLE_ORDER[0] ~ ROLE_ORDER[3]
  for (const role of ROLE_ORDER) {
    form.button(`${ROLE_LABELS[role]} — ${ROLE_DESCRIPTIONS[role]}`);
  }

  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;

  try {
    if (response.selection === 0) {
      // 切换启用/禁用
      service.setContainerRoleAndState(warehouse.id, containerId, null, !container.enabled);
      const newStatus = container.enabled ? "禁用" : "启用";
      player.sendMessage(`§a已${newStatus}此容器`);
    } else {
      // 角色选择：selection 为 1~4，对应 ROLE_ORDER 索引 0~3
      const roleIndex = response.selection - 1;
      const selectedRole = ROLE_ORDER[roleIndex];
      if (!selectedRole) return;
      service.setContainerRoleAndState(warehouse.id, containerId, selectedRole, null);
      player.sendMessage(`§a已将容器角色设置为 ${ROLE_LABELS[selectedRole]}`);
    }
  } catch (error) {
    player.sendMessage(`§c操作失败: ${error}`);
  }
}
