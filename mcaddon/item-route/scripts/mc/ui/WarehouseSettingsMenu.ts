// ─── 仓库配置：单一复杂模态（信息展示 + 属性修改 + 操作开关于互斥，对齐 v1） ──
// 对齐 v1 WarehouseSettingsMenu 设计：一个 ModalForm 内
//   · 顶部 label 展示仓库实时统计（容器/槽位/物品/种类/分角色数）
//   · 中部属性字段：名称、默认容器角色/启用、处理速度、仓库运转、自动整理、整理阈值滑块
//   · 底部"操作"分区：`rescan/containerRoles/memberManage/stats/resize/delete` 若干**互斥**
//     动作开关（同时只允许一个，防误触）。提交后先落设置，再执行所选单个动作。
// 权限：成员可见 [刷新容器]；owner 额外 [成员/统计/调整/删除]（经 auth.requireRole 分级）。
import { world, type Player } from "@minecraft/server";
import { ModalFormBuilder, ActionFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import { ROLE_LABELS, type ContainerRole } from "../../core/model/Container";
import { unregisterContainer } from "../../core/model/ContainerRegistry";
import type { Warehouse } from "../../core/model/Warehouse";
import { scanWarehouseArea } from "../commands/scan";
import { showContainerRoleMenu } from "./ContainerRoleMenu";
import { showMemberMenu } from "./MemberMenu";
import { showStatsUI } from "./StatsUI";
import * as uiColor from "./uiColor";

/** 处理速度可选项（tick 间隔）；默认 index 2 = 8 tick */
const SPEED_OPTIONS = [4, 8, 16, 20, 30, 40];
/** 默认容器角色可选集（输入由漏斗/放置决定，不作为整仓默认；与建仓表单一致） */
const DEFAULT_ROLE_OPTIONS: ContainerRole[] = ["single", "multi", "misc"];

/** 仓库概览统计文本（容器/每角色/槽位/物品），供 info label 展示（ModalForm 深底 → 浅色） */
function formatWarehouseSummary(deps: CommandDeps, warehouse: Warehouse): string {
  const s = deps.stats.getWarehouseStats(warehouse);
  const byRole = Object.entries(s.byRole)
    .map(
      ([role, r]) =>
        `${uiColor.form.accent}${ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}§f${r.containerCount}`
    )
    .join("  ");
  return (
    `${uiColor.form.muted}容器 ${uiColor.form.body}${s.containerCount}` +
    `  ${uiColor.form.muted}槽位 ${uiColor.form.body}${s.usedSlots}/${s.totalSlots}` +
    `  ${uiColor.form.muted}物品 ${uiColor.form.body}${s.totalItems}` +
    `  ${uiColor.form.muted}种类 ${uiColor.form.body}${s.uniqueTypes}` +
    (byRole ? `\n${byRole}` : "")
  );
}

/**
 * 展示仓库配置单一模态（owner 级完整表单）。先 ensureContainersLoaded（统计/列表需要）。
 * 提交后先落属性设置，再执行唯一选择的动作（互斥）。
 */
export async function showWarehouseSettingsMenu(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse
): Promise<void> {
  deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载
  const isOwner = requireRole(deps.members, warehouse, player.name, "owner");

  const settings = warehouse.settings;
  const speedIndex = Math.max(0, SPEED_OPTIONS.indexOf(settings.processingSpeed));
  const roleIndex = DEFAULT_ROLE_OPTIONS.indexOf(settings.defaultContainerRole);

  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}仓库配置 · ${warehouse.displayName}`)
    .label("info", formatWarehouseSummary(deps, warehouse))
    .textField("name", "仓库名称", { defaultValue: warehouse.displayName, tooltip: "修改仓库的显示名称" })
    .dropdown(
      "defaultRole",
      "默认新容器角色",
      DEFAULT_ROLE_OPTIONS.map((r) => ROLE_LABELS[r]),
      {
        defaultValueIndex: Math.max(0, roleIndex),
        tooltip: "后续新增容器的默认角色（漏斗始终为 input）",
      }
    )
    .dropdown("defaultEnabled", "新容器默认启用", ["是", "否"], {
      defaultValueIndex: settings.defaultContainerEnabled ? 0 : 1,
    })
    .dropdown(
      "speed",
      "处理速度（tick 间隔）",
      SPEED_OPTIONS.map((s) => `${s} tick`),
      { defaultValueIndex: speedIndex >= 0 ? speedIndex : 2, tooltip: "分拣间隔，越小越快" }
    )
    .toggle("routingEnabled", `${uiColor.form.accent}仓库运转`, {
      defaultValue: settings.routingEnabled,
      tooltip: "关闭后该仓暂停分拣",
    })
    .toggle("sortingEnabled", "自动整理", {
      defaultValue: settings.sortingEnabled,
      tooltip: "路由成功且混乱度过高时自动整理",
    })
    .toggle("showBoundary", `${uiColor.form.accent}显示边界光幕`, {
      defaultValue: settings.showBoundary,
      tooltip: "在仓库区域边缘持续显示粒子边界（附近玩家手持信物时可见；v1 同款）",
    })
    .slider("autoSortThreshold", `${uiColor.form.muted}自动整理阈值（0-100，推荐 40）`, 0, 100, {
      defaultValue: Math.round(settings.autoSortThreshold * 100),
      valueStep: 20,
    })
    .label("opSep", "§8━━━ 操作（同时仅可一个）━━━")
    .toggle("rescan", `${uiColor.form.success}刷新容器（重新扫描区域容器列表）`)
    .toggle("repair", `${uiColor.form.accent}修复仓库（检查并修复数据完整性）`)
    .toggle("containerRoles", `${uiColor.form.accent}容器角色（查看/编辑各容器）`);

  if (isOwner) {
    form
      .toggle("memberManage", `${uiColor.form.accent}成员管理（提交后打开）`)
      .toggle("stats", `${uiColor.form.accent}统计`)
      .toggle("resize", `${uiColor.form.accent}调整仓库区域（提交后需选新区域）`)
      .toggle("delete", `${uiColor.form.error}删除此仓库（不可撤销）`);
  }

  const vals = await form.show(player);
  if (!vals) return;

  // 操作互斥：一次只允许选一个动作开关
  const ops = ["rescan", "repair", "containerRoles", "memberManage", "stats", "resize", "delete"].filter(
    (k) => vals[k] === true
  );
  if (ops.length > 1) {
    player.sendMessage(`${uiColor.chat.error}操作项只能同时开启一个，请重新选择`);
    return;
  }

  // 保存属性变更（名称/默认角色/默认启用/速度/运转/整理/阈值/边界光幕）
  const newName = (vals.name as string).trim();
  if (newName && newName !== warehouse.displayName) deps.warehouses.rename(warehouse, newName);
  const newSpeed = SPEED_OPTIONS[vals.speed as number] ?? settings.processingSpeed;
  const newShowBoundary = vals.showBoundary === true;
  deps.warehouses.updateSettings(warehouse, {
    defaultContainerRole: DEFAULT_ROLE_OPTIONS[vals.defaultRole as number] ?? settings.defaultContainerRole,
    defaultContainerEnabled: vals.defaultEnabled === 0,
    processingSpeed: newSpeed,
    routingEnabled: vals.routingEnabled === true,
    sortingEnabled: vals.sortingEnabled === true,
    autoSortThreshold: (vals.autoSortThreshold as number) / 100,
    showBoundary: newShowBoundary,
  });
  deps.route.setProcessingSpeed(warehouse.id, newSpeed); // 已激活仓库立即重建 interval
  deps.boundary.setEnabled(warehouse, newShowBoundary); // 持久边界光幕随开关启停
  player.sendMessage(`${uiColor.chat.success}仓库配置已保存`);

  // 执行唯一选择的动作
  const chosen = ops[0];
  if (chosen === "rescan") {
    rescanWarehouse(player, deps, warehouse);
    return;
  }
  if (chosen === "repair") {
    await confirmRepair(player, deps, warehouse);
    return;
  }
  if (chosen === "containerRoles") {
    await showContainerRoleMenu(player, deps, warehouse);
    return;
  }
  if (chosen === "memberManage" && isOwner) {
    await showMemberMenu(player, deps, warehouse);
    return;
  }
  if (chosen === "stats" && isOwner) {
    await showStatsUI(player, deps, warehouse);
    return;
  }
  if (chosen === "resize" && isOwner) {
    deps.session.set(player.name, { kind: "resizeWarehouse", warehouseId: warehouse.id });
    player.sendMessage(`${uiColor.chat.info}请在两个对角位置使用信物点击方块来选择新的仓库区域`);
    return;
  }
  if (chosen === "delete" && isOwner) {
    await confirmDelete(player, deps, warehouse);
  }
}

/**
 * 刷新容器（member+）：先剔除几何为空的登记项（方块被拆），再重扫区域补注册新容器。
 * 最小单位：扫描只在回调里持久化新增容器 + 一次索引同步。（表单提交后已在正常上下文。）
 */
/** 重扫区域核心（rescan/修复共用）：剔除空几何登记项 + 重扫补注册新容器（最小单位持久化） */
function rescanArea(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  // 1) 剔除空几何登记项（方块被拆）
  const removed: string[] = [];
  for (const c of [...warehouse.containers.values()]) {
    if (c.occupiedLocations.length === 0) {
      unregisterContainer(warehouse, c.id);
      deps.resolveIndex(warehouse.id)?.onContainerRemoved(c);
      deps.stats.discard(c.id);
      removed.push(c.id);
    }
  }
  for (const cid of removed) deps.removeContainer(warehouse, cid);

  // 2) 重扫区域补注册新容器（最小单位持久化）
  const dim = world.getDimension(warehouse.area.dimension);
  if (dim !== undefined) {
    scanWarehouseArea(
      dim,
      warehouse.area,
      deps.factory,
      deps.resolveIndex(warehouse.id),
      warehouse,
      deps.config.maxContainers,
      (wh, added) => {
        for (const c of added) deps.persistContainer(wh, c);
        deps.persistContainerIds(wh);
      }
    );
  }
}

/** 刷新容器（member+）：重扫区域 + 剔除空几何登记项 */
function rescanWarehouse(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  rescanArea(player, deps, warehouse);
  player.sendMessage(`${uiColor.chat.success}容器刷新完成（当前 ${warehouse.containers.size} 个）`);
}

/**
 * 修复仓库（member+，v1 同款）：二次确认 → 重建索引（reconcile 惰性自愈）→ 重置统计缓存
 * → 重扫区域。比"刷新容器"多"索引重建 + 统计重置"，用于数据疑似不一致后的完整修复。
 */
async function confirmRepair(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  await new ActionFormBuilder()
    .title(`${uiColor.form.title}修复仓库`)
    .body(
      `${uiColor.form.body}确定要修复仓库 "${warehouse.displayName}" 吗？\n\n` +
        `${uiColor.form.body}将执行以下修复步骤：\n` +
        `${uiColor.form.body}1. 重新扫描所有容器方块\n` +
        `${uiColor.form.body}2. 重建运行时索引\n` +
        `${uiColor.form.body}3. 重置存储统计缓存\n` +
        `${uiColor.form.body}4. 检查数据完整性`
    )
    .button(`${uiColor.btn.accent}确认修复`, () => {
      // 1) 重建运行时索引：逐容器 reconcile（惰性校验/修复候选条目，索引未激活时激活重建兜底）
      const index = deps.resolveIndex(warehouse.id);
      if (index !== undefined) {
        for (const c of warehouse.containers.values()) index.reconcile(c);
      }
      // 2) 重置统计缓存（该仓全部容器，冷读重算）
      for (const cid of warehouse.containers.keys()) deps.stats.invalidate(cid);
      // 3) 重扫区域（剔除空几何 + 补注册）
      rescanArea(player, deps, warehouse);
      player.sendMessage(`${uiColor.chat.success}仓库修复完成！共发现 ${warehouse.containers.size} 个容器，统计已重置`);
    })
    .button(`${uiColor.btn.info}取消`, () => undefined)
    .show(player);
}

/** 删除确认：二次确认 → deleteWarehouse（副作用由 warehouseDeleted 事件订阅者清理） */
async function confirmDelete(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  await new ActionFormBuilder()
    .title(`${uiColor.form.error}确认删除`)
    .body(`${uiColor.form.body}确定删除仓库 ${warehouse.displayName} 吗？此操作不可恢复。`)
    .button(`${uiColor.btn.danger}确认删除`, () => {
      deps.warehouses.deleteWarehouse(warehouse.id);
      player.sendMessage(`${uiColor.chat.success}仓库 ${warehouse.displayName} 已删除`);
    })
    .button(`${uiColor.btn.info}取消`, () => undefined)
    .show(player);
}
