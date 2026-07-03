import { world, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { ContainerId, ContainerRole, WarehouseId } from "../types";
import type { StoredContainer, WarehouseData } from "../types";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import { SlotOrganizer } from "../sorting/SlotOrganizer";
import { formatOrganizeResult } from "../util/OrganizeFormatter";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { getFamilyPurity, getContainerFromStored } from "../sorting/ContainerInventory";
import { getFamilyById } from "../data/ItemFamilies";
import { getChineseName } from "../data/ItemNameMap";

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
 * 构建该容器中已启用的家族纯度排行文本。
 *
 * 只显示纯度 > 0（容器中有该家族物品）的家族，按纯度降序排列。
 * 返回空字符串表示无匹配。
 */
function formatFamilyPurityInfo(warehouse: WarehouseData, container: StoredContainer): string {
  try {
    const enabledFamilies = warehouse.settings.enabledFamilies ?? [];
    if (enabledFamilies.length === 0) return "";

    const dimension = world.getDimension(warehouse.dimensionId);
    const mcContainer = getContainerFromStored(dimension, container);
    if (!mcContainer) return "";

    // 一次性扫描容器，收集所有物品种类（避免对每个家族独立全槽扫描）
    const allTypes = new Set<string>();
    for (let slot = 0; slot < mcContainer.size; slot++) {
      const item = mcContainer.getItem(slot);
      if (item) allTypes.add(item.typeId);
    }
    if (allTypes.size === 0) return "";

    const entries: { name: string; purity: number }[] = [];
    for (const familyId of enabledFamilies) {
      const family = getFamilyById(familyId);
      if (!family) continue;
      const memberSet = new Set(family.items);
      let matchCount = 0;
      for (const typeId of allTypes) {
        if (memberSet.has(typeId)) matchCount++;
      }
      if (matchCount > 0) {
        entries.push({ name: family.displayName, purity: matchCount / allTypes.size });
      }
    }
    if (entries.length === 0) return "";

    entries.sort((a, b) => b.purity - a.purity);

    // 取前三名，防止排行太长挤占表单空间
    const top = entries.slice(0, 3);
    const parts = top.map((e, i) => `§e#${i + 1}§f${e.name} §a${(e.purity * 100).toFixed(0)}%`);
    const suffix = entries.length > 3 ? ` §8+${entries.length - 3}` : "";
    return `\n§8┊ §7家族分布 ${parts.join(" §8│ ")}${suffix}§r`;
  } catch {
    return "";
  }
}

// ─── 大宗物品类型配置 ──────────────────────────────────────────

/**
 * 显示大宗物品类型配置菜单（ActionForm）。
 *
 * 在容器角色设为 "bulk" 后，引导玩家配置大宗箱的目标物品类型。
 * 空大宗箱在未配置目标类型时不接受任何物品。
 */
async function showBulkTypeConfig(
  player: Player,
  warehouseId: WarehouseId,
  containerId: ContainerId,
  service: WarehouseService
): Promise<void> {
  // 重新加载最新容器数据
  const warehouse = service.requireWarehouse(warehouseId);
  const container = warehouse.containers[containerId];
  if (!container) return;

  const currentTypeId = container.bulkTypeId;
  const currentName = currentTypeId ? getChineseName(currentTypeId) : undefined;

  const form = new ActionFormData()
    .title("大宗物品设置")
    .body(
      `§7大宗箱需要配置目标物品类型才能工作。\n\n` +
      `§7当前配置: ${currentTypeId ? `§a${currentName}§7 (§f${currentTypeId}§7)` : "§c未配置"}\n\n` +
      `§7配置后，大宗箱只会接收指定类型的物品。`
    )
    .button("§a设置物品类型")
    .button("关闭");

  if (currentTypeId) {
    form.button("§c清除配置");
  }

  const response = await form.show(player);
  if (response.canceled) return;

  const selection = response.selection;
  if (selection === 0) {
    // 设置物品类型
    await showBulkTypeInput(player, warehouseId, containerId, service, currentTypeId);
  } else if (currentTypeId && selection === 2) {
    // 清除配置
    try {
      service.setContainerBulkType(warehouseId, containerId, null);
      player.sendMessage("§a大宗物品类型已清除");
    } catch (error) {
      player.sendMessage(`§c清除失败: ${error}`);
    }
  }
}

/**
 * 大宗物品类型文本输入 ModalForm。
 */
async function showBulkTypeInput(
  player: Player,
  warehouseId: WarehouseId,
  containerId: ContainerId,
  service: WarehouseService,
  currentTypeId?: string
): Promise<void> {
  const form = new ModalFormData()
    .title("配置大宗物品类型")
    .label(
      `§7请输入物品类型 ID（如 §fminecraft:white_wool§7）。\n` +
      `§7配置后大宗箱只接收该类型的物品。`
    )
    .textField("物品 ID", "例: minecraft:white_wool", { defaultValue: currentTypeId ?? "" });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 1) return;

  // 兼容 label 占索引
  const offset = values.length >= 2 ? 1 : 0;
  const typeId = (values[0 + offset] as string ?? "").trim();

  if (!typeId) {
    player.sendMessage("§c物品 ID 不能为空");
    return;
  }

  try {
    service.setContainerBulkType(warehouseId, containerId, typeId);
    const name = getChineseName(typeId);
    player.sendMessage(`§a大宗物品类型已设置为 ${name}§a (§f${typeId}§a)`);
  } catch (error) {
    player.sendMessage(`§c设置失败: ${error}`);
  }
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

    const familyLine = formatFamilyPurityInfo(warehouse, container);
    const isHopper = details?.blockType === "hopper";

    const form = new ActionFormData()
      .title("容器信息")
      .body(
        `§7仓库: ${warehouse.displayName}\n` +
        `${detailsLine}\n` +
        `§7容器ID: ${containerId}\n` +
        `§7状态: ${container.enabled ? "§a启用" : "§c禁用"}\n` +
        `§7角色: ${roleLabel}${isHopper ? " §8(漏斗·自) " : ""}\n` +
        `§7描述: ${isHopper ? "漏斗自动采集物品流入分拣系统" : roleDesc}` +
        familyLine
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

  const familyLine = formatFamilyPurityInfo(warehouse, container);

  // 检测是否为漏斗（漏斗自动锁定为 input 角色）
  const isHopper = details?.blockType === "hopper";

  const form = new ModalFormData()
    .title("容器设置")
    .label(
      `§7仓库: ${warehouse.displayName}\n` +
      `${detailsLine}\n` +
      `§7容器ID: ${containerId}\n` +
      `§7状态: ${container.enabled ? "§a已启用" : "§c已禁用"}\n` +
      `§7角色: §f${currentRoleLabel} — ${roleDesc}§r` +
      familyLine
    )
    .toggle("启用容器", { defaultValue: container.enabled });

  if (isHopper) {
    // 漏斗锁定为 input 角色，不显示角色下拉
    form.label("§8§o此容器是漏斗，只能作为输入容器使用。");
  } else {
    form.dropdown("容器角色", roleOptions, { defaultValueIndex: currentRoleIndex >= 0 ? currentRoleIndex : 0 });
  }

  form.toggle("§e立即整理（按物品 ID 排序合并）", { defaultValue: false });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 2) return;

  // ── 解析表单值 ──
  // 非漏斗: [toggle(启用), dropdown(角色), toggle(整理)] = 3 个值
  // 漏斗:   [toggle(启用),                toggle(整理)] = 2 个值（角色固定为 input）
  // label 不占用 formValues 索引
  const newEnabled = values[0] as boolean;
  const newRole: ContainerRole = isHopper ? "input" : ROLE_ORDER[values[1] as number];
  const shouldOrganize = values[isHopper ? 1 : 2] as boolean;

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
    service.setContainerRoleAndState(warehouse.id, containerId, newRole, newEnabled);
    player.sendMessage(`§a容器已更新：${newEnabled ? "启用" : "禁用"}，角色=${ROLE_LABELS[newRole]}`);

    // 如果角色改为大宗，引导玩家配置目标物品类型
    if (newRole === "bulk") {
      await showBulkTypeConfig(player, warehouse.id, containerId, service);
    }
  } catch (error) {
    player.sendMessage(`§c操作失败: ${error}`);
  }
}
