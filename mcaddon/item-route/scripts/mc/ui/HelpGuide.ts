// ─── 帮助手册：分节展示命令与用法 ──────────────────────────
// 分节正文走聊天栏（透明/灰背景 → chat.* 语义色）；菜单标题/按钮为
// ActionForm（标题深色头 → form 浅色；按钮浅灰 → btn 深色）。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import { chat, form, btn } from "./uiColor";

/** 帮助章节列表（设计 §12 手册结构） */
export const HELP_SECTIONS: string[] = ["快速上手", "命令一览", "容器角色", "成员与权限", "仓库管理"];

/** 分节正文（聊天栏消息） */
function sectionBody(index: number): string {
  switch (index) {
    case 0:
      return [
        `${chat.warn}快速上手`,
        `${chat.info}1. /ir:create 名称 x1 y1 z1 x2 y2 z2 建仓`,
        `${chat.info}2. 区域内放箱子/漏斗（自动注册为 single/input）`,
        `${chat.info}3. 手持信物右键容器设置角色`,
        `${chat.info}4. 往 input 放物品，自动路由到 single/multi`,
      ].join("\n");
    case 1:
      return [
        `${chat.warn}命令一览（9 条）`,
        `${chat.info}/ir:create${chat.muted} 建仓（任意）`,
        `${chat.info}/ir:resize${chat.muted} 调整区域（owner）`,
        `${chat.info}/ir:rescan${chat.muted} 重扫容器（member+）`,
        `${chat.info}/ir:rescan_preview${chat.muted} 预览重扫（member+）`,
        `${chat.info}/ir:delete${chat.muted} 删除仓库（owner）`,
        `${chat.info}/ir:menu${chat.muted} 主菜单（visitor+）`,
        `${chat.info}/ir:search${chat.muted} 在你有权限的最近仓库搜索物品（member+）`,
        `${chat.info}/ir:organize${chat.muted} 整理（任意）`,
        `${chat.info}/ir:help${chat.muted} 帮助（任意）`,
      ].join("\n");
    case 2:
      return [
        `${chat.warn}容器角色`,
        `${chat.highlight}input${chat.muted} 输入（漏斗默认）`,
        `${chat.success}single${chat.muted} 单物（绑定首槽类型）`,
        `${chat.info}multi${chat.muted} 多物（放同类型）`,
        `${chat.accent}misc${chat.muted} 杂项（兜底）`,
      ].join("\n");
    case 3:
      return [
        `${chat.warn}成员与权限`,
        `${chat.warn}owner${chat.muted} 全权限（建仓者）`,
        `${chat.success}member${chat.muted} 管理（重扫/角色）`,
        `${chat.muted}visitor${chat.muted} 只读（菜单/搜索）`,
      ].join("\n");
    default:
      return [
        `${chat.warn}仓库管理`,
        `${chat.info}/ir:menu${chat.muted} → 仓库列表 → 设置`,
        `${chat.muted}可：改名/改角色/成员/删除/统计`,
      ].join("\n");
  }
}

/**
 * 发送某一章节的帮助正文（聊天栏）。index 越界回退到末章（仓库管理）。
 *
 * @param player - 接收玩家
 * @param index  - HELP_SECTIONS 下标
 */
export function showHelpSection(player: Player, index: number): void {
  player.sendMessage(`${chat.muted}━━ ${HELP_SECTIONS[index] ?? "帮助"} ━━\n${sectionBody(index)}`);
}

/**
 * 打开帮助手册菜单：章节列表 → 点选章节 → 聊天栏输出正文。
 *
 * @param player - 打开手册的玩家
 */
export async function showHelpGuide(player: Player): Promise<void> {
  const dlg = new ActionFormBuilder().title(`${form.title}物品路由 · 帮助手册`).body(`${form.body}选择一个章节：`);
  HELP_SECTIONS.forEach((section) => {
    dlg.button(`${btn.nav}${section}`, () => showHelpSection(player, HELP_SECTIONS.indexOf(section)));
  });
  await dlg.show(player);
}
