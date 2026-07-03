import { world, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { ContainerId, ContainerRole, StoredContainer, WarehouseData } from "../types";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import { SlotOrganizer } from "../sorting/SlotOrganizer";
import { formatOrganizeResult } from "../util/OrganizeFormatter";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { getFamilyPurity, getContainerFromStored } from "../sorting/ContainerInventory";
import { getFamilyById } from "../data/ItemFamilies";
import { formatContainerCapacityLine } from "./WarehouseStats";

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
    const capacityLine = details
      ? formatContainerCapacityLine(details.usedSlots, details.totalSlots, details.totalItems, details.uniqueTypes)
      : "";

    const form = new ActionFormData()
      .title("容器信息")
      .body(
        `§7仓库: ${warehouse.displayName}\n` +
        `${detailsLine}\n` +
        `${capacityLine}\n` +
        `§7容器ID: ${containerId}\n` +
        `§7状态: ${container.enabled ? "§a启用" : "§c禁用"}` +
        (container.capacityWarningEnabled ? "" : " §8预警关") + "\n" +
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
  const capacityLine = details
    ? formatContainerCapacityLine(details.usedSlots, details.totalSlots, details.totalItems, details.uniqueTypes)
    : "";

  const form = new ModalFormData()
    .title("容器设置")
    .label(
      `§7仓库: ${warehouse.displayName}\n` +
      `${detailsLine}\n` +
      `${capacityLine}\n` +
      `§7容器ID: ${containerId}\n` +
      `§7状态: ${container.enabled ? "§a已启用" : "§c已禁用"}` +
      (container.capacityWarningEnabled ? "" : " §8预警关") + "\n" +
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

  form.toggle("§e容量预警", { defaultValue: container.capacityWarningEnabled })
    .toggle("§e立即整理（按物品 ID 排序合并）", { defaultValue: false });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 2) return;

  // ── 解析表单值 ──
  // Bedrock 不同版本对 ModalForm label 是否占用 formValues 索引行为不一致。
  // label 返回 null 但占用索引位置，通过 values.length 判断：
  //
  // 非漏斗布局: [label(信息), toggle(启用), dropdown(角色), toggle(容量预警), toggle(整理)]
  //   label 不占位: length=4 → [启用, 角色, 容量预警, 整理]
  //   label 占位:   length=5 → [null, 启用, 角色, 容量预警, 整理]
  //
  // 漏斗布局: [label(信息), toggle(启用), label(提示), toggle(容量预警), toggle(整理)]
  //   label 不占位: length=3 → [启用, 容量预警, 整理]
  //   2 label 占位: length=5 → [null, 启用, null, 容量预警, 整理]
  let newEnabled: boolean;
  let newRole: ContainerRole;
  let newCapacityWarning: boolean;
  let shouldOrganize: boolean;

  if (isHopper) {
    newEnabled = values.length >= 5 ? (values[1] as boolean) : (values[0] as boolean);
    newRole = "input";
    newCapacityWarning = values.length >= 5 ? (values[3] as boolean) : (values[1] as boolean);
    shouldOrganize = values.length >= 5 ? (values[4] as boolean) : (values[2] as boolean);
  } else {
    newEnabled = values.length >= 5 ? (values[1] as boolean) : (values[0] as boolean);
    newRole = ROLE_ORDER[values.length >= 5 ? (values[2] as number) : (values[1] as number)];
    newCapacityWarning = values.length >= 5 ? (values[3] as boolean) : (values[2] as boolean);
    shouldOrganize = values.length >= 5 ? (values[4] as boolean) : (values[3] as boolean);
  }

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
    service.setContainerRoleAndState(warehouse.id, containerId, newRole, newEnabled, newCapacityWarning);
    player.sendMessage(
      `§a容器已更新：${newEnabled ? "启用" : "禁用"}，` +
      `角色=${ROLE_LABELS[newRole]}，` +
      `容量预警=${newCapacityWarning ? "开" : "关"}`
    );

    // 如果角色改为大宗，引导玩家手动放入物品来设定类型
    if (newRole === "bulk") {
      player.sendMessage("§e将需要大宗存储的物品放入此容器，分拣系统会自动识别并路由同类物品至此。");
    }
  } catch (error) {
    player.sendMessage(`§c操作失败: ${error}`);
  }
}
