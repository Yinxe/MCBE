import { world, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { ContainerId, StoredContainer, WarehouseData } from "../types";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import { SlotOrganizer } from "../sorting/SlotOrganizer";
import { formatOrganizeResult } from "../util/OrganizeFormatter";
import type { WarehouseService } from "../warehouse/WarehouseService";

// ─── 容器详情辅助 ─────────────────────────────────────────────

interface ContainerDetails {
  blockType: string;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  messiness?: { total: number; order: number; stack: number; };
}

/**
 * 从 StoredContainer 读取容器的实际运行时详情（含混乱度评分）。
 */
function getContainerDetails(warehouse: WarehouseData, container: StoredContainer): ContainerDetails | undefined {
  try {
    const dimension = world.getDimension(warehouse.dimensionId);
    const block = dimension.getBlock(container.primaryLocation);
    if (!block) return undefined;
    const inv =
      (block.getComponent("inventory") as import("@minecraft/server").BlockInventoryComponent | undefined) ??
      (block.getComponent("minecraft:inventory") as import("@minecraft/server").BlockInventoryComponent | undefined);
    const mcContainer = inv?.container;
    if (!mcContainer) return undefined;

    const blockType = block.typeId.replace("minecraft:", "");
    const totalSlots = mcContainer.size;
    let usedSlots = 0;
    let totalItems = 0;
    const uniqueTypesSet = new Set<string>();

    for (let slot = 0; slot < totalSlots; slot++) {
      try {
        const stack = mcContainer.getItem(slot);
        if (stack) {
          usedSlots++;
          totalItems += stack.amount;
          uniqueTypesSet.add(stack.typeId);
        }
      } catch { /* 跳过 */ }
    }

    // 计算混乱度
    const org = new SlotOrganizer();
    const messiness = org.calculateMessiness(mcContainer);

    return { blockType, totalSlots, usedSlots, totalItems, uniqueTypes: uniqueTypesSet.size, messiness };
  } catch {
    return undefined;
  }
}

/**
 * 格式化容器详情文本行（含混乱度）。
 */
function formatDetailsLine(details: ContainerDetails | undefined): string {
  if (!details) return "§8容器不可达";
  const usage = `${details.usedSlots}/${details.totalSlots}`;
  let line = `§7${details.blockType}  §f${usage} §7Slots  §f${details.totalItems} §7Items  §f${details.uniqueTypes} §7Types`;
  if (details.messiness) {
    const m = details.messiness;
    line += `\n§7混乱度 §f${(m.total * 100).toFixed(0)}% §7(顺序§e${(m.order * 100).toFixed(0)}§7 堆叠§e${(m.stack * 100).toFixed(0)}§7)`;
  }
  return line;
}

/**
 * 显示容器设置菜单。
 *
 * 根据玩家权限提供不同界面：
 * - 非管理员：只读查看容器信息，仅有关闭按钮。
 * - 管理员：使用 ModalForm 统一设置容器的启用状态和角色。
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
  const details = getContainerDetails(warehouse, container);
  const detailsLine = formatDetailsLine(details);

  if (!isManager) {
    // ── 非管理员玩家：只读查看容器信息 ──
    const roleLabel = ROLE_LABELS[container.role];
    const roleDesc = ROLE_DESCRIPTIONS[container.role];

    const form = new ActionFormData()
      .title("容器信息")
      .body(
        `§7仓库: ${warehouse.displayName}\n` +
        `${detailsLine}\n` +
        `§7容器ID: ${containerId}\n` +
        `§7状态: ${container.enabled ? "§a启用" : "§c禁用"}\n` +
        `§7角色: ${roleLabel}\n` +
        `§7描述: ${roleDesc}`
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
      `${detailsLine}\n` +
      `§7容器ID: ${containerId}\n` +
      `§7状态: ${container.enabled ? "§a已启用" : "§c已禁用"}\n` +
      `§7角色: §f${currentRoleLabel} — ${roleDesc}§r`
    )
    .toggle("启用容器", { defaultValue: container.enabled })
    .dropdown("容器角色", roleOptions, { defaultValueIndex: currentRoleIndex >= 0 ? currentRoleIndex : 0 })
    .toggle("§e立即整理（按物品 ID 排序合并）", { defaultValue: false });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 3) return;

  // 兼容 label 占索引 (3字段+label=4, 3字段无label=3)
  const offset = values.length >= 4 ? 1 : 0;
  const newEnabled = values[0 + offset] as boolean;
  const newRoleIndex = values[1 + offset] as number;
  const shouldOrganize = values[2 + offset] as boolean;

  // ── 整理容器 ──
  if (shouldOrganize) {
    try {
      const dim = world.getDimension(warehouse.dimensionId);
      const block = dim.getBlock(container.primaryLocation);
      if (block) {
        const inv = (block.getComponent("inventory") ?? block.getComponent("minecraft:inventory")) as
          import("@minecraft/server").BlockInventoryComponent | undefined;
        const mcContainer = inv?.container;
        if (mcContainer) {
          const organizer = new SlotOrganizer();
          const result = organizer.organize(mcContainer);
          const name = block.typeId.replace("minecraft:", "");
          for (const line of formatOrganizeResult(result, name)) {
            player.sendMessage(line);
          }
        }
      }
    } catch (error) {
      player.sendMessage(`§c整理出错: ${error}`);
    }
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
