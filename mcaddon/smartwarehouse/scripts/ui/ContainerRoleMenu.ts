import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { ContainerRole, ContainerId, StoredContainer, WarehouseData } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import type { WarehouseService } from "../warehouse/WarehouseService";

/**
 * 所有可选的容器角色列表。
 * 用于在操作表单中按顺序展示角色选项按钮。
 * 玩家选择一个角色后，对应索引直接映射到此数组。
 */
const ROLE_OPTIONS: ContainerRole[] = ["disabled", "normal", "misc", "bulk", "input"];

/**
 * 容器角色中文标签映射表。
 * 将内部枚举值映射为面向玩家的中文显示文本。
 */
const ROLE_LABELS: Record<ContainerRole, string> = {
  disabled: "禁用",
  normal:   "普通",
  misc:     "杂项",
  bulk:     "批量",
  input:    "输入",
};

/**
 * 显示容器角色设置菜单。
 * 根据玩家权限提供不同界面：
 * - 无管理权限的玩家：只读查看容器信息（仓库名、当前角色、容器ID），无法修改。
 * - 有管理权限的玩家：显示角色选择按钮列表，点击即可修改容器角色。
 *
 * @param player      - 请求查看/修改容器角色的玩家
 * @param warehouse   - 容器所属的仓库数据
 * @param containerId - 容器的唯一标识符（字符串形式的坐标键）
 * @param container   - 容器存储数据（包含当前角色、占位坐标等信息）
 * @param service     - 仓库服务实例，用于执行角色修改
 */
export async function showContainerRoleMenu(
  player: Player,
  warehouse: WarehouseData,
  containerId: ContainerId,
  container: StoredContainer,
  service: WarehouseService
): Promise<void> {
  // 检查当前玩家是否拥有仓库管理权限
  const isManager = canManageWarehouse(player);

  if (!isManager) {
    // ── 非管理员玩家：仅展示容器信息，不允许修改角色 ──
    const form = new ActionFormData()
      .title("容器信息")
      .body(
        `仓库: ${warehouse.displayName}\n` +
          `当前角色: ${ROLE_LABELS[container.role]}\n` +
          `容器ID: ${containerId}\n\n` +
          "你没有管理权限，无法修改容器角色。"
      )
      .button("关闭"); // 仅有的关闭按钮，无修改功能
    await form.show(player);
    return;
  }

  // ── 管理员玩家：展示角色选择界面 ──────────────────
  // 显示仓库名称、容器 ID 以及当前角色作为参考信息
  const form = new ActionFormData()
    .title("设置容器角色")
    .body(`仓库: ${warehouse.displayName}\n` + `容器ID: ${containerId}\n` + `当前角色: ${ROLE_LABELS[container.role]}`);

  // 为每个可选角色添加一个按钮
  for (const role of ROLE_OPTIONS) {
    form.button(ROLE_LABELS[role]);
  }

  // 展示表单并等待玩家选择
  const response = await form.show(player);
  // 如果玩家取消或未选择任何角色，直接返回
  if (response.canceled || response.selection === undefined) return;

  // 根据玩家选择的按钮索引获取对应的角色值
  const selectedRole = ROLE_OPTIONS[response.selection];
  if (!selectedRole) return;

  try {
    // 调用仓库服务更新容器角色
    service.setContainerRole(warehouse.id, containerId, selectedRole);
    player.sendMessage(`§a已将容器角色设置为 ${ROLE_LABELS[selectedRole]}`);
  } catch (error) {
    // 角色设置失败时向玩家显示错误信息
    player.sendMessage(`§c设置角色失败: ${error}`);
  }
}
