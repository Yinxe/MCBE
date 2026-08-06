// ─── 容器配置：列表 + 单一复杂模态（信息展示 + 属性修改 + 整理动作，对齐 v1） ──
// 列表：仓库内容器按钮（漏斗标 [输入]），点击进入该容器的配置模态。
// 配置模态（v1 ContainerRoleMenu 设计）：
//   · 顶部 label 实时扫描该容器 → 仓库/类型/容量/混乱度/容器ID/状态/角色
//   · 属性字段：启用 toggle、角色 dropdown（漏斗强制 input，带中文说明）
//   · 动作 toggle：立即整理（就地单容器整理 + 详细报告）
//   · 提交：角色/启用变更 → 刷新 inputs 镜像 + 更新索引 + invalidate 统计 + 触发
//     containerRegistryChanged（持久化由中央订阅处理，单容器最小单位）
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import { ROLE_LABELS, type ContainerRole } from "../../core/model/Container";
import { isHopperType } from "../../core/model/ContainerTypes";
import { scanContainer } from "../../core/model/ContainerScan";
import { refreshInputMembership } from "../../core/model/ContainerRegistry";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import { Organizer } from "../../core/organizing/Organizer";
import { MoveJournal } from "../../core/routing/Move";
import { formatOrganizeResult } from "./OrganizeFormatter";
import * as uiColor from "./uiColor";

/** 容器角色下拉（漏斗强制 input，其余可选；v1 语义带说明） */
const ROLE_OPTIONS: ContainerRole[] = ["input", "single", "multi", "misc"];

/** 容器实时信息文本（单趟扫描 → 容量 + 混乱度，供 info label；ModalForm 深底 → 浅色） */
function formatContainerInfo(deps: CommandDeps, warehouse: Warehouse, container: Container): string {
  const blockType = (container as { blockType?: string }).blockType ?? "未知";
  const scan = scanContainer(container);
  const messiness = new Organizer().messinessFromScan(scan).total;
  const roleLabel = ROLE_LABELS[container.role];
  // 容量行对齐 v1 formatContainerCapacityLine：usage% 按档着色 + ⚠ 告急（≥ warningThreshold）
  const usage = container.capacity > 0 ? Math.round((scan.usedSlots / container.capacity) * 100) : 0;
  const usageColor =
    usage >= 100
      ? uiColor.form.error
      : usage >= 80
        ? uiColor.form.warn
        : usage >= 50
          ? uiColor.form.accent
          : uiColor.form.success;
  const warnMark =
    container.capacity > 0 && usage >= Math.round(warehouse.settings.warningThreshold * 100) ? ` ${usageColor}⚠` : "";
  const capacityLine = `${uiColor.form.muted}容量 ${uiColor.form.body}${scan.usedSlots}${uiColor.form.muted}/${uiColor.form.body}${container.capacity}[${usageColor}${usage}%${uiColor.form.muted}]  ${uiColor.form.body}${scan.totalItems}${uiColor.form.muted} 个物品  ${uiColor.form.body}${Object.keys(scan.byType).length}${uiColor.form.muted} 种类型${warnMark}`;
  return (
    `${uiColor.form.muted}仓库 ${uiColor.form.body}${warehouse.displayName}\n` +
    `${uiColor.form.muted}类型 ${uiColor.form.body}${blockType}${isHopperType(blockType) ? "（漏斗→输入容器）" : ""}\n` +
    `${capacityLine}\n` +
    `${uiColor.form.muted}混乱度 ${uiColor.form.body}${(messiness * 100).toFixed(0)}%\n` +
    `${uiColor.form.muted}容器ID ${uiColor.form.body}${container.id}\n` +
    `${uiColor.form.muted}状态 ${container.enabled ? uiColor.form.success + "已启用" : uiColor.form.error + "已禁用"}\n` +
    `${uiColor.form.muted}角色 ${uiColor.form.accent}${roleLabel}\n` +
    `${uiColor.form.muted}优先级 ${uiColor.form.body}${container.priority}`
  );
}

/**
 * 展示容器列表（member+）：仓库内容器按钮（漏斗标 [输入]）。点击进入配置模态。
 */
