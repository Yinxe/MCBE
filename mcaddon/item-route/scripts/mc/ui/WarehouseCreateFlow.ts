// ─── 建仓流程：表单 → 选区会话 → 信物操作 ────────────────
import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import { ROLE_LABELS, type ContainerRole } from "../../core/model/Container";
import type { CommandDeps } from "../commands/deps";
import * as uiColor from "./uiColor";

export async function showWarehouseCreateForm(player: Player, deps: CommandDeps): Promise<void> {
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}创建仓库`) // ModalForm 深灰背景 → 浅色标题
    .textField("name", "仓库名称", { defaultValue: "我的仓库" })
    .dropdown("defaultRole", "默认容器角色", [ROLE_LABELS.input, ROLE_LABELS.single, ROLE_LABELS.multi, ROLE_LABELS.misc], { defaultValueIndex: 1 })
    .toggle("defaultEnabled", "容器默认启用", { defaultValue: true });

  const values = await form.show(player);
  if (!values) return;
  const name = (values.name as string).trim();
  const defaultRole = (Object.keys(ROLE_LABELS)[(values.defaultRole as number) ?? 1] ?? "single") as ContainerRole;
  const defaultEnabled = values.defaultEnabled as boolean;
  if (name.length === 0) {
    player.sendMessage(`${uiColor.chat.error}仓库名称不能为空`);
    return;
  }
  deps.session.set(player.id, { kind: "createWarehouse", name, defaultRole, defaultEnabled });
  player.sendMessage(`${uiColor.chat.success}已进入建仓选区模式：请手持信物右键两个对角方块完成区域选择`);
}