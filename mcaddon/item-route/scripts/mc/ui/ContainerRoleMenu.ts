// ─── 容器角色菜单：查看/变更角色与启用状态 ─────────────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import { isHopperType } from "../../core/model/ContainerTypes";
import { ROLE_LABELS } from "../../core/model/Container";
import type { ContainerRole } from "../../core/model/Container";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";

export async function showContainerRoleMenu(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const form = new ActionFormBuilder()
    .title(`§d容器角色 · ${warehouse.displayName}`)
    .body("选择容器（漏斗为强制 input）：");
  for (const container of warehouse.containers.values()) {
    const roleLabel = ROLE_LABELS[container.role] ?? container.role;
    form.button(`§f${container.id} §7[${roleLabel}]`, () =>
      void showContainerEdit(player, deps, warehouse, container)
    );
  }
  await form.show(player);
}

async function showContainerEdit(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse,
  container: Container
): Promise<void> {
  const isMember = requireRole(deps.members, warehouse, player.id, "member");
  const forced = isHopperType((container as { blockType?: string }).blockType ?? "");

  const roleOptions = [ROLE_LABELS.input, ROLE_LABELS.single, ROLE_LABELS.multi, ROLE_LABELS.misc];
  const form = new ModalFormBuilder()
    .title(`容器 ${container.id}`)
    .dropdown(
      "role",
      "角色",
      roleOptions,
      { defaultValueIndex: ["input", "single", "multi", "misc"].indexOf(container.role) }
    )
    .toggle("enabled", "启用", { defaultValue: container.enabled });

  const values = await form.show(player);
  if (!values) return;
  if (!isMember) {
    player.sendMessage("§c需要 member 及以上权限");
    return;
  }
  const role = Object.keys(ROLE_LABELS)[values.role as number] as ContainerRole;
  if (!forced) container.role = role;
  container.enabled = values.enabled as boolean;
  deps.index.onContainerChanged(container);
  deps.stats.invalidate(container.id);
  deps.persistContainers(warehouse);
  player.sendMessage(`§a容器 ${container.id} 已更新${forced ? "（漏斗强制 input）" : ""}`);
}