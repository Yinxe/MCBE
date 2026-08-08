// ─── 菜单信息显示开关 UI（OP 专属）：仓库级/容器级逐项开关 ──
// 控制仓库菜单/容器菜单里各**信息元素**是否显示。默认全开；
// 关闭的元素渲染方跳过对应计算（如统计/扫描/族榜），避免无效开销。
// 单模态：上半分区 = 仓库级信息元素，下半分区 = 容器级信息元素，各族一行开关；提交写穿 McModConfig。
// 配置持久化在 ir2:modcfg.menuInfo（key → boolean；清单见 core/data/MenuInfo）。
import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import {
  WAREHOUSE_INFO_ITEMS,
  CONTAINER_INFO_ITEMS,
  isMenuInfoOn,
  type MenuInfoKey,
  type ContainerInfoKey,
} from "../../core/data/MenuInfo";
import * as uiColor from "./uiColor";

/**
 * 展示菜单信息显示开关模态（管理员专属）：仓库级 + 容器级逐项开关。
 *
 * @param player - 打开面板的玩家（OP）
 * @param deps   - 命令共享依赖门面
 */
export async function showOPInfoConfigUI(player: Player, deps: CommandDeps): Promise<void> {
  const current = deps.config.menuInfo; // key → boolean（默认全开）

  const form = new ModalFormBuilder().title(`${uiColor.form.title}菜单信息显示`);

  // 仓库级分区
  form.label("whHeader", `${uiColor.form.muted}━━─ 仓库级信息 ─━━`);
  for (const item of WAREHOUSE_INFO_ITEMS) {
    form.toggle(`info_${item.key}`, item.label, {
      defaultValue: isMenuInfoOn(current, item.key as MenuInfoKey),
      tooltip: "关闭后仓库菜单/列表不再显示该项（并跳过对应计算）",
    });
  }

  // 容器级分区
  form.label("ctHeader", `${uiColor.form.muted}━━─ 容器级信息 ─━━`);
  for (const item of CONTAINER_INFO_ITEMS) {
    form.toggle(`info_${item.key}`, item.label, {
      defaultValue: isMenuInfoOn(current, item.key as ContainerInfoKey),
      tooltip: "关闭后容器配置菜单不再显示该项（并跳过对应计算）",
    });
  }

  const values = await form.show(player);
  if (!values) return;

  const next: Record<string, boolean> = {};
  for (const item of [...WAREHOUSE_INFO_ITEMS, ...CONTAINER_INFO_ITEMS]) {
    next[item.key] = values[`info_${item.key}`] === true;
  }
  deps.config.setMenuInfo(next);
  player.sendMessage(`${uiColor.chat.success}菜单信息显示已保存（关闭的项同时跳过计算）`);
}