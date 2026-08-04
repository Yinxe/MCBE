// ─── 新手引导：首次进入主菜单展示，hasSeenGuide 去重 ────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import type { McModConfig } from "../storage/McModConfig";

/** 首次使用主菜单时展示引导页；该玩家已看过则跳过 */
export async function tryShowNewPlayerGuide(player: Player, config: McModConfig): Promise<boolean> {
  if (config.hasSeenGuide(player.id)) return false;
  const form = new ActionFormBuilder()
    .title("§a物品路由 · 欢迎")
    .body(
      [
        "§f智能仓库自动分拣系统。",
        "",
        "§e开始使用：",
        "§71. /ir:create 创建仓库区域",
        "§72. 在区域内放置容器（自动注册）",
        "§73. 手持信物右键容器设置角色",
        "§74. 往 input 容器放物品 → 自动分拣",
        "",
        "§7信物默认：§f木锄 §7（可在设置更换）",
        "§7更多见 /ir:help",
      ].join("\n")
    )
    .button("知道了", () => undefined);
  await form.show(player);
  config.markSeenGuide(player.id);
  return true;
}