export async function showContainerRoleMenu(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载（列表才有容器可编辑）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}容器角色 · ${warehouse.displayName}`)
    .body(`${uiColor.form.body}选择容器（漏斗为强制输入容器）：`);
  for (const container of warehouse.containers.values()) {
    const roleLabel = ROLE_LABELS[container.role] ?? container.role;
    form.button(
      `${uiColor.btn.nav}${container.id} ${uiColor.btn.info}[${roleLabel}]`,
      () => void showContainerConfigMenu(player, deps, warehouse, container)
    );
  }
  await form.show(player);
}

/**
 * 单容器配置模态（member+，信物点击容器 / 容器列表项直通）：信息展示 + 启用/角色修改 + 立即整理动作。
 * 漏斗强制 input（角色不可改）。提交变更 → inputs 镜像 + 索引 + 统计失效 + containerRegistryChanged
 * （持久化由中央订阅处理，单容器最小单位）。
 */
export async function showContainerConfigMenu(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse,
  container: Container
): Promise<void> {
  if (!requireRole(deps.members, warehouse, player.name, "member")) {
    player.sendMessage(`${uiColor.chat.error}需要成员及以上权限`);
    return;
  }
  const forced = isHopperType((container as { blockType?: string }).blockType ?? "");
  const info = formatContainerInfo(deps, warehouse, container);

  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}容器配置`)
    .label("info", info)
    .toggle("enabled", `${uiColor.form.accent}启用容器`, {
      defaultValue: container.enabled,
      tooltip: "开启后参与路由，关闭则跳过",
    });

  if (forced) {
    form.label("hopperHint", `${uiColor.form.muted}此容器是漏斗，只能作为输入容器使用。`);
  } else {
    const roleIndex = ROLE_OPTIONS.indexOf(container.role);
    form.dropdown(
      "role",
      "容器角色",
      ROLE_OPTIONS.map((r) => ROLE_LABELS[r]),
      {
        defaultValueIndex: roleIndex >= 0 ? roleIndex : 1,
        tooltip: "角色决定路由去向：输入→单物→多物→其他",
      }
    );
  }

  // 路由优先级（1-100，数字小先处理；默认 10）
  form.slider("priority", `${uiColor.form.muted}路由优先级（1-100，小者先）`, 1, 100, {
    defaultValue: container.priority,
    valueStep: 1,
    tooltip: "决定路由处理先后（输入容器按优先级升序处理；默认 10）",
  });

  form.toggle("organize", `${uiColor.form.success}立即整理（就地排序合并堆叠）`, {
    tooltip: "忽略混乱度强制就地整理：清空→按类型排序→合并可堆叠堆",
  });

  form.toggle("warnThis", `${uiColor.form.warn}该容器容量预警`, {
    defaultValue: container.warningEnabled,
    tooltip: "关闭后该容器不再触发容量预警",
  });

  const values = await form.show(player);
  if (!values) return;

  // 整理动作优先执行
  if (values.organize === true) {
    const res = deps.organize.organizeContainer(warehouse, container, new MoveJournal());
    const name = container.id.split("@")[1] ?? container.id;
    for (const line of formatOrganizeResult(res, name)) player.sendMessage(line);
    return;
  }

  // 提交角色/启用/预警/优先级变更
  const newRole = forced ? container.role : (ROLE_OPTIONS[values.role as number] ?? container.role);
  const newPriority = values.priority as number;
  const changed =
    newRole !== container.role ||
    values.enabled !== container.enabled ||
    values.warnThis !== container.warningEnabled ||
    newPriority !== container.priority;
  if (!changed) {
    player.sendMessage(`${uiColor.chat.muted}容器设置未变化`);
    return;
  }
  container.role = newRole;
  container.enabled = values.enabled as boolean;
  container.warningEnabled = values.warnThis === true;
  container.priority = newPriority;
  refreshInputMembership(warehouse, container); // 角色/启用变更 → 刷新 inputs 成员资格
  deps.resolveIndex(warehouse.id)?.onContainerChanged(container); // 该仓自己的索引
  deps.stats.invalidate(container.id);
  // 持久化（注册表 + 索引条目）由中央订阅订阅 containerRegistryChanged 统一处理（单容器最小单位）
  deps.bus.containerRegistryChanged.trigger({
    type: "container-registry-changed",
    warehouseId: warehouse.id,
    containerId: container.id,
  });
  // 配置更新通知打印 layout 信息（v1 风格，避免仅"已更新"）
  const shortName = container.id.split("@")[1] ?? container.id;
  player.sendMessage(
    [
      `${uiColor.chat.success}容器 ${shortName} 配置已更新`,
      `${uiColor.chat.muted}角色: ${uiColor.chat.info}${ROLE_LABELS[container.role]}${forced ? "（漏斗强制输入容器）" : ""}`,
      `${uiColor.chat.muted}启用: ${uiColor.chat.info}${container.enabled ? "开启" : "关闭"}${uiColor.chat.muted}  ·  容量预警: ${uiColor.chat.info}${container.warningEnabled ? "开启" : "关闭"}`,
      `${uiColor.chat.muted}优先级: ${uiColor.chat.info}${container.priority}`,
    ].join("\n")
  );
}
