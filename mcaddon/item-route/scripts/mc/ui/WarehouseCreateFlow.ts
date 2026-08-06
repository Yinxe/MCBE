// ─── 建仓流程：表单 → 选区会话 → 信物操作 ────────────────
import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import { ROLE_LABELS, type ContainerRole } from "../../core/model/Container";
import type { CommandDeps } from "../commands/deps";
import * as uiColor from "./uiColor";

/**
 * 建仓表单的默认容器角色可选集。
 * 含 "input"（输入）——输入容器由漏斗/放置位置决定，整仓默认设成 input 会让
 * 新建容器全部变成输入源而无可路由去向；故默认角色只允许 single/multi/misc。
 */
const DEFAULT_ROLE_OPTIONS: ContainerRole[] = ["single", "multi", "misc"];
const DEFAULT_ROLE_INDEX = 1; // "multi"（多物）——用户期望的新容器默认为多物聚集

export async function showWarehouseCreateForm(player: Player, deps: CommandDeps): Promise<void> {
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}创建仓库`) // ModalForm 深灰背景 → 浅色标题
    .textField("name", "仓库名称", {
      defaultValue: "我的仓库",
      tooltip: "给你的仓库取个名字，创建后可在设置中修改",
    })
    .dropdown(
      "defaultRole",
      "默认容器角色",
      DEFAULT_ROLE_OPTIONS.map((r) => ROLE_LABELS[r]),
      { defaultValueIndex: DEFAULT_ROLE_INDEX, tooltip: "新注册的容器默认分配的角色（漏斗始终为输入）" }
    )
    .toggle("defaultEnabled", "容器默认启用", {
      defaultValue: true,
      tooltip: "新注册容器默认是否参与分拣",
    });

  const values = await form.show(player);
  if (!values) return;
  const name = (values.name as string).trim();
  const defaultRole = (DEFAULT_ROLE_OPTIONS[(values.defaultRole as number) ?? DEFAULT_ROLE_INDEX] ??
    "multi") as ContainerRole;
  const defaultEnabled = values.defaultEnabled as boolean;
  if (name.length === 0) {
    player.sendMessage(`${uiColor.chat.error}仓库名称不能为空`);
    return;
  }
  deps.session.set(player.name, { kind: "createWarehouse", name, defaultRole, defaultEnabled });
  player.sendMessage(
    `${uiColor.chat.success}已进入建仓选区模式：请手持信物在两个对角普通方块上右键完成区域选择，区域内容器将自动扫描`
  );
}
