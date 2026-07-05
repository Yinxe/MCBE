import { world, type Player } from "@minecraft/server";
import type { ContainerId, ContainerRole, StoredContainer, WarehouseData } from "../types";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import { SlotOrganizer } from "../organize/SlotOrganizer";
import { formatOrganizeResult } from "../organize/OrganizeFormatter";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { getFamilyPurity, getContainerFromStored } from "../sorting/ContainerInventory";
import { getFamilyById } from "../data/ItemFamilies";
import { formatContainerCapacityLine, setContainerStats, CAPACITY_WARNING_THRESHOLD } from "./WarehouseStats";
import type { ContainerStats } from "../types";
import { scanContainerSlots } from "../util/ContainerScan";
import { ModalFormBuilder, ActionFormBuilder } from "./FormHelper";

// ─── 容器详情辅助 ─────────────────────────────────────────────

interface ContainerDetails {
  blockType: string;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  messiness?: { total: number; order: number; stack: number };
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

    // 一次扫描，同时用于统计和混乱度分析
    const scan = scanContainerSlots(mcContainer);
    const org = new SlotOrganizer();
    const messiness = org.calculateMessinessFromScan(scan);

    return {
      blockType,
      totalSlots: scan.totalSlots,
      usedSlots: scan.usedSlots,
      totalItems: scan.totalItems,
      uniqueTypes: scan.uniqueTypes,
      messiness,
    };
  } catch {
    return undefined;
  }
}

/**
 * 格式化容器详情文本行（含混乱度）。
 */
/**
 * 格式化容器概要信息。
 * 返回多行文本：类型行 + 容量行 + 混乱度行。
 */
function formatContainerSummary(details: ContainerDetails | undefined): string {
  if (!details) return "§8类型: §7容器不可达";
  const lines: string[] = [];

  // 类型
  lines.push(`§7类型: §f${details.blockType}`);

  // 容量（由 formatContainerCapacityLine 生成）
  // 该函数调用在外部

  // 混乱度
  if (details.messiness) {
    const m = details.messiness;
    lines.push(
      `§7混乱度: §f${(m.total * 100).toFixed(0)}%§7[sort:§e${(m.order * 100).toFixed(0)}%§7 , stack:§e${(m.stack * 100).toFixed(0)}%§7]`
    );
  }

  return lines.join("\n");
}

/**
 * 构建该容器中已启用的家族纯度排行文本。
 *
 * 多行格式，每行一个家族：
 *   家族:   #1食物[60%]
 *           #2武器[30%]
 */
function formatFamilyPurityInfo(warehouse: WarehouseData, container: StoredContainer): string {
  try {
    const enabledFamilies = warehouse.settings.enabledFamilies ?? [];
    if (enabledFamilies.length === 0) return "";

    const dimension = world.getDimension(warehouse.dimensionId);
    const mcContainer = getContainerFromStored(dimension, container);
    if (!mcContainer) return "";

    // 一次性扫描容器，收集所有物品种类
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

    // 取所有家族（不限制数量）
    const familyLines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const pct = (e.purity * 100).toFixed(0);
      if (i === 0) {
        familyLines.push(`§7家族: §e#${i + 1}§f${e.name}§7[§a${pct}%§7]`);
      } else {
        familyLines.push(`       §e#${i + 1}§f${e.name}§7[§a${pct}%§7]`);
      }
    }
    return "\n" + familyLines.join("\n");
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

  // 将现场扫描结果写入统计缓存 + DP，使仓库级统计直接复用
  if (details) {
    const stats: ContainerStats = {
      containerId,
      blockType: details.blockType,
      role: container.role,
      totalSlots: details.totalSlots,
      usedSlots: details.usedSlots,
      totalItems: details.totalItems,
      uniqueTypes: details.uniqueTypes,
      isWarning: details.totalSlots > 0 && details.usedSlots / details.totalSlots >= CAPACITY_WARNING_THRESHOLD,
    };
    setContainerStats(warehouse.id, containerId, stats);
  }

  // ── 构建容器信息文本（共用布局） ──
  const roleLabel = ROLE_LABELS[container.role];
  const roleDesc = ROLE_DESCRIPTIONS[container.role];
  const isHopper = details?.blockType === "hopper";
  const capacityLine = details
    ? formatContainerCapacityLine(details.usedSlots, details.totalSlots, details.totalItems, details.uniqueTypes)
    : "";
  const familyLine = formatFamilyPurityInfo(warehouse, container);
  const messinessLine = details?.messiness
    ? `混乱度: §f${(details.messiness.total * 100).toFixed(0)}%§7[sort:§e${(details.messiness.order * 100).toFixed(0)}%§7 , stack:§e${(details.messiness.stack * 100).toFixed(0)}%§7]`
    : "";

  // 共用信息块（仓库/类型/容量/混乱度/容器ID/状态/角色）
  const infoHeader = (statusColor: string, statusText: string) =>
    `§7仓库:   §f${warehouse.displayName}\n` +
    `§7类型:   §f${details?.blockType ?? "未知"}\n` +
    `${capacityLine ? `§7${capacityLine}\n` : ""}` +
    `${messinessLine ? `§7${messinessLine}\n` : ""}` +
    `§7容器ID: §f${containerId}\n` +
    `§7状态:   ${statusColor}${statusText}§r` +
    (container.capacityWarningEnabled ? "" : " §8预警关") +
    "\n" +
    `§7角色:   §f${roleLabel}${isHopper ? " §8(漏斗)" : ""} — ${isHopper ? "漏斗自动采集物品流入分拣系统" : roleDesc}§r` +
    familyLine;

  if (!isManager) {
    // ── 非管理员玩家：只读查看容器信息 ──
    await new ActionFormBuilder()
      .title("容器信息")
      .body(infoHeader(container.enabled ? "§a" : "§c", container.enabled ? "已启用" : "已禁用"))
      .button("关闭") // no callback, just closes
      .show(player);
    return;
  }

  // ── 管理员玩家：ModalForm 统一设置 ──
  const currentRoleIndex = ROLE_ORDER.indexOf(container.role);
  const roleOptions = ROLE_ORDER.map((r) => `${ROLE_LABELS[r]} — ${ROLE_DESCRIPTIONS[r]}`);

  const form = new ModalFormBuilder()
    .title("容器设置")
    .label("info", infoHeader(container.enabled ? "§a" : "§c", container.enabled ? "已启用" : "已禁用"))
    .toggle("enabled", "启用容器", { defaultValue: container.enabled });

  if (isHopper) {
    form.label("hopperHint", "§8§o此容器是漏斗，只能作为输入容器使用。");
  } else {
    form.dropdown("role", "容器角色", roleOptions, { defaultValueIndex: currentRoleIndex >= 0 ? currentRoleIndex : 0 });
  }

  form
    .toggle("capacityWarning", "§e容量预警", { defaultValue: container.capacityWarningEnabled })
    .toggle("organize", "§e立即整理（按物品 ID 排序合并）");

  const vals = await form.show(player);
  if (!vals) return;

  const newEnabled = vals.enabled as boolean;
  const newRole: ContainerRole = isHopper ? "input" : (ROLE_ORDER[vals.role as number] ?? container.role);
  const newCapacityWarning = vals.capacityWarning as boolean;
  const shouldOrganize = vals.organize as boolean;

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
