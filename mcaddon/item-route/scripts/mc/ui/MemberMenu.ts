// ─── 成员管理：**单个模态 UI**（owner 专属） ────────────────
// v2 简化（无访客）：仓库成员只有 owner（隐含）+ member。一个 ModalForm 完成全部操作：
//   · 主控件 = 下拉选择框：默认项"无" + 所有**在线且未添加**的玩家（选取即添加为 member）
//   · 下方 = 已添加成员列表：每个一行开关（开=保留 / 关=移除）
// 提交一次落所有变更（添加选中玩家 + 移除被关闭的成员），owner 不在列表中（不可移除）。
import { world, type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { Warehouse } from "../../core/model/Warehouse";
import { onlinePlayerNames } from "../util/playerName";
import * as uiColor from "./uiColor";

/** 下拉"无"选项（默认）：不添加任何人 */
const DROP_NONE = "无";

/** 玩家 ID 短显示（UUID 尾 8 位，聊天友好） */
function shortId(playerName: string): string {
  return playerName.length > 10 ? playerName.slice(-8) : playerName;
}

/**
 * 展示成员管理单模态（owner）：下拉选在线未添加玩家 → 添加为成员；成员开关列表（关=移除）。
 *
 * @param player    - 操作玩家（必须为仓库 owner，调用方已 requireRole 守卫）
 * @param deps      - 命令共享依赖门面
 * @param warehouse - 目标仓库
 */
export async function showMemberMenu(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const members = warehouse.members.filter((m) => m.playerName !== warehouse.ownerName); // owner 隐含，不可列/不可移除
  // ⚠️ getAllPlayers 可能含 undefined/字段不全项（模拟玩家进出/半初始化）→ 三级兜底取名并拒绝不安全数据
  const onlineNames = onlinePlayerNames(world.getAllPlayers());
  // 可添加候选：在线且未在成员列表、非 owner
  const addable = onlineNames.filter(
    (name) => name !== warehouse.ownerName && !warehouse.members.some((m) => m.playerName === name)
  );
  const dropdownOptions = [DROP_NONE, ...addable];

  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}成员管理 · ${warehouse.displayName}`)
    .dropdown("addPlayer", "添加成员（在线玩家）", dropdownOptions, {
      defaultValueIndex: 0,
      tooltip: "选中在线玩家 → 提交后添加为成员；选「无」则不添加",
    });

  if (members.length > 0) {
    const tooltip = "开 = 保留该成员；关 = 移除（提交生效）";
    for (const m of members) {
      form.toggle(`keep_${m.playerName}`, `${m.playerName}`, {
        defaultValue: true,
        tooltip,
      });
    }
  }
  form.label("empty", members.length === 0 ? `${uiColor.form.muted}（暂无成员）` : "");

  const values = await form.show(player);
  if (!values) return;

  // 1) 添加所选玩家（默认"无" → 不添加）
  const chosen = dropdownOptions[values.addPlayer as number];
  if (chosen !== undefined && chosen !== DROP_NONE) {
    const err = deps.warehouses.addMember(warehouse, chosen, "member");
    player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}已添加成员 ${chosen}`);
  }

  // 2) 移除被关闭的成员（开关关 = 移除）
  for (const m of members) {
    if (values[`keep_${m.playerName}`] === false) {
      const err = deps.warehouses.removeMember(warehouse, m.playerName);
      if (!err) player.sendMessage(`${uiColor.chat.success}已移除成员 ${shortId(m.playerName)}`);
    }
  }
  if (chosen === DROP_NONE && members.every((m) => values[`keep_${m.playerName}`] !== false)) {
    player.sendMessage(`${uiColor.chat.muted}成员未变更`);
  }
}