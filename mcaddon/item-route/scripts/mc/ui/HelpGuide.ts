// ─── 帮助手册：分节展示命令与用法 ──────────────────────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";

/** 帮助章节列表（§12 手册结构） */
export const HELP_SECTIONS: string[] = [
  "快速上手",
  "命令一览",
  "容器角色",
  "成员与权限",
  "仓库管理",
];

/** 分节正文 */
function sectionBody(index: number): string {
  switch (index) {
    case 0:
      return [
        "§e快速上手",
        "1. /ir:create 名称 x1 y1 z1 x2 y2 z2 建仓",
        "2. 区域内放箱子/漏斗（自动注册为 single/input）",
        "3. 手持信物右键容器设置角色",
        "4. 往 input 放物品，自动路由到 single/multi",
      ].join("\n");
    case 1:
      return [
        "§e命令一览（9 条）",
        "§f/ir:create§7 建仓（任意）",
        "§f/ir:resize§7 调整区域（owner）",
        "§f/ir:rescan§7 重扫容器（member+）",
        "§f/ir:rescan_preview§7 预览重扫（member+）",
        "§f/ir:delete§7 删除仓库（owner）",
        "§f/ir:menu§7 主菜单（visitor+）",
        "§f/ir:search§7 搜索物品（visitor+）",
        "§f/ir:organize§7 整理（任意）",
        "§f/ir:help§7 帮助（任意）",
      ].join("\n");
    case 2:
      return [
        "§e容器角色",
        "§6input§7 输入（漏斗默认）",
        "§a§asingle§7 单物（绑定首槽类型）",
        "§9multi§7 多物（放同类型）",
        "§dmisc§7 杂项（兜底）",
      ].join("\n");
    case 3:
      return [
        "§e成员与权限",
        "§eowner§7 全权限（建仓者）",
        "§amember§7 管理（重扫/角色）",
        "§7visitor§7 只读（菜单/搜索）",
      ].join("\n");
    default:
      return [
        "§e仓库管理",
        "§f/ir:menu§7 → 仓库列表 → 设置",
        "可：改名/改角色/成员/删除/统计",
      ].join("\n");
  }
}

export function showHelpSection(player: Player, index: number): void {
  player.sendMessage(`§7━━ ${HELP_SECTIONS[index] ?? "帮助"} ━━\n${sectionBody(index)}`);
}

export async function showHelpGuide(player: Player): Promise<void> {
  const form = new ActionFormBuilder().title("§e物品路由 · 帮助手册").body("选择一个章节：");
  HELP_SECTIONS.forEach((section, i) => {
    form.button(section, () => showHelpSection(player, i));
  });
  await form.show(player);
